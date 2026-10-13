// Solicitudes de inscripcion. El profesor las aprueba o rechaza; el estudiante las hace desde el catalogo.
const Solicitudes = (() => {
  const ESTADOS = { PENDIENTE: ['Pendiente', 'warn'], APROBADA: ['Aprobada', 'ok'], RECHAZADA: ['Rechazada', 'err'] };
  const badge = (e) => `<span class="badge ${ESTADOS[e]?.[1] || ''}">${ESTADOS[e]?.[0] || esc(e)}</span>`;

  /** Tarjeta de una solicitud pendiente: el profesor ve quien es (nombre, cedula, correo) y decide. */
  const tarjetaPendiente = (s) => `<div class="solicitud" data-id="${s.id}">
      <div class="solicitud-datos">
        <strong>${esc(s.estudianteNombre)}</strong>
        <span class="muted">Cédula ${esc(s.estudianteCedula || '—')} · ${esc(s.estudianteEmail)}</span>
        <span>${esc(s.materiaNombre)} · <strong>${esc(s.seccionNombre)}</strong>${s.horario ? ` <span class="muted">(${esc(s.horario)})</span>` : ''}</span>
        <span class="muted" style="font-size:.78rem">Pidió inscribirse el ${fecha(s.creadaEn)}</span>
      </div>
      <div class="row" style="flex-wrap:nowrap">
        <button class="btn small primary" data-resolver="true">Aprobar</button>
        <button class="btn small danger" data-resolver="false">Rechazar</button>
      </div>
    </div>`;

  /** Enlaza los botones Aprobar/Rechazar de un contenedor; `alCambiar` repinta lo que haga falta. */
  function activarBotones(contenedor, alCambiar) {
    contenedor.onclick = async (e) => {
      const b = e.target.closest('[data-resolver]');
      if (!b) return;
      const id = b.closest('.solicitud').dataset.id;
      const aprobar = b.dataset.resolver === 'true';
      b.closest('.solicitud').querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        await API.put(`clases/solicitudes/${id}`, { aprobar });
        toast(aprobar ? 'Estudiante aprobado: ya ve tus clases' : 'Solicitud rechazada');
        alCambiar();
      } catch (err) {
        toast(err.message, true);
        alCambiar();
      }
    };
  }

  /** Recuadro "Solicitudes pendientes" para el inicio del profesor. No dibuja nada si no hay. */
  async function panel(destino) {
    const pendientes = await API.get('clases/solicitudes?estado=PENDIENTE').catch(() => []);
    if (!pendientes.length) { destino.innerHTML = ''; return; }
    destino.innerHTML = `<div class="card avisos-solicitudes">
      <h2 style="margin-bottom:.2rem">Solicitudes pendientes <span class="badge warn">${pendientes.length}</span></h2>
      <p class="muted" style="margin-top:0">Estudiantes que pidieron inscribirse en tus secciones.</p>
      <div class="lista-solicitudes">${pendientes.map(tarjetaPendiente).join('')}</div>
    </div>`;
    activarBotones(destino, () => panel(destino));
  }

  /** Pantalla "Solicitudes" del profesor: pendientes arriba e historial abajo. */
  async function vistaProfesor(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando solicitudes...</div>';
    const todas = await API.get('clases/solicitudes');
    const pendientes = todas.filter((s) => s.estado === 'PENDIENTE');
    const historial = todas.filter((s) => s.estado !== 'PENDIENTE');

    destino.innerHTML = `
      <div class="page-head"><div><h1>Solicitudes de inscripción</h1>
        <p class="muted" style="margin:0">Los estudiantes eligen tu materia y sección desde el catálogo y esperan tu aprobación.</p></div></div>
      <div class="card" style="margin-bottom:1rem" id="zonaPendientes">
        <h2>Pendientes <span class="badge ${pendientes.length ? 'warn' : ''}">${pendientes.length}</span></h2>
        ${pendientes.length ? `<div class="lista-solicitudes">${pendientes.map(tarjetaPendiente).join('')}</div>`
          : '<p class="muted">No tienes solicitudes pendientes.</p>'}
      </div>
      <div class="card">
        <h2>Historial</h2>
        ${historial.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Estudiante</th><th>Cédula</th><th>Materia y sección</th><th>Estado</th><th>Resuelta</th></tr></thead>
          <tbody>${historial.map((s) => `<tr>
            <td><strong>${esc(s.estudianteNombre)}</strong><br><span class="muted">${esc(s.estudianteEmail)}</span></td>
            <td>${esc(s.estudianteCedula || '—')}</td>
            <td>${esc(s.materiaNombre)} · ${esc(s.seccionNombre)}</td>
            <td>${badge(s.estado)}</td><td>${fecha(s.resueltaEn)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Todavía no has aprobado ni rechazado a nadie.</p>'}
      </div>`;
    activarBotones(document.getElementById('zonaPendientes'), () => vistaProfesor(destino));
  }

  // ---------------------------------------------------------------- catalogo del estudiante
  /** Boton o etiqueta segun el estado del estudiante en esa seccion. */
  function accionSeccion(sec) {
    if (sec.estado === 'INSCRITO') return '<span class="badge ok">✓ Inscrito</span>';
    if (sec.estado === 'PENDIENTE') return '<span class="badge warn">Pendiente de aprobación</span>';
    const rechazada = sec.estado === 'RECHAZADA' ? '<span class="badge err" style="margin-right:.5rem">Rechazada</span>' : '';
    return `${rechazada}<button class="btn small primary" data-solicitar="${sec.id}">${sec.estado === 'RECHAZADA' ? 'Volver a solicitar' : 'Solicitar inscripción'}</button>`;
  }

  /** "Inscribirme": profesores > materias > secciones con su horario. El estudiante solicita y espera la aprobacion. */
  async function vistaCatalogo(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando el catálogo...</div>';
    const catalogo = await API.get('clases/catalogo');
    const porProfesor = new Map();
    for (const m of catalogo) {
      if (!porProfesor.has(m.profesorNombre)) porProfesor.set(m.profesorNombre, []);
      porProfesor.get(m.profesorNombre).push(m);
    }

    destino.innerHTML = `
      <div class="page-head"><div><h1>Inscribirme</h1>
        <p class="muted" style="margin:0">Elige la materia y la sección de tu profesor. Cuando él te apruebe, verás sus clases en "Mis clases".</p></div></div>
      ${[...porProfesor].map(([profesor, ms]) => `<section class="bloque-materia">
        <h2 style="margin-bottom:.7rem">📚 ${esc(profesor || 'Profesor')}</h2>
        <div class="grid">${ms.map((m) => `<div class="card">
          <h3 style="margin-bottom:.1rem">${esc(m.nombre)}</h3>
          <span class="semana" style="font-family:var(--mono);color:var(--accent);font-size:.78rem">${esc(m.codigo || '')}</span>
          ${m.descripcion ? `<p class="muted" style="margin:.4rem 0 0">${esc(m.descripcion)}</p>` : ''}
          <div class="secciones-catalogo">${m.secciones.map((sec) => `<div class="fila-seccion">
              <div><strong>${esc(sec.nombre)}</strong><br><span class="muted" style="font-size:.84rem">${esc(sec.horario || 'Horario por definir')}</span></div>
              <div>${accionSeccion(sec)}</div></div>`).join('') || '<p class="muted">Todavía no tiene secciones.</p>'}</div>
        </div>`).join('')}</div>
      </section>`).join('') || '<div class="card estado">Todavía no hay materias disponibles. Cuando un profesor cree las suyas aparecerán aquí.</div>'}`;

    destino.onclick = async (e) => {
      const b = e.target.closest('[data-solicitar]');
      if (!b) return;
      b.disabled = true;
      try {
        await API.post('clases/solicitudes', { seccionId: Number(b.dataset.solicitar) });
        toast('Solicitud enviada. Tu profesor recibirá un aviso.');
      } catch (err) { toast(err.message, true); }
      vistaCatalogo(destino);
    };
  }

  return { panel, vistaProfesor, vistaCatalogo };
})();
