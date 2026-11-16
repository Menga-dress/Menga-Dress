// Riconosce il tipo di capo da una foto, tutto sul telefono e gratis: il modello MobileCLIP S0
// (web/modello/immagini.onnx, preparato da tools/modello/prepara.mjs) trasforma la foto in
// un'"impronta" che si confronta con quelle già calcolate dei tipi di capo (web/modello/testi.json).
// Il modello si scarica una sola volta (circa 12 MB) e poi resta nella cache del telefono.

const base = (p) => new URL(p, import.meta.url).href;
let loading = null;

export function isModelCached() {
  return localStorage.getItem('menga-modello') === '1';
}

function load() {
  if (!loading) {
    loading = (async () => {
      const ort = await import('../vendor/ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = base('../vendor/ort/');
      ort.env.wasm.numThreads = 1;
      const [pre, testi, session] = await Promise.all([
        fetch(base('../modello/preprocessore.json')).then((r) => r.json()),
        fetch(base('../modello/testi.json')).then((r) => r.json()),
        ort.InferenceSession.create(base('../modello/immagini.onnx'), { executionProviders: ['wasm'] }),
      ]);
      try { localStorage.setItem('menga-modello', '1'); } catch { /* niente */ }
      return { ort, pre, classes: testi.classes, colors: testi.colors, session };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const num = (v, d) => (typeof v === 'number' ? v : d);

// Stessa preparazione dell'immagine usata per addestrare il modello: ridimensiona, ritaglia
// il centro, porta i valori tra 0 e 1 (ed eventualmente normalizza).
async function pixels(blob, pre) {
  const size = pre.size || {};
  const crop = pre.crop_size || {};
  const short = num(size.shortest_edge, num(size.height, 256));
  const cw = num(crop.width, num(crop.height, short));
  const ch = num(crop.height, cw);
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = short / Math.min(bmp.width, bmp.height);
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  const doCrop = pre.do_center_crop !== false;
  ctx.drawImage(bmp, doCrop ? Math.round((cw - w) / 2) : 0, doCrop ? Math.round((ch - h) / 2) : 0, doCrop ? w : cw, doCrop ? h : ch);
  bmp.close?.();
  const d = ctx.getImageData(0, 0, cw, ch).data;
  const scale = pre.do_rescale === false ? 1 : num(pre.rescale_factor, 1 / 255);
  const norm = pre.do_normalize === true;
  const mean = norm ? pre.image_mean || [0, 0, 0] : [0, 0, 0];
  const std = norm ? pre.image_std || [1, 1, 1] : [1, 1, 1];
  const out = new Float32Array(3 * cw * ch);
  const plane = cw * ch;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (d[i * 4 + c] * scale - mean[c]) / std[c];
  }
  return { data: out, dims: [1, 3, ch, cw] };
}

// Probabilità come in CLIP (scala 100) delle classi rispetto all'impronta della foto.
function rank(list, v, n) {
  const scores = list.map((c) => {
    let s = 0;
    for (let i = 0; i < c.e.length; i++) s += c.e[i] * v[i];
    return s;
  });
  const mx = Math.max(...scores);
  const ex = scores.map((s) => Math.exp(100 * (s - mx)));
  const tot = ex.reduce((a, b) => a + b, 0);
  return list.map((c, i) => ({ category: c.category, name: c.name, p: ex[i] / tot })).sort((a, b) => b.p - a.p);
}

// Guarda la foto una volta sola e restituisce i tipi e i colori più probabili:
// { types: [{ category, name, p }], colors: [{ name, p }] } con p tra 0 e 1.
export async function analyzeGarment(blob, top = 4) {
  const { ort, pre, classes, colors, session } = await load();
  const px = await pixels(blob, pre);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', px.data, px.dims) };
  const res = await session.run(feeds);
  const outName = session.outputNames.includes('image_embeds') ? 'image_embeds' : session.outputNames[0];
  const raw = res[outName].data;
  let n = 0;
  for (let i = 0; i < raw.length; i++) n += raw[i] * raw[i];
  n = Math.sqrt(n) || 1;
  const v = Array.from(raw, (x) => x / n);
  return {
    types: rank(classes, v).slice(0, top),
    colors: colors ? rank(colors, v).slice(0, 3).map(({ name, p }) => ({ name, p })) : [],
  };
}

export async function recognizeGarment(blob, top = 3) {
  return (await analyzeGarment(blob, top)).types;
}
