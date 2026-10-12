// Modelos de MongoDB con Mongoose (NoSQL de la Clase 12).
// Usamos documentos porque el contenido de cada presentacion tiene forma variable
// (N diapositivas, banco de preguntas que crece, respuestas anidadas).
const mongoose = require('mongoose');

const diapositivaSchema = new mongoose.Schema({
  n: { type: Number, required: true },
  titulo: String,
  texto: String,        // texto extraido del PDF/PPTX
  explicacion: String,  // redactada por la IA (editable por la profesora)
}, { _id: false });

const contenidoSchema = new mongoose.Schema({
  claseId: { type: Number, required: true, unique: true },
  titulo: String,
  descripcion: String,
  nombreArchivo: String,
  tipo: String,
  estado: { type: String, enum: ['procesando', 'listo', 'error'], default: 'procesando' },
  error: String,
  modo: { type: String, enum: ['ia', 'demo'] },
  resumen: String,
  diapositivas: [diapositivaSchema],
  publicado: { type: Boolean, default: false },
  privada: { type: Boolean, default: false },
  // Estudiantes con acceso: los inscritos en las secciones de la clase (y en la lista, si es privada).
  // Lo calcula el servicio de clases (Java) y lo envia en /interno/asignar.
  permitidos: [Number],
  preguntasPorEstudiante: { type: Number, default: 5, min: 1, max: 20 },
  preguntasUsadas: [String],   // para que ninguna pregunta se repita entre estudiantes
}, { timestamps: true });

const preguntaSchema = new mongoose.Schema({
  texto: { type: String, required: true },
  respuesta: { type: String, default: '' },
});

const asignacionSchema = new mongoose.Schema({
  claseId: { type: Number, required: true, index: true },
  estudianteId: { type: Number, required: true },
  estudianteNombre: String,
  estudianteEmail: String,
  preguntas: [preguntaSchema],          // N preguntas, distintas a las de otros estudiantes
  entregada: { type: Boolean, default: false },
  entregadaEn: Date,
}, { timestamps: true });
asignacionSchema.index({ claseId: 1, estudianteId: 1 }, { unique: true });

// Dudas que los estudiantes le preguntan a la IA desde el visor de diapositivas
const consultaSchema = new mongoose.Schema({
  claseId: { type: Number, required: true, index: true },
  diapositiva: { type: Number, required: true },
  usuarioId: { type: Number, required: true },
  usuarioNombre: String,
  rol: String,
  pregunta: { type: String, required: true },
  respuesta: String,
  modo: { type: String, enum: ['ia', 'demo'] },
}, { timestamps: true });

module.exports = {
  Contenido: mongoose.model('Contenido', contenidoSchema),
  Asignacion: mongoose.model('Asignacion', asignacionSchema),
  Consulta: mongoose.model('Consulta', consultaSchema),
};
