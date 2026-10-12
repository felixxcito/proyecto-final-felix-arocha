// Cliente de Google Gemini usando la API REST (sin SDK, para que se vea que es un simple POST).
// Docs: https://ai.google.dev/api/generate-content
const API_KEY = process.env.GEMINI_API_KEY;
const MODELO = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
const MAX_PDF_INLINE = 15 * 1024 * 1024;

const activo = () => Boolean(API_KEY);

/** Llama a Gemini pidiendo una respuesta JSON que cumpla `schema`. */
async function generarJSON(partes, schema, temperatura = 0.7) {
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: schema,
    temperature: temperatura,
  };
  // En los modelos "flash" apagamos el razonamiento interno para que responda mas rapido
  if (MODELO.includes('flash')) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  const texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!texto) throw new Error(`Gemini no devolvio contenido (${data.candidates?.[0]?.finishReason || 'sin candidatos'})`);
  return JSON.parse(texto);
}

const CONTEXTO = 'Eres asistente docente de la materia "Lenguajes de Programacion" (LPR07304) '
  + 'de la Universidad Jose Antonio Paez, Venezuela. Escribes en espanol claro, para estudiantes universitarios.';

async function explicarPresentacion({ titulo, descripcion, diapositivas, buffer, tipo }) {
  const textoDiapos = diapositivas.map((d) => `--- Diapositiva ${d.n} ---\n${d.texto || '(sin texto)'}`).join('\n\n');
  const partes = [{
    text: `${CONTEXTO}

La profesora subio la presentacion de la clase "${titulo}". ${descripcion ? `Descripcion: ${descripcion}` : ''}
Para CADA una de las ${diapositivas.length} diapositivas escribe una explicacion de 60 a 140 palabras que
desarrolle lo que muestra la diapositiva, explique el porque de cada concepto y, si hay codigo, que hace ese codigo.
No inventes contenido ajeno al tema. Devuelve tambien un resumen general de la clase (3 a 5 oraciones).
Usa exactamente los mismos numeros de diapositiva.

Texto extraido de las diapositivas:
${textoDiapos}`,
  }];
  // Si es PDF, Gemini puede "ver" las paginas (sirve para diapositivas con imagenes o diagramas)
  if (tipo === 'pdf' && buffer.length <= MAX_PDF_INLINE) {
    partes.push({ inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } });
  }

  const schema = {
    type: 'OBJECT',
    properties: {
      resumen: { type: 'STRING' },
      diapositivas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { n: { type: 'INTEGER' }, titulo: { type: 'STRING' }, explicacion: { type: 'STRING' } },
          required: ['n', 'titulo', 'explicacion'],
        },
      },
    },
    required: ['resumen', 'diapositivas'],
  };
  return generarJSON(partes, schema, 0.4);
}

async function generarPreguntas({ titulo, resumen, diapositivas, cantidad, evitar }) {
  const material = diapositivas.map((d) => `(${d.n}) ${d.titulo}: ${d.explicacion || d.texto}`).join('\n');
  const partes = [{
    text: `${CONTEXTO}

Genera ${cantidad} preguntas DISTINTAS entre si sobre la clase "${titulo}" para evaluar a los estudiantes.
Cada estudiante recibira 5 de ellas, asi que deben cubrir temas variados y tener dificultad similar.
Mezcla preguntas conceptuales, de aplicacion practica, de analisis de codigo y de comparacion.
Deben poder responderse en 3 a 8 lineas. No numeres las preguntas.
${evitar.length ? `NO repitas ni parafrasees ninguna de estas preguntas ya usadas:\n- ${evitar.join('\n- ')}` : ''}

Resumen de la clase: ${resumen}

Contenido:
${material}`,
  }];
  const schema = {
    type: 'OBJECT',
    properties: { preguntas: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['preguntas'],
  };
  const r = await generarJSON(partes, schema, 1.0);
  return r.preguntas || [];
}

module.exports = { activo, explicarPresentacion, generarPreguntas, MODELO };
