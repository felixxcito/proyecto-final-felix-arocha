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

  const ir = (vista, datos) => ({ ingresar, codigo, espera }[vista] || ingresar)(datos);

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
        // Cuenta sin confirmar: el servidor responde 403 con accion=verificar y ya reenvio el codigo
        if (err.datos?.accion === 'verificar') return codigo(err.datos.email, err.message);
        error.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };
    document.getElementById('olvide').onclick = (e) => { e.preventDefault(); ir('recuperar'); };
  }

  // ---------------------------------------------------------------- codigo del correo
  /** 6 casillas para el codigo: avanza sola al escribir, retrocede con Borrar y acepta pegar el codigo entero. */
  function casillasCodigo() {
    const cajas = [...raiz().querySelectorAll('.codigo-cajas input')];
    cajas.forEach((c, i) => {
      c.oninput = () => {
        c.value = c.value.replace(/\D/g, '').slice(-1);
        if (c.value && cajas[i + 1]) cajas[i + 1].focus();
      };
      c.onkeydown = (e) => { if (e.key === 'Backspace' && !c.value && cajas[i - 1]) cajas[i - 1].focus(); };
      c.onpaste = (e) => {
        e.preventDefault();
        const digitos = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        digitos.split('').forEach((d, k) => { cajas[k].value = d; });
        cajas[Math.min(digitos.length, 5)].focus();
      };
    });
    cajas[0].focus();
    return () => cajas.map((c) => c.value).join('');
  }

  let temporizador = null;
  /** Cuenta regresiva del boton Reenviar (el servidor tambien obliga a esperar 60 s). */
  function cuentaRegresiva(boton, segundos = 60) {
    clearInterval(temporizador);
    let falta = segundos;
    const pintarBoton = () => {
      boton.disabled = falta > 0;
      boton.textContent = falta > 0 ? `Reenviar codigo (${falta} s)` : 'Reenviar codigo';
    };
    pintarBoton();
    temporizador = setInterval(() => { falta -= 1; pintarBoton(); if (falta <= 0) clearInterval(temporizador); }, 1000);
  }

  function codigo(email, aviso) {
    pintar(`<form class="card" id="formCodigo">
      <h2>Revisa tu correo</h2>
      <p class="muted">${aviso ? esc(aviso) : 'Te enviamos un codigo de 6 digitos a'} <strong>${esc(email)}</strong>. Vence en 10 minutos.</p>
      <div class="codigo-cajas">${'<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Digito del codigo">'.repeat(6)}</div>
      <p class="error" id="error"></p>
      <button class="btn primary" style="width:100%;justify-content:center" id="btn">Confirmar</button>
      <div class="row" style="justify-content:space-between;margin-top:.8rem">
        <button type="button" class="btn small ghost" id="reenviar"></button>
        <a href="#" id="volver" class="muted">Volver</a>
      </div>
    </form>`);
    const leer = casillasCodigo();
    const error = document.getElementById('error');
    cuentaRegresiva(document.getElementById('reenviar'));

    document.getElementById('volver').onclick = (e) => { e.preventDefault(); clearInterval(temporizador); ir('ingresar'); };
    document.getElementById('reenviar').onclick = async () => {
      try {
        await API.post('auth/registro/reenviar', { email });
        error.textContent = '';
        cuentaRegresiva(document.getElementById('reenviar'));
      } catch (err) { error.textContent = err.message; }
    };
    document.getElementById('formCodigo').onsubmit = async (e) => {
      e.preventDefault();
      if (leer().length < 6) { error.textContent = 'Escribe los 6 digitos'; return; }
      const btn = document.getElementById('btn');
      btn.disabled = true;
      try {
        const r = await API.post('auth/registro/verificar', { email, codigo: leer() });
        clearInterval(temporizador);
        if (r.token) { API.guardarSesion(r); location.href = '/app.html'; return; }   // estudiante: entra directo
        espera(r.mensaje);                                                             // profesor: lista de espera
      } catch (err) {
        error.textContent = err.message;
        btn.disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------- profesor en lista de espera
  function espera(mensaje) {
    pintar(`<div class="card">
      <h2>Casi listo</h2>
      <p class="aviso-ok">${esc(mensaje)}</p>
      <p class="muted">Cuando un administrador apruebe tu cuenta te llegará un correo y podrás iniciar sesión.</p>
      <button class="btn primary" style="width:100%;justify-content:center" id="aIngresar">Ir a Ingresar</button>
    </div>`);
    document.getElementById('aIngresar').onclick = () => ir('ingresar');
  }

  return { iniciar: () => ingresar() };
})();
