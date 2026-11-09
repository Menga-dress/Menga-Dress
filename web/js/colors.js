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

const PALETTE_LAB = NAMES.map((n) => toLab(PALETTE[n]));

function nearest(rgb) {
  const lab = toLab(rgb);
  let best = 0; let bestD = Infinity;
  for (let i = 0; i < PALETTE_LAB.length; i++) {
    const p = PALETTE_LAB[i];
    const d = (lab[0] - p[0]) ** 2 + (lab[1] - p[1]) ** 2 + (lab[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return NAMES[best];
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
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n], i) => i === 0 || n / total > 0.18)
    .slice(0, max)
    .map(([k]) => k);
}
