// Visor de diapositivas: la diapositiva real (PDF renderizado con pdf.js) + la explicacion de la IA
// + un boton pequeño para preguntarle a la IA sobre la diapositiva actual.
const Visor = (() => {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let cargaPdfjs = null;

  function cargarPdfjs() {
    if (!cargaPdfjs) {
      cargaPdfjs = new Promise((ok, error) => {
        const s = document.createElement('script');
        s.src = PDFJS;
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
        s.onerror = () => { cargaPdfjs = null; error(new Error('No se pudo cargar el visor de PDF')); };
        document.head.appendChild(s);
      });
    }
    return cargaPdfjs;
  }

  // ---------------------------------------------------------------- visor
  async function pintar(destino, tema, contenido, nInicial = 1) {
    const diapos = contenido.diapositivas;
    const total = diapos.length;
    let actual = Math.min(Math.max(1, nInicial || 1), total);
    let pdf = null;
    let renderizando = null;
    let consultas = [];

    destino.innerHTML = `
      <div class="visor-grid" id="visorRaiz">
        <div class="visor-slide">
          <div class="lienzo" id="lienzo"><div class="spinner"></div></div>
          <div class="controles">
            <button class="btn small" id="vAnterior" aria-label="Diapositiva anterior">← Anterior</button>
            <span id="vContador" class="muted"></span>
            <button class="btn small" id="vSiguiente" aria-label="Diapositiva siguiente">Siguiente →</button>
          </div>
        </div>
        <article class="card visor-texto" id="vTexto"></article>
      </div>
      <button class="chat-fab" id="chatFab" title="Pregúntale a la IA sobre esta diapositiva">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Pregúntale a la IA</span>
      </button>
      <section class="chat-panel hidden" id="chatPanel" aria-label="Chat con la IA">
        <header><div><strong>Dudas sobre la diapositiva <span id="chatN"></span></strong>
          <div class="muted" id="chatTitulo" style="font-size:.78rem"></div></div>
          <button class="btn small ghost" id="chatCerrar" aria-label="Cerrar">✕</button></header>
        <div class="chat-mensajes" id="chatMensajes"></div>
        <form id="chatForm">
          <textarea id="chatInput" rows="2" placeholder="¿Qué no entendiste de esta diapositiva?" maxlength="1000"></textarea>
          <button class="btn primary small" id="chatEnviar">Enviar</button>
        </form>
      </section>`;

    const $ = (id) => document.getElementById(id);
    const lienzo = $('lienzo');
    const panel = $('chatPanel');

    // ---- diapositiva
    async function mostrarPdf(n) {
      const pagina = await pdf.getPage(Math.min(n, pdf.numPages));
      const ancho = lienzo.clientWidth || 640;
      const base = pagina.getViewport({ scale: 1 });
      const escala = ancho / base.width;
      const dpr = window.devicePixelRatio || 1;
      const vp = pagina.getViewport({ scale: escala * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = '100%';
      canvas.style.aspectRatio = `${base.width} / ${base.height}`;
      renderizando?.cancel();
      renderizando = pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      try { await renderizando.promise; } catch { return; } // cancelado por un cambio rapido
      lienzo.replaceChildren(canvas);
    }

    function mostrarTexto(d, aviso) {
      const lineas = (d.texto || '').split('\n').filter(Boolean);
      lienzo.innerHTML = `<div class="slide-texto">
          <h3>${esc(lineas[0] || d.titulo)}</h3>
          <ul>${lineas.slice(1, 12).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
        </div>`;
    }

    async function ir(n) {
      actual = Math.min(Math.max(1, n), total);
      const d = diapos[actual - 1];
      $('vContador').textContent = `${actual} / ${total}`;
      $('vAnterior').disabled = actual === 1;
      $('vSiguiente').disabled = actual === total;
      $('vTexto').innerHTML = `
        <div class="semana" style="font-family:var(--mono);color:var(--accent);font-weight:600;font-size:.8rem">DIAPOSITIVA ${actual}</div>
        <h2>${esc(d.titulo)}</h2>
        <div class="explicacion">${esc(d.explicacion)}</div>
        ${actual === 1 && contenido.resumen ? `<div class="resumen" style="margin-top:1rem"><strong>Resumen de la clase</strong><p style="margin:.4rem 0 0">${esc(contenido.resumen)}</p></div>` : ''}`;
      pintarChat();
      if (pdf) await mostrarPdf(actual);
      else mostrarTexto(d, avisoVista());
    }

    const avisoVista = () => ({
      CONVIRTIENDO: 'Preparando la vista original de la diapositiva...',
      ERROR: 'No se pudo generar la vista original; se muestra el texto de la diapositiva.',
    }[tema.vistaEstado] || '');

    async function iniciarPdf() {
      try {
        const pdfjs = await cargarPdfjs();
        pdf = await pdfjs.getDocument(`/api/clases/temas/${tema.id}/diapositivas.pdf?token=${encodeURIComponent(API.token)}`).promise;
      } catch {
        pdf = null;
      }
    }

    if (tema.vistaEstado === 'LISTA') await iniciarPdf();
    if (!pdf) mostrarTexto(diapos[actual - 1], avisoVista());

    // Si el PPTX se esta convirtiendo, se consulta cada 4 s y se cambia a la vista real al terminar
    if (tema.vistaEstado === 'CONVIRTIENDO') {
      const esperar = async () => {
        if (!document.body.contains(lienzo)) return;
        const t = await API.get(`clases/temas/${tema.id}`).catch(() => null);
        if (t?.vistaEstado === 'LISTA') { tema.vistaEstado = 'LISTA'; await iniciarPdf(); ir(actual); return; }
        if (t?.vistaEstado === 'ERROR') { tema.vistaEstado = 'ERROR'; ir(actual); return; }
        setTimeout(esperar, 4000);
      };
      setTimeout(esperar, 4000);
    }

    $('vAnterior').onclick = () => ir(actual - 1);
    $('vSiguiente').onclick = () => ir(actual + 1);
    const teclas = (e) => {
      if (!document.body.contains(lienzo)) return document.removeEventListener('keydown', teclas);
      if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowRight') ir(actual + 1);
      if (e.key === 'ArrowLeft') ir(actual - 1);
    };
    document.addEventListener('keydown', teclas);
    let tResize;
    const alRedimensionar = () => {
      if (!document.body.contains(lienzo)) return window.removeEventListener('resize', alRedimensionar);
      clearTimeout(tResize);
      tResize = setTimeout(() => pdf && mostrarPdf(actual), 200);
    };
    window.addEventListener('resize', alRedimensionar);

    // ---- chat con la IA
    function pintarChat() {
      $('chatN').textContent = actual;
      $('chatTitulo').textContent = diapos[actual - 1].titulo;
      const propias = consultas.filter((c) => c.diapositiva === actual);
      $('chatMensajes').innerHTML = propias.length
        ? propias.map(burbujas).join('')
        : `<p class="muted chat-vacio">Pregunta lo que no te quedó claro de esta diapositiva. La IA responde usando su contenido.${esProfe ? '<br><br>(Tus preguntas como profesora no aparecen en el reporte de dudas.)' : ''}</p>`;
      const m = $('chatMensajes');
      m.scrollTop = m.scrollHeight;
    }
    const burbujas = (c) => `<div class="burbuja yo">${esc(c.pregunta)}</div>
      <div class="burbuja ia">${c.respuesta ? esc(c.respuesta) : '<span class="escribiendo"><i></i><i></i><i></i></span>'}</div>`;

    $('chatFab').onclick = () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) { pintarChat(); $('chatInput').focus(); }
    };
    $('chatCerrar').onclick = () => panel.classList.add('hidden');
    $('chatInput').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); }
    };
    $('chatForm').onsubmit = async (e) => {
      e.preventDefault();
      const pregunta = $('chatInput').value.trim();
      if (!pregunta) return;
      const n = actual;
      const pendiente = { diapositiva: n, pregunta, respuesta: '' };
      consultas.push(pendiente);
      $('chatInput').value = '';
      $('chatEnviar').disabled = true;
      pintarChat();
      try {
        Object.assign(pendiente, await API.post(`ia/clases/${tema.id}/consultas`, { diapositiva: n, pregunta }));
      } catch (err) {
        pendiente.respuesta = `No se pudo obtener respuesta: ${err.message}`;
      }
      $('chatEnviar').disabled = false;
      if (actual === n) pintarChat();
    };

    consultas = await API.get(`ia/clases/${tema.id}/consultas`).then((l) => (esProfe ? [] : l)).catch(() => []);
    await ir(actual);
  }

  // ---------------------------------------------------------------- reporte para la profesora
  async function pintarDudas(destino, claseId, irADiapositiva) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando dudas...</div>';
    const lista = await API.get(`ia/clases/${claseId}/consultas`);
    if (!lista.length) {
      destino.innerHTML = '<div class="estado">Todavía ningún estudiante le ha preguntado a la IA en esta clase.</div>';
      return;
    }
    const porDiapo = {};
    const porAlumno = new Map();
    for (const c of lista) {
      porDiapo[c.diapositiva] = (porDiapo[c.diapositiva] || 0) + 1;
      if (!porAlumno.has(c.usuarioId)) porAlumno.set(c.usuarioId, { nombre: c.usuarioNombre, consultas: [] });
      porAlumno.get(c.usuarioId).consultas.push(c);
    }
    const top = Object.entries(porDiapo).sort((a, b) => b[1] - a[1]).slice(0, 6);

    destino.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <h3>Diapositivas con más dudas</h3>
        <p class="muted" style="margin:.2rem 0 .8rem">${lista.length} pregunta(s) de ${porAlumno.size} estudiante(s). Haz click para ver la diapositiva.</p>
        <div class="row">${top.map(([n, k]) => `<button class="btn small" data-ir="${n}">Diapositiva ${n} · <strong>${k}</strong></button>`).join('')}</div>
      </div>
      ${[...porAlumno.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((a) => `
        <details class="card" style="margin-bottom:.7rem">
          <summary class="row" style="cursor:pointer;justify-content:space-between">
            <strong>${esc(a.nombre)}</strong><span class="badge info">${a.consultas.length} pregunta(s)</span>
          </summary>
          <div style="margin-top:1rem">${a.consultas.map((c) => `
            <div class="duda">
              <div class="row" style="justify-content:space-between;margin-bottom:.4rem">
                <button class="btn small ghost" data-ir="${c.diapositiva}">📄 Diapositiva ${c.diapositiva}</button>
                <span class="muted" style="font-size:.78rem">${fecha(c.createdAt)}</span>
              </div>
              <div class="burbuja yo">${esc(c.pregunta)}</div>
              <div class="burbuja ia">${esc(c.respuesta)}</div>
            </div>`).join('')}
          </div>
        </details>`).join('')}`;
    destino.onclick = (e) => {
      const b = e.target.closest('[data-ir]');
      if (b) { e.preventDefault(); irADiapositiva(Number(b.dataset.ir)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    };
  }

  return { pintar, pintarDudas };
})();
