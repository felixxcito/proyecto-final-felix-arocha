// Cliente de Inteligencia Artificial con dos proveedores intercambiables desde el .env:
//   IA_PROVIDER=nvidia -> NVIDIA NIM (build.nvidia.com, key gratis, API compatible con OpenAI)
//   IA_PROVIDER=gemini -> Google Gemini (aistudio.google.com)
// Ambos se usan con un simple POST (sin SDK) para que se vea claramente como se consume el servicio.
const PROVEEDOR = (process.env.IA_PROVIDER || 'nvidia').toLowerCase();
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'google/gemma-4-31b-it';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const DIAPOS_POR_LLAMADA = 4; // se procesa por partes para no pasar el limite de tokens de respuesta
const LLAMADAS_EN_PARALELO = 3;

const activo = () => Boolean(PROVEEDOR === 'gemini' ? GEMINI_KEY : NVIDIA_KEY);
const MODELO = PROVEEDOR === 'gemini' ? `Gemini ${GEMINI_MODEL}` : `NVIDIA ${NVIDIA_MODEL}`;

const CONTEXTO = 'Eres asistente docente de la materia "Lenguajes de Programacion" (LPR07304) de la Universidad '
  + 'Jose Antonio Paez, Venezuela. Escribes en espanol claro para estudiantes universitarios.';
const SISTEMA = `${CONTEXTO} Respondes UNICAMENTE con JSON valido, sin texto adicional ni bloques de codigo markdown.`;

/** Extrae el JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto. */
function parsearJSON(texto) {
  // Algunos modelos "razonan" en voz alta dentro de <think>...</think> antes del JSON
  const limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio < 0 || fin < inicio) throw new Error('La IA no devolvio JSON');
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

// NVIDIA retira modelos con frecuencia: si el configurado ya no existe (404/410) se prueba el siguiente
const NVIDIA_RESPALDO = [NVIDIA_MODEL, 'google/gemma-4-31b-it', 'nvidia/nemotron-3-super-120b-a12b']
  .filter((m, i, arr) => arr.indexOf(m) === i);
let nvidiaModeloActual = NVIDIA_MODEL;

async function nvidia(sistema, mensajes, temperatura) {
  let ultimoError;
  for (const modelo of NVIDIA_RESPALDO.slice(NVIDIA_RESPALDO.indexOf(nvidiaModeloActual))) {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_KEY}` },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'system', content: sistema }, ...mensajes],
        temperature: temperatura,
        max_tokens: 8192,
        stream: true, // la respuesta llega por partes: evita que la conexion se corte en respuestas largas
      }),
    });
    if (res.status === 404 || res.status === 410) {
      ultimoError = new Error(`NVIDIA ${res.status}: el modelo ${modelo} no esta disponible`);
      console.warn(`${ultimoError.message}, probando el siguiente modelo...`);
      continue;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`NVIDIA ${res.status}: ${data.detail || data.error?.message || JSON.stringify(data)}`);
    }
    if (modelo !== nvidiaModeloActual) console.warn(`Usando el modelo de respaldo ${modelo}`);
    nvidiaModeloActual = modelo;
    return leerStream(res);
  }
  throw ultimoError;
}

/** Junta los fragmentos "data: {...}" del stream (Server-Sent Events, formato OpenAI). */
async function leerStream(res) {
  const decoder = new TextDecoder();
  let pendiente = '';
  let texto = '';
  for await (const trozo of res.body) {
    pendiente += decoder.decode(trozo, { stream: true });
    const lineas = pendiente.split('\n');
    pendiente = lineas.pop();
    for (const linea of lineas) {
      const datos = linea.replace(/^data:\s*/, '').trim();
      if (!linea.startsWith('data:') || !datos || datos === '[DONE]') continue;
      try { texto += JSON.parse(datos).choices?.[0]?.delta?.content || ''; } catch { /* linea incompleta */ }
    }
  }
  return texto;
}

async function gemini(sistema, mensajes, temperatura, json = true) {
  const generationConfig = { temperature: temperatura };
  if (json) generationConfig.responseMimeType = 'application/json';
  if (GEMINI_MODEL.includes('flash')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: mensajes.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

/** Envia el prompt al proveedor configurado y devuelve el JSON de la respuesta (1 reintento). */
async function pedirJSON(prompt, temperatura = 0.5) {
  const llamar = () => (PROVEEDOR === 'gemini' ? gemini : nvidia)(SISTEMA, [{ role: 'user', content: prompt }], temperatura);
  try {
    return parsearJSON(await llamar());
  } catch (e) {
    console.warn('Reintentando llamada a la IA:', e.message);
    return parsearJSON(await llamar());
  }
}

/**
 * Chat del visor: el estudiante pregunta sobre la diapositiva que esta viendo.
 * `historial` son las preguntas/respuestas anteriores de ese estudiante en esa diapositiva.
 */
async function responderDuda({ titulo, resumen, diapositiva, historial, pregunta }) {
  const sistema = `${CONTEXTO}
Eres un tutor paciente. El estudiante esta viendo la diapositiva ${diapositiva.n} ("${diapositiva.titulo}") de la clase "${titulo}".
Responde su duda en 40 a 180 palabras, con ejemplos sencillos y, si ayuda, un fragmento corto de codigo.
Si la pregunta no tiene relacion con la materia, indicalo amablemente y vuelve al tema. Escribe en texto plano (sin markdown pesado).

Resumen de la clase: ${resumen}
Texto de la diapositiva:
${diapositiva.texto || '(diapositiva visual)'}
Explicacion que ya leyo el estudiante:
${diapositiva.explicacion}`;
  const mensajes = [];
  for (const h of historial.slice(-4)) mensajes.push({ role: 'user', content: h.pregunta }, { role: 'assistant', content: h.respuesta });
  mensajes.push({ role: 'user', content: pregunta });
  const texto = PROVEEDOR === 'gemini' ? await gemini(sistema, mensajes, 0.5, false) : await nvidia(sistema, mensajes, 0.5);
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function explicarPresentacion({ titulo, descripcion, diapositivas }) {
  const grupos = [];
  for (let i = 0; i < diapositivas.length; i += DIAPOS_POR_LLAMADA) grupos.push(diapositivas.slice(i, i + DIAPOS_POR_LLAMADA));

  const explicarGrupo = async (grupo) => {
    const texto = grupo.map((d) => `--- Diapositiva ${d.n} ---\n${d.texto || '(sin texto, diapositiva visual)'}`).join('\n\n');
    const r = await pedirJSON(`La profesora subio la presentacion de la clase "${titulo}". ${descripcion ? `Descripcion: ${descripcion}` : ''}
Para CADA una de estas ${grupo.length} diapositivas escribe una explicacion de 60 a 140 palabras que desarrolle lo
que muestra, explique el porque de cada concepto y, si hay codigo, que hace ese codigo. No inventes contenido ajeno al tema.
Usa exactamente los mismos numeros de diapositiva.

Formato de respuesta:
{"diapositivas":[{"n":1,"titulo":"titulo corto","explicacion":"..."}]}

${texto}`, 0.4);
    return r.diapositivas || [];
  };

  // Varios grupos a la vez para que una presentacion larga no tarde demasiado
  const resultado = [];
  for (let i = 0; i < grupos.length; i += LLAMADAS_EN_PARALELO) {
    const tandas = await Promise.all(grupos.slice(i, i + LLAMADAS_EN_PARALELO).map(explicarGrupo));
    tandas.forEach((t) => resultado.push(...t));
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

module.exports = { activo, explicarPresentacion, generarPreguntas, responderDuda, MODELO, PROVEEDOR };
