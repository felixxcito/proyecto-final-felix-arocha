// Pantalla de acceso: ingresar, registrarse, confirmar el correo con un codigo y recuperar la clave.
const Cuenta = (() => {
  const raiz = () => document.getElementById('panelCuenta');
  const pintar = (html) => { raiz().innerHTML = html; };

  /** Campo de clave con boton para mostrarla u ocultarla. */
  const campoClave = (id, etiqueta, autocompletar) => `
    <div class="field">
      <label for="${id}">${etiqueta}</label>
      <div class="clave-wrap">
        <input id="${id}" type="password" autocomplete="${autocompletar}" required>
        <button type="button" class="ojo" data-ojo="${id}" aria-label="Mostrar u ocultar la clave">Mostrar</button>
      </div>
    </div>`;

  function activarOjos() {
    raiz().querySelectorAll('[data-ojo]').forEach((b) => {
      b.onclick = () => {
        const input = document.getElementById(b.dataset.ojo);
        const oculto = input.type === 'password';
        input.type = oculto ? 'text' : 'password';
        b.textContent = oculto ? 'Ocultar' : 'Mostrar';
      };
    });
  }

  const pestanas = (activa) => `
    <div class="tabs-cuenta" role="tablist">
      <button type="button" role="tab" class="${activa === 'ingresar' ? 'activo' : ''}" data-ir="ingresar">Ingresar</button>
      <button type="button" role="tab" class="${activa === 'registro' ? 'activo' : ''}" data-ir="registro">Registrarse</button>
    </div>`;

  function activarPestanas() {
    raiz().querySelectorAll('[data-ir]').forEach((b) => { b.onclick = () => ir(b.dataset.ir); });
  }

  const ir = (vista, datos) => ({ ingresar }[vista] || ingresar)(datos);

  // ---------------------------------------------------------------- ingresar
  function ingresar(aviso = '') {
    pintar(`<form class="card" id="formIngreso">
      ${pestanas('ingresar')}
      <h2>Bienvenido</h2>
      ${aviso ? `<p class="aviso-ok">${esc(aviso)}</p>` : ''}
      <div class="field">
        <label for="email">Correo</label>
        <input id="email" type="email" autocomplete="username" required>
      </div>
      ${campoClave('password', 'Clave', 'current-password')}
      <div class="row" style="justify-content:space-between;margin-bottom:.8rem">
        <label class="check"><input type="checkbox" id="recordarme"> Recordarme</label>
        <a href="#" id="olvide" class="muted">¿Olvidaste tu clave?</a>
      </div>
      <p class="error" id="error"></p>
      <button class="btn primary" style="width:100%;justify-content:center" id="btn">Entrar</button>
    </form>`);
    activarPestanas();
    activarOjos();

    document.getElementById('formIngreso').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn');
      const error = document.getElementById('error');
      btn.disabled = true;
      error.textContent = '';
      try {
        const sesion = await API.post('auth/login', {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
          recordarme: document.getElementById('recordarme').checked,
        });
        API.guardarSesion(sesion);
        location.href = '/app.html';
      } catch (err) {
        error.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };
  }

  return { iniciar: () => ingresar() };
})();
