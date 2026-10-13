// Panel del administrador general: aprueba a los profesores que se registran y gestiona las cuentas.
const Admin = (() => {
  const ESTADOS = {
    activo: ['Activo', 'ok'], en_espera: ['En espera', 'warn'], sin_verificar: ['Sin verificar', ''],
    rechazado: ['Rechazado', 'err'], desactivado: ['Desactivado', ''],
  };
  const badge = (e) => `<span class="badge ${ESTADOS[e]?.[1] || ''}">${ESTADOS[e]?.[0] || esc(e)}</span>`;
  const ROLES = { admin: 'Administrador', profesor: 'Profesor', estudiante: 'Estudiante' };

  async function vista(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando...</div>';
    const [espera, usuarios] = await Promise.all([
      API.get('auth/admin/profesores?estado=en_espera'),
      API.get('auth/admin/usuarios'),
    ]);
    const yo = API.usuario;

    destino.innerHTML = `
      <div class="page-head"><div><h1>Administración</h1>
        <p class="muted" style="margin:0">Aprueba a los profesores que se registran y gestiona las cuentas del sistema.</p></div></div>

      <div class="card" style="margin-bottom:1rem">
        <h2>Profesores esperando aprobación <span class="badge ${espera.length ? 'warn' : ''}">${espera.length}</span></h2>
        ${espera.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Nombre</th><th>Cédula</th><th>Correo</th><th>Se registró</th><th></th></tr></thead>
          <tbody>${espera.map((u) => `<tr>
            <td><strong>${esc(u.nombre)}</strong></td><td>${esc(u.cedula)}</td><td>${esc(u.email)}</td><td>${fecha(u.creado_en)}</td>
            <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
              <button class="btn small primary" data-accion="aprobar" data-id="${u.id}">Aprobar</button>
              <button class="btn small danger" data-accion="rechazar" data-id="${u.id}">Rechazar</button></div></td>
          </tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No hay profesores esperando. Cuando uno confirme su correo aparecerá aquí.</p>'}
      </div>

      <div class="card">
        <h2>Todas las cuentas</h2>
        <div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Cédula</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>${usuarios.map((u) => `<tr>
            <td><strong>${esc(u.nombre)}</strong></td><td>${esc(u.email)}</td><td>${esc(u.cedula || '—')}</td>
            <td>${ROLES[u.rol] || esc(u.rol)}</td><td>${badge(u.estado)}</td>
            <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">${u.id === Number(yo.id) ? '<span class="muted">Tú</span>' : `
              ${['activo', 'desactivado'].includes(u.estado) ? `<button class="btn small" data-accion="estado" data-id="${u.id}" data-estado="${u.estado === 'activo' ? 'desactivado' : 'activo'}">${u.estado === 'activo' ? 'Desactivar' : 'Activar'}</button>` : ''}
              <button class="btn small danger" data-accion="borrar" data-id="${u.id}">Eliminar</button>`}</div></td>
          </tr>`).join('')}</tbody></table></div>
      </div>`;

    destino.onclick = async (e) => {
      const b = e.target.closest('button[data-accion]');
      if (!b) return;
      const id = b.dataset.id;
      try {
        if (b.dataset.accion === 'aprobar') { await API.post(`auth/admin/profesores/${id}/aprobar`); toast('Profesor aprobado: ya puede entrar'); }
        else if (b.dataset.accion === 'rechazar') {
          if (!confirm('¿Rechazar a este profesor? Recibirá un aviso por correo.')) return;
          await API.post(`auth/admin/profesores/${id}/rechazar`); toast('Profesor rechazado');
        } else if (b.dataset.accion === 'estado') {
          await API.patch(`auth/admin/usuarios/${id}`, { estado: b.dataset.estado });
          toast(b.dataset.estado === 'activo' ? 'Cuenta activada' : 'Cuenta desactivada: pierde el acceso al instante');
        } else if (b.dataset.accion === 'borrar') {
          if (!confirm('¿Eliminar esta cuenta? No se puede deshacer.')) return;
          await API.del(`auth/admin/usuarios/${id}`); toast('Cuenta eliminada');
        }
        vista(destino);
      } catch (err) { toast(err.message, true); }
    };
  }

  return { vista };
})();
