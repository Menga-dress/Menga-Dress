// Prepara il riconoscimento dei capi (si lancia dal workflow "Modello riconoscimento capi"):
// scarica MobileCLIP S0, salva in web/modello/ la parte che guarda le immagini e calcola qui
// una volta per tutte le "impronte" dei tipi di capo (così il telefono non scarica la parte testo).
// Alla fine prova il riconoscimento su qualche foto di Wikimedia Commons e stampa il risultato.
import fs from 'node:fs';
import path from 'node:path';
import {
  env, AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage,
} from '@huggingface/transformers';

const ID = 'Xenova/mobileclip_s0';
const OUT = path.resolve('web/modello');
env.cacheDir = path.resolve('.cache-modelli');
fs.mkdirSync(OUT, { recursive: true });

const labels = JSON.parse(fs.readFileSync('tools/modello/etichette.json', 'utf8'));
delete labels._nota;
const TEMPLATES = ['a photo of {}.', 'a product photo of {}.', '{} laid flat on a bed.', '{} on a hanger.', 'a photo of {} worn by a person.'];

const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

const tokenizer = await AutoTokenizer.from_pretrained(ID);
const text = await CLIPTextModelWithProjection.from_pretrained(ID, { dtype: 'fp32' });
const classes = [];
for (const [key, descs] of Object.entries(labels)) {
  const prompts = descs.flatMap((d) => TEMPLATES.map((t) => t.replace('{}', d)));
  const inputs = tokenizer(prompts, { padding: 'max_length', truncation: true });
  const { text_embeds } = await text(inputs);
  const dim = text_embeds.dims[1];
  const data = text_embeds.data;
  const mean = new Array(dim).fill(0);
  for (let i = 0; i < prompts.length; i++) {
    const e = norm(Array.from(data.slice(i * dim, (i + 1) * dim)));
    e.forEach((x, k) => { mean[k] += x; });
  }
  const [category, name] = key.split('|');
  classes.push({ category, name, e: norm(mean).map((x) => Math.round(x * 1e5) / 1e5) });
}
fs.writeFileSync(path.join(OUT, 'testi.json'), JSON.stringify({ model: ID, classes }));
console.log('impronte salvate:', classes.length);

const processor = await AutoProcessor.from_pretrained(ID);
const vision = await CLIPVisionModelWithProjection.from_pretrained(ID, { dtype: 'q8' });
const src = path.join(env.cacheDir, ID, 'onnx');
console.log('file onnx:', fs.readdirSync(src).map((f) => `${f} ${(fs.statSync(path.join(src, f)).size / 1e6).toFixed(1)}MB`));
fs.copyFileSync(path.join(src, 'vision_model_quantized.onnx'), path.join(OUT, 'immagini.onnx'));
const pc = JSON.parse(fs.readFileSync(path.join(env.cacheDir, ID, 'preprocessor_config.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'preprocessore.json'), JSON.stringify(pc, null, 1));
console.log('preprocessore:', JSON.stringify(pc));

// Prova su foto vere.
const UA = { 'User-Agent': 'wardrobe-classifier-test/1.0' };
const terms = ['t-shirt', 'jeans', 'hoodie', 'blazer', 'sneakers', 'dress', 'skirt', 'puffer jacket', 'loafers', 'cardigan', 'polo shirt', 'handbag', 'trench coat', 'sweatpants', 'necktie', 'ankle boots'];
let tot = 0;
for (const term of terms) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json`;
  try {
    const res = await (await fetch(api, { headers: UA })).json();
    for (const p of Object.values(res.query?.pages || {})) {
      const url = p.imageinfo?.[0]?.thumburl;
      if (!url) continue;
      const blob = await (await fetch(url, { headers: UA })).blob();
      const img = await RawImage.fromBlob(blob);
      const { image_embeds } = await vision(await processor(img));
      const v = norm(Array.from(image_embeds.data));
      const scored = classes.map((c) => ({ n: c.name, s: c.e.reduce((a, x, i) => a + x * v[i], 0) })).sort((a, b) => b.s - a.s);
      tot++;
      console.log(`[${term}] ${p.title} → ${scored.slice(0, 3).map((x) => `${x.n} ${x.s.toFixed(3)}`).join(' | ')}`);
    }
  } catch (e) { console.log('prova fallita', term, e.message); }
}
console.log("foto provate:", tot);
