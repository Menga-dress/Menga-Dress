// Riconosce il tipo di capo da una foto, tutto sul telefono e gratis: il modello MobileCLIP S0
// (web/modello/immagini.onnx, preparato da tools/modello/prepara.mjs) trasforma la foto in
// un'"impronta" che si confronta con quelle già calcolate dei tipi di capo (web/modello/testi.json).
// Il modello si scarica una sola volta (circa 12 MB) e poi resta nella cache del telefono.

import * as db from './db.js';

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
      return { ort, pre, classes: testi.classes, colors: testi.colors, others: testi.others || [], session };
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
    let s = c.boost || 0;
    for (let i = 0; i < c.e.length; i++) s += c.e[i] * v[i];
    return s;
  });
  const mx = Math.max(...scores);
  const ex = scores.map((s) => Math.exp(100 * (s - mx)));
  const tot = ex.reduce((a, b) => a + b, 0);
  return list.map((c, i) => ({ category: c.category, name: c.name, p: ex[i] / tot })).sort((a, b) => b.p - a.p);
}

// Impronta della foto (vettore normalizzato).
async function embed(blob) {
  const { ort, pre, session } = await load();
  const px = await pixels(blob, pre);
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', px.data, px.dims) });
  const outName = session.outputNames.includes('image_embeds') ? 'image_embeds' : session.outputNames[0];
  const raw = res[outName].data;
  let n = 0;
  for (let i = 0; i < raw.length; i++) n += raw[i] * raw[i];
  n = Math.sqrt(n) || 1;
  return Array.from(raw, (x) => x / n);
}

// ---------- l'app impara dai tuoi capi ----------
// Per ogni capo salvato si tiene l'impronta della sua foto (solo sul telefono, in kv 'impronte').
// Una foto nuova molto simile a un capo già salvato prende il suo tipo: così le correzioni
// (es. "non sono leggings, sono chino") valgono anche per le foto successive.
const version = (it) => it.updatedAt || it.createdAt || '';
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export async function rememberGarment(item, emb) {
  if (!emb) return;
  const store = (await db.getKV('impronte')) || {};
  store[item.id] = { v: version(item), e: emb.map((x) => Math.round(x * 1000) / 1000) };
  await db.setKV('impronte', store);
}

export async function forgetGarment(id) {
  const store = (await db.getKV('impronte')) || {};
  if (store[id]) { delete store[id]; await db.setKV('impronte', store); }
}

// Calcola in sottofondo le impronte dei capi che non l'hanno ancora (o con la foto cambiata).
let filling = false;
export async function learnFromWardrobe() {
  if (filling) return;
  filling = true;
  try {
    const items = await db.getAll('items');
    const store = (await db.getKV('impronte')) || {};
    let changed = false;
    for (const id of Object.keys(store)) if (!items.some((it) => it.id === id)) { delete store[id]; changed = true; }
    for (const it of items) {
      if (!it.image || !it.category || !it.subcategory || store[it.id]?.v === version(it)) continue;
      try {
        store[it.id] = { v: version(it), e: (await embed(it.image)).map((x) => Math.round(x * 1000) / 1000) };
        changed = true;
      } catch { /* foto illeggibile: si salta */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    if (changed) await db.setKV('impronte', store);
  } finally { filling = false; }
}

// Tipo dei capi già salvati più simili alla foto: { [category|subcategory]: somiglianza massima }.
async function nearestKnown(v, excludeId) {
  const store = (await db.getKV('impronte')) || {};
  const items = await db.getAll('items');
  const byId = new Map(items.map((it) => [it.id, it]));
  const best = {};
  let top = null;
  for (const [id, rec] of Object.entries(store)) {
    if (id === excludeId) continue;
    const it = byId.get(id);
    if (!it?.category || !it.subcategory) continue;
    const sim = dot(v, rec.e);
    const key = `${it.category}|${it.subcategory}`;
    if (!(key in best) || sim > best[key]) best[key] = sim;
    if (!top || sim > top.sim) top = { sim, item: it };
  }
  return { best, top };
}

// Quanto la foto somiglia a un capo invece che a qualcos'altro (mappa, schermata, paesaggio, cibo…):
// probabilità tra 0 e 1, calcolata come rank() ma sommando tutti i tipi di capo.
// Sotto GARMENT_MIN la foto non viene salvata.
export const GARMENT_MIN = 0.4;
function garmentProbability(classes, others, v) {
  if (!others.length) return { p: 1, other: null }; // modello vecchio senza "non capi": nessun controllo
  const all = [...classes.map((c) => ({ capo: true, name: c.name, e: c.e })), ...others.map((c) => ({ capo: false, name: c.name, e: c.e }))];
  const scores = all.map((c) => dot(c.e, v));
  const mx = Math.max(...scores);
  let tot = 0; let capo = 0; let other = null; let otherS = -Infinity;
  scores.forEach((s, i) => {
    const ex = Math.exp(100 * (s - mx));
    tot += ex;
    if (all[i].capo) capo += ex;
    else if (s > otherS) { otherS = s; other = all[i].name; }
  });
  return { p: capo / tot, other };
}

// Guarda la foto una volta sola e restituisce i tipi e i colori più probabili:
// { garment: { p, ok, other }, types: [{ category, name, p }], colors: [{ name, p }] } con p tra 0 e 1.
// garment.ok false: la foto non sembra un capo d'abbigliamento (other: a cosa somiglia).
// learned: il capo già salvato più simile, se lo è molto (stesso capo o quasi).
export async function analyzeGarment(blob, top = 4, { excludeId } = {}) {
  const { classes, colors, others } = await load();
  const v = await embed(blob);
  // Somiglianza con i capi già salvati: sopra 0,85 sposta il tipo verso quello del capo simile.
  let known = { best: {}, top: null };
  try { known = await nearestKnown(v, excludeId); } catch { /* niente memoria */ }
  const boosted = classes.map((c) => {
    const sim = known.best[`${c.category}|${c.name}`];
    return sim > 0.85 ? { ...c, boost: (sim - 0.85) * 2 } : c;
  });
  // Somiglia molto a un capo che hai già salvato: è un capo di sicuro.
  const g = known.top && known.top.sim > 0.85 ? { p: 1, other: null } : garmentProbability(classes, others, v);
  return {
    garment: { p: g.p, other: g.other, ok: g.p >= GARMENT_MIN },
    types: rank(boosted, v).slice(0, top),
    colors: colors ? rank(colors, v).slice(0, 3).map(({ name, p }) => ({ name, p })) : [],
    emb: v,
    learned: known.top && known.top.sim > 0.88 ? known.top : null,
  };
}

export async function recognizeGarment(blob, top = 3) {
  return (await analyzeGarment(blob, top)).types;
}
