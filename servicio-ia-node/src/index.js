/*
 * Microservicio de IA — Node.js + Express + Mongoose + MongoDB + Google Gemini
 *
 * Gateway: http://localhost/api/ia/...
 *   GET  /clases/:id/contenido        -> explicacion de cada diapositiva
 *   PUT  /clases/:id/contenido        -> la profesora corrige lo que genero la IA
 *   POST /clases/:id/regenerar        -> volver a pedir las explicaciones a la IA
 *   GET  /clases/:id/mis-preguntas    -> las 5 preguntas del estudiante
 *   PUT  /clases/:id/mis-preguntas    -> guardar / entregar respuestas
 *   GET  /clases/:id/respuestas       -> (profesora) respuestas de todos
 *   GET  /mis-asignaciones            -> (estudiante) estado de sus preguntas
 *   GET  /estadisticas                -> (profesora) entregas por clase
 * Internos (solo otros microservicios, header X-Internal-Token):
 *   POST /interno/procesar            <- Java manda la presentacion
 *   POST /interno/asignar             <- Java publica la clase
 *   POST /interno/estudiante-nuevo    <- Python creo un estudiante
 *   DELETE /interno/clases/:id        <- Java elimino el tema
 */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { Contenido, Asignacion } = require('./modelos');
const { extraerDiapositivas } = require('./extraer');
const gemini = require('./gemini');
const { explicarDemo, preguntasDemo, normalizar, barajar } = require('./demo');
const { usuariosPorRol, actualizarEstadoClase, notificar } = require('./servicios');

const app = express();
app.use(express.json({ limit: '80mb' }));  // la presentacion llega en base64

const PREGUNTAS_POR_ESTUDIANTE = 5;

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
const soloProfesora = (req, res, next) => (req.usuario.rol === 'profesora'
  ? next() : res.status(403).json({ detail: 'Solo la profesora' }));
const soloEstudiante = (req, res, next) => (req.usuario.rol === 'estudiante'
  ? next() : res.status(403).json({ detail: 'Solo estudiantes' }));
const soloInterno = (req, res, next) => (req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN
  ? next() : res.status(403).json({ detail: 'Solo servicios internos' }));

// Envuelve handlers async para que los errores devuelvan 500 en JSON
const h = (fn) => (req, res, next) => fn(req, res, next).catch((e) => {
  console.error(e);
  res.status(500).json({ detail: e.message });
});

// ------------------------------------------------------------------ logica de IA

/** Extrae el texto, pide a Gemini (o al modo demo) la explicacion y guarda en Mongo. */
async function procesar({ claseId, titulo, descripcion, nombreArchivo, tipo, base64 }) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const diapositivas = await extraerDiapositivas(buffer, tipo);
    if (!diapositivas.length) throw new Error('No se encontraron diapositivas en el archivo');

    let resultado;
    let modo = 'demo';
    if (gemini.activo()) {
      resultado = await gemini.explicarPresentacion({ titulo, descripcion, diapositivas, buffer, tipo });
      modo = 'gemini';
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
      `La IA (${modo === 'gemini' ? gemini.MODELO : 'modo demo'}) explico ${final.length} diapositivas. Revisalas y publica la clase.`);
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

  if (gemini.activo()) {
    for (let intento = 0; intento < 3 && nuevas.length < cantidad; intento++) {
      try {
        const faltan = cantidad - nuevas.length;
        agregar(await gemini.generarPreguntas({
          titulo: contenido.titulo, resumen: contenido.resumen, diapositivas: contenido.diapositivas,
          cantidad: faltan + 3, evitar: [...usadas, ...nuevas].slice(-150),
        }));
      } catch (e) {
        console.error('Gemini fallo generando preguntas:', e.message);
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

/** Asigna 5 preguntas unicas a cada estudiante que todavia no tenga en esta clase. */
function asignarPreguntas(claseId, estudiantes) {
  return enCola(claseId, async () => {
    const contenido = await Contenido.findOne({ claseId, estado: 'listo' });
    if (!contenido) return;
    const yaTienen = new Set((await Asignacion.find({ claseId }, 'estudianteId')).map((a) => a.estudianteId));
    const pendientes = estudiantes.filter((e) => !yaTienen.has(e.id));
    if (!pendientes.length) return;

    const preguntas = barajar(await preguntasNuevas(contenido, pendientes.length * PREGUNTAS_POR_ESTUDIANTE));
    for (const [i, est] of pendientes.entries()) {
      const suyas = preguntas.slice(i * PREGUNTAS_POR_ESTUDIANTE, (i + 1) * PREGUNTAS_POR_ESTUDIANTE);
      await Asignacion.create({
        claseId, estudianteId: est.id, estudianteNombre: est.nombre, estudianteEmail: est.email,
        preguntas: suyas.map((texto) => ({ texto })),
      });
      await Contenido.updateOne({ claseId }, { $push: { preguntasUsadas: { $each: suyas } } });
      notificar(est, `Nueva clase: ${contenido.titulo}`,
        `Ya puedes estudiar la clase "${contenido.titulo}" con la explicacion de cada diapositiva. Tienes ${PREGUNTAS_POR_ESTUDIANTE} preguntas para responder.`,
        `#/clase/${claseId}`);
    }
    console.log(`Clase ${claseId}: preguntas asignadas a ${pendientes.length} estudiante(s)`);
  });
}

// ------------------------------------------------------------------ endpoints internos
app.post('/interno/procesar', soloInterno, h(async (req, res) => {
  const { claseId, titulo, descripcion, nombreArchivo, tipo } = req.body;
  await Contenido.updateOne(
    { claseId },
    { $set: { titulo, descripcion, nombreArchivo, tipo, estado: 'procesando', error: null } },
    { upsert: true },
  );
  res.status(202).json({ ok: true });
  procesar(req.body); // en segundo plano: la IA puede tardar
}));

app.post('/interno/asignar', soloInterno, h(async (req, res) => {
  const { claseId } = req.body;
  await Contenido.updateOne({ claseId }, { publicado: true });
  res.status(202).json({ ok: true });
  usuariosPorRol('estudiante')
    .then((estudiantes) => asignarPreguntas(claseId, estudiantes))
    .catch((e) => console.error('Error asignando preguntas:', e.message));
}));

app.post('/interno/estudiante-nuevo', soloInterno, h(async (req, res) => {
  const estudiante = req.body;
  const publicadas = await Contenido.find({ publicado: true, estado: 'listo' }, 'claseId');
  for (const c of publicadas) await asignarPreguntas(c.claseId, [estudiante]);
  res.json({ clasesAsignadas: publicadas.length });
}));

app.delete('/interno/clases/:id', soloInterno, h(async (req, res) => {
  const claseId = Number(req.params.id);
  await Contenido.deleteOne({ claseId });
  await Asignacion.deleteMany({ claseId });
  res.status(204).end();
}));

// ------------------------------------------------------------------ endpoints publicos
app.get('/health', (req, res) => res.json({
  servicio: 'ia', lenguaje: 'Node.js / Express', orm: 'Mongoose', bd: 'MongoDB',
  ia: gemini.activo() ? `Gemini (${gemini.MODELO})` : 'modo demo (sin GEMINI_API_KEY)',
  estado: mongoose.connection.readyState === 1 ? 'ok' : 'sin-bd',
}));

app.get('/clases/:id/contenido', conToken, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) }, '-preguntasUsadas');
  if (!c) return res.status(404).json({ detail: 'Esta clase aun no tiene presentacion' });
  if (req.usuario.rol !== 'profesora' && !c.publicado) return res.status(403).json({ detail: 'Clase no publicada' });
  res.json(c);
}));

app.put('/clases/:id/contenido', conToken, soloProfesora, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) });
  if (!c) return res.status(404).json({ detail: 'No existe' });
  if (typeof req.body.resumen === 'string') c.resumen = req.body.resumen;
  for (const cambio of req.body.diapositivas || []) {
    const d = c.diapositivas.find((x) => x.n === Number(cambio.n));
    if (d && typeof cambio.explicacion === 'string') d.explicacion = cambio.explicacion;
    if (d && typeof cambio.titulo === 'string') d.titulo = cambio.titulo;
  }
  await c.save();
  res.json(c);
}));

app.post('/clases/:id/regenerar', conToken, soloProfesora, h(async (req, res) => {
  const c = await Contenido.findOne({ claseId: Number(req.params.id) });
  if (!c?.diapositivas?.length) return res.status(404).json({ detail: 'No hay diapositivas para regenerar' });
  const resultado = gemini.activo()
    ? await gemini.explicarPresentacion({ titulo: c.titulo, descripcion: c.descripcion, diapositivas: c.diapositivas, buffer: Buffer.alloc(0), tipo: 'texto' })
    : explicarDemo(c.diapositivas, c.titulo);
  const porNumero = new Map(resultado.diapositivas.map((d) => [Number(d.n), d]));
  c.diapositivas.forEach((d) => { if (porNumero.has(d.n)) d.explicacion = porNumero.get(d.n).explicacion; });
  c.resumen = resultado.resumen;
  c.modo = gemini.activo() ? 'gemini' : 'demo';
  await c.save();
  res.json(c);
}));

app.get('/clases/:id/mis-preguntas', conToken, soloEstudiante, h(async (req, res) => {
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
    if (a.preguntas.some((p) => !p.respuesta.trim())) return res.status(400).json({ detail: 'Responde las 5 preguntas antes de entregar' });
    a.entregada = true;
    a.entregadaEn = new Date();
  }
  await a.save();
  if (a.entregada) {
    const c = await Contenido.findOne({ claseId }, 'titulo');
    usuariosPorRol('profesora').then((profes) => profes.forEach((p) => notificar(p,
      `${req.usuario.nombre} entrego sus respuestas`,
      `${req.usuario.nombre} respondio sus 5 preguntas de la clase "${c?.titulo}".`, `#/clase/${claseId}`)))
      .catch((e) => console.error(e.message));
  }
  res.json(a);
}));

app.get('/clases/:id/respuestas', conToken, soloProfesora, h(async (req, res) => {
  res.json(await Asignacion.find({ claseId: Number(req.params.id) }).sort('estudianteNombre'));
}));

app.get('/mis-asignaciones', conToken, soloEstudiante, h(async (req, res) => {
  res.json(await Asignacion.find({ estudianteId: req.usuario.id }, 'claseId entregada entregadaEn'));
}));

app.get('/estadisticas', conToken, soloProfesora, h(async (req, res) => {
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
    app.listen(PORT, () => console.log(`servicio-ia escuchando en :${PORT} (${gemini.activo() ? 'Gemini' : 'modo demo'})`));
  })
  .catch((e) => { console.error('No se pudo conectar a MongoDB', e); process.exit(1); });
