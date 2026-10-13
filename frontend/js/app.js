// Aplicacion principal (SPA con rutas por hash): #/clases, #/clase/:id, #/secciones, #/solicitudes, #/inscribirme, #/admin
if (!API.token) location.href = '/';

const yo = API.usuario;
const esProfe = yo?.rol === 'profesor';
const esAdmin = yo?.rol === 'admin';
const vista = document.getElementById('vista');
let temporizador = null; // para refrescar mientras la IA procesa

document.getElementById('nombreUsuario').textContent = yo?.nombre || '';
document.getElementById('rolUsuario').textContent = esAdmin ? 'Administrador' : esProfe ? 'Profesor' : 'Estudiante';

const ESTADOS = {
  SIN_MATERIAL: ['Sin presentacion', ''],
  PROCESANDO: ['IA procesando', 'warn'],
  BORRADOR: ['Borrador', 'info'],
  PUBLICADA: ['Publicada', 'ok'],
  ERROR: ['Error', 'err'],
};
const badgeEstado = (e) => `<span class="badge ${ESTADOS[e]?.[1] || ''}">${ESTADOS[e]?.[0] || e}</span>`;

// ------------------------------------------------------------------ router
function pintarNav(ruta) {
  // Cada rol ve solo su menu
  const links = esAdmin ? [['#/admin', 'Administración']]
    : esProfe ? [['#/clases', 'Clases'], ['#/secciones', 'Secciones'], ['#/solicitudes', 'Solicitudes']]
      : [['#/clases', 'Mis clases'], ['#/inscribirme', 'Inscribirme']];
  links.push(['/como-lo-hicimos.html', 'Cómo lo construimos']);
  document.getElementById('nav').innerHTML = links
    .map(([href, txt]) => `<a href="${href}" class="${href.startsWith('#') && ruta.startsWith(href.slice(1)) ? 'active' : ''}">${txt}</a>`).join('');
}

async function router() {
  clearTimeout(temporizador);
  const ruta = location.hash.slice(1) || (esAdmin ? '/admin' : '/clases');
  pintarNav(ruta);
  window.scrollTo(0, 0);
  try {
    const m = ruta.match(/^\/clase\/(\d+)(?:\/(\w+))?/);
    if (m) await vistaClase(Number(m[1]), m[2]);
    else if (esAdmin) await Admin.vista(vista);
    else if (ruta.startsWith('/secciones') && esProfe) await Secciones.vista(vista);
    else if (ruta.startsWith('/solicitudes') && esProfe) await Solicitudes.vistaProfesor(vista);
    else if (ruta.startsWith('/inscribirme') && !esProfe) await Solicitudes.vistaCatalogo(vista);
    else await vistaClases();
  } catch (e) {
    vista.innerHTML = `<div class="card estado err">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', router);

// ------------------------------------------------------------------ lista de clases
async function vistaClases() {
  vista.innerHTML = '<div class="row"><div class="spinner"></div> Cargando clases...</div>';
  const [temas, extra, materias] = await Promise.all([
    API.get('clases/temas'),
    (esProfe ? API.get('ia/estadisticas') : API.get('ia/mis-asignaciones')).catch(() => []),
    Secciones.materias(true),
  ]);
  const porClase = new Map(extra.map((x) => [x.claseId, x]));
  // Un bloque por materia; el estudiante solo recibe las materias y temas de sus secciones
  const bloques = materias.map((m) => ({ m, temas: temas.filter((t) => t.materiaId === m.id) }))
    .filter((b) => esProfe || b.temas.length);

  vista.innerHTML = `
    ${esProfe ? '<div id="panelSolicitudes"></div>' : ''}
    <div class="page-head">
      <div>
        <h1>${esProfe ? 'Tus clases' : 'Mis clases'}</h1>
        <p class="muted" style="margin:0">${esProfe
          ? 'Sube la presentación de cada tema: la IA la explica y genera preguntas distintas para cada estudiante.'
          : 'Abre una clase publicada para ver la explicación de cada diapositiva y responder tus preguntas.'}</p>
      </div>
      ${esProfe ? '<button class="btn primary" id="btnNuevo">+ Nuevo tema</button>' : ''}
    </div>
    ${bloques.map(({ m, temas: ts }) => `<section class="bloque-materia">
      <div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:.7rem">
        <h2 style="margin:0">${esc(m.nombre)} <span class="semana" style="font-family:var(--mono);color:var(--accent);font-size:.8rem">${esc(m.codigo || '')}</span></h2>
        <span class="muted" style="font-size:.85rem">${esProfe
          ? `${m.secciones.length} sección(es) · ${m.secciones.reduce((n, s) => n + s.estudiantes.length, 0)} estudiante(s)`
          : esc(m.secciones.map((x) => x.nombre).join(', '))}</span>
      </div>
      <div class="grid">${ts.map((t) => tarjetaClase(t, porClase.get(t.id), m)).join('') || '<p class="muted">Aún no hay temas en esta materia.</p>'}</div>
    </section>`).join('') || `<div class="card estado">${esProfe ? 'Crea tu primera materia en <a href="#/secciones">Secciones</a>: agrega sus secciones y horarios para que los estudiantes puedan solicitar inscripción.'
      : 'Todavía no estás inscrito en ninguna materia. Entra a <a href="#/inscribirme">Inscribirme</a>, elige a tu profesor y solicita tu sección.'}</div>`}`;

  if (esProfe) {
    document.getElementById('btnNuevo').onclick = () => modalTema();
    // Lo primero que ve el profesor: quien pide entrar a sus materias
    Solicitudes.panel(document.getElementById('panelSolicitudes'), vistaClases);
  }
}

// Al estudiante, Java le dice si tiene acceso (inscrito + publicada + presente si es privada): el frontend no reconstruye la regla
const tengoAcceso = (t) => esProfe || t.acceso === true;

function tarjetaClase(t, extra, materia) {
  const visible = tengoAcceso(t);
  let pie = '';
  if (esProfe && extra) pie = `<span class="muted" style="font-size:.85rem">${extra.entregadas}/${extra.total} entregas</span>`;
  if (!esProfe && extra) pie = extra.entregada ? '<span class="badge ok">Respuestas entregadas</span>' : '<span class="badge warn">Preguntas pendientes</span>';
  const privada = t.privada ? ' <span class="badge info">🔒 Privada</span>' : '';
  const etiqueta = esProfe ? `<span>${badgeEstado(t.estado)}${privada}</span>`
    : (visible ? privada : (t.privada && t.estado === 'PUBLICADA' ? '<span class="badge">🔒 Solo asistentes</span>' : '<span class="badge">Próximamente</span>'));
  const tag = visible ? 'a' : 'div';
  return `<${tag} class="card clase-card ${visible ? '' : 'bloqueada'}" ${visible ? `href="#/clase/${t.id}"` : ''}>
      <div class="row" style="justify-content:space-between"><span class="semana">SEMANA ${esc(t.semana ?? '—')}</span>${etiqueta}</div>
      <h3>${esc(t.titulo)}</h3>
      <div class="desc">${esc(t.descripcion || '')}</div>
      ${esProfe ? `<div class="muted" style="font-size:.8rem">👥 ${esc(textoSecciones(t, materia))}</div>` : ''}
      <div class="row" style="justify-content:space-between">${pie}${t.archivoNombre && esProfe ? `<span class="muted" style="font-size:.8rem">📎 ${esc(t.archivoNombre)}</span>` : ''}</div>
    </${tag}>`;
}

/** "Todas las secciones" o la lista de secciones elegidas para el tema. */
function textoSecciones(t, materia) {
  if (!materia) return 'Sin materia';
  if (!t.secciones?.length) return `Todas las secciones (${materia.secciones.length})`;
  return materia.secciones.filter((s) => t.secciones.includes(s.id)).map((s) => s.nombre).join(', ') || 'Ninguna sección';
}

async function modalTema(tema) {
  const materias = await Secciones.materias(true);
  if (!materias.length) {
    toast('Primero crea una materia en Secciones', true);
    location.hash = '#/secciones';
    return;
  }
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<form class="card">
      <h2>${tema ? 'Editar tema' : 'Nuevo tema'}</h2>
      <div class="field"><label>Materia</label>
        <select name="materiaId" required>${materias.map((x) => `<option value="${x.id}" ${x.id === tema?.materiaId ? 'selected' : ''}>${esc(Secciones.etiqueta(x))}</option>`).join('')}</select></div>
      <div class="row">
        <div class="field" style="width:110px"><label>Semana</label><input name="semana" type="number" min="1" max="30" value="${esc(tema?.semana ?? '')}"></div>
        <div class="field grow"><label>Título</label><input name="titulo" required value="${esc(tema?.titulo || '')}"></div>
      </div>
      <div class="field"><label>Descripción</label><textarea name="descripcion">${esc(tema?.descripcion || '')}</textarea></div>
      <div class="field"><label>Visible para</label><div id="checkSecciones" class="row"></div>
        <div class="muted" style="font-size:.8rem;margin-top:.3rem">Si no marcas ninguna, la ven todas las secciones de la materia.</div></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn primary">Guardar</button>
      </div>
    </form>`;
  document.body.appendChild(m);
  const select = m.querySelector('select[name=materiaId]');
  const pintarSecciones = () => {
    const materia = materias.find((x) => x.id === Number(select.value));
    const elegidas = new Set(Number(select.value) === tema?.materiaId ? tema.secciones : []);
    m.querySelector('#checkSecciones').innerHTML = materia.secciones.map((s) => `
      <label class="chip-check"><input type="checkbox" value="${s.id}" ${elegidas.has(s.id) ? 'checked' : ''}> ${esc(s.nombre)}</label>`).join('')
      || '<span class="muted">Esta materia no tiene secciones todavía.</span>';
  };
  select.onchange = pintarSecciones;
  pintarSecciones();
  m.querySelector('[data-cerrar]').onclick = () => m.remove();
  m.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const datos = {
      semana: f.get('semana') ? Number(f.get('semana')) : null,
      titulo: f.get('titulo'),
      descripcion: f.get('descripcion'),
      materiaId: Number(f.get('materiaId')),
      secciones: [...m.querySelectorAll('#checkSecciones input:checked')].map((c) => Number(c.value)),
    };
    try {
      if (tema) await API.put(`clases/temas/${tema.id}`, datos);
      else await API.post('clases/temas', datos);
      m.remove();
      toast('Tema guardado');
      router();
    } catch (err) { toast(err.message, true); }
  };
}

// ------------------------------------------------------------------ detalle de clase
const enClase = (id) => new RegExp(`^#/clase/${id}(/|$)`).test(location.hash);
async function vistaClase(id, tabInicial) {
  vista.innerHTML = '<div class="row"><div class="spinner"></div> Cargando clase...</div>';
  const tema = await API.get(`clases/temas/${id}`);
  if (!tengoAcceso(tema)) {
    vista.innerHTML = `<a class="btn small" href="#/clases">← Todas las clases</a>
      <div class="card estado" style="margin-top:1rem">🔒 ${tema.privada ? 'Esta clase es privada: tu profesor te dará acceso al pasar la lista.' : 'Esta clase todavía no está publicada.'}</div>`;
    return;
  }
  const contenido = tema.archivoNombre ? await API.get(`ia/clases/${id}/contenido`).catch(() => null) : null;
  const materia = (await Secciones.materias()).find((x) => x.id === tema.materiaId);

  vista.innerHTML = `
    <a class="btn small" href="#/clases" style="margin-bottom:1rem">← Todas las clases</a>
    <div class="page-head">
      <div>
        <div class="semana" style="font-family:var(--mono);color:var(--accent);font-weight:600">SEMANA ${esc(tema.semana ?? '—')}</div>
        <h1>${esc(tema.titulo)}</h1>
        <p class="muted" style="margin:0">${esc(tema.descripcion || '')}</p>
        ${materia ? `<p style="margin:.4rem 0 0;font-size:.88rem">📚 ${esc(Secciones.etiqueta(materia))}${esProfe ? ` · 👥 ${esc(textoSecciones(tema, materia))}` : ''}</p>` : ''}
      </div>
      ${esProfe ? `<div class="row">
        <button class="btn small" id="btnEditar">Editar</button>
        <button class="btn small danger" id="btnEliminar">Eliminar</button></div>` : ''}
    </div>
    ${esProfe ? panelProfesor(tema, contenido) : ''}
    <div class="tabs" id="tabs"></div>
    <div id="tabContenido"></div>`;

  const tabs = [];
  const hayDiapos = contenido?.diapositivas?.length;
  if (hayDiapos) tabs.push(['ver', 'Ver clase']);
  if (hayDiapos) tabs.push(['diapos', esProfe ? 'Editar explicaciones' : 'Todas las explicaciones']);
  if (!esProfe) tabs.push(['preguntas', 'Mis preguntas']);
  if (esProfe && tema.estado === 'PUBLICADA') tabs.push(['respuestas', 'Respuestas de estudiantes']);
  if (esProfe && tema.estado === 'PUBLICADA') tabs.push(['dudas', 'Dudas a la IA']);

  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = tabs.map(([k, t]) => `<button data-tab="${k}">${t}</button>`).join('');
  const abrir = (k, diapositiva) => {
    clearTimeout(temporizador);
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
    const destino = document.getElementById('tabContenido');
    destino.onclick = null;
    if (k === 'ver') Visor.pintar(destino, tema, contenido, diapositiva);
    if (k === 'diapos') pintarDiapositivas(destino, id, contenido);
    if (k === 'preguntas') pintarMisPreguntas(destino, id);
    if (k === 'respuestas') pintarRespuestas(destino, id);
    if (k === 'dudas') Visor.pintarDudas(destino, id, (n) => abrir('ver', n));
  };
  tabsEl.onclick = (e) => e.target.dataset.tab && abrir(e.target.dataset.tab);
  if (tabs.length) abrir(tabs.some(([k]) => k === tabInicial) ? tabInicial : tabs[0][0]);

  if (esProfe) {
    document.getElementById('btnEditar').onclick = () => modalTema(tema);
    document.getElementById('btnEliminar').onclick = async () => {
      if (!confirm(`¿Eliminar "${tema.titulo}" con su presentación, explicaciones y respuestas?`)) return;
      await API.del(`clases/temas/${id}`);
      toast('Tema eliminado');
      location.hash = '#/clases';
    };
    activarPanelProfesor(tema);
  }
  // Mientras la IA procesa, se refresca cada 4 segundos
  const trabajando = tema.estado === 'PROCESANDO' || (esProfe && (tema.mensajeEstado || '').includes('Generando'));
  if (trabajando) temporizador = setTimeout(() => enClase(id) && vistaClase(id), 4000);
}

function panelProfesor(tema, contenido) {
  const claseEstado = { ERROR: 'err', PUBLICADA: 'ok' }[tema.estado] || '';
  const spinner = tema.estado === 'PROCESANDO' || (tema.mensajeEstado || '').includes('Generando') ? '<div class="spinner"></div>' : '';
  const modo = contenido?.modo === 'demo' ? ' <span class="badge warn">modo demo</span>' : '';
  return `<div class="card" style="margin-bottom:1rem">
    <div class="row" style="justify-content:space-between;margin-bottom:.8rem">
      <h3 style="margin:0">Presentación ${badgeEstado(tema.estado)}${modo}</h3>
      <div class="row">
        ${tema.archivoNombre ? `<a class="btn small" target="_blank" href="/api/clases/temas/${tema.id}/archivo?token=${encodeURIComponent(API.token)}">Ver archivo</a>` : ''}
        ${contenido?.diapositivas?.length ? '<button class="btn small" id="btnRegenerar">Regenerar con IA</button>' : ''}
        ${['BORRADOR', 'PUBLICADA'].includes(tema.estado) ? `<button class="btn small primary" id="btnPublicar">${tema.estado === 'PUBLICADA' ? 'Asignar a nuevos estudiantes' : 'Publicar a estudiantes'}</button>` : ''}
      </div>
    </div>
    ${tema.mensajeEstado ? `<div class="estado ${claseEstado}" style="margin-bottom:.8rem">${spinner}<span>${esc(tema.mensajeEstado)}</span></div>` : ''}
    <div class="config-clase">
      <div class="field" style="margin:0">
        <label for="cfgPreguntas">Preguntas por estudiante</label>
        <div class="row" style="flex-wrap:nowrap">
          <input id="cfgPreguntas" type="number" min="1" max="20" value="${tema.preguntasPorEstudiante || 5}" style="width:80px">
          <button class="btn small" id="btnGuardarPreguntas">Guardar</button>
        </div>
      </div>
      <div class="field" style="margin:0">
        <label>Acceso</label>
        <div class="segmento" role="radiogroup">
          <button class="${tema.privada ? '' : 'activo'}" data-privada="false">Todos los estudiantes</button>
          <button class="${tema.privada ? 'activo' : ''}" data-privada="true">🔒 Solo asistentes</button>
        </div>
      </div>
      ${tema.privada ? `<div class="field" style="margin:0"><label>Lista de asistencia</label>
        <button class="btn small primary" id="btnLista">✓ Pasar lista (${(tema.asistentes || []).length} presentes)</button></div>` : ''}
    </div>
    ${tema.estado === 'PUBLICADA' ? '<p class="muted" style="font-size:.8rem;margin:.2rem 0 .8rem">Los cambios en la cantidad de preguntas aplican a los estudiantes que reciban acceso desde ahora.</p>' : ''}
    <label class="dropzone" id="drop">
      <input type="file" id="archivo" accept=".pdf,.pptx" hidden>
      <strong>${tema.archivoNombre ? `📎 ${esc(tema.archivoNombre)} — click para reemplazar` : 'Arrastra aquí tu presentación o haz click'}</strong>
      <div class="muted" style="font-size:.85rem">PDF o PPTX · máx. 50 MB · la IA explicará cada diapositiva</div>
    </label>
  </div>`;
}

async function guardarConfiguracion(tema, cambios, mensaje) {
  try {
    await API.put(`clases/temas/${tema.id}/configuracion`, cambios);
    toast(mensaje);
    vistaClase(tema.id);
  } catch (e) { toast(e.message, true); }
}

async function modalLista(tema) {
  // Los inscritos (con nombre, cedula y correo) ya vienen dentro de cada seccion: Java los entrega al profesor dueno
  const materias = await Secciones.materias(true);
  const materia = materias.find((x) => x.id === tema.materiaId);
  const secciones = (materia?.secciones || []).filter((s) => !tema.secciones?.length || tema.secciones.includes(s.id));
  const presentes = new Set(tema.asistentes || []);
  let actual = secciones[0];
  const alumnos = (s) => [...(s.estudiantesDetalle || [])].sort((a, b) => a.nombre.localeCompare(b.nombre));

  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<form class="card modal-lista">
      <h2>Pasar lista</h2>
      <p class="muted" style="margin-bottom:.6rem">${tema.estado === 'PUBLICADA'
        ? 'Toca a cada estudiante presente. Al guardar, los nuevos reciben acceso, sus preguntas y una notificación.'
        : 'Toca a cada estudiante presente. Recibirán acceso cuando publiques la clase.'}</p>
      ${secciones.length ? `<div class="segmento" id="tabsSeccion" style="margin-bottom:.7rem;flex-wrap:wrap">${secciones.map((s) =>
        `<button type="button" data-sec="${s.id}">${esc(s.nombre)}</button>`).join('')}</div>
      <div class="row" style="margin-bottom:.6rem">
        <input id="filtroLista" class="grow" style="width:auto" placeholder="Buscar en la sección...">
        <button type="button" class="btn small" id="todosPresentes">Todos presentes</button>
        <button type="button" class="btn small" id="ninguno">Ninguno</button>
      </div>
      <div class="lista-asistencia" id="listaAlumnos"></div>`
      : '<div class="estado">Esta materia todavía no tiene secciones con estudiantes aprobados. Revisa tus <a href="#/solicitudes">solicitudes</a>.</div>'}
      <div class="row" style="justify-content:space-between;margin-top:1rem">
        <span class="muted" id="cuentaLista"></span>
        <div class="row"><button type="button" class="btn" data-cerrar>Cancelar</button>
        <button class="btn primary" ${secciones.length ? '' : 'disabled'}>Guardar asistencia</button></div>
      </div>
    </form>`;
  document.body.appendChild(m);

  const contar = () => {
    if (!actual) return;
    const enSeccion = alumnos(actual).filter((u) => presentes.has(u.id)).length;
    m.querySelector('#cuentaLista').textContent = `${enSeccion} de ${alumnos(actual).length} en ${actual.nombre} · ${presentes.size} presentes en total`;
  };
  const pintar = () => {
    m.querySelectorAll('#tabsSeccion button').forEach((b) => b.classList.toggle('activo', Number(b.dataset.sec) === actual.id));
    const lista = alumnos(actual);
    m.querySelector('#listaAlumnos').innerHTML = lista.map((u) => `
      <label class="asistente"><input type="checkbox" value="${u.id}" ${presentes.has(u.id) ? 'checked' : ''}>
        <span class="grow"><strong>${esc(u.nombre)}</strong><br><span class="muted">${esc(u.cedula || '')}${u.email ? ` · ${esc(u.email)}` : ''}</span></span>
        <span class="marca">${presentes.has(u.id) ? 'Presente' : 'Ausente'}</span></label>`).join('')
      || '<p class="muted" style="padding:1rem">No hay estudiantes inscritos en esta sección.</p>';
    m.querySelector('#filtroLista').value = '';
    contar();
  };
  if (actual) {
    pintar();
    m.querySelector('#tabsSeccion').onclick = (e) => {
      const b = e.target.closest('[data-sec]');
      if (b) { actual = secciones.find((s) => s.id === Number(b.dataset.sec)); pintar(); }
    };
    m.querySelector('#listaAlumnos').onchange = (e) => {
      const id = Number(e.target.value);
      if (e.target.checked) presentes.add(id); else presentes.delete(id);
      e.target.closest('.asistente').querySelector('.marca').textContent = e.target.checked ? 'Presente' : 'Ausente';
      contar();
    };
    m.querySelector('#filtroLista').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      m.querySelectorAll('.asistente').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(q); });
    };
    const marcar = (valor) => {
      alumnos(actual).forEach((u) => (valor ? presentes.add(u.id) : presentes.delete(u.id)));
      pintar();
    };
    m.querySelector('#todosPresentes').onclick = () => marcar(true);
    m.querySelector('#ninguno').onclick = () => marcar(false);
  }
  m.querySelector('[data-cerrar]').onclick = () => m.remove();
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    m.remove();
    guardarConfiguracion(tema, { privada: true, asistentes: [...presentes] }, `Asistencia guardada: ${presentes.size} presente(s)`);
  };
}

function activarPanelProfesor(tema) {
  document.getElementById('btnGuardarPreguntas').onclick = () => {
    const n = Number(document.getElementById('cfgPreguntas').value);
    if (!(n >= 1 && n <= 20)) return toast('Elige entre 1 y 20 preguntas', true);
    guardarConfiguracion(tema, { preguntasPorEstudiante: n }, `Cada estudiante recibirá ${n} preguntas`);
  };
  document.querySelectorAll('[data-privada]').forEach((b) => {
    b.onclick = () => {
      const privada = b.dataset.privada === 'true';
      if (privada === Boolean(tema.privada)) return;
      if (privada && tema.estado === 'PUBLICADA'
        && !confirm('Solo los estudiantes que marques en la lista podrán ver la clase. ¿Continuar?')) return;
      guardarConfiguracion(tema, { privada }, privada ? 'Clase privada: ahora pasa la lista' : 'Clase abierta para todos los estudiantes');
    };
  });
  const lista = document.getElementById('btnLista');
  if (lista) lista.onclick = () => modalLista(tema).catch((e) => toast(e.message, true));

  const drop = document.getElementById('drop');
  const input = document.getElementById('archivo');
  const subir = async (archivo) => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    drop.innerHTML = '<div class="row" style="justify-content:center"><div class="spinner"></div> Subiendo...</div>';
    try {
      await API.post(`clases/temas/${tema.id}/presentacion`, fd);
      toast('Presentación subida. La IA está trabajando...');
    } catch (e) { toast(e.message, true); }
    vistaClase(tema.id);
  };
  input.onchange = () => subir(input.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); subir(e.dataTransfer.files[0]); };

  const pub = document.getElementById('btnPublicar');
  if (pub) pub.onclick = async () => {
    pub.disabled = true;
    try {
      await API.post(`clases/temas/${tema.id}/publicar`);
      toast('Clase publicada. Se están generando las preguntas y avisando a los estudiantes.');
      vistaClase(tema.id);
    } catch (e) { toast(e.message, true); pub.disabled = false; }
  };
  const regen = document.getElementById('btnRegenerar');
  if (regen) regen.onclick = async () => {
    if (!confirm('Se reemplazarán las explicaciones actuales (incluidas tus correcciones). ¿Continuar?')) return;
    regen.disabled = true;
    regen.textContent = 'Generando...';
    try {
      await API.post(`ia/clases/${tema.id}/regenerar`);
      toast('Explicaciones regeneradas');
      vistaClase(tema.id);
    } catch (e) { toast(e.message, true); regen.disabled = false; regen.textContent = 'Regenerar con IA'; }
  };
}

function pintarDiapositivas(destino, id, c) {
  destino.innerHTML = `
    ${esProfe ? `<p class="muted">Puedes corregir lo que escribió la IA antes de publicar. ${c.modo === 'demo' ? '<strong>Estás en modo demo: configura NVIDIA_API_KEY en el .env para usar IA real.</strong>' : ''}</p>` : ''}
    <div class="resumen"><strong>Resumen de la clase</strong>
      ${esProfe ? `<textarea id="resumen" style="margin-top:.5rem">${esc(c.resumen)}</textarea>` : `<p style="margin:.4rem 0 0">${esc(c.resumen)}</p>`}
    </div>
    <div class="card">${c.diapositivas.map((d) => `
      <div class="slide">
        <div class="num">${d.n}</div>
        <div>
          <h3>${esc(d.titulo)}</h3>
          ${esProfe ? `<textarea data-n="${d.n}" rows="5">${esc(d.explicacion)}</textarea>` : `<div class="explicacion">${esc(d.explicacion)}</div>`}
          ${d.texto ? `<details><summary>Texto original de la diapositiva</summary><pre>${esc(d.texto)}</pre></details>` : ''}
        </div>
      </div>`).join('')}
    </div>
    ${esProfe ? '<div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="btn primary" id="btnGuardarExp">Guardar cambios</button></div>' : ''}`;

  if (esProfe) document.getElementById('btnGuardarExp').onclick = async () => {
    const diapositivas = [...destino.querySelectorAll('textarea[data-n]')].map((t) => ({ n: Number(t.dataset.n), explicacion: t.value }));
    try {
      await API.put(`ia/clases/${id}/contenido`, { resumen: document.getElementById('resumen').value, diapositivas });
      toast('Cambios guardados');
    } catch (e) { toast(e.message, true); }
  };
}

async function pintarMisPreguntas(destino, id) {
  destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando tus preguntas...</div>';
  let a;
  try {
    a = await API.get(`ia/clases/${id}/mis-preguntas`);
  } catch (e) {
    destino.innerHTML = `<div class="estado"><div class="spinner"></div>${esc(e.message)}</div>`;
    temporizador = setTimeout(() => enClase(id) && pintarMisPreguntas(destino, id), 5000);
    return;
  }
  const bloqueado = a.entregada ? 'disabled' : '';
  destino.innerHTML = `<div class="card">
    <p class="muted">${a.entregada ? `Entregaste tus respuestas el ${fecha(a.entregadaEn)}.` : `Estas ${a.preguntas.length} preguntas son solo tuyas: ningún compañero tiene las mismas.`}</p>
    ${a.preguntas.map((p, i) => `<div class="pregunta">
        <div class="q"><span>${i + 1}.</span>${esc(p.texto)}</div>
        <textarea data-id="${p._id}" ${bloqueado} placeholder="Escribe tu respuesta...">${esc(p.respuesta)}</textarea>
      </div>`).join('')}
    ${a.entregada ? '<span class="badge ok">Entregado</span>' : `<div class="row" style="justify-content:flex-end">
      <button class="btn" id="btnBorrador">Guardar borrador</button>
      <button class="btn primary" id="btnEntregar">Entregar respuestas</button></div>`}
  </div>`;
  if (a.entregada) return;
  const enviar = async (entregar) => {
    const respuestas = [...destino.querySelectorAll('textarea')].map((t) => ({ id: t.dataset.id, respuesta: t.value }));
    if (entregar && !confirm('Una vez entregadas no podrás modificarlas. ¿Entregar?')) return;
    try {
      await API.put(`ia/clases/${id}/mis-preguntas`, { respuestas, entregar });
      toast(entregar ? '¡Respuestas entregadas! Tu profesor fue notificado.' : 'Borrador guardado');
      if (entregar) pintarMisPreguntas(destino, id);
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('btnBorrador').onclick = () => enviar(false);
  document.getElementById('btnEntregar').onclick = () => enviar(true);
}

async function pintarRespuestas(destino, id) {
  destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando respuestas...</div>';
  const lista = await API.get(`ia/clases/${id}/respuestas`);
  if (!lista.length) {
    destino.innerHTML = '<div class="estado"><div class="spinner"></div>Generando preguntas para los estudiantes... (si no hay estudiantes, créalos en Usuarios)</div>';
    temporizador = setTimeout(() => enClase(id) && pintarRespuestas(destino, id), 5000);
    return;
  }
  const entregadas = lista.filter((a) => a.entregada).length;
  destino.innerHTML = `<p class="muted">${entregadas} de ${lista.length} estudiantes entregaron.</p>
    ${lista.map((a) => `<details class="card" style="margin-bottom:.7rem">
      <summary class="row" style="cursor:pointer;justify-content:space-between">
        <strong>${esc(a.estudianteNombre)}</strong>
        ${a.entregada ? `<span class="badge ok">Entregó · ${fecha(a.entregadaEn)}</span>` : '<span class="badge warn">Pendiente</span>'}
      </summary>
      <div style="margin-top:1rem">${a.preguntas.map((p, i) => `<div class="pregunta" data-aid="${a._id}" data-pid="${p._id}">
        <div class="q row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
          <div><span>${i + 1}.</span><span class="texto-pregunta">${esc(p.texto)}</span></div>
          ${a.entregada ? '' : '<button class="btn small ghost" data-editar-pregunta title="Corregir la pregunta">✏️</button>'}
        </div>
        <div class="explicacion ${p.respuesta ? '' : 'muted'}">${esc(p.respuesta || 'Sin responder')}</div></div>`).join('')}
      </div>
    </details>`).join('')}`;

  destino.onclick = async (e) => {
    const b = e.target.closest('[data-editar-pregunta]');
    if (!b) return;
    const caja = b.closest('.pregunta');
    const actual = caja.querySelector('.texto-pregunta').textContent;
    caja.querySelector('.q').innerHTML = `<div class="grow"><textarea rows="2">${esc(actual)}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:.4rem"><button class="btn small" data-cancelar>Cancelar</button>
      <button class="btn small primary" data-guardar>Guardar pregunta</button></div></div>`;
    caja.querySelector('[data-cancelar]').onclick = () => pintarRespuestas(destino, id);
    caja.querySelector('[data-guardar]').onclick = async () => {
      try {
        await API.put(`ia/clases/${id}/asignaciones/${caja.dataset.aid}/preguntas/${caja.dataset.pid}`, { texto: caja.querySelector('textarea').value });
        toast('Pregunta actualizada');
        pintarRespuestas(destino, id);
      } catch (err) { toast(err.message, true); }
    };
  };
}

// ------------------------------------------------------------------ notificaciones (campanita)
const panel = document.getElementById('panelNotif');
let ultimaNotificacion = null; // para mostrar un aviso cuando llega una nueva
async function cargarNotificaciones() {
  try {
    const { noLeidas, notificaciones } = await API.get('notificaciones/');
    const maxId = Math.max(0, ...(notificaciones || []).map((n) => n.ID));
    if (ultimaNotificacion !== null && maxId > ultimaNotificacion) {
      const nueva = notificaciones.find((n) => n.ID === maxId);
      if (nueva && !nueva.leida) toast(`🔔 ${nueva.titulo}`);
    }
    ultimaNotificacion = maxId;
    const contador = document.getElementById('contador');
    contador.textContent = noLeidas > 9 ? '9+' : noLeidas;
    contador.classList.toggle('hidden', !noLeidas);
    panel.innerHTML = `<div class="head">Notificaciones ${noLeidas ? '<button class="btn small ghost" id="leerTodas">Marcar todas</button>' : ''}</div>
      ${(notificaciones || []).map((n) => `<div class="notif ${n.leida ? '' : 'nueva'}" data-id="${n.ID}" data-enlace="${esc(n.enlace)}">
        <div class="t">${esc(n.titulo)}</div><div>${esc(n.mensaje)}</div><div class="f">${fecha(n.CreatedAt)}${n.correoEnviado ? ' · ✉ correo enviado' : ''}</div>
      </div>`).join('') || '<div class="notif muted">No tienes notificaciones.</div>'}`;
  } catch { /* el servicio puede estar arrancando */ }
}
document.getElementById('btnCampana').onclick = (e) => { e.stopPropagation(); panel.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!panel.contains(e.target)) panel.classList.add('hidden'); });
panel.onclick = async (e) => {
  e.stopPropagation();
  if (e.target.id === 'leerTodas') { await API.post('notificaciones/leer-todas'); return cargarNotificaciones(); }
  const n = e.target.closest('.notif[data-id]');
  if (!n) return;
  await API.patch(`notificaciones/${n.dataset.id}/leida`).catch(() => {});
  const hash = n.dataset.enlace.split('#')[1];
  if (hash && location.hash === `#${hash}`) router();
  else if (hash) location.hash = `#${hash}`;
  panel.classList.add('hidden');
  cargarNotificaciones();
};
cargarNotificaciones();
setInterval(cargarNotificaciones, 10000);

router();
