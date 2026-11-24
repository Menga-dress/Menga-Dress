// Prepara il riconoscimento dei capi (si lancia dal workflow "Modello riconoscimento capi"):
// scarica alcuni modelli gratuiti tipo CLIP, li prova su foto di capi da Wikimedia Commons,
// e salva in web/modello/ il migliore: la parte che guarda le immagini (immagini.onnx) e le
// "impronte" dei tipi di capo calcolate qui una volta per tutte (testi.json), così il telefono
// non deve scaricare la parte testo.
import fs from 'node:fs';
import path from 'node:path';
import {
  env, AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage,
} from '@huggingface/transformers';

const OUT = path.resolve('web/modello');
env.cacheDir = path.resolve('.cache-modelli');
fs.mkdirSync(OUT, { recursive: true });

const CANDIDATES = (process.env.CANDIDATI || 'Xenova/mobileclip_s0:fp32,Xenova/mobileclip_s0:fp16,Xenova/clip-vit-base-patch32:q8,Xenova/clip-vit-base-patch32:fp16')
  .split(',').map((s) => { const [id, dtype] = s.split(':'); return { id, dtype }; });
const FILE = { fp32: 'vision_model.onnx', fp16: 'vision_model_fp16.onnx', q8: 'vision_model_quantized.onnx' };

const labels = JSON.parse(fs.readFileSync('tools/modello/etichette.json', 'utf8'));
delete labels._nota;
// Cose che non sono capi: servono a rifiutare le foto sbagliate (mappe, schermate, paesaggi…).
const nonCapi = JSON.parse(fs.readFileSync('tools/modello/non-capi.json', 'utf8'));
delete nonCapi._nota;
const OTHER_TEMPLATES = ['a photo of {}.', '{}.', 'an image of {}.'];
const TEMPLATES = ['a photo of {}.', 'a product photo of {}.', '{} laid flat on a bed.', '{} on a hanger.', 'a photo of {} worn by a person.'];
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

// Colori della palette dell'app (catalog.js) → nomi in inglese per il modello.
const COLORS = {
  nero: ['black'], grigio: ['grey', 'dark grey'], 'grigio chiaro': ['light grey'], bianco: ['white', 'off-white'],
  beige: ['beige', 'cream'], marrone: ['brown'], blu: ['royal blue', 'blue'], 'blu navy': ['navy blue'],
  azzurro: ['light blue', 'sky blue'], denim: ['denim blue'], verde: ['green'], 'verde oliva': ['olive green', 'khaki green'],
  rosso: ['red'], bordeaux: ['burgundy', 'maroon'], rosa: ['pink'], arancione: ['orange'], giallo: ['yellow'], viola: ['purple'],
  senape: ['mustard yellow', 'mustard'], ocra: ['ochre', 'ochre yellow', 'dark mustard brown'],
};
const COLOR_TEMPLATES = ['a photo of {} clothing.', 'a {} garment.', 'a pair of {} shoes.', 'a {} shirt.', 'a pair of {} trousers.', 'a {} jacket.', 'a {} sweater.'];

async function textClasses(id, map = labels, templates = TEMPLATES) {
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const text = await CLIPTextModelWithProjection.from_pretrained(id, { dtype: 'fp32' });
  const classes = [];
  for (const [key, descs] of Object.entries(map)) {
    const prompts = descs.flatMap((d) => templates.map((t) => t.replace('{}', d)));
    const inputs = tokenizer(prompts, { padding: 'max_length', truncation: true });
    const { text_embeds } = await text(inputs);
    const dim = text_embeds.dims[1];
    const mean = new Array(dim).fill(0);
    for (let i = 0; i < prompts.length; i++) {
      norm(Array.from(text_embeds.data.slice(i * dim, (i + 1) * dim))).forEach((x, k) => { mean[k] += x; });
    }
    const [category, name] = key.includes('|') ? key.split('|') : [undefined, key];
    classes.push({ category, name, e: norm(mean).map((x) => Math.round(x * 1e5) / 1e5) });
  }
  return classes;
}

// Foto di prova: termine di ricerca → tipi accettati come risposta giusta.
const TESTS = {
  't-shirt product': ['T-shirt'], 'blue jeans trousers': ['Jeans'], 'hoodie sweatshirt': ['Felpa'], 'blazer jacket': ['Blazer'],
  'sneakers shoes': ['Sneakers', 'Scarpe da corsa'], 'summer dress': ['Vestito', 'Abito elegante'], 'skirt garment': ['Gonna'],
  'puffer jacket': ['Piumino'], 'loafers shoes': ['Mocassini'], 'cardigan sweater': ['Cardigan', 'Maglione'], 'polo shirt': ['Polo'],
  'leather handbag': ['Borsa'], 'trench coat': ['Trench', 'Cappotto'], 'sweatpants': ['Pantaloni sportivi'], 'necktie': ['Cravatta'],
  'chelsea boots': ['Stivaletti'], 'desert boots': ['Polacchini', 'Stivaletti'], 'dress shirt': ['Camicia', 'Camicia elegante'], 'denim jacket': ['Giacca di jeans'],
  'cargo pants': ['Cargo'], 'high heels shoes': ['Décolleté'], 'knitted sweater': ['Maglione', 'Cardigan'], 'sandals footwear': ['Sandali'],
};
const UA = { 'User-Agent': 'wardrobe-classifier-test/1.0' };
const images = [];
for (const [term, ok] of Object.entries(TESTS)) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json`;
  try {
    const res = await (await fetch(api, { headers: UA })).json();
    for (const p of Object.values(res.query?.pages || {})) {
      const url = p.imageinfo?.[0]?.thumburl;
      if (!url) continue;
      images.push({ term, ok, title: p.title, img: await RawImage.fromBlob(await (await fetch(url, { headers: UA })).blob()) });
    }
  } catch (e) { console.log('foto non scaricata', term, e.message); }
}
console.log('foto di prova:', images.length);

// Foto che NON sono capi: per scegliere la soglia oltre la quale l'app rifiuta la foto.
const NON_TESTS = ['city map', 'satellite image city', 'smartphone screenshot', 'mountain landscape', 'dog', 'pizza',
  'car automobile', 'portrait face', 'building facade', 'laptop computer', 'printed document', 'flowers', 'cat', 'kitchen interior'];
const nonImages = [];
for (const term of NON_TESTS) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json`;
  try {
    const res = await (await fetch(api, { headers: UA })).json();
    for (const p of Object.values(res.query?.pages || {})) {
      const url = p.imageinfo?.[0]?.thumburl;
      if (!url) continue;
      nonImages.push({ term, title: p.title, img: await RawImage.fromBlob(await (await fetch(url, { headers: UA })).blob()) });
    }
  } catch (e) { console.log('foto non scaricata', term, e.message); }
}
console.log('foto di prova non capi:', nonImages.length);

let best = null;
for (const cand of CANDIDATES) {
  try {
    const classes = await textClasses(cand.id);
    const processor = await AutoProcessor.from_pretrained(cand.id);
    const vision = await CLIPVisionModelWithProjection.from_pretrained(cand.id, { dtype: cand.dtype });
    let hit = 0; let hit3 = 0;
    for (const t of images) {
      const { image_embeds } = await vision(await processor(t.img));
      const v = norm(Array.from(image_embeds.data));
      const sc = classes.map((c) => ({ n: c.name, s: c.e.reduce((a, x, i) => a + x * v[i], 0) })).sort((a, b) => b.s - a.s);
      if (t.ok.includes(sc[0].n)) hit++;
      if (sc.slice(0, 3).some((x) => t.ok.includes(x.n))) hit3++;
      console.log(`  ${cand.id}:${cand.dtype} [${t.term}] ${t.title.slice(5, 60)} → ${sc.slice(0, 3).map((x) => `${x.n} ${x.s.toFixed(3)}`).join(' | ')}`);
    }
    const file = path.join(env.cacheDir, cand.id, 'onnx', FILE[cand.dtype]);
    const mb = fs.statSync(file).size / 1e6;
    console.log(`RISULTATO ${cand.id}:${cand.dtype} giusti ${hit}/${images.length}, nei primi 3 ${hit3}, ${mb.toFixed(1)} MB`);
    // Il migliore; a parità di risultato (±2) il più leggero.
    if (!best || hit > best.hit + 2 || (hit >= best.hit - 2 && mb < best.mb)) best = { ...cand, hit, mb, file, classes };
  } catch (e) { console.log('ERRORE', cand.id, cand.dtype, e.message); }
}
if (!best) throw new Error('nessun modello funziona');
console.log(`SCELTO ${best.id}:${best.dtype}`);
fs.copyFileSync(best.file, path.join(OUT, 'immagini.onnx'));
const colors = (await textClasses(best.id, COLORS, COLOR_TEMPLATES)).map(({ name, e }) => ({ name, e }));
const vision = await CLIPVisionModelWithProjection.from_pretrained(best.id, { dtype: best.dtype });
const processor = await AutoProcessor.from_pretrained(best.id);
for (const t of images) {
  const { image_embeds } = await vision(await processor(t.img));
  const v = norm(Array.from(image_embeds.data));
  const sc = colors.map((c) => ({ n: c.name, s: c.e.reduce((a, x, i) => a + x * v[i], 0) })).sort((a, b) => b.s - a.s);
  console.log(`  colore [${t.term}] ${t.title.slice(5, 60)} → ${sc.slice(0, 3).map((x) => `${x.n} ${x.s.toFixed(3)}`).join(' | ')}`);
}
const others = (await textClasses(best.id, nonCapi, OTHER_TEMPLATES)).map(({ name, e }) => ({ name, e }));
// Probabilità che la foto sia un capo: come fa l'app (riconosci.js), scala 100 su capi + non capi.
const pCapo = (v) => {
  const all = [...best.classes.map((c) => ({ capo: true, c })), ...others.map((c) => ({ capo: false, c }))]
    .map((x) => ({ ...x, s: x.c.e.reduce((a, y, i) => a + y * v[i], 0) }));
  const mx = Math.max(...all.map((x) => x.s));
  let tot = 0; let capo = 0; let top = null;
  for (const x of all) {
    const ex = Math.exp(100 * (x.s - mx));
    tot += ex; if (x.capo) capo += ex;
    if (!top || x.s > top.s) top = x;
  }
  return { p: capo / tot, top: top.c.name, max: mx };
};
const garmentP = [];
for (const t of images) {
  const { image_embeds } = await vision(await processor(t.img));
  const r = pCapo(norm(Array.from(image_embeds.data)));
  garmentP.push(r.p);
  console.log(`  CAPO [${t.term}] ${t.title.slice(5, 50)} → capo ${(r.p * 100).toFixed(1)}% (${r.top}, ${r.max.toFixed(3)})`);
}
const otherP = [];
for (const t of nonImages) {
  const { image_embeds } = await vision(await processor(t.img));
  const r = pCapo(norm(Array.from(image_embeds.data)));
  otherP.push(r.p);
  console.log(`  NON CAPO [${t.term}] ${t.title.slice(5, 50)} → capo ${(r.p * 100).toFixed(1)}% (${r.top}, ${r.max.toFixed(3)})`);
}
for (const th of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  console.log(`SOGLIA ${th}: capi rifiutati ${garmentP.filter((p) => p < th).length}/${garmentP.length}, non capi accettati ${otherP.filter((p) => p >= th).length}/${otherP.length}`);
}
fs.writeFileSync(path.join(OUT, 'testi.json'), JSON.stringify({ model: best.id, dtype: best.dtype, classes: best.classes, colors, others }));
fs.copyFileSync(path.join(env.cacheDir, best.id, 'preprocessor_config.json'), path.join(OUT, 'preprocessore.json'));
