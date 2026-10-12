// Extrae el texto de cada diapositiva de un PDF o PPTX.
const JSZip = require('jszip');
// Se importa lib/pdf-parse.js directamente para evitar el "modo debug" de index.js
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const decodificar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function extraerPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const archivos = Object.keys(zip.files)
    .map((nombre) => ({ nombre, m: nombre.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));

  const diapositivas = [];
  for (const { nombre } of archivos) {
    const xml = await zip.file(nombre).async('string');
    // Cada <a:p> es un parrafo; dentro, cada <a:t> es un trozo de texto
    const parrafos = xml.split('</a:p>').map((p) =>
      [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodificar(m[1])).join(''),
    ).map((t) => t.trim()).filter(Boolean);
    diapositivas.push({ n: diapositivas.length + 1, texto: parrafos.join('\n') });
  }
  return diapositivas;
}

async function extraerPdf(buffer) {
  const paginas = [];
  await pdfParse(buffer, {
    pagerender: async (pagina) => {
      const contenido = await pagina.getTextContent();
      let texto = '';
      let ultimaY;
      for (const item of contenido.items) {
        texto += (ultimaY === undefined || ultimaY === item.transform[5]) ? item.str : `\n${item.str}`;
        ultimaY = item.transform[5];
      }
      paginas[pagina.pageNumber - 1] = texto.trim();
      return texto;
    },
  });
  return paginas.map((texto, i) => ({ n: i + 1, texto: texto || '' }));
}

async function extraerDiapositivas(buffer, tipo) {
  const diapositivas = tipo === 'pptx' ? await extraerPptx(buffer) : await extraerPdf(buffer);
  // El titulo de cada diapositiva es su primera linea
  return diapositivas.map((d) => ({
    ...d,
    titulo: (d.texto.split('\n').find((l) => l.trim().length > 2) || `Diapositiva ${d.n}`).slice(0, 120),
  }));
}

module.exports = { extraerDiapositivas };
