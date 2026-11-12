// Anteprima visiva dell'outfit, istantanea e senza rete: il manichino di Luciano
// (web/img/manichino.jpg) con giacca, maglia, pantaloni e scarpe ricolorati sul telefono
// con i colori dei capi proposti. Le zone e le ombre stanno in web/img/manichino-zone.png
// (R = zona, G = luce/ombra, B = trasparenza del bordo), create con tools/manichino_zone_*.py.
import { PALETTE } from './catalog.js';

const W = 512;
const H = 768;
const ZONE = { jacket: 1, tee: 2, trousers: 3, shoes: 4 };

let assets = null;
function loadAssets() {
  if (!assets) {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    const pixels = (img) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    };
    assets = Promise.all([load('img/manichino.jpg'), load('img/manichino-zone.png')])
      .then(([base, zone]) => ({ base: pixels(base), zone: pixels(zone) }))
      .catch((e) => { assets = null; throw e; });
  }
  return assets;
}

const rgbOf = (p) => PALETTE[String(p?.colors?.[0] || '').toLowerCase().trim()] || null;

// Quale colore va su ogni zona del manichino.
function zoneColors(pieces) {
  const get = (cat) => pieces.find((p) => p.category === cat);
  const top = rgbOf(get('top'));
  const bottom = rgbOf(get('bottom'));
  const dress = rgbOf(get('dress'));
  const outer = rgbOf(get('outerwear'));
  const shoes = rgbOf(get('shoes'));
  const body = top || dress;
  return {
    [ZONE.jacket]: outer || body, // senza capospalla la giacca prende il colore della maglia (sembra una camicia aperta)
    [ZONE.tee]: body,
    [ZONE.trousers]: bottom || dress,
    [ZONE.shoes]: shoes,
  };
}

// Disegna l'anteprima in un <canvas>; se qualcosa va storto resta il manichino originale.
export function lookCanvas(pieces) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Anteprima dell\'outfit sul manichino');
  loadAssets().then(({ base, zone }) => {
    const colors = zoneColors(pieces);
    const out = new ImageData(new Uint8ClampedArray(base), W, H);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const z = Math.round(zone[i] / 60);
      const c = z && colors[z];
      if (!c) continue;
      const a = zone[i + 2] / 255;
      if (!a) continue;
      const t = (zone[i + 1] - 128) / 75; // luce (+) e ombra (-) del tessuto originale
      const lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
      const add = t * (0.10 + 0.14 * (1 - lum)) * 255;
      for (let k = 0; k < 3; k++) {
        const v = c[k] * (1 + t * 0.28) + add;
        d[i + k] = d[i + k] * (1 - a) + v * a;
      }
    }
    canvas.getContext('2d').putImageData(out, 0, 0);
  }).catch(() => {});
  return canvas;
}
