// Comunicacion con los otros microservicios por la red interna de Docker.
// Se usan los nombres de servicio del docker-compose.yml como hostname.
const AUTH = 'http://servicio-auth:8000';
const CLASES = 'http://servicio-clases:8080';
const NOTIF = 'http://servicio-notificaciones:8080';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://localhost';

const headers = () => ({ 'Content-Type': 'application/json', 'X-Internal-Token': process.env.INTERNAL_TOKEN });

async function pedir(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, headers: headers() });
  if (!res.ok) throw new Error(`${opciones.method || 'GET'} ${url} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Node -> Python: lista de usuarios activos por rol. */
async function usuariosPorRol(rol) {
  const lista = await pedir(`${AUTH}/usuarios?rol=${rol}`);
  return lista.filter((u) => u.activo);
}

/** Node -> Java: informa el estado del procesamiento de una clase. */
function actualizarEstadoClase(claseId, estado, mensaje) {
  return pedir(`${CLASES}/interno/temas/${claseId}/estado`, {
    method: 'PATCH', body: JSON.stringify({ estado, mensaje }),
  }).catch((e) => console.error('No se pudo actualizar servicio-clases:', e.message));
}

/** Node -> Go: crea notificacion (campanita) y envia correo. */
function notificar(usuario, titulo, mensaje, ruta = '') {
  return pedir(`${NOTIF}/interno/notificar`, {
    method: 'POST',
    body: JSON.stringify({
      usuarioId: usuario.id, email: usuario.email, nombre: usuario.nombre,
      titulo, mensaje, enlace: `${PUBLIC_URL}/app.html${ruta}`, enviarCorreo: true,
    }),
  }).catch((e) => console.error('No se pudo notificar:', e.message));
}

module.exports = { usuariosPorRol, actualizarEstadoClase, notificar };
