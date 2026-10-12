// Cliente de Inteligencia Artificial con dos proveedores intercambiables desde el .env:
//   IA_PROVIDER=nvidia -> NVIDIA NIM (build.nvidia.com, key gratis, API compatible con OpenAI)
//   IA_PROVIDER=gemini -> Google Gemini (aistudio.google.com)
// Ambos se usan con un simple POST (sin SDK) para que se vea claramente como se consume el servicio.
const PROVEEDOR = (process.env.IA_PROVIDER || 'nvidia').toLowerCase();
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const DIAPOS_POR_LLAMADA = 8; // se procesa por partes para no pasar el limite de tokens de respuesta

const activo = () => Boolean(PROVEEDOR === 'gemini' ? GEMINI_KEY : NVIDIA_KEY);
const MODELO = PROVEEDOR === 'gemini' ? `Gemini ${GEMINI_MODEL}` : `NVIDIA ${NVIDIA_MODEL}`;

const SISTEMA = 'Eres asistente docente de la materia "Lenguajes de Programacion" (LPR07304) de la Universidad '
  + 'Jose Antonio Paez, Venezuela. Escribes en espanol claro para estudiantes universitarios. '
  + 'Respondes UNICAMENTE con JSON valido, sin texto adicional ni bloques de codigo markdown.';

/** Extrae el JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto. */
function parsearJSON(texto) {
  const limpio = texto.replace(/```(?:json)?/gi, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio < 0 || fin < inicio) throw new Error('La IA no devolvio JSON');
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

async function nvidia(prompt, temperatura) {
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_KEY}` },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: prompt }],
      temperature: temperatura,
      max_tokens: 4096,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`NVIDIA ${res.status}: ${data.detail || data.error?.message || JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content || '';
}

async function gemini(prompt, temperatura) {
  const generationConfig = { responseMimeType: 'application/json', temperature: temperatura };
  if (GEMINI_MODEL.includes('flash')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

/** Envia el prompt al proveedor configurado y devuelve el JSON de la respuesta (1 reintento). */
async function pedirJSON(prompt, temperatura = 0.5) {
  const llamar = PROVEEDOR === 'gemini' ? gemini : nvidia;
  try {
    return parsearJSON(await llamar(prompt, temperatura));
  } catch (e) {
    console.warn('Reintentando llamada a la IA:', e.message);
    return parsearJSON(await llamar(prompt, temperatura));
  }
}

async function explicarPresentacion({ titulo, descripcion, diapositivas }) {
  const resultado = [];
  for (let i = 0; i < diapositivas.length; i += DIAPOS_POR_LLAMADA) {
    const grupo = diapositivas.slice(i, i + DIAPOS_POR_LLAMADA);
    const texto = grupo.map((d) => `--- Diapositiva ${d.n} ---\n${d.texto || '(sin texto, diapositiva visual)'}`).join('\n\n');
    const r = await pedirJSON(`La profesora subio la presentacion de la clase "${titulo}". ${descripcion ? `Descripcion: ${descripcion}` : ''}
Para CADA una de estas ${grupo.length} diapositivas escribe una explicacion de 60 a 140 palabras que desarrolle lo
que muestra, explique el porque de cada concepto y, si hay codigo, que hace ese codigo. No inventes contenido ajeno al tema.
Usa exactamente los mismos numeros de diapositiva.

Formato de respuesta:
{"diapositivas":[{"n":1,"titulo":"titulo corto","explicacion":"..."}]}

${texto}`, 0.4);
    resultado.push(...(r.diapositivas || []));
  }

  const r = await pedirJSON(`Escribe un resumen general (3 a 5 oraciones) de la clase "${titulo}" a partir de estas explicaciones.
Formato: {"resumen":"..."}

${resultado.map((d) => `(${d.n}) ${d.titulo}: ${d.explicacion}`).join('\n').slice(0, 12000)}`, 0.4);
  return { resumen: r.resumen, diapositivas: resultado };
}

async function generarPreguntas({ titulo, resumen, diapositivas, cantidad, evitar }) {
  const material = diapositivas.map((d) => `(${d.n}) ${d.titulo}: ${d.explicacion || d.texto}`).join('\n').slice(0, 12000);
  const r = await pedirJSON(`Genera ${Math.min(cantidad, 40)} preguntas DISTINTAS entre si sobre la clase "${titulo}" para evaluar a los estudiantes.
Cada estudiante recibira 5 de ellas, asi que deben cubrir temas variados y tener dificultad similar.
Mezcla preguntas conceptuales, de aplicacion practica, de analisis de codigo y de comparacion.
Deben poder responderse en 3 a 8 lineas. No numeres las preguntas.
${evitar.length ? `NO repitas ni parafrasees ninguna de estas preguntas ya usadas:\n- ${evitar.join('\n- ')}` : ''}

Formato: {"preguntas":["...","..."]}

Resumen de la clase: ${resumen}

Contenido:
${material}`, 1.0);
  return (r.preguntas || []).filter((p) => typeof p === 'string');
}

module.exports = { activo, explicarPresentacion, generarPreguntas, MODELO, PROVEEDOR };
