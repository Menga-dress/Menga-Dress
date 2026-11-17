// Manichini creati da te: carichi dall'app un'immagine fatta con ChatGPT o Gemini con i capi
// a colori pieni (giacca rossa, maglia verde, pantaloni blu, scarpe gialle) e l'app prepara da sola,
// sul telefono, la base grigia e la mappa delle zone. È la stessa preparazione di
// tools/manichino/prepara.py, riscritta in JavaScript.
// I manichini restano sul telefono (IndexedDB, chiave 'manichini') ed entrano nel backup.

import * as db from './db.js';
import { setCustomMannequins } from './catalog.js';

export const W = 640;
export const H = 960;
const KEY = 'manichini';

// ---------- archivio ----------
// Due elenchi: i tuoi (kv 'manichini', solo su questo telefono) e quelli pubblici
// dell'amministratore (kv 'manichini-pubblici', copia locale del catalogo su Supabase).
// Nell'app si usano entrambi; i tuoi vengono prima.
const SHARED = 'manichini-pubblici';

async function refresh() {
  let mine = []; let shared = [];
  try { mine = (await db.getKV(KEY)) || []; } catch { /* niente */ }
  try { shared = (await db.getKV(SHARED)) || []; } catch { /* niente */ }
  const ids = new Set(mine.map((m) => m.id));
  setCustomMannequins([...mine, ...shared.filter((m) => !ids.has(m.id)).map((m) => ({ ...m, shared: true }))]);
  return mine;
}

export async function loadCustom() {
  const mine = await refresh();
  syncShared().catch((e) => console.warn('manichini pubblici', e));
  return mine;
}

export async function saveCustom(m) {
  const list = ((await db.getKV(KEY)) || []).filter((x) => x.id !== m.id);
  list.push(m);
  await db.setKV(KEY, list);
  await refresh();
}

export async function removeCustom(id) {
  const list = ((await db.getKV(KEY)) || []).filter((x) => x.id !== id);
  await db.setKV(KEY, list);
  await refresh();
}

// ---------- catalogo pubblico (Supabase) ----------

async function catalog() {
  const conf = await import('./config.js');
  if (conf.CATALOGO_URL && conf.CATALOGO_KEY) return { url: conf.CATALOGO_URL, key: conf.CATALOGO_KEY };
  const sync = await import('./sync.js');
  return sync.getConfig();
}

const publicFile = (cfg, name) => `${cfg.url}/storage/v1/object/public/manichini/${name}`;

// Scarica i manichini pubblici nuovi o cambiati e li tiene sul telefono (vanno anche offline).
let syncing = null;
export function syncShared() {
  if (!syncing) {
    syncing = (async () => {
      const cfg = await catalog();
      if (!cfg) return false;
      const res = await fetch(`${cfg.url}/rest/v1/manichini?select=id,data,modified`, { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } });
      if (!res.ok) throw new Error(`catalogo ${res.status}`);
      const rows = await res.json();
      const have = (await db.getKV(SHARED)) || [];
      const next = [];
      let changed = rows.length !== have.length;
      for (const r of rows) {
        const old = have.find((x) => x.id === r.id);
        if (old && old.modified === r.modified) { next.push(old); continue; }
        const v = encodeURIComponent(r.modified);
        const [base, zone] = await Promise.all([`${r.id}-base.jpg`, `${r.id}-zone.png`].map(async (n) => {
          const f = await fetch(`${publicFile(cfg, n)}?v=${v}`);
          if (!f.ok) throw new Error(`immagine ${n} ${f.status}`);
          return f.blob();
        }));
        next.push({ ...r.data, id: r.id, modified: r.modified, base, zone });
        changed = true;
      }
      if (changed) {
        await db.setKV(SHARED, next);
        await refresh();
        window.dispatchEvent(new Event('manichini'));
      }
      return changed;
    })().finally(() => { syncing = null; });
  }
  return syncing;
}

// Sei l'amministratore? (accesso fatto nello stesso progetto del catalogo e presente in "admins")
export async function isAdmin() {
  try {
    const sync = await import('./sync.js');
    const cfg = await catalog();
    const mine = sync.getConfig();
    if (!cfg || !mine || cfg.url !== mine.url) return false;
    const user = await sync.currentUser();
    if (!user) return false;
    const sb = await sync.client();
    const { data, error } = await sb.from('admins').select('user_id').eq('user_id', user.id);
    return !error && data?.length > 0;
  } catch { return false; }
}

const META = ['name', 'gender', 'occasions', 'garments', 'main', 'createdAt'];

// Pubblica (o aggiorna) un tuo manichino per tutti gli utenti.
export async function publishShared(m) {
  const sync = await import('./sync.js');
  const sb = await sync.client();
  const up = async (name, blob, type) => {
    const { error } = await sb.storage.from('manichini').upload(name, blob, { upsert: true, contentType: type });
    if (error) throw error;
  };
  await up(`${m.id}-base.jpg`, m.base, 'image/jpeg');
  await up(`${m.id}-zone.png`, m.zone, 'image/png');
  const data = Object.fromEntries(META.map((k) => [k, m[k] ?? null]));
  const { error } = await sb.from('manichini').upsert({ id: m.id, data, modified: new Date().toISOString() });
  if (error) throw error;
  const list = (await db.getKV(KEY)) || [];
  const it = list.find((x) => x.id === m.id);
  if (it) { it.published = true; await db.setKV(KEY, list); }
  await refresh();
}

// Toglie un manichino dal catalogo pubblico (resta tra i tuoi).
export async function unpublishShared(id) {
  const sync = await import('./sync.js');
  const sb = await sync.client();
  const { error } = await sb.from('manichini').delete().eq('id', id);
  if (error) throw error;
  await sb.storage.from('manichini').remove([`${id}-base.jpg`, `${id}-zone.png`]);
  const list = (await db.getKV(KEY)) || [];
  const it = list.find((x) => x.id === id);
  if (it) { it.published = false; await db.setKV(KEY, list); }
  const shared = ((await db.getKV(SHARED)) || []).filter((x) => x.id !== id);
  await db.setKV(SHARED, shared);
  await refresh();
}

// ---------- preparazione dell'immagine ----------

// Massimo (dilate) o minimo (erode) su una finestra k×k di una maschera 0/1, separabile.
function boxFilter(mask, k, dilate) {
  const r = k >> 1;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < W) sum += mask[row + x];
    for (let x = 0; x < W; x++) {
      const n = Math.min(W - 1, x + r) - Math.max(0, x - r) + 1;
      tmp[row + x] = dilate ? (sum > 0 ? 1 : 0) : (sum === n ? 1 : 0);
      const xo = x - r; const xi = x + r + 1;
      if (xo >= 0) sum -= mask[row + xo];
      if (xi < W) sum += mask[row + xi];
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < H) sum += tmp[y * W + x];
    for (let y = 0; y < H; y++) {
      const n = Math.min(H - 1, y + r) - Math.max(0, y - r) + 1;
      out[y * W + x] = dilate ? (sum > 0 ? 1 : 0) : (sum === n ? 1 : 0);
      const yo = y - r; const yi = y + r + 1;
      if (yo >= 0) sum -= tmp[yo * W + x];
      if (yi < H) sum += tmp[yi * W + x];
    }
  }
  return out;
}

// Tiene solo i pezzi (pixel collegati) con almeno minPx pixel.
function keepBig(mask, minPx) {
  const seen = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const pix = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0; let n = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp];
      pix[n++] = p;
      const x = p % W;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
      for (const q of nb) {
        if (q >= 0 && q < W * H && mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    if (n >= minPx) for (let j = 0; j < n; j++) keep[pix[j]] = 1;
  }
  return keep;
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

// Prepara il manichino dall'immagine a colori pieni.
// → { base: Blob jpg, zone: Blob png, overlay: canvas con le zone colorate, counts: {1..4 pixel} }
export async function prepareMannequin(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  // Ritaglio 2:3 al centro, come i manichini dell'app.
  const k = Math.max(W / bmp.width, H / bmp.height);
  const sw = W / k; const sh = H / k;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, W, H);
  bmp.close?.();
  const src = ctx.getImageData(0, 0, W, H).data;

  const N = W * H;
  const V = new Float32Array(N); const S = new Float32Array(N); const Hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = src[i * 4] / 255; const g = src[i * 4 + 1] / 255; const b = src[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    V[i] = mx;
    S[i] = mx > 1e-3 ? (mx - mn) / Math.max(mx, 1e-3) : 0;
    const d = Math.max(mx - mn, 1e-6);
    let hh;
    if (mx === r) hh = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    Hh[i] = hh * 60;
  }

  const RED = 25;
  const garment = new Uint8Array(N);
  const zone = new Uint8Array(N);
  const feet = Math.round(H * 0.7) * W; // le scarpe stanno sempre in basso (non il bagliore dorato)
  for (let i = 0; i < N; i++) {
    if (!(S[i] > 0.35 && V[i] > 0.1)) continue;
    garment[i] = 1;
    const hh = Hh[i];
    if (hh < RED || hh > 335) zone[i] = 1; // rosso: giacca
    else if (hh >= 75 && hh < 170) zone[i] = 2; // verde: maglia
    else if (hh >= 200 && hh < 265) zone[i] = 3; // blu: pantaloni
    else if (i >= feet && hh >= 40 && hh < 75) zone[i] = 4; // giallo: scarpe
    else if (i >= feet && hh >= 30 && hh < 40 && V[i] > 0.4 && S[i] > 0.5) zone[i] = 4; // ocra (Gemini), non il bagliore dorato
  }

  // Pezzi piccoli: restano se vicini al capo principale, altrimenti via (riflessi del bordo dorato).
  const MIN = { 1: 60, 2: 60, 3: 1500, 4: 300 };
  for (let z = 1; z <= 4; z++) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) m[i] = zone[i] === z ? 1 : 0;
    // Scarpe: via le linee sottili (cerchio e bordo dorati hanno quasi lo stesso colore dell'ocra).
    if (z === 4) {
      const open = boxFilter(boxFilter(m, 5, false), 5, true);
      for (let i = 0; i < N; i++) if (m[i] && !open[i]) { m[i] = 0; zone[i] = 0; }
    }
    const big = keepBig(m, MIN[z]);
    const near = boxFilter(big, 51, true);
    const rest = new Uint8Array(N);
    for (let i = 0; i < N; i++) rest[i] = m[i] && !big[i] ? 1 : 0;
    const small = keepBig(rest, 20);
    for (let i = 0; i < N; i++) {
      if (rest[i]) zone[i] = small[i] && near[i] ? z : 0;
    }
  }

  // Buchi dentro un capo (riflessi, cuciture): si chiudono se il pixel non è scuro come il manichino.
  const HUES = {
    1: (h) => h < RED || h > 335, 2: (h) => h >= 75 && h < 170,
    3: (h) => h >= 190 && h < 270, 4: (h) => h >= 28 && h < 75,
  };
  for (let z = 1; z <= 4; z++) {
    const m = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) if (zone[i] === z) { m[i] = 1; any = true; }
    if (!any) continue;
    const kk = z === 4 ? 9 : 21;
    const closed = boxFilter(boxFilter(m, kk, true), kk, false);
    for (let i = 0; i < N; i++) {
      if (!closed[i] || zone[i]) continue;
      if ((HUES[z](Hh[i]) && S[i] > 0.2 && V[i] > 0.03) || (V[i] > 0.18 && S[i] < 0.35)) zone[i] = z;
    }
  }

  // Riflesso delle scarpe sul piedistallo.
  let maxY = -1; let minX = W; let maxX = -1;
  for (let i = 0; i < N; i++) {
    if (zone[i] !== 4) continue;
    const x = i % W; const y = (i / W) | 0;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (maxY >= 0) {
    for (let y = Math.max(0, maxY - 30); y < Math.min(H, maxY + 28); y++) {
      for (let x = Math.max(0, minX - 6); x < Math.min(W, maxX + 6); x++) {
        const i = y * W + x;
        if (!zone[i] && S[i] > 0.4 && V[i] > 0.08 && Hh[i] >= 36 && Hh[i] < 72) zone[i] = 4;
      }
    }
  }

  // Luce: luminosità rispetto al colore pieno della zona (80° percentile).
  const ref = {};
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let z = 1; z <= 4; z++) {
    const vals = [];
    for (let i = 0; i < N; i++) if (zone[i] === z) vals.push(V[i]);
    counts[z] = vals.length;
    if (vals.length) { vals.sort((a, b) => a - b); ref[z] = vals[Math.floor(0.8 * (vals.length - 1))] || 1; }
  }
  const G = new Float32Array(N);
  const cover = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const z = zone[i];
    if (!z) continue;
    G[i] = Math.min(255, (V[i] / ref[z]) * 128);
    cover[i] = garment[i] ? Math.min(1, Math.max(0, (S[i] - 0.2) / 0.3)) : 1;
  }
  // Bordi sfumati: la zona si allarga di un pixel dove il colore è ancora un po' saturo.
  const zoneD = new Uint8Array(zone);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (zone[i] || !(S[i] > 0.15)) continue;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, zone[i + dy * W + dx]);
      if (!best) continue;
      zoneD[i] = best;
      cover[i] = Math.min(1, Math.max(0, (S[i] - 0.12) / 0.4));
      G[i] = Math.min(255, (V[i] / 0.8) * 128);
    }
  }

  // Mappa delle zone (R zona, G luce, B copertura) e base grigia.
  const zoneImg = new ImageData(W, H);
  const baseImg = new ImageData(W, H);
  const over = new ImageData(W, H);
  const TINT = { 1: [230, 80, 80], 2: [90, 200, 110], 3: [90, 130, 240], 4: [240, 210, 70] };
  for (let i = 0; i < N; i++) {
    const z = zoneD[i];
    const o = i * 4;
    zoneImg.data[o] = z * 60; zoneImg.data[o + 1] = Math.round(G[i]); zoneImg.data[o + 2] = Math.round(cover[i] * 255); zoneImg.data[o + 3] = 255;
    const gray = V[i] * 0.35 * 255;
    for (let c = 0; c < 3; c++) {
      baseImg.data[o + c] = z ? gray : src[o + c];
      const dim = ((src[o] + src[o + 1] + src[o + 2]) / 3) * 0.45;
      over.data[o + c] = z ? dim * 0.35 + TINT[z][c] * 0.65 : dim;
    }
    baseImg.data[o + 3] = 255; over.data[o + 3] = 255;
  }
  const put = (img) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  };
  const [base, zonePng] = await Promise.all([toBlob(put(baseImg), 'image/jpeg', 0.88), toBlob(put(zoneImg), 'image/png')]);
  for (let z = 1; z <= 4; z++) counts[z] = 0;
  const box = {};
  for (let i = 0; i < N; i++) {
    const z = zoneD[i];
    if (!z) continue;
    counts[z]++;
    const x = i % W; const y = (i / W) | 0;
    const b = box[z] || (box[z] = [x, y, x, y]);
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  // Ritaglio di ogni capo dall'immagine originale, per indovinarne il tipo.
  const crops = {};
  for (const z of Object.keys(box)) {
    const [x0, y0, x1, y1] = box[z];
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.08);
    const sx = Math.max(0, x0 - pad); const sy = Math.max(0, y0 - pad);
    const w = Math.min(W, x1 + pad) - sx; const hgt = Math.min(H, y1 + pad) - sy;
    if (w < 8 || hgt < 8) continue;
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    c.getContext('2d').drawImage(cv, sx, sy, w, hgt, 0, 0, w, hgt);
    crops[z] = await toBlob(c, 'image/jpeg', 0.9);
  }
  return { base, zone: zonePng, overlay: put(over), counts, crops };
}
