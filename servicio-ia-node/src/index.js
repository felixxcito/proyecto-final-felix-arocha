/*
 * Microservicio de IA — Node.js + Express + Mongoose + MongoDB + IA (NVIDIA NIM o Google Gemini)
 *
 * Gateway: https://localhost/api/ia/...
 *   GET  /clases/:id/contenido        -> explicacion de cada diapositiva
 *   PUT  /clases/:id/contenido        -> el profesor corrige lo que genero la IA
 *   POST /clases/:id/regenerar        -> volver a pedir las explicaciones a la IA
 *   GET  /clases/:id/mis-preguntas    -> las preguntas del estudiante
 *   PUT  /clases/:id/mis-preguntas    -> guardar / entregar respuestas
 *   GET  /clases/:id/respuestas       -> (profesor) respuestas de todos
 *   PUT  /clases/:id/asignaciones/:aid/preguntas/:pid -> (profesor) corregir una pregunta
 *   POST /clases/:id/consultas        -> preguntarle a la IA sobre una diapositiva
 *   GET  /clases/:id/consultas        -> estudiante: sus dudas / profesor: las de todos
 *   GET  /mis-asignaciones            -> (estudiante) estado de sus preguntas
 *   GET  /estadisticas                -> (profesor) entregas por clase
 * Internos (solo otros microservicios, header X-Internal-Token):
 *   POST /interno/procesar            <- Java manda la presentacion
 *   POST /interno/asignar             <- Java publica la clase
 *   DELETE /interno/clases/:id        <- Java elimino el tema
 */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { Contenido, Asignacion, Consulta } = require('./modelos');
const { extraerDiapositivas } = require('./extraer');
const ia = require('./ia');
const { explicarDemo, preguntasDemo, normalizar, barajar } = require('./demo');
const { usuariosPorRol, actualizarEstadoClase, notificar } = require('./servicios');

const app = express();
app.use(express.json({ limit: '80mb' }));  // la presentacion llega en base64

/** El profesor dueno y los estudiantes permitidos (seccion + lista de asistencia, segun Java) pueden ver la clase. */
const tieneAcceso = (c, usuario) => (usuario.rol === 'profesor'
  ? c.profesorId === usuario.id                      // un profesor solo ve SUS clases
  : c.publicado && (c.permitidos || []).includes(usuario.id));
const sinAcceso = (c) => (c.privada ? 'Clase privada: pidele acceso a tu profesor' : 'No tienes acceso a esta clase');

// ------------------------------------------------------------------ middlewares
function conToken(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    const p = jwt.verify(h.replace(/^Bearer /, ''), process.env.SECRET_KEY, { algorithms: ['HS256'] });
    req.usuario = { id: Number(p.sub), nombre: p.nombre, email: p.email, rol: p.rol };
    next();
  } catch {
    res.status(401).json({ detail: 'Token invalido o ausente' });
  }
}
const soloProfesor = (req, res, next) => (req.usuario.rol === 'profesor'
  ? next() : res.status(403).json({ detail: 'Solo un profesor' }));
const soloEstudiante = (req, res, next) => (req.usuario.rol === 'estudiante'
  ? next() : res.status(403).json({ detail: 'Solo estudiantes' }));
const soloInterno = (req, res, next) => (req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN
  ? next() : res.status(403).json({ detail: 'Solo servicios internos' }));

/** Carga el contenido de la clase y comprueba que sea del profesor. Si no, ya respondio (404 o 403) y devuelve null. */
async function claseDelProfesor(req, res, campos) {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) }, campos);
  if (!c) { res.status(404).json({ detail: 'Esta clase no existe' }); return null; }
  if (c.profesorId !== req.usuario.id) { res.status(403).json({ detail: 'Esta clase no es tuya' }); return null; }
  return c;
}

// Envuelve handlers async para que los errores devuelvan 500 en JSON
const h = (fn) => (req, res, next) => fn(req, res, next).catch((e) => {
  console.error(e);
  res.status(500).json({ detail: e.message });
});

// ------------------------------------------------------------------ logica de IA

/** Extrae el texto, pide a la IA (o al modo demo) la explicacion y guarda en Mongo. */
async function procesar({ claseId, titulo, descripcion, nombreArchivo, tipo, base64 }) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const diapositivas = await extraerDiapositivas(buffer, tipo);
    if (!diapositivas.length) throw new Error('No se encontraron diapositivas en el archivo');

    let resultado;
    let modo = 'demo';
    if (ia.activo()) {
      resultado = await ia.explicarPresentacion({ titulo, descripcion, diapositivas });
      modo = 'ia';
    } else {
      resultado = explicarDemo(diapositivas, titulo);
    }

    const porNumero = new Map((resultado.diapositivas || []).map((d) => [Number(d.n), d]));
    const respaldo = explicarDemo(diapositivas, titulo).diapositivas;
    const final = diapositivas.map((d, i) => ({
      n: d.n,
      texto: d.texto,
      titulo: porNumero.get(d.n)?.titulo || d.titulo,
      explicacion: porNumero.get(d.n)?.explicacion || respaldo[i].explicacion,
    }));

    await Contenido.updateOne({ claseId }, {
      titulo, descripcion, nombreArchivo, tipo, modo,
      estado: 'listo', error: null, resumen: resultado.resumen, diapositivas: final,
    });
    await actualizarEstadoClase(claseId, 'BORRADOR',
      `La IA (${modo === 'ia' ? ia.MODELO : 'modo demo'}) explico ${final.length} diapositivas. Revisalas y publica la clase.`);
  } catch (e) {
    console.error('Error procesando clase', claseId, e);
    await Contenido.updateOne({ claseId }, { estado: 'error', error: e.message });
    await actualizarEstadoClase(claseId, 'ERROR', `Error de la IA: ${e.message}`);
  }
}

/** Devuelve `cantidad` preguntas nuevas que no se hayan usado antes en esta clase. */
async function preguntasNuevas(contenido, cantidad) {
  const usadas = [...contenido.preguntasUsadas];
  const vistas = new Set(usadas.map(normalizar));
  const nuevas = [];
  const agregar = (lista) => {
    for (const p of lista) {
      const k = normalizar(p);
      if (p && p.length > 10 && !vistas.has(k) && nuevas.length < cantidad) { vistas.add(k); nuevas.push(p.trim()); }
    }
  };

  if (ia.activo()) {
    const intentos = Math.ceil(cantidad / 35) + 2;
    for (let intento = 0; intento < intentos && nuevas.length < cantidad; intento++) {
      try {
        const faltan = cantidad - nuevas.length;
        agregar(await ia.generarPreguntas({
          titulo: contenido.titulo, resumen: contenido.resumen, diapositivas: contenido.diapositivas,
          cantidad: faltan + 3, evitar: [...usadas, ...nuevas].slice(-150),
        }));
      } catch (e) {
        console.error('La IA fallo generando preguntas:', e.message);
        break;
      }
    }
  }
  // Respaldo: si la IA no esta configurada o no alcanzo, se completan con plantillas
  if (nuevas.length < cantidad) agregar(preguntasDemo(contenido.diapositivas, cantidad - nuevas.length, [...usadas, ...nuevas]));
  // Ultimo recurso para clases muy pequenas con muchos estudiantes
  let k = 2;
  while (nuevas.length < cantidad) {
    const base = barajar(usadas.concat(nuevas))[0] || `Explica el tema "${contenido.titulo}"`;
    agregar([`${base} (Version ${k++}: apoya tu respuesta con un ejemplo distinto)`]);
  }
  return nuevas;
}

// Evita que dos asignaciones de la misma clase corran a la vez y repitan preguntas
const colas = new Map();
function enCola(claseId, fn) {
  const anterior = colas.get(claseId) || Promise.resolve();
  const siguiente = anterior.then(fn, fn);
  colas.set(claseId, siguiente.catch(() => {}));
  return siguiente;
}

/** Asigna N preguntas unicas a cada estudiante con acceso que todavia no tenga en esta clase. */
function asignarPreguntas(claseId, estudiantes) {
  return enCola(claseId, async () => {
    const contenido = await Contenido.findOne({ claseId, estado: 'listo' });
    if (!contenido) return;
    const porEstudiante = contenido.preguntasPorEstudiante || 5;
    const yaTienen = new Set((await Asignacion.find({ claseId }, 'estudianteId')).map((a) => a.estudianteId));
    const pendientes = estudiantes.filter((e) => !yaTienen.has(e.id) && tieneAcceso(contenido, { ...e, rol: 'estudiante' }));
    const resumenEstado = () => {
      const conAcceso = (contenido.permitidos || []).length;
      const listos = [...yaTienen, ...pendientes.map((e) => e.id)].filter((id) => contenido.permitidos.includes(id)).length;
      return `Publicada${contenido.privada ? ' (privada)' : ''}. ${listos} de ${conAcceso} estudiante(s) con acceso tienen sus preguntas.`;
    };
    if (!pendientes.length) {
      await actualizarEstadoClase(claseId, 'PUBLICADA', resumenEstado());
      return;
    }

    const preguntas = barajar(await preguntasNuevas(contenido, pendientes.length * porEstudiante));
    for (const [i, est] of pendientes.entries()) {
      const suyas = preguntas.slice(i * porEstudiante, (i + 1) * porEstudiante);
      await Asignacion.create({
        claseId, estudianteId: est.id, estudianteNombre: est.nombre, estudianteEmail: est.email,
        preguntas: suyas.map((texto) => ({ texto })),
      });
      await Contenido.updateOne({ claseId }, { $push: { preguntasUsadas: { $each: suyas } } });
      notificar(est, contenido.privada ? `Tienes acceso a la clase: ${contenido.titulo}` : `Nueva clase: ${contenido.titulo}`,
        `Ya puedes estudiar la clase "${contenido.titulo}" con la explicacion de cada diapositiva. Tienes ${suyas.length} preguntas para responder.`,
        `#/clase/${claseId}`);
    }
    await actualizarEstadoClase(claseId, 'PUBLICADA', resumenEstado());
    console.log(`Clase ${claseId}: preguntas asignadas a ${pendientes.length} estudiante(s)`);
  });
}

// ------------------------------------------------------------------ endpoints internos
app.post('/interno/procesar', soloInterno, h(async (req, res) => {
  const { claseId, profesorId, titulo, descripcion, nombreArchivo, tipo } = req.body;
  await Contenido.updateOne(
    { claseId },
    { $set: { profesorId: Number(profesorId), titulo, descripcion, nombreArchivo, tipo, estado: 'procesando', error: null } },
    { upsert: true },
  );
  res.status(202).json({ ok: true });
  procesar(req.body); // en segundo plano: la IA puede tardar
}));

app.post('/interno/asignar', soloInterno, h(async (req, res) => {
  const { claseId, profesorId, privada, permitidos, preguntasPorEstudiante } = req.body;
  await Contenido.updateOne({ claseId }, {
    publicado: true,
    ...(profesorId ? { profesorId: Number(profesorId) } : {}),
    privada: Boolean(privada),
    permitidos: (permitidos || []).map(Number),
    preguntasPorEstudiante: Math.min(20, Math.max(1, Number(preguntasPorEstudiante) || 5)),
  });
  res.status(202).json({ ok: true });
  usuariosPorRol('estudiante')
    .then((estudiantes) => asignarPreguntas(claseId, estudiantes))
    .catch((e) => console.error('Error asignando preguntas:', e.message));
}));

app.delete('/interno/clases/:id', soloInterno, h(async (req, res) => {
  const claseId = Number(req.params.id);
  await Contenido.deleteOne({ claseId });
  await Asignacion.deleteMany({ claseId });
  await Consulta.deleteMany({ claseId });
  res.status(204).end();
}));

// ------------------------------------------------------------------ endpoints publicos
app.get('/health', (req, res) => res.json({
  servicio: 'ia', lenguaje: 'Node.js / Express', orm: 'Mongoose', bd: 'MongoDB',
  ia: ia.activo() ? ia.MODELO : 'modo demo (sin API key)',
  estado: mongoose.connection.readyState === 1 ? 'ok' : 'sin-bd',
}));

app.get('/clases/:id/contenido', conToken, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) }, '-preguntasUsadas');
  if (!c) return res.status(404).json({ detail: 'Esta clase aun no tiene presentacion' });
  if (!tieneAcceso(c, req.usuario)) return res.status(403).json({ detail: sinAcceso(c) });
  res.json(c);
}));

app.put('/clases/:id/contenido', conToken, soloProfesor, h(async (req, res) => {
  const c = await claseDelProfesor(req, res);
  if (!c) return;
  if (typeof req.body.resumen === 'string') c.resumen = req.body.resumen;
  for (const cambio of req.body.diapositivas || []) {
    const d = c.diapositivas.find((x) => x.n === Number(cambio.n));
    if (d && typeof cambio.explicacion === 'string') d.explicacion = cambio.explicacion;
    if (d && typeof cambio.titulo === 'string') d.titulo = cambio.titulo;
  }
  await c.save();
  res.json(c);
}));

app.post('/clases/:id/regenerar', conToken, soloProfesor, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) });
  if (!c?.diapositivas?.length) return res.status(404).json({ detail: 'No hay diapositivas para regenerar' });
  const resultado = ia.activo()
    ? await ia.explicarPresentacion({ titulo: c.titulo, descripcion: c.descripcion, diapositivas: c.diapositivas })
    : explicarDemo(c.diapositivas, c.titulo);
  const porNumero = new Map(resultado.diapositivas.map((d) => [Number(d.n), d]));
  c.diapositivas.forEach((d) => { if (porNumero.has(d.n)) d.explicacion = porNumero.get(d.n).explicacion; });
  c.resumen = resultado.resumen;
  c.modo = ia.activo() ? 'ia' : 'demo';
  await c.save();
  res.json(c);
}));

app.get('/clases/:id/mis-preguntas', conToken, soloEstudiante, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) }, 'publicado privada permitidos');
  if (!c || !tieneAcceso(c, req.usuario)) return res.status(403).json({ detail: c ? sinAcceso(c) : 'Clase no disponible' });
  const a = await Asignacion.findOne({ claseId: Number(req.params.id), estudianteId: req.usuario.id });
  if (!a) return res.status(404).json({ detail: 'Tus preguntas se estan generando, vuelve en un momento' });
  res.json(a);
}));

app.put('/clases/:id/mis-preguntas', conToken, soloEstudiante, h(async (req, res) => {
  const claseId = Number(req.params.id);
  const a = await Asignacion.findOne({ claseId, estudianteId: req.usuario.id });
  if (!a) return res.status(404).json({ detail: 'No tienes preguntas en esta clase' });
  if (a.entregada) return res.status(409).json({ detail: 'Ya entregaste tus respuestas' });
  for (const r of req.body.respuestas || []) {
    const p = a.preguntas.id(r.id);
    if (p) p.respuesta = String(r.respuesta || '').slice(0, 5000);
  }
  if (req.body.entregar) {
    if (a.preguntas.some((p) => !p.respuesta.trim())) return res.status(400).json({ detail: `Responde las ${a.preguntas.length} preguntas antes de entregar` });
    a.entregada = true;
    a.entregadaEn = new Date();
  }
  await a.save();
  if (a.entregada) {
    const c = await Contenido.findOne({ claseId }, 'titulo');
    usuariosPorRol('profesor').then((profes) => profes.forEach((p) => notificar(p,
      `${req.usuario.nombre} entrego sus respuestas`,
      `${req.usuario.nombre} respondio sus ${a.preguntas.length} preguntas de la clase "${c?.titulo}".`, `#/clase/${claseId}/respuestas`)))
      .catch((e) => console.error(e.message));
  }
  res.json(a);
}));

app.get('/clases/:id/respuestas', conToken, soloProfesor, h(async (req, res) => {
  res.json(await Asignacion.find({ claseId: Number(req.params.id) }).sort('estudianteNombre'));
}));

/** El profesor corrige una pregunta generada por la IA (solo si el estudiante aun no entrega). */
app.put('/clases/:id/asignaciones/:aid/preguntas/:pid', conToken, soloProfesor, h(async (req, res) => {
  const texto = String(req.body.texto || '').trim();
  if (texto.length < 5) return res.status(400).json({ detail: 'La pregunta es muy corta' });
  const a = await Asignacion.findOne({ _id: req.params.aid, claseId: Number(req.params.id) });
  const p = a?.preguntas.id(req.params.pid);
  if (!p) return res.status(404).json({ detail: 'Pregunta no encontrada' });
  if (a.entregada) return res.status(409).json({ detail: 'El estudiante ya entrego; no se puede cambiar la pregunta' });
  p.texto = texto;
  await a.save();
  res.json(a);
}));

// ------------------------------------------------------------------ dudas a la IA (visor)
app.post('/clases/:id/consultas', conToken, h(async (req, res) => {
  const claseId = Number(req.params.id);
  const n = Number(req.body.diapositiva);
  const pregunta = String(req.body.pregunta || '').trim().slice(0, 1000);
  if (!pregunta) return res.status(400).json({ detail: 'Escribe tu pregunta' });

  const c = await Contenido.findOne({ claseId }, 'titulo resumen diapositivas publicado privada permitidos');
  if (!c) return res.status(404).json({ detail: 'Esta clase no tiene contenido' });
  if (!tieneAcceso(c, req.usuario)) return res.status(403).json({ detail: sinAcceso(c) });
  const diapositiva = c.diapositivas.find((d) => d.n === n);
  if (!diapositiva) return res.status(400).json({ detail: 'Diapositiva invalida' });

  const historial = await Consulta.find({ claseId, diapositiva: n, usuarioId: req.usuario.id }).sort('createdAt');
  let respuesta;
  let modo = 'ia';
  if (ia.activo()) {
    respuesta = await ia.responderDuda({ titulo: c.titulo, resumen: c.resumen, diapositiva, historial, pregunta });
  } else {
    modo = 'demo';
    respuesta = `(Modo demo) Recibí tu pregunta sobre "${diapositiva.titulo}". Con una API key configurada, aquí la IA `
      + `respondería usando el contenido de esta diapositiva. Mientras tanto, repasa la explicación: ${diapositiva.explicacion.slice(0, 300)}...`;
  }
  const consulta = await Consulta.create({
    claseId, diapositiva: n, usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre, rol: req.usuario.rol,
    pregunta, respuesta: respuesta || 'La IA no devolvio respuesta, intenta de nuevo.', modo,
  });
  res.status(201).json(consulta);
}));

app.get('/clases/:id/consultas', conToken, h(async (req, res) => {
  const filtro = { claseId: Number(req.params.id) };
  // El profesor ve las dudas de todos los estudiantes; cada estudiante solo las suyas
  if (req.usuario.rol === 'profesor') filtro.rol = 'estudiante';
  else filtro.usuarioId = req.usuario.id;
  res.json(await Consulta.find(filtro).sort('createdAt'));
}));

app.get('/mis-asignaciones', conToken, soloEstudiante, h(async (req, res) => {
  res.json(await Asignacion.find({ estudianteId: req.usuario.id }, 'claseId entregada entregadaEn'));
}));

app.get('/estadisticas', conToken, soloProfesor, h(async (req, res) => {
  res.json(await Asignacion.aggregate([
    { $group: { _id: '$claseId', total: { $sum: 1 }, entregadas: { $sum: { $cond: ['$entregada', 1, 0] } } } },
    { $project: { _id: 0, claseId: '$_id', total: 1, entregadas: 1 } },
  ]));
}));

// ------------------------------------------------------------------ arranque
const PORT = process.env.PORT_IA || 3000;
mongoose.connect(process.env.MONGO_URL)
  .then(() => {
    console.log('Conectado a MongoDB');
    app.listen(PORT, () => console.log(`servicio-ia escuchando en :${PORT} (${ia.activo() ? ia.MODELO : 'modo demo'})`));
  })
  .catch((e) => { console.error('No se pudo conectar a MongoDB', e); process.exit(1); });
