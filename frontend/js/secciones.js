// Materias y secciones: la profesora organiza a sus estudiantes por materia y seccion.
const Secciones = (() => {
  let cache = null;

  /** Materias con sus secciones (la profesora ve todas; el estudiante solo las suyas). */
  async function materias(refrescar = false) {
    if (!cache || refrescar) cache = await API.get('clases/materias');
    return cache;
  }

  const etiqueta = (m) => (m.codigo ? `${m.nombre} · ${m.codigo}` : m.nombre);

  /** <option>s agrupadas por materia para elegir la seccion de un estudiante. */
  function opciones(ms) {
    return '<option value="">Sin sección</option>' + ms.map((m) => `<optgroup label="${esc(etiqueta(m))}">
      ${m.secciones.map((s) => `<option value="${s.id}">${esc(s.nombre)}${s.horario ? ` · ${esc(s.horario)}` : ''}</option>`).join('')}
    </optgroup>`).join('');
  }

  /** Nombres de las secciones donde esta inscrito un estudiante. */
  function deEstudiante(ms, estudianteId) {
    return ms.flatMap((m) => m.secciones.filter((s) => s.estudiantes.includes(estudianteId))
      .map((s) => `${m.codigo || m.nombre} · ${s.nombre}`));
  }

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

  /** Lista de estudiantes con casillas (para inscribir en una seccion). */
  function modalEstudiantes(seccion, materia, estudiantes, alGuardar) {
    const inscritos = new Set(seccion.estudiantes);
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<form class="card">
        <h2>Estudiantes de ${esc(seccion.nombre)}</h2>
        <p class="muted">${esc(etiqueta(materia))}. Marca a los estudiantes inscritos en esta sección.</p>
        <div class="row" style="margin-bottom:.6rem">
          <input id="filtro" class="grow" style="width:auto" placeholder="Buscar estudiante...">
          <button type="button" class="btn small" id="todos">Marcar todos</button>
        </div>
        <div class="lista-asistencia">${estudiantes.map((u) => `
          <label class="asistente"><input type="checkbox" value="${u.id}" ${inscritos.has(u.id) ? 'checked' : ''}>
            <span><strong>${esc(u.nombre)}</strong><br><span class="muted">${esc(u.email)}</span></span></label>`).join('')
          || '<p class="muted" style="padding:1rem">No hay estudiantes. Créalos en Usuarios.</p>'}</div>
        <div class="row" style="justify-content:space-between;margin-top:1rem">
          <span class="muted" id="cuenta"></span>
          <div class="row"><button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn primary">Guardar</button></div>
        </div>
      </form>`;
    document.body.appendChild(m);
    const casillas = () => [...m.querySelectorAll('input[type=checkbox]')];
    const contar = () => { m.querySelector('#cuenta').textContent = `${casillas().filter((c) => c.checked).length} inscritos`; };
    contar();
    m.onchange = contar;
    m.querySelector('#filtro').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      m.querySelectorAll('.asistente').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(q); });
    };
    m.querySelector('#todos').onclick = () => { casillas().forEach((c) => { if (!c.closest('.asistente').hidden) c.checked = true; }); contar(); };
    m.querySelector('[data-cerrar]').onclick = () => m.remove();
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await alGuardar(casillas().filter((c) => c.checked).map((c) => Number(c.value)));
        m.remove();
      } catch (err) { toast(err.message, true); }
    };
  }

  // ---------------------------------------------------------------- vista de la profesora
  async function vista(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando materias...</div>';
    const [ms, estudiantes] = await Promise.all([
      materias(true),
      API.get('auth/usuarios?rol=estudiante'),
    ]);
    const sinSeccion = estudiantes.filter((u) => !ms.some((m) => m.secciones.some((s) => s.estudiantes.includes(u.id))));

    destino.innerHTML = `
      <div class="page-head">
        <div><h1>Materias y secciones</h1>
          <p class="muted" style="margin:0">Organiza a tus estudiantes por materia y sección. Cada tema se publica a las secciones que elijas y la lista se pasa por sección.</p></div>
        <button class="btn primary" data-accion="nueva-materia">+ Nueva materia</button>
      </div>
      ${sinSeccion.length ? `<div class="estado" style="margin-bottom:1rem">⚠️ ${sinSeccion.length} estudiante(s) sin sección: no verán ninguna clase hasta que los inscribas.</div>` : ''}
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
              <button class="btn small primary" data-accion="estudiantes" data-materia="${m.id}" data-seccion="${s.id}">Inscribir estudiantes</button>
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
      if (accion === 'estudiantes') {
        modalEstudiantes(s, m, estudiantes.filter((u) => u.activo), async (ids) => {
          await API.put(`clases/secciones/${s.id}/estudiantes`, { estudiantes: ids });
          toast(`${ids.length} estudiante(s) en ${s.nombre}`);
          recargar();
        });
      }
      if (accion === 'borrar-materia' && confirm(`¿Eliminar la materia "${m.nombre}" y sus secciones?`)) {
        API.del(`clases/materias/${m.id}`).then(() => { toast('Materia eliminada'); recargar(); }).catch((err) => toast(err.message, true));
      }
      if (accion === 'borrar-seccion' && confirm(`¿Eliminar ${s.nombre}? Sus estudiantes perderán acceso a las clases de esta sección.`)) {
        API.del(`clases/secciones/${s.id}`).then(() => { toast('Sección eliminada'); recargar(); }).catch((err) => toast(err.message, true));
      }
    };
  }

  return { materias, etiqueta, opciones, deEstudiante, vista };
})();
