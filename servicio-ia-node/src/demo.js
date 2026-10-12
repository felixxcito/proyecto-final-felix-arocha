// "Modo demo": cuando no hay GEMINI_API_KEY el sistema sigue funcionando
// con contenido generado por plantillas a partir del texto de las diapositivas.

const AVISO = 'Contenido generado en modo demo. Configura GEMINI_API_KEY en el .env para que la IA redacte la explicacion.';

function explicarDemo(diapositivas, titulo) {
  return {
    resumen: `La clase "${titulo}" tiene ${diapositivas.length} diapositivas. ${AVISO}`,
    diapositivas: diapositivas.map((d) => {
      const lineas = d.texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
      const ideas = lineas.slice(1, 7);
      let explicacion = `Esta diapositiva trata sobre "${d.titulo}".`;
      if (ideas.length) explicacion += ` Los puntos principales son: ${ideas.join('; ')}.`;
      else if (!lineas.length) explicacion = 'Esta diapositiva es principalmente visual (sin texto que analizar).';
      return { n: d.n, titulo: d.titulo, explicacion: `${explicacion}\n\n(${AVISO})` };
    }),
  };
}

const PLANTILLAS = [
  (t) => `Explica con tus propias palabras que es "${t}".`,
  (t) => `¿Por que es importante "${t}" en un proyecto de software?`,
  (t) => `Da un ejemplo practico donde aplicarias "${t}".`,
  (t) => `¿Que problema resuelve "${t}"? Justifica tu respuesta.`,
  (t) => `¿Que pasaria en un sistema real si no se tuviera en cuenta "${t}"?`,
  (t) => `Describe paso a paso como implementarias "${t}".`,
  (t) => `Menciona una ventaja y una desventaja de "${t}".`,
  (t) => `¿Como le explicarias "${t}" a un compañero que falto a clase?`,
];
const PLANTILLAS_PAR = [
  (a, b) => `Compara "${a}" con "${b}": ¿en que se parecen y en que se diferencian?`,
  (a, b) => `¿Como se relaciona "${a}" con "${b}"?`,
];

/** Devuelve hasta `cantidad` preguntas que no esten en `evitar`. */
function preguntasDemo(diapositivas, cantidad, evitar = []) {
  const usadas = new Set(evitar.map(normalizar));
  // La portada (diapositiva 1) no suele ser un tema evaluable
  const sinPortada = diapositivas.length > 2 ? diapositivas.filter((d) => d.n !== 1) : diapositivas;
  const temas = [...new Set(sinPortada.map((d) => d.titulo).filter((t) => t && t.length > 3 && !/^\d+$/.test(t)))];
  if (!temas.length) temas.push('el tema de la clase');

  const candidatas = [];
  for (const p of PLANTILLAS) for (const t of temas) candidatas.push(p(t));
  for (const p of PLANTILLAS_PAR) for (let i = 0; i < temas.length; i++) for (let j = i + 1; j < temas.length; j++) candidatas.push(p(temas[i], temas[j]));

  const resultado = [];
  for (const c of barajar(candidatas)) {
    if (resultado.length >= cantidad) break;
    if (!usadas.has(normalizar(c))) { usadas.add(normalizar(c)); resultado.push(c); }
  }
  return resultado;
}

const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function barajar(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { explicarDemo, preguntasDemo, normalizar, barajar };
