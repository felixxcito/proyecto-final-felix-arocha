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

  return { panel, vistaProfesor };
})();
