// Riconosce i colori principali di un capo dalla foto, direttamente sul telefono.
import { PALETTE } from './catalog.js';

const NAMES = Object.keys(PALETTE);

// RGB → Lab, per confrontare i colori come li vede l'occhio.
function toLab([r, g, b]) {
  const lin = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// Lab → tinta (gradi), saturazione (croma / luminosità) e luminosità.
// La saturazione cambia poco tra parte in luce e parte in ombra dello stesso capo,
// la luminosità invece molto: per questo pesa meno.
function toLsh([L, a, b]) {
  const C = Math.hypot(a, b);
  return { L, C, s: C / Math.max(L, 8), h: (Math.atan2(b, a) * 180) / Math.PI };
}

const PALETTE_LSH = NAMES.map((n) => toLsh(toLab(PALETTE[n])));
const GREYS = new Set(['nero', 'grigio', 'grigio chiaro', 'bianco']);

export function nearest(rgb) {
  const p = toLsh(toLab(rgb));
  let best = 0; let bestD = Infinity;
  for (let i = 0; i < PALETTE_LSH.length; i++) {
    const q = PALETTE_LSH[i];
    let dh = Math.abs(p.h - q.h);
    if (dh > 180) dh = 360 - dh;
    // La tinta conta solo se entrambi i colori sono abbastanza colorati.
    const hw = Math.min(1, p.C / 18, q.C / 18);
    const d = ((p.L - q.L) / (GREYS.has(NAMES[i]) ? 12 : 28)) ** 2
      + ((p.s - q.s) / 0.2) ** 2
      + ((dh * hw) / 11) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return NAMES[best];
}

// Due colori della palette che possono essere lo stesso tessuto in luce e in ombra
// (ocra in ombra sembra marrone, in piena luce beige): tinta e luminosità vicine.
export function sameShade(a, b) {
  const p = PALETTE_LSH[NAMES.indexOf(a)]; const q = PALETTE_LSH[NAMES.indexOf(b)];
  if (!p || !q) return false;
  if (Math.abs(p.L - q.L) >= 30) return false;
  if (p.C < 10 && q.C < 10) return true;
  if (p.C < 10 || q.C < 10 || Math.min(p.C, q.C) / Math.max(p.C, q.C) < 0.35) return false;
  let dh = Math.abs(p.h - q.h);
  if (dh > 180) dh = 360 - dh;
  return dh < 20;
}

// Dai conteggi dei pixel ai colori del capo: le ombre e le luci dello stesso colore
// si sommano al colore principale invece di diventare un secondo colore.
function pickColors(counts, max) {
  const groups = [];
  for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const g = groups.find((x) => sameShade(x.name, name));
    if (g) g.n += n; else groups.push({ name, n });
  }
  const total = groups.reduce((t, g) => t + g.n, 0);
  return groups.sort((a, b) => b.n - a.n)
    .filter((g, i) => i === 0 || g.n / total > 0.18).slice(0, max).map((g) => g.name);
}

async function loadBitmap(blob) {
  try { return await createImageBitmap(blob); } catch { /* fallback sotto */ }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// Guarda la parte centrale della foto (dove di solito sta il capo) e scarta
// i pixel simili al bordo, che di solito sono lo sfondo.
export async function detectColors(blob, max = 2) {
  const img = await loadBitmap(blob);
  const W = 80; const H = Math.max(1, Math.round((img.height || img.naturalHeight) / (img.width || img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const alpha = (x, y) => data[(y * W + x) * 4 + 3];

  // Foto con lo sfondo già tolto (trasparente): conta solo i pixel del capo, in tutta l'immagine.
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
  if (clear > W * H * 0.05) {
    const counts = {};
    let total = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (alpha(x, y) < 200) continue;
        const n = nearest(px(x, y));
        counts[n] = (counts[n] || 0) + 1;
        total++;
      }
    }
    if (total) return pickColors(counts, max);
  }

  const border = {};
  for (let x = 0; x < W; x++) { for (const y of [0, H - 1]) { const n = nearest(px(x, y)); border[n] = (border[n] || 0) + 1; } }
  for (let y = 0; y < H; y++) { for (const x of [0, W - 1]) { const n = nearest(px(x, y)); border[n] = (border[n] || 0) + 1; } }
  const borderTotal = 2 * (W + H);
  const background = Object.entries(border).filter(([, n]) => n / borderTotal > 0.35).map(([k]) => k);

  const counts = {};
  let total = 0;
  for (let y = Math.floor(H * 0.2); y < Math.ceil(H * 0.8); y++) {
    for (let x = Math.floor(W * 0.2); x < Math.ceil(W * 0.8); x++) {
      const n = nearest(px(x, y));
      if (background.includes(n)) continue;
      counts[n] = (counts[n] || 0) + 1;
      total++;
    }
  }
  if (!total) return background.slice(0, 1);
  return pickColors(counts, max);
}
