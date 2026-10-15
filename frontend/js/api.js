// Cliente del API Gateway. Todas las llamadas van a /api/<servicio>/ en el mismo origen (Nginx).
const API = {
  get token() { return localStorage.getItem('token'); },
  get usuario() { try { return JSON.parse(localStorage.getItem('usuario')); } catch { return null; } },

  guardarSesion({ token, usuario }) {
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
  },
  salir() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    location.href = '/';
  },

  async pedir(metodo, ruta, cuerpo) {
    const opciones = { method: metodo, headers: {} };
    if (this.token) opciones.headers.Authorization = `Bearer ${this.token}`;
    if (cuerpo instanceof FormData) opciones.body = cuerpo;
    else if (cuerpo instanceof Blob) { // una imagen va tal cual (ej. la foto de perfil)
      opciones.headers['Content-Type'] = cuerpo.type;
      opciones.body = cuerpo;
    }
    else if (cuerpo !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }
    const res = await fetch(`/api/${ruta}`, opciones);
    if (res.status === 401 && this.token && !ruta.startsWith('auth/login')) { this.salir(); return; }
    const texto = await res.text();
    let data = null;
    try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
    if (!res.ok) {
      // FastAPI usa "detail", Spring usa "message"
      let msg = data?.detail || data?.message || data?.error || `Error ${res.status}`;
      if (Array.isArray(msg)) msg = msg.map((e) => e.msg).join(', ');
      const error = new Error(msg);
      // El login necesita saber el estado y la "accion" que manda el servidor (ej. {accion:"verificar"})
      error.status = res.status;
      error.datos = data;
      throw error;
    }
    return data;
  },
  /** Foto de perfil (la propia, o la de un estudiante si soy su profesor) como URL local (blob:).
   *  Un <img> no puede mandar el token, por eso se pide con fetch. */
  async foto(usuarioId) {
    const ruta = usuarioId ? `usuarios/${usuarioId}/foto` : 'me/foto';
    const res = await fetch(`/api/auth/${ruta}`, { headers: { Authorization: `Bearer ${this.token}` } });
    return res.ok ? URL.createObjectURL(await res.blob()) : null;
  },
  get(r) { return this.pedir('GET', r); },
  post(r, b) { return this.pedir('POST', r, b ?? {}); },
  put(r, b) { return this.pedir('PUT', r, b); },
  patch(r, b) { return this.pedir('PATCH', r, b); },
  del(r) { return this.pedir('DELETE', r); },
};

function toast(msg, error = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = error ? 'err' : '';
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Escapa texto antes de insertarlo como HTML (evita XSS con contenido de usuarios o de la IA)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
