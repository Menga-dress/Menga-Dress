// Anteprima visiva dell'outfit, istantanea e senza rete: un manichino disegnato in SVG con i capi
// proposti. Ogni capo ha la sua forma (camicia, felpa, blazer, jeans, sneakers...) e il colore del
// capo vero, con sopra luci, ombre e pieghe che danno volume (effetto 3D) qualunque sia il colore.
// Se manca un capo si usa quello tipico dell'occasione.
import { PALETTE } from './catalog.js';

const VW = 400;
const VH = 600;
const SKIN = [226, 201, 170];

// Capi di partenza per occasione, usati quando la proposta non ha quel capo (o non ne dice il tipo).
const DEFAULTS = {
  lavoro: { top: ['Camicia', 'azzurro'], bottom: ['Chino', 'beige'], shoes: ['Mocassini', 'marrone'] },
  tempo_libero: { top: ['T-shirt', 'bianco'], bottom: ['Jeans', 'denim'], shoes: ['Sneakers', 'bianco'] },
  serata: { top: ['Camicia', 'nero'], bottom: ['Pantaloni eleganti', 'grigio'], shoes: ['Scarpe eleganti', 'nero'] },
  sport: { top: ['Maglia sportiva', 'grigio'], bottom: ['Pantaloni sportivi', 'nero'], shoes: ['Scarpe da corsa', 'bianco'] },
  viaggio: { top: ['Felpa', 'grigio'], bottom: ['Chino', 'verde oliva'], shoes: ['Sneakers', 'bianco'] },
  evento: { top: ['Camicia elegante', 'bianco'], bottom: ['Pantaloni eleganti', 'blu navy'], shoes: ['Scarpe eleganti', 'nero'] },
};

// ---------- colori ----------

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (c, d, t) => c.map((v, i) => clamp(v + (d[i] - v) * t));
const lighten = (c, t) => mix(c, [255, 255, 255], t);
const darken = (c, t) => mix(c, [0, 0, 0], t);
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const lum = (c) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
const colorOf = (name) => PALETTE[String(name || '').toLowerCase().trim()] || null;
// Linee di cuciture e pieghe: più scure del tessuto, o più chiare se il tessuto è già scuro.
const line = (c) => css(lum(c) < 0.22 ? lighten(c, 0.28) : darken(c, 0.3));

// ---------- geometria ----------

const mx = (p) => [VW - p[0], p[1], p[2]];
const fmt = (n) => Math.round(n * 10) / 10;

// Curva morbida (Catmull-Rom) che passa per i punti; i punti con 'c' restano spigoli.
function curve(pts, closed = true) {
  const runs = [];
  let run = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    run.push(pts[i]);
    if (pts[i][2] === 'c' && i < pts.length - 1) { runs.push(run); run = [pts[i]]; }
  }
  if (closed) run.push(pts[0]);
  runs.push(run);
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
  for (const r of runs) {
    for (let i = 0; i < r.length - 1; i++) {
      const p0 = r[i - 1] || r[i];
      const p1 = r[i];
      const p2 = r[i + 1];
      const p3 = r[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${fmt(c1[0])},${fmt(c1[1])} ${fmt(c2[0])},${fmt(c2[1])} ${fmt(p2[0])},${fmt(p2[1])}`;
    }
  }
  return closed ? d + 'Z' : d;
}

// Sagoma simmetrica: punti della metà sinistra, dal centro in alto al centro in basso.
const sym = (half) => curve([...half, ...half.slice().reverse().map(mx).filter((p, i) => i > 0 && i < half.length - 1)]);
// Coppia sinistra + destra della stessa forma (gambe, maniche, scarpe).
const pair = (pts, closed = true) => curve(pts, closed) + curve(pts.map(mx), closed);

// ---------- disegno ----------

class Sketch {
  constructor(id) {
    this.id = id; this.out = []; this.n = 0;
    // Luce da sinistra: ogni forma diventa un "cilindro" (bordo in ombra, riflesso chiaro, lato destro scuro).
    this.defs = [
      `<linearGradient id="${id}sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".12" stop-color="#000" stop-opacity=".08"/><stop offset=".3" stop-color="#fff" stop-opacity=".2"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`,
      `<linearGradient id="${id}sv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`,
      `<filter id="${id}b1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>`,
      `<filter id="${id}b2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>`,
    ];
  }
  // Colore di base del capo, con una leggera sfumatura.
  fill(c, pattern, c2) {
    const g = `${this.id}g${this.n++}`;
    this.defs.push(`<linearGradient id="${g}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${css(lighten(c, 0.14))}"/><stop offset=".5" stop-color="${css(c)}"/><stop offset="1" stop-color="${css(darken(c, 0.16))}"/></linearGradient>`);
    if (!pattern || pattern === 'solid' || pattern === 'other') return `url(#${g})`;
    const p = `${this.id}p${this.n++}`;
    const ink = css(c2 || (lum(c) > 0.55 ? darken(c, 0.45) : lighten(c, 0.5)));
    const motif = {
      striped: `<rect width="14" height="14" fill="url(#${g})"/><rect y="0" width="14" height="3" fill="${ink}"/>`,
      checked: `<rect width="18" height="18" fill="url(#${g})"/><rect width="18" height="5" fill="${ink}" opacity=".45"/><rect width="5" height="18" fill="${ink}" opacity=".45"/>`,
      dotted: `<rect width="12" height="12" fill="url(#${g})"/><circle cx="6" cy="6" r="1.8" fill="${ink}"/>`,
      floral: `<rect width="22" height="22" fill="url(#${g})"/><g fill="${ink}"><circle cx="7" cy="7" r="2.2"/><circle cx="4" cy="7" r="1.6"/><circle cx="10" cy="7" r="1.6"/><circle cx="7" cy="4" r="1.6"/><circle cx="7" cy="10" r="1.6"/><circle cx="17" cy="17" r="1.4"/></g>`,
      printed: `<rect width="24" height="24" fill="url(#${g})"/><path d="M3 18 L9 8 L15 18 Z M15 5 h6 v6 h-6 Z" fill="${ink}" opacity=".7"/>`,
    }[pattern];
    if (!motif) return `url(#${g})`;
    const size = { striped: 14, checked: 18, dotted: 12, floral: 22, printed: 24 }[pattern];
    this.defs.push(`<pattern id="${p}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${motif}</pattern>`);
    return `url(#${p})`;
  }
  // Forma piena del capo + luci e ombre sopra (vert = anche sfumatura dall'alto in basso).
  shape(d, g, extra = '', vert = false) {
    this.out.push(`<path d="${d}" fill="${g.fill}" ${extra}/>`);
    if (g.flat) return;
    this.out.push(`<path d="${d}" fill="url(#${this.id}sh)"/>`);
    if (vert) this.out.push(`<path d="${d}" fill="url(#${this.id}sv)"/>`);
  }
  // Piega del tessuto: un solco scuro sfumato con un filo di luce accanto.
  fold(d, w = 3, op = 0.32) {
    this.out.push(`<path d="${d}" fill="none" stroke="#000" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round" filter="url(#${this.id}b1)"/>`);
    this.out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${op * 0.35}" stroke-width="${w * 0.4}" stroke-linecap="round" transform="translate(-1.6 -.6)" filter="url(#${this.id}b1)"/>`);
  }
  // Ombra portata morbida (sotto colletto, revers, orlo della giacca, cintura).
  shadow(d, op = 0.4, soft = 1) { this.out.push(`<path d="${d}" fill="#000" fill-opacity="${op}" filter="url(#${this.id}${soft > 1 ? 'b2' : 'b1'})"/>`); }
  // Cuciture e bottoni: linee sottili.
  stroke(d, c, w = 1.3, extra = '') { this.out.push(`<path d="${d}" fill="none" stroke="${typeof c === 'string' ? c : line(c)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`); }
  raw(s) { this.out.push(s); }
}

const garment = (sk, c, pattern, c2) => ({ c, fill: sk.fill(c, pattern, c2) });

// Linea centrale del braccio sinistro (spalla → gomito → polso): lungo il corpo o con la mano in tasca.
const ARMS = { down: [[151, 132], [141, 200], [133, 292]], pocket: [[151, 132], [137, 210], [161, 290]] };
let ARM = ARMS.down;
const armPath = (from = 0, to = 1) => {
  const at = (t) => {
    const s = t * 2;
    const i = Math.min(1, Math.floor(s));
    const k = s - i;
    return [ARM[i][0] + (ARM[i + 1][0] - ARM[i][0]) * k, ARM[i][1] + (ARM[i + 1][1] - ARM[i][1]) * k];
  };
  const pts = [];
  for (let t = from; t <= to + 1e-6; t += (to - from) / 6) pts.push(at(t));
  return pts;
};
// Manica (o braccio) come tubo pieno: contorno netto, luce sul lato sinistro e ombra su quello destro.
const tube = (pts, width) => {
  const L = []; const R = []; const N = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0]; let dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    let n = [-dy, dx]; if (n[0] > 0) n = [dy, -dx]; // normale verso sinistra (verso la luce)
    const w = width * (1 - 0.14 * (i / (pts.length - 1))) / 2;
    N.push([n, w]);
    L.push([p[0] + n[0] * w, p[1] + n[1] * w]); R.push([p[0] - n[0] * w, p[1] - n[1] * w]);
  });
  L[L.length - 1][2] = 'c'; R[R.length - 1][2] = 'c';
  const [p0, p1] = pts; const d0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const cap = [p0[0] - (p1[0] - p0[0]) / d0 * width * 0.3, p0[1] - (p1[1] - p0[1]) / d0 * width * 0.3];
  const off = (k) => curve(pts.map((p, i) => [p[0] + N[i][0][0] * N[i][1] * k, p[1] + N[i][0][1] * N[i][1] * k]), false);
  return { d: curve([cap, ...L, ...R.reverse()]), hi: off(0.45), lo: off(-0.62) };
};
const sleeve = (sk, g, to, width, folds = true) => {
  const pts = armPath(0, to);
  for (const side of [pts, pts.map(mx)]) {
    const tb = tube(side, width);
    const clip = `${sk.id}c${sk.n++}`;
    sk.defs.push(`<clipPath id="${clip}"><path d="${tb.d}"/></clipPath>`);
    sk.raw(`<path d="${tb.d}" fill="${g.fill}"/>`);
    sk.raw(`<g clip-path="url(#${clip})"><path d="${tb.lo}" fill="none" stroke="#000" stroke-opacity=".38" stroke-width="${fmt(width * 0.32)}" stroke-linecap="round" filter="url(#${sk.id}b2)"/><path d="${tb.hi}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="${fmt(width * 0.22)}" stroke-linecap="round" filter="url(#${sk.id}b1)"/></g>`);
  }
  if (!folds) return pts[pts.length - 1];
  // Pieghe al gomito e attaccatura della spalla.
  if (to > 0.5) {
    const [ex, ey] = ARM[1];
    const bent = ARM === ARMS.pocket;
    sk.fold(`M${ex - 8} ${ey - 4} q8 ${bent ? 8 : 4} 15 ${bent ? -2 : 1} M${VW - ex + 8} ${ey - 4} q-8 ${bent ? 8 : 4} -15 ${bent ? -2 : 1}`, 2.6, 0.38);
    sk.fold(`M${ex - 6} ${ey + 10} q7 3 13 0 M${VW - ex + 6} ${ey + 10} q-7 3 -13 0`, 2, 0.25);
  }
  sk.fold('M150 128 q-6 22 -4 46 M250 128 q6 22 4 46', 2.4, 0.3);
  return pts[pts.length - 1];
};
const cuff = (sk, g, end, width, h = 7) => {
  // Polsino o bordo della manica: una fascia perpendicolare al braccio.
  const [x, y] = end;
  sk.raw(`<g fill="${css(darken(g.c, 0.08))}" stroke="${line(g.c)}" stroke-width=".8"><rect x="${fmt(x - width / 2)}" y="${fmt(y - h)}" width="${width}" height="${h}" rx="2" transform="rotate(7 ${fmt(x)} ${fmt(y)})"/><rect x="${fmt(VW - x - width / 2)}" y="${fmt(y - h)}" width="${width}" height="${h}" rx="2" transform="rotate(-7 ${fmt(VW - x)} ${fmt(y)})"/></g>`);
};

// ---------- manichino ----------

function backdrop(sk) {
  const id = sk.id;
  sk.defs.push(`<radialGradient id="${id}bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#6b4528"/><stop offset=".6" stop-color="#3d2716"/><stop offset="1" stop-color="#22150c"/></radialGradient>`);
  sk.defs.push(`<linearGradient id="${id}gold" x1="0" x2="1"><stop offset="0" stop-color="#8a6324"/><stop offset=".5" stop-color="#f1cf7a"/><stop offset="1" stop-color="#8a6324"/></linearGradient>`);
  sk.defs.push(`<linearGradient id="${id}ped" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a2a1c"/><stop offset="1" stop-color="#17100a"/></linearGradient>`);
  sk.raw(`<rect width="${VW}" height="${VH}" fill="url(#${id}bg)"/>`);
  sk.raw(`<circle cx="200" cy="250" r="168" fill="none" stroke="#f3c56b" stroke-width="9" opacity=".35" filter="url(#${id}b2)"/>`);
  sk.raw(`<circle cx="200" cy="250" r="168" fill="none" stroke="url(#${id}gold)" stroke-width="2.2" opacity=".9"/>`);
  sk.raw(`<rect x="0" y="520" width="${VW}" height="80" fill="#1d130b" opacity=".55"/>`);
  sk.raw(`<path d="M76 548 v14 a124 20 0 0 0 248 0 v-14" fill="url(#${id}ped)"/>`);
  sk.raw(`<ellipse cx="200" cy="548" rx="124" ry="20" fill="#2c1f14" stroke="url(#${id}gold)" stroke-width="2.4"/>`);
  sk.raw(`<ellipse cx="200" cy="548" rx="124" ry="20" fill="none" stroke="#f3c56b" stroke-width="6" opacity=".3" filter="url(#${id}b2)"/>`);
  sk.raw(`<ellipse cx="200" cy="545" rx="58" ry="8" fill="#000" opacity=".55" filter="url(#${id}b2)"/>`);
}

function body(sk) {
  const skin = garment(sk, SKIN);
  // Gambe e braccia nude: i capi le coprono dove serve.
  sk.shape(pair([[163, 296], [166, 410], [170, 516, 'c'], [191, 516, 'c'], [194, 410], [199, 322, 'c']]), skin);
  sk.shape(curve([[189, 84], [188, 122, 'c'], [212, 122, 'c'], [211, 84]]), skin);
  sk.shadow('M188 84 Q200 100 212 84 L212 98 Q200 106 188 98 Z', 0.35);
  sk.shape(sym([[200, 112], [176, 116], [150, 126], [156, 200], [161, 300, 'c'], [200, 304]]), skin);
  return skin;
}

// Braccia nude (e mani se non sono in tasca): vanno sopra la maglia e sotto le maniche.
function arms(sk, skin) {
  sleeve(sk, skin, 1, 21, false);
  if (ARM === ARMS.down) {
    sk.shape(pair([[123, 292], [121, 310], [127, 326], [136, 324], [141, 306], [139, 292, 'c']]), skin);
  } else {
    // Polso che entra in tasca: un'ombra dove sparisce la mano.
    sk.shadow('M152 286 q10 -4 18 4 l-2 8 q-8 -4 -16 -2 Z M248 286 q-10 -4 -18 4 l2 8 q8 -4 16 -2 Z', 0.45);
  }
}

function head(sk, skin) {
  const id = sk.id;
  sk.defs.push(`<radialGradient id="${id}hd" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${css(lighten(SKIN, 0.35))}"/><stop offset=".45" stop-color="${css(SKIN)}"/><stop offset="1" stop-color="${css(darken(SKIN, 0.3))}"/></radialGradient>`);
  sk.raw(`<path d="M200 24 C219 24 228 40 228 58 C228 80 216 94 200 94 C184 94 172 80 172 58 C172 40 181 24 200 24 Z" fill="url(#${id}hd)"/>`);
  sk.raw(`<ellipse cx="190" cy="44" rx="7" ry="11" fill="#fff" opacity=".18" filter="url(#${id}b1)"/>`);
}

// ---------- capi ----------

// Pantaloni: forma per tipo. Restituisce l'altezza della vita.
function bottoms(sk, kind, g) {
  const t = String(kind).toLowerCase();
  const waist = 282;
  let hem = 520; let knee = [160, 196]; let ankle = [166, 194];
  if (t.includes('jeans')) { knee = [161, 195]; ankle = [168, 192]; }
  if (t.includes('legging')) { knee = [163, 194]; ankle = [170, 191]; }
  if (t.includes('sportiv')) { knee = [158, 197]; ankle = [165, 194]; hem = 514; }
  if (t.includes('eleganti')) { knee = [159, 196]; ankle = [164, 195]; }
  if (t.includes('bermuda')) { hem = 398; knee = [154, 197]; }

  if (t.includes('gonna')) {
    sk.shape(sym([[200, waist], [158, waist, 'c'], [154, 320], [143, 408, 'c'], [200, 412]]), g, '', true);
    sk.fold('M180 300 Q176 350 168 404 M220 300 Q224 350 232 404 M200 330 V406', 3, 0.28);
    sk.stroke('M158 290 H242', g.c, 1.1);
    sk.stroke('M176 300 L170 404 M224 300 L230 404', g.c, 1);
    return waist;
  }
  const leg = t.includes('bermuda')
    ? [[158, waist, 'c'], [154, 320], [152, hem, 'c'], [197, hem, 'c'], [199, 328, 'c'], [200, waist, 'c']]
    : [[158, waist, 'c'], [155, 320], [knee[0], 410], [ankle[0], hem, 'c'], [ankle[1], hem, 'c'], [knee[1], 410], [200, 330, 'c'], [200, waist, 'c']];
  sk.raw(`<rect x="158" y="${waist}" width="84" height="16" fill="${g.fill}"/>`);
  sk.shape(pair(leg), g, '', true);
  // Pieghe: inguine, ginocchia e caviglie (meno sui leggings).
  const soft = t.includes('legging') ? 0.5 : 1;
  sk.fold('M199 332 q-8 10 -18 14 M201 332 q8 10 18 14 M196 312 q-6 4 -14 4 M204 312 q6 4 14 4', 2.6, 0.3 * soft);
  if (!t.includes('bermuda')) {
    for (const x of [knee[0] + 8, VW - knee[1] + 8]) sk.fold(`M${x} 402 q10 5 20 0 M${x + 2} 414 q9 4 17 0`, 2.4, 0.3 * soft);
    sk.fold(`M${ankle[0] + 2} ${hem - 14} q11 6 ${ankle[1] - ankle[0] - 4} 0 M${VW - ankle[1] + 2} ${hem - 14} q11 6 ${ankle[1] - ankle[0] - 4} 0`, 2.4, 0.32 * soft);
    sk.fold(`M${knee[0] + 18} 330 L${knee[0] + 18} 520 M${VW - knee[0] - 18} 330 L${VW - knee[0] - 18} 520`, 5, 0.06);
  }
  // Dettagli per tipo.
  if (t.includes('sportiv')) {
    sk.stroke('M157 296 L163 420 L166 506 M243 296 L237 420 L234 506', lighten(g.c, 0.6), 2.2);
    sk.raw(`<g fill="${css(darken(g.c, 0.1))}"><rect x="165" y="506" width="29" height="10" rx="3"/><rect x="206" y="506" width="29" height="10" rx="3"/></g>`);
    sk.stroke('M158 290 H242', g.c, 1.2);
    sk.stroke('M197 290 l-3 14 M203 290 l3 14', '#eee', 1);
  } else if (t.includes('legging')) {
    sk.stroke('M158 292 H242', g.c, 1);
  } else {
    sk.stroke('M158 296 H242', g.c, 1.1);
    sk.stroke('M200 296 V326', g.c, 1.1);
    sk.stroke('M160 300 Q170 306 172 318 M240 300 Q230 306 228 318', g.c, 1);
    sk.fold('M161 302 Q170 307 171 318 M239 302 Q230 307 229 318', 2.2, 0.35);
    if (t.includes('jeans')) {
      sk.stroke('M160 300 Q170 306 172 318 M240 300 Q230 306 228 318', '#d9a441', 0.9, 'stroke-dasharray="2 2"');
      sk.stroke('M156 330 L161 410 L167 518 M244 330 L239 410 L233 518', g.c, 0.9);
    }
    if (t.includes('eleganti') || t.includes('chino')) sk.stroke(`M179 300 L${(knee[0] + knee[1]) / 2} 410 L${(ankle[0] + ankle[1]) / 2} ${hem - 2} M221 300 L${VW - (knee[0] + knee[1]) / 2} 410 L${VW - (ankle[0] + ankle[1]) / 2} ${hem - 2}`, g.c, 0.9);
    if (t.includes('bermuda')) sk.stroke(`M152 ${hem - 8} H197 M248 ${hem - 8} H203`, g.c, 1);
    // Passanti per la cintura.
    sk.stroke('M168 283 v12 M232 283 v12 M186 283 v12 M214 283 v12', g.c, 1.4);
  }
  return waist;
}

function shoes(sk, kind, g) {
  const t = String(kind).toLowerCase();
  const dark = darken(g.c, 0.25);
  if (t.includes('sandal')) {
    sk.shape(pair([[170, 514], [190, 514], [194, 532], [192, 541, 'c'], [157, 543, 'c'], [160, 532]]), garment(sk, SKIN));
    sk.raw(`<g fill="${g.fill}"><path d="${pair([[162, 526, 'c'], [194, 524, 'c'], [194, 530, 'c'], [161, 532, 'c']])}"/><path d="${pair([[156, 540, 'c'], [193, 540, 'c'], [193, 545, 'c'], [155, 545, 'c']])}"/></g>`);
    return;
  }
  let top = 512; let toe = 156; let sole = 0; let soleC = darken(g.c, 0.35);
  if (t.includes('stival')) top = 488;
  if (t.includes('eleganti') || t.includes('décolleté') || t.includes('decollete')) toe = 153;
  if (t.includes('mocassin')) top = 514;
  if (t.includes('sneaker') || t.includes('corsa')) { sole = 7; soleC = t.includes('corsa') ? [245, 245, 245] : [238, 236, 230]; toe = 155; }
  const shoe = [[168, top], [192, top], [196, 528], [195, 541, 'c'], [toe, 544, 'c'], [toe + 2, 534], [165, 522]];
  sk.shape(pair(shoe), g);
  if (sole) {
    sk.raw(`<path d="${pair([[toe - 1, 537, 'c'], [196, 535, 'c'], [196, 543, 'c'], [toe, 545, 'c']])}" fill="${css(soleC)}"/>`);
    sk.stroke('M170 520 L186 520 M214 520 L230 520', dark, 1.1);
    if (t.includes('corsa')) sk.stroke('M162 532 Q176 524 192 526 M238 532 Q224 524 208 526', lighten(g.c, 0.7), 2);
    else sk.stroke('M168 517 l4 6 M176 516 l4 6 M224 516 l-4 6 M232 517 l-4 6', lighten(g.c, 0.5), 1);
  } else {
    sk.raw(`<path d="${pair([[toe, 541, 'c'], [195, 539, 'c'], [195, 544, 'c'], [toe, 545, 'c']])}" fill="${css(soleC)}"/>`);
    if (t.includes('mocassin')) sk.stroke('M166 524 Q180 518 192 523 M234 524 Q220 518 208 523', dark, 1.2);
    else if (t.includes('stival')) sk.stroke('M181 492 V530 M219 492 V530', dark, 1);
    else sk.stroke('M163 530 Q172 524 178 527 M237 530 Q228 524 222 527', '#ffffff', 1.6, 'opacity=".65"');
    sk.stroke('M170 516 Q180 514 190 516 M210 516 Q220 514 230 516', '#ffffff', 1.2, 'opacity=".3"');
  }
}

// Maglie e camicie. tucked = infilata nei pantaloni.
function top(sk, kind, g, tucked, drawArms) {
  const t = String(kind).toLowerCase();
  const hem = tucked ? 292 : 304;
  const short = /t-shirt|polo|^top|maglia sportiva|camicetta/.test(t);
  const tank = t === 'top';
  const neckDeep = /cardigan/.test(t) ? 176 : 122;
  if (/felpa/.test(t)) {
    // Cappuccio abbassato dietro il collo.
    sk.shape(sym([[200, 96], [182, 98], [168, 110], [164, 126, 'c'], [200, 126]]), garment(sk, darken(g.c, 0.12)));
    sk.fold('M172 112 Q186 102 200 102 Q214 102 228 112', 3, 0.35);
  }
  const half = tank
    ? [[200, 128], [184, 112], [172, 118], [158, 150], [158, 200], [162, hem, 'c'], [200, hem + 2]]
    : [[200, neckDeep], [183, 112], [149, 125], [153, 175], [160, 240], [159, hem, 'c'], [200, hem + 2]];
  sk.shape(sym(half), g, '', true);
  const c = g.c;
  // Pieghe che partono dalle ascelle e verso la vita.
  sk.fold('M156 176 Q170 190 178 214 M244 176 Q230 190 222 214', 3, 0.26);
  sk.fold(`M172 ${hem - 40} Q176 ${hem - 20} 172 ${hem - 4} M228 ${hem - 40} Q224 ${hem - 20} 228 ${hem - 4}`, 2.6, 0.22);
  if (/camicia|camicetta/.test(t)) {
    // Colletto (con la sua ombra), abbottonatura e bottoni.
    sk.shadow('M200 130 L184 114 L178 128 L184 140 Z M200 130 L216 114 L222 128 L216 140 Z', 0.45);
    const col = garment(sk, lighten(c, 0.06));
    sk.shape(curve([[200, 126, 'c'], [183, 110, 'c'], [176, 122], [182, 134, 'c']]) + curve([[200, 126, 'c'], [217, 110, 'c'], [224, 122], [218, 134, 'c']]), col);
    sk.stroke(`M200 126 V${hem}`, c, 1);
    for (let y = 150; y < hem - 6; y += 30) sk.raw(`<circle cx="203" cy="${y}" r="1.8" fill="${line(c)}"/>`);
    if (!short) sk.stroke('M178 160 l8 0', c, 0.9);
  } else if (/polo/.test(t)) {
    const col = garment(sk, lighten(c, 0.06));
    sk.shape(curve([[200, 124, 'c'], [184, 110, 'c'], [178, 120], [184, 130, 'c']]) + curve([[200, 124, 'c'], [216, 110, 'c'], [222, 120], [216, 130, 'c']]), col);
    sk.stroke('M200 124 V158', c, 1);
    sk.raw(`<circle cx="202" cy="134" r="1.6" fill="${line(c)}"/><circle cx="202" cy="148" r="1.6" fill="${line(c)}"/>`);
  } else if (/cardigan/.test(t)) {
    sk.stroke(`M200 176 V${hem} M183 112 L200 176 L217 112`, c, 1.2);
    for (let y = 190; y < hem - 6; y += 24) sk.raw(`<circle cx="203" cy="${y}" r="2" fill="${line(c)}"/>`);
  } else if (!tank) {
    sk.stroke('M183 113 Q200 132 217 113', c, 2.2);
  }
  if (/felpa/.test(t)) {
    // Tasca a marsupio con l'ombra dell'apertura e cordini del cappuccio.
    sk.shadow('M176 252 L168 290 L172 290 L180 254 Z M224 252 L232 290 L228 290 L220 254 Z', 0.5);
    sk.stroke('M176 250 L224 250 L232 292 L168 292 Z', c, 1.1);
    sk.stroke('M193 124 q-2 14 0 30 M207 124 q2 14 0 30', lighten(c, 0.6), 1.8);
    sk.raw(`<g fill="${css(lighten(c, 0.7))}"><rect x="191" y="152" width="4" height="7" rx="1.5"/><rect x="205" y="152" width="4" height="7" rx="1.5"/></g>`);
  }
  if (/sportiva/.test(t)) {
    sk.stroke('M183 113 L156 128 M217 113 L244 128', c, 1.1);
    sk.stroke(`M156 176 L160 ${hem} M244 176 L240 ${hem}`, lighten(c, 0.55), 3);
  }
  if (/felpa|maglione|cardigan/.test(t) && !tucked) {
    sk.raw(`<path d="${sym([[200, hem - 10, 'c'], [160, hem - 10, 'c'], [159, hem, 'c'], [200, hem + 2]])}" fill="${css(darken(c, 0.08))}"/>`);
  }
  if (/maglione/.test(t)) {
    for (let x = 172; x <= 228; x += 14) sk.stroke(`M${x} 140 Q${x + 4} 200 ${x} ${hem - 12}`, c, 0.8, 'opacity=".7"');
  }
  if (tucked) sk.fold('M166 272 Q176 286 186 280 M234 272 Q224 286 214 280 M190 276 Q196 288 200 282', 2.6, 0.3);
  if (drawArms) drawArms();
  if (!tank) {
    const end = sleeve(sk, g, short ? 0.32 : 0.97, short ? 30 : 27);
    if (!short) cuff(sk, g, end, 26, /felpa|maglione|cardigan|sportiva/.test(t) ? 10 : 7);
    else sk.fold('M137 176 q8 3 18 0 M263 176 q-8 3 -18 0', 2.4, 0.3);
  }
}

function belt(sk, c) {
  sk.shadow('M158 290 H242 V296 H158 Z', 0.4);
  sk.raw(`<rect x="158" y="283" width="84" height="9" fill="${css(c)}"/><rect x="194" y="282" width="12" height="11" rx="1.5" fill="none" stroke="#c9a85a" stroke-width="2"/><rect x="158" y="283" width="84" height="2" fill="#fff" opacity=".15"/>`);
}

// Giacche e cappotti, aperti davanti per far vedere la maglia.
function outer(sk, kind, g, drawArms) {
  const t = String(kind).toLowerCase();
  const c = g.c;
  let hem = 312; let closed = false; let lapels = true; let quilt = false; let rib = false;
  if (/cappotto/.test(t)) hem = 430;
  if (/trench/.test(t)) hem = 440;
  if (/impermeabile/.test(t)) { hem = 372; closed = true; lapels = false; }
  if (/piumino/.test(t)) { hem = 300; closed = true; lapels = false; quilt = true; }
  if (/giubbotto/.test(t)) { hem = 298; closed = true; lapels = false; rib = true; }
  if (/jeans/.test(t)) { hem = 290; lapels = false; }
  const w = quilt ? 6 : 0;
  // Ombra che la giacca proietta sui pantaloni.
  sk.shadow(`M152 ${hem - 4} H248 V${hem + 8} H152 Z`, 0.45, 2);
  if (closed) {
    sk.shape(sym([[200, 110], [181, 106], [144 - w, 123], [148 - w, 180], [151 - w, 250], [150 - w, hem, 'c'], [200, hem + 2]]), g, '', true);
    // Colletto alto e cerniera.
    sk.shape(curve([[178, 102], [200, 96], [222, 102], [224, 120, 'c'], [176, 120, 'c']]), garment(sk, darken(c, 0.06)));
    sk.stroke(`M200 104 V${hem}`, c, 1.6);
  } else {
    const front = /blazer|cappotto/.test(t) ? [[199, 238, 'c'], [192, hem - 30], [186, hem, 'c']] : [[193, 238], [192, hem, 'c']];
    const half = [[183, 110], [143, 123], [147, 180], [150, 250], [149, hem, 'c'], ...front.slice().reverse().map((p, i) => (i === 0 ? [p[0], p[1], 'c'] : p)), [190, 150]];
    // Metà sinistra e destra della giacca, con lo spazio davanti per la maglia.
    const right = half.map(mx);
    sk.shape(curve(half), g, '', true);
    sk.shape(curve(right), g, '', true);
    // Ombra della giacca sulla maglia lungo l'apertura.
    sk.shadow('M190 150 L193 300 L198 300 L196 150 Z M210 150 L207 300 L202 300 L204 150 Z', 0.35);
    if (lapels) {
      sk.shadow(pair([[186, 112, 'c'], [200, 236, 'c'], [184, 170], [177, 146, 'c'], [185, 138, 'c'], [180, 128]]), 0.5);
      const lap = garment(sk, lighten(c, 0.07));
      sk.shape(pair([[184, 110, 'c'], [198, 232, 'c'], [180, 166], [173, 142, 'c'], [181, 134, 'c'], [176, 124]]), lap);
      sk.stroke('M184 110 L198 232 L180 166 L173 142 L181 134 M216 110 L202 232 L220 166 L227 142 L219 134', c, 0.9);
    }
    if (/blazer|cappotto/.test(t)) {
      sk.raw(`<circle cx="203" cy="246" r="2.6" fill="${line(c)}"/>`);
      // Pieghe a X che tirano dal bottone.
      sk.fold('M196 244 Q180 232 160 222 M204 244 Q220 232 240 222 M196 250 Q182 264 166 282 M204 250 Q218 264 234 282', 2.6, 0.28);
      if (/cappotto/.test(t)) sk.raw(`<circle cx="203" cy="290" r="2.6" fill="${line(c)}"/>`);
      sk.stroke('M160 270 h22 M240 270 h-22', c, 1.2);
      sk.stroke('M220 170 h14', c, 1.2);
      sk.raw(`<path d="M222 170 l4 -6 l4 6 z" fill="#f2eee6" opacity=".9"/>`);
    }
    if (/trench/.test(t)) {
      sk.raw(`<rect x="148" y="252" width="104" height="11" fill="${css(darken(c, 0.08))}"/><rect x="190" y="250" width="20" height="15" rx="2" fill="none" stroke="${line(c)}" stroke-width="1.6"/>`);
      for (const y of [200, 228, 286, 330]) sk.raw(`<circle cx="186" cy="${y}" r="2.4" fill="${line(c)}"/><circle cx="214" cy="${y}" r="2.4" fill="${line(c)}"/>`);
    }
    if (/jeans/.test(t)) {
      sk.stroke('M160 152 h24 v20 h-24 Z M240 152 h-24 v20 h24 Z M150 148 L190 148 M250 148 L210 148', c, 1.1, 'stroke-dasharray="3 2"');
      sk.stroke(`M168 180 V${hem - 4} M232 180 V${hem - 4}`, c, 1);
      sk.raw(`<rect x="150" y="${hem - 12}" width="42" height="12" fill="${css(darken(c, 0.1))}"/><rect x="208" y="${hem - 12}" width="42" height="12" fill="${css(darken(c, 0.1))}"/>`);
      sk.raw(`<g fill="#c9a85a"><circle cx="188" cy="170" r="2"/><circle cx="188" cy="210" r="2"/><circle cx="188" cy="250" r="2"/></g>`);
    }
  }
  if (quilt) for (let y = 150; y < hem; y += 32) sk.stroke(`M146 ${y} Q200 ${y + 6} 254 ${y}`, c, 1.2);
  if (quilt) for (const [y1, y2] of [[175, 185], [215, 225], [255, 265]]) sk.stroke(`M140 ${y1} L148 ${y2} M260 ${y1} L252 ${y2}`, c, 1);
  if (rib) {
    sk.raw(`<path d="${sym([[200, hem - 12, 'c'], [152, hem - 12, 'c'], [154, hem, 'c'], [200, hem]])}" fill="${css(darken(c, 0.1))}"/>`);
    sk.stroke('M160 210 L182 210 M240 210 L218 210', c, 1.2);
  }
  if (/impermeabile/.test(t)) {
    sk.stroke('M162 240 h24 v20 M238 240 h-24 v20', c, 1.2);
    sk.stroke('M183 104 Q200 84 217 104', c, 2);
  }
  if (closed) sk.fold('M200 106 V' + hem, 3, 0.25);
  if (drawArms) drawArms();
  const end = sleeve(sk, g, 0.95, quilt ? 34 : 31);
  if (rib || quilt) cuff(sk, g, end, 28, 9);
}

function dress(sk, kind, g, drawArms) {
  const t = String(kind).toLowerCase();
  const hem = /elegante/.test(t) ? 512 : 412;
  const flare = /elegante/.test(t) ? 144 : 138;
  sk.shape(sym([[200, 124], [183, 112], [150, 125], [155, 175], [163, 250], [158, 290], [flare, hem, 'c'], [200, hem + 4]]), g, '', true);
  sk.stroke('M163 250 Q200 258 237 250', g.c, 1.1);
  sk.fold(`M180 262 Q176 ${hem - 80} 168 ${hem - 4} M220 262 Q224 ${hem - 80} 232 ${hem - 4} M200 262 V${hem}`, 3.2, 0.3);
  sk.stroke('M183 113 Q200 134 217 113', g.c, 2);
  if (drawArms) drawArms();
  sleeve(sk, g, 0.3, 30);
}

function tie(sk, c) {
  const g = garment(sk, c);
  sk.shape(curve([[196, 126, 'c'], [204, 126, 'c'], [205, 135, 'c'], [207, 230, 'c'], [200, 240, 'c'], [193, 230, 'c'], [195, 135, 'c']]), g);
}

function scarf(sk, c) {
  const g = garment(sk, c);
  sk.shape(curve([[176, 112], [200, 124], [224, 112], [228, 124], [200, 140], [172, 124]]), g);
  sk.shape(curve([[206, 128, 'c'], [222, 126, 'c'], [220, 216, 'c'], [206, 218, 'c']]), g);
  sk.stroke('M207 210 h13', c, 1);
}

function hat(sk, c) {
  const g = garment(sk, c);
  sk.shape(curve([[170, 42, 'c'], [176, 18], [200, 10], [224, 18], [230, 42, 'c']]), g);
  sk.raw(`<ellipse cx="200" cy="42" rx="40" ry="6" fill="${css(darken(c, 0.1))}"/>`);
}

let uid = 0;

// Costruisce l'SVG dell'outfit: pieces sono i capi della proposta, occasion l'occasione scelta.
export function lookSvgMarkup(pieces, occasion) {
  const sk = new Sketch(`lk${uid++}`);
  const def = DEFAULTS[occasion] || DEFAULTS.tempo_libero;
  const get = (cat) => pieces.find((p) => p.category === cat);
  const pick = (cat) => {
    const p = get(cat);
    const d = def[cat];
    const c = colorOf(p?.colors?.[0]) || (d && colorOf(d[1]));
    return { kind: p?.subcategory || d?.[0] || '', c, pattern: p?.pattern, c2: colorOf(p?.colors?.[1]), real: !!p };
  };
  const dr = get('dress');
  const drKind = String(dr?.subcategory || '').toLowerCase();
  const drC = colorOf(dr?.colors?.[0]) || [40, 40, 50];
  let t = pick('top');
  let b = pick('bottom');
  let o = get('outerwear') ? pick('outerwear') : null;
  const s = pick('shoes');
  const acc = pieces.filter((p) => p.category === 'accessory');
  const accOf = (name) => acc.find((p) => String(p.subcategory || '').toLowerCase().includes(name));

  // Completo e tuta: giacca/maglia e pantaloni dello stesso colore.
  if (dr && /completo/.test(drKind)) {
    b = { ...b, kind: 'Pantaloni eleganti', c: drC, pattern: dr.pattern, real: true };
    o = { kind: 'Blazer', c: drC, pattern: dr.pattern };
    if (!t.real) t = { ...t, kind: 'Camicia elegante', c: colorOf('bianco') };
  } else if (dr && /tuta/.test(drKind)) {
    b = { kind: 'Pantaloni', c: drC, pattern: dr.pattern, real: true };
    t = { kind: 'Felpa', c: drC, pattern: dr.pattern, real: true };
  }
  const isDress = dr && !/completo|tuta/.test(drKind);
  const formalTop = /camicia|polo/.test(String(t.kind).toLowerCase());
  const tucked = formalTop && /eleganti|chino/.test(String(b.kind).toLowerCase()) && !isDress;

  // Posa: mani in tasca come nei manichini di riferimento, braccia lungo il corpo per sport, gonne e vestiti.
  const noPockets = isDress || /legging|gonna/.test(String(b.kind).toLowerCase()) || occasion === 'sport';
  ARM = noPockets ? ARMS.down : ARMS.pocket;

  backdrop(sk);
  const skin = body(sk);
  const drawArms = () => arms(sk, skin);
  if (isDress) {
    shoes(sk, s.kind, garment(sk, s.c, s.pattern, s.c2));
    dress(sk, drKind || 'vestito', garment(sk, drC, dr.pattern, colorOf(dr.colors?.[1])), drawArms);
  } else {
    bottoms(sk, b.kind, garment(sk, b.c, b.pattern, b.c2));
    shoes(sk, s.kind, garment(sk, s.c, s.pattern, s.c2));
    const bl = accOf('cintura');
    const beltC = (bl && colorOf(bl.colors?.[0])) || colorOf(lum(s.c) < 0.2 ? 'nero' : 'marrone');
    top(sk, t.kind, garment(sk, t.c, t.pattern, t.c2), tucked, () => { if (tucked) belt(sk, beltC); drawArms(); });
  }
  const ti = accOf('cravatta');
  if (ti && !isDress) tie(sk, colorOf(ti.colors?.[0]) || [110, 25, 40]);
  if (o) outer(sk, o.kind, garment(sk, o.c, o.pattern, o.c2));
  head(sk, skin);
  const sc = accOf('sciarpa');
  if (sc) scarf(sk, colorOf(sc.colors?.[0]) || [128, 128, 128]);
  const ha = accOf('cappello');
  if (ha) hat(sk, colorOf(ha.colors?.[0]) || [40, 40, 40]);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Anteprima dell'outfit sul manichino"><defs>${sk.defs.join('')}</defs>${sk.out.join('')}</svg>`;
}

export function lookSvg(pieces, occasion) {
  const wrap = document.createElement('div');
  wrap.innerHTML = lookSvgMarkup(pieces, occasion);
  return wrap.firstElementChild;
}

// ---------- manichino fotografico ----------
// Base e zone ricavate da un'immagine a colori pieni (tools/manichino/prepara.py): ogni zona
// (giacca, maglia, pantaloni, scarpe) prende il colore del capo proposto mantenendo pieghe e luci.
const PW = 640;
const PH = 960;
// Manichini disponibili (immagini di Luciano in colori pieni): l'app sceglie quello che somiglia
// di più ai capi proposti.
function choosePhoto(pieces, occasion) {
  const def = DEFAULTS[occasion] || DEFAULTS.tempo_libero;
  const sub = (cat) => String(pieces.find((p) => p.category === cat)?.subcategory || '').toLowerCase();
  const outer = sub('outerwear');
  const top = sub('top') || def.top[0].toLowerCase();
  const bottom = sub('bottom') || def.bottom[0].toLowerCase();
  const shoes = sub('shoes') || def.shoes[0].toLowerCase();
  // Varietà: tra due manichini adatti, proposte diverse ne usano di diversi.
  const seed = pieces.map((p) => p.id || p.subcategory || '').join('|');
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const pick = (list) => list[Math.abs(hash) % list.length];
  if (/blazer|cappotto|trench/.test(outer) || /completo/.test(sub('dress'))) {
    // Blazer su t-shirt/maglia o con i jeans: look smart casual.
    if (!/camicia/.test(top) || /jeans/.test(bottom)) return 'blazer-tshirt';
    if (/sneaker|corsa/.test(shoes)) return 'blazer-sneakers';
    if (occasion === 'lavoro') return pick(['blazer-lavoro', 'blazer']); // con la ventiquattrore
    if (occasion === 'serata' || occasion === 'evento') return pick(['blazer-pochette', 'blazer']);
    return 'blazer';
  }
  // In viaggio: giacca aperta, borsone e trolley.
  if (occasion === 'viaggio' && !/camicia/.test(top)) return 'viaggio';
  if (/sportiv|legging/.test(bottom) || /tuta/.test(sub('dress'))) return 'sport'; // felpa aperta e jogger
  if (outer) return 'casual'; // giubbotto aperto su maglietta
  if (/felpa/.test(top)) return pick(['felpa', 'felpa-zip']);
  if (/maglione|cardigan|maglia sportiva/.test(top)) return 'felpa';
  if (/camicia/.test(top)) return 'camicia-aperta';
  return 'casual';
}

const photos = {};
function loadPhoto(name) {
  if (!photos[name]) {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    const pixels = (img) => {
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, PW, PH);
      return ctx.getImageData(0, 0, PW, PH).data;
    };
    photos[name] = Promise.all([load(`img/manichino/${name}.jpg`), load(`img/manichino/${name}-zone.png`)])
      .then(([base, zone]) => ({ base: pixels(base), zone: pixels(zone) }))
      .catch((e) => { delete photos[name]; throw e; });
  }
  return photos[name];
}

// Colore per zona: 1 giacca, 2 maglia, 3 pantaloni, 4 scarpe.
function photoColors(pieces, occasion, base) {
  const def = DEFAULTS[occasion] || DEFAULTS.tempo_libero;
  const get = (cat) => colorOf(pieces.find((p) => p.category === cat)?.colors?.[0]);
  const dress = get('dress');
  const suit = /completo|tuta/i.test(pieces.find((p) => p.category === 'dress')?.subcategory || '');
  const top = get('top') || (suit ? null : dress) || colorOf(def.top[1]);
  const outer = get('outerwear') || (suit ? dress : null);
  // Felpa aperta, camicia aperta e jogger: senza giacca il capo aperto è la maglia proposta,
  // e sotto c'è una t-shirt bianca (blu scuro se la maglia è già chiara).
  const layered = !outer && ['felpa-zip', 'camicia-aperta', 'sport', 'viaggio'].includes(base);
  const tee = colorOf(lum(top) > 0.8 ? 'blu navy' : 'bianco');
  return {
    // Completo e tuta: giacca e pantaloni dello stesso colore. Altrimenti senza giacca proposta
    // sembra una camicia aperta del colore della maglia.
    1: outer || top,
    2: layered || (suit && !get('top')) ? tee : top,
    3: get('bottom') || dress || colorOf(def.bottom[1]),
    4: get('shoes') || colorOf(def.shoes[1]),
  };
}

function paintPhoto(canvas, { base, zone }, colors) {
  const out = new ImageData(new Uint8ClampedArray(base), PW, PH);
  const d = out.data;
  // I colori molto scuri partono un po' più chiari, se no pieghe e luci non si vedono.
  const tint = {};
  for (const z in colors) tint[z] = colors[z].map((v) => Math.max(v, 34));
  for (let i = 0; i < d.length; i += 4) {
    const z = Math.round(zone[i] / 60);
    const a = zone[i + 2] / 255;
    if (!z || !a) continue;
    const c = tint[z];
    const s = zone[i + 1] / 128; // 1 = colore pieno, meno = ombra, più = luce
    for (let k = 0; k < 3; k++) {
      const v = s <= 1 ? c[k] * s : c[k] + (255 - c[k]) * Math.min(1, (s - 1) * 0.8);
      d[i + k] = d[i + k] * (1 - a) + v * a;
    }
  }
  canvas.getContext('2d').putImageData(out, 0, 0);
}

// Anteprima: manichino fotografico ricolorato; se l'immagine non si carica resta il disegno SVG.
export function lookView(pieces, occasion) {
  const box = document.createElement('div');
  box.className = 'look-view';
  const canvas = document.createElement('canvas');
  canvas.width = PW; canvas.height = PH;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Anteprima dell\'outfit sul manichino');
  box.append(canvas);
  const base = choosePhoto(pieces, occasion);
  loadPhoto(base)
    .then((px) => paintPhoto(canvas, px, photoColors(pieces, occasion, base)))
    .catch(() => box.replaceChildren(lookSvg(pieces, occasion)));
  return box;
}
