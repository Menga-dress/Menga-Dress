// Toglie lo sfondo dalla foto del capo, sul telefono e gratis: modello U²-Net piccolo (u2netp,
// licenza Apache 2.0, web/modello/sfondo.onnx, 4,6 MB) con ONNX Runtime Web.
// Restituisce un'immagine WebP con lo sfondo trasparente, ritagliata attorno al capo,
// oppure null se il capo non si distingue bene dallo sfondo (si tiene la foto originale).

const base = (p) => new URL(p, import.meta.url).href;
const S = 320;
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const ort = await import('../vendor/ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = base('../vendor/ort/');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(base('../modello/sfondo.onnx'), { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

export async function removeBackground(blob) {
  const { ort, session } = await load();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const W = bmp.width; const H = bmp.height;

  // Ingresso del modello: 320×320, valori divisi per il massimo e normalizzati come ImageNet.
  const small = document.createElement('canvas');
  small.width = S; small.height = S;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, S, S);
  const d = sctx.getImageData(0, 0, S, S).data;
  let mx = 1;
  for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]);
  const mean = [0.485, 0.456, 0.406]; const std = [0.229, 0.224, 0.225];
  const px = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) px[c * S * S + i] = (d[i * 4 + c] / mx - mean[c]) / std[c];
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', px, [1, 3, S, S]) });
  const m = res[session.outputNames[0]].data;

  // Maschera tra 0 e 1, bordi morbidi.
  let lo = Infinity; let hi = -Infinity;
  for (const v of m) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const mask = new ImageData(S, S);
  let on = 0;
  for (let i = 0; i < S * S; i++) {
    const v = (m[i] - lo) / span;
    const a = Math.max(0, Math.min(1, (v - 0.15) / 0.6));
    if (a > 0.5) on++;
    mask.data[i * 4 + 3] = Math.round(a * 255);
  }
  const coverage = on / (S * S);
  if (coverage < 0.04 || coverage > 0.97) { bmp.close?.(); return null; }

  const mc = document.createElement('canvas');
  mc.width = S; mc.height = S;
  mc.getContext('2d').putImageData(mask, 0, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mc, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // Ritaglio attorno al capo, con un po' di margine.
  let x0 = S; let y0 = S; let x1 = -1; let y1 = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (mask.data[(y * S + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const pad = 0.05;
  const cx0 = Math.max(0, Math.floor((x0 / S - pad) * W)); const cy0 = Math.max(0, Math.floor((y0 / S - pad) * H));
  const cx1 = Math.min(W, Math.ceil(((x1 + 1) / S + pad) * W)); const cy1 = Math.min(H, Math.ceil(((y1 + 1) / S + pad) * H));
  const crop = document.createElement('canvas');
  crop.width = cx1 - cx0; crop.height = cy1 - cy0;
  crop.getContext('2d').drawImage(out, cx0, cy0, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const webp = await toBlob(crop, 'image/webp', 0.9);
  return webp && webp.type === 'image/webp' ? webp : toBlob(crop, 'image/png');
}
