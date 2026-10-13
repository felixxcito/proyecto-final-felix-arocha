// Materias y secciones: el profesor organiza sus materias, secciones y horarios.
const Secciones = (() => {
  let cache = null;

  /** Materias con sus secciones (el profesor ve las suyas; el estudiante solo donde esta inscrito). */
  async function materias(refrescar = false) {
    if (!cache || refrescar) cache = await API.get('clases/materias');
    return cache;
  }

  const etiqueta = (m) => (m.codigo ? `${m.nombre} · ${m.codigo}` : m.nombre);

  // ---------------------------------------------------------------- modales reutilizables
  function modalFormulario(titulo, campos, alGuardar) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<form class="card">
        <h2>${titulo}</h2>
        ${campos.map((c) => `<div class="field"><label>${c.label}</label>
          ${c.tipo === 'textarea' ? `<textarea name="${c.nombre}">${esc(c.valor || '')}</textarea>`
            : `<input name="${c.nombre}" value="${esc(c.valor || '')}" ${c.requerido ? 'required' : ''} placeholder="${esc(c.ayuda || '')}">`}</div>`).join('')}
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn primary">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(m);
    m.querySelector('input,textarea')?.focus();
    m.querySelector('[data-cerrar]').onclick = () => m.remove();
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await alGuardar(Object.fromEntries(new FormData(e.target)));
        m.remove();
      } catch (err) { toast(err.message, true); }
    };
  }

  /** Los estudiantes aprobados de una seccion (nombre, cedula y correo) con la opcion de darlos de baja. */
  function modalEstudiantes(seccion, materia, alCambiar) {
    const m = document.createElement('div');
    m.className = 'modal';
    const lista = seccion.estudiantesDetalle || [];
    m.innerHTML = `<div class="card modal-lista">
        <h2>Estudiantes de ${esc(seccion.nombre)}</h2>
        <p class="muted">${esc(etiqueta(materia))}${seccion.horario ? ` · ${esc(seccion.horario)}` : ''}. Entran cuando apruebas su solicitud.</p>
        <div class="lista-asistencia">${lista.map((u) => `
          <div class="asistente" style="cursor:default">
            <span class="grow"><strong>${esc(u.nombre)}</strong><br><span class="muted">${esc(u.cedula || '')}${u.email ? ` · ${esc(u.email)}` : ''}</span></span>
            <button class="btn small danger" data-quitar="${u.id}">Dar de baja</button></div>`).join('')
          || '<p class="muted" style="padding:1rem">Todavía no hay estudiantes en esta sección.</p>'}</div>
        <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="btn" data-cerrar>Cerrar</button></div>
      </div>`;
    document.body.appendChild(m);
    m.querySelector('[data-cerrar]').onclick = () => m.remove();
    m.onclick = async (e) => {
      const b = e.target.closest('[data-quitar]');
      if (!b || !confirm('¿Dar de baja a este estudiante? Perderá el acceso a las clases de la materia.')) return;
      try {
        await API.del(`clases/secciones/${seccion.id}/estudiantes/${b.dataset.quitar}`);
        toast('Estudiante dado de baja');
        m.remove();
        alCambiar();
      } catch (err) { toast(err.message, true); }
    };
  }

  // ---------------------------------------------------------------- vista del profesor
  async function vista(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando materias...</div>';
    const ms = await materias(true);

    destino.innerHTML = `
      <div class="page-head">
        <div><h1>Materias y secciones</h1>
          <p class="muted" style="margin:0">Crea tus materias, secciones y horarios. Los estudiantes los ven en el catálogo y piden inscribirse; tú los apruebas en Solicitudes.</p></div>
        <button class="btn primary" data-accion="nueva-materia">+ Nueva materia</button>
      </div>
      ${ms.map((m) => `<section class="card materia" style="margin-bottom:1rem">
        <div class="row" style="justify-content:space-between;margin-bottom:.8rem">
          <div><h2 style="margin:0">${esc(m.nombre)}</h2>
            <span class="semana" style="font-family:var(--mono);color:var(--accent);font-weight:600;font-size:.8rem">${esc(m.codigo || '')}</span></div>
          <div class="row">
            <button class="btn small" data-accion="nueva-seccion" data-materia="${m.id}">+ Sección</button>
            <button class="btn small" data-accion="editar-materia" data-materia="${m.id}">Editar</button>
            <button class="btn small danger" data-accion="borrar-materia" data-materia="${m.id}">Eliminar</button>
          </div>
        </div>
        ${m.secciones.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Sección</th><th>Horario</th><th>Estudiantes</th><th></th></tr></thead>
          <tbody>${m.secciones.map((s) => `<tr>
            <td><strong>${esc(s.nombre)}</strong></td>
            <td>${esc(s.horario || '—')}</td>
            <td><span class="badge info">${s.estudiantes.length}</span></td>
            <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
              <button class="btn small primary" data-accion="estudiantes" data-materia="${m.id}" data-seccion="${s.id}">Ver estudiantes</button>
              <button class="btn small" data-accion="editar-seccion" data-materia="${m.id}" data-seccion="${s.id}">Editar</button>
              <button class="btn small danger" data-accion="borrar-seccion" data-materia="${m.id}" data-seccion="${s.id}">Eliminar</button>
            </div></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Esta materia todavía no tiene secciones.</p>'}
      </section>`).join('') || '<p class="muted">Crea tu primera materia.</p>'}`;

    const recargar = () => vista(destino);
    destino.onclick = (e) => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      const m = ms.find((x) => x.id === Number(b.dataset.materia));
      const s = m?.secciones.find((x) => x.id === Number(b.dataset.seccion));
      const accion = b.dataset.accion;
      const camposMateria = (x) => [
        { nombre: 'nombre', label: 'Nombre', valor: x?.nombre, requerido: true, ayuda: 'Lenguajes de Programación' },
        { nombre: 'codigo', label: 'Código', valor: x?.codigo, ayuda: 'LPR07304' },
        { nombre: 'descripcion', label: 'Descripción', valor: x?.descripcion, tipo: 'textarea' },
      ];
      const camposSeccion = (x) => [
        { nombre: 'nombre', label: 'Nombre', valor: x?.nombre, requerido: true, ayuda: 'Sección 02' },
        { nombre: 'horario', label: 'Horario', valor: x?.horario, ayuda: 'Lunes y miércoles 7:00 a 9:15' },
      ];

      if (accion === 'nueva-materia') modalFormulario('Nueva materia', camposMateria(), async (d) => { await API.post('clases/materias', d); toast('Materia creada'); recargar(); });
      if (accion === 'editar-materia') modalFormulario('Editar materia', camposMateria(m), async (d) => { await API.put(`clases/materias/${m.id}`, d); toast('Materia guardada'); recargar(); });
      if (accion === 'nueva-seccion') modalFormulario(`Nueva sección · ${esc(m.nombre)}`, camposSeccion(), async (d) => { await API.post(`clases/materias/${m.id}/secciones`, d); toast('Sección creada'); recargar(); });
      if (accion === 'editar-seccion') modalFormulario('Editar sección', camposSeccion(s), async (d) => { await API.put(`clases/secciones/${s.id}`, d); toast('Sección guardada'); recargar(); });
      if (accion === 'estudiantes') modalEstudiantes(s, m, recargar);
      if (accion === 'borrar-materia' && confirm(`¿Eliminar la materia "${m.nombre}" y sus secciones?`)) {
        API.del(`clases/materias/${m.id}`).then(() => { toast('Materia eliminada'); recargar(); }).catch((err) => toast(err.message, true));
      }
      if (accion === 'borrar-seccion' && confirm(`¿Eliminar ${s.nombre}? Sus estudiantes perderán acceso a las clases de esta sección.`)) {
        API.del(`clases/secciones/${s.id}`).then(() => { toast('Sección eliminada'); recargar(); }).catch((err) => toast(err.message, true));
      }
    };
  }

  return { materias, etiqueta, vista };
})();
