// Mi perfil (#/perfil): foto, datos opcionales sobre mi y eliminar la cuenta. Lo ven los tres roles.
const Perfil = (() => {
  const iniciales = (nombre) => String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0].toUpperCase()).join('');

  /** Pone la foto en un elemento .avatar, o las iniciales del nombre si no hay foto. Sin usuario: la propia. */
  async function pintarAvatar(el, usuario) {
    if (!el) return;
    el.textContent = iniciales((usuario || API.usuario)?.nombre);
    const url = await API.foto(usuario?.id);
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  }

  /** Recorta la imagen al centro en un cuadrado de 400x400 y la devuelve como JPEG: así se sube poco peso. */
  function recortar(archivo) {
    return new Promise((ok, falla) => {
      const img = new Image();
      img.onload = () => {
        const lado = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = 400;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; // un PNG transparente no queda con fondo negro
        ctx.fillRect(0, 0, 400, 400);
        ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 400, 400);
        URL.revokeObjectURL(img.src);
        c.toBlob((b) => (b ? ok(b) : falla(new Error('No se pudo leer la imagen'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => falla(new Error('Ese archivo no es una imagen'));
      img.src = URL.createObjectURL(archivo);
    });
  }

  async function vista(destino) {
    destino.innerHTML = '<div class="row"><div class="spinner"></div> Cargando...</div>';
    const p = await API.get('auth/me/perfil');
    const yo = API.usuario;
    const opcion = (valor, texto, actual) =>
      `<option value="${valor}" ${String(actual ?? '') === valor ? 'selected' : ''}>${texto}</option>`;
    const semestres = Array.from({ length: 12 }, (_, i) => opcion(String(i + 1), `${i + 1}º`, p.semestre)).join('');

    destino.innerHTML = `
      <div class="page-head"><div><h1>Mi perfil</h1>
        <p class="muted" style="margin:0">Todo lo de esta página es opcional: llena solo lo que quieras.${yo.rol === 'estudiante'
          ? ' Los profesores de tus secciones pueden ver tu foto y estos datos.' : ''}</p></div></div>
      <div class="perfil-grid">
        <div class="card perfil-foto">
          <div class="avatar grande" id="avatarGrande"></div>
          <div><strong>${esc(yo.nombre)}</strong><div class="muted correo">${esc(yo.email)}</div></div>
          <input type="file" id="archivoFoto" accept="image/jpeg,image/png,image/webp" hidden>
          <div class="row" style="justify-content:center">
            <button class="btn small" id="btnFoto">${p.tieneFoto ? 'Cambiar foto' : 'Subir foto'}</button>
            ${p.tieneFoto ? '<button class="btn small danger" id="btnQuitarFoto">Quitar</button>' : ''}
          </div>
        </div>

        <form class="card" id="formPerfil">
          <h2>Sobre mí</h2>
          <div class="field"><label for="sobreMi">Cuéntanos de ti</label>
            <textarea id="sobreMi" maxlength="500" placeholder="Qué te gusta, qué quieres aprender...">${esc(p.sobreMi || '')}</textarea></div>
          <div class="field"><label for="carrera">¿Qué estudias?</label>
            <input id="carrera" maxlength="120" value="${esc(p.carrera || '')}" placeholder="Ej. Ingeniería en Computación"></div>
          <div class="perfil-campos">
            <div class="field"><label for="semestre">Semestre</label>
              <select id="semestre">${opcion('', '—', p.semestre)}${semestres}</select></div>
            <div class="field"><label for="edad">Edad</label>
              <input id="edad" type="number" min="14" max="99" value="${p.edad ?? ''}"></div>
            <div class="field"><label for="trabaja">¿Trabajas?</label>
              <select id="trabaja">${opcion('', 'Prefiero no decir', p.trabaja)}${opcion('true', 'Sí', p.trabaja)}${opcion('false', 'No', p.trabaja)}</select></div>
          </div>
          <div class="row" style="justify-content:flex-end"><button class="btn primary">Guardar</button></div>
        </form>

        <div class="card zona-peligro">
          <h2>Eliminar mi cuenta</h2>
          ${yo.rol === 'admin'
            ? '<p class="muted" style="margin:0">La cuenta del administrador no se puede eliminar: sin ella nadie podría aprobar a los profesores.</p>'
            : `<p class="muted">${textoEliminar(yo.rol)} No se puede deshacer.</p>
               <button class="btn danger" id="btnEliminar">Eliminar mi cuenta</button>`}
        </div>
      </div>`;

    pintarAvatar(document.getElementById('avatarGrande'));
    const refrescar = () => { vista(destino); pintarAvatar(document.getElementById('avatarTopbar')); };

    const archivo = document.getElementById('archivoFoto');
    document.getElementById('btnFoto').onclick = () => archivo.click();
    archivo.onchange = async () => {
      if (!archivo.files[0]) return;
      try {
        await API.put('auth/me/foto', await recortar(archivo.files[0]));
        toast('Foto actualizada');
        refrescar();
      } catch (err) { toast(err.message, true); }
    };
    const quitar = document.getElementById('btnQuitarFoto');
    if (quitar) quitar.onclick = async () => {
      try { await API.del('auth/me/foto'); toast('Foto quitada'); refrescar(); } catch (err) { toast(err.message, true); }
    };

    document.getElementById('formPerfil').onsubmit = async (e) => {
      e.preventDefault();
      const valor = (id) => document.getElementById(id).value.trim();
      try {
        await API.put('auth/me/perfil', {
          sobreMi: valor('sobreMi') || null,
          carrera: valor('carrera') || null,
          semestre: valor('semestre') ? Number(valor('semestre')) : null,
          edad: valor('edad') ? Number(valor('edad')) : null,
          trabaja: valor('trabaja') ? valor('trabaja') === 'true' : null,
        });
        toast('Perfil guardado');
      } catch (err) { toast(err.message, true); }
    };

    const eliminar = document.getElementById('btnEliminar');
    if (eliminar) eliminar.onclick = modalEliminar;
  }

  const textoEliminar = (rol) => (rol === 'profesor'
    ? 'Se borran tu cuenta, tu perfil, tu foto y <strong>todas tus materias</strong> con sus secciones, temas y presentaciones.'
    : 'Se borran tu cuenta, tu perfil y tu foto, y sales de todas tus secciones.');

  /** El profesor ve el perfil de uno de sus estudiantes (solo lectura). u = {id, nombre, cedula, email}. */
  async function modalVer(u) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="card"><div class="row"><div class="spinner"></div> Cargando perfil...</div></div>';
    document.body.appendChild(m);
    m.onclick = (e) => { if (e.target === m || e.target.closest('[data-cerrar]')) m.remove(); };
    try {
      const p = await API.get(`auth/usuarios/${u.id}/perfil`);
      const datos = [
        ['¿Qué estudia?', p.carrera],
        ['Semestre', p.semestre && `${p.semestre}º`],
        ['Edad', p.edad && `${p.edad} años`],
        ['¿Trabaja?', p.trabaja == null ? null : (p.trabaja ? 'Sí' : 'No')],
      ].filter(([, v]) => v);
      m.querySelector('.card').innerHTML = `
        <div class="perfil-ver">
          <div class="avatar grande" id="avatarVer"></div>
          <div><h2 style="margin:0">${esc(u.nombre)}</h2>
            <div class="muted correo">${esc(u.cedula || '')}${u.email ? ` · ${esc(u.email)}` : ''}</div></div>
        </div>
        ${p.sobreMi ? `<p class="sobre-mi">${esc(p.sobreMi)}</p>` : ''}
        ${datos.length ? `<dl class="perfil-datos">${datos.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${!p.sobreMi && !datos.length ? '<p class="muted">Este estudiante todavía no ha llenado su perfil.</p>' : ''}
        <div class="row" style="justify-content:flex-end"><button class="btn" data-cerrar>Cerrar</button></div>`;
      if (p.tieneFoto) pintarAvatar(m.querySelector('#avatarVer'), u);
      else m.querySelector('#avatarVer').textContent = iniciales(u.nombre);
    } catch (err) { m.remove(); toast(err.message, true); }
  }

  /** Pide la clave otra vez antes de borrar: una sesión olvidada abierta no basta para eliminar la cuenta. */
  function modalEliminar() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<form class="card">
        <h2>¿Eliminar tu cuenta?</h2>
        <p class="muted">${textoEliminar(API.usuario.rol)} <strong>No se puede deshacer.</strong></p>
        <div class="field"><label for="claveEliminar">Escribe tu clave para confirmar</label>
          <input id="claveEliminar" type="password" autocomplete="current-password" required></div>
        <p class="error" id="errorEliminar"></p>
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button class="btn danger">Eliminar definitivamente</button>
        </div>
      </form>`;
    document.body.appendChild(m);
    m.querySelector('input').focus();
    m.querySelector('[data-cerrar]').onclick = () => m.remove();
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.pedir('DELETE', 'auth/me', { password: document.getElementById('claveEliminar').value });
        API.salir();
      } catch (err) { document.getElementById('errorEliminar').textContent = err.message; }
    };
  }

  return { vista, pintarAvatar, modalVer };
})();
