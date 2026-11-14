// Anteprima visiva dell'outfit, istantanea e senza rete: un manichino disegnato in SVG con i capi
// proposti. Ogni capo ha la sua forma (camicia, felpa, blazer, jeans, sneakers...) e il colore del
// capo vero, quindi i contorni sono sempre netti. Se manca un capo si usa quello tipico dell'occasione.
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
  constructor(id) { this.id = id; this.defs = []; this.out = []; this.n = 0; }
  // Riempimento con un leggero volume (più chiaro a sinistra), senza ombre portate.
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
  shape(d, g, extra = '') { this.out.push(`<path d="${d}" fill="${g.fill}" ${extra}/>`); }
  // Cuciture, pieghe, bottoni: linee sottili, mai ombre.
  stroke(d, c, w = 1.3, extra = '') { this.out.push(`<path d="${d}" fill="none" stroke="${typeof c === 'string' ? c : line(c)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`); }
  raw(s) { this.out.push(s); }
}

const garment = (sk, c, pattern, c2) => ({ c, fill: sk.fill(c, pattern, c2) });

// Linea centrale del braccio sinistro (spalla → polso) e della mano.
const ARM = [[151, 132], [141, 200], [133, 292]];
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
const sleeve = (sk, g, to, width) => {
  const pts = armPath(0, to);
  const d = curve(pts, false);
  const dm = curve(pts.map(mx), false);
  sk.raw(`<path d="${d}${dm}" fill="none" stroke="${g.fill}" stroke-width="${width}" stroke-linecap="butt"/>`);
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
  sk.raw(`<circle cx="200" cy="250" r="168" fill="none" stroke="url(#${id}gold)" stroke-width="2.2" opacity=".85"/>`);
  sk.raw(`<rect x="0" y="520" width="${VW}" height="80" fill="#1d130b" opacity=".55"/>`);
  sk.raw(`<path d="M76 548 v14 a124 20 0 0 0 248 0 v-14" fill="url(#${id}ped)"/>`);
  sk.raw(`<ellipse cx="200" cy="548" rx="124" ry="20" fill="#2c1f14" stroke="url(#${id}gold)" stroke-width="2.4"/>`);
}

function body(sk) {
  const skin = garment(sk, SKIN);
  // Gambe e braccia nude: i capi le coprono dove serve.
  sk.shape(pair([[163, 296], [166, 410], [170, 516, 'c'], [191, 516, 'c'], [194, 410], [199, 322, 'c']]), skin);
  sleeve(sk, skin, 1, 22);
  sk.shape(pair([[123, 292], [121, 310], [127, 326], [136, 324], [141, 306], [139, 292, 'c']]), skin);
  sk.shape(curve([[189, 84], [188, 122, 'c'], [212, 122, 'c'], [211, 84]]), skin);
  sk.shape(sym([[200, 112], [176, 116], [150, 126], [156, 200], [161, 300, 'c'], [200, 304]]), skin);
  return skin;
}

function head(sk, skin) {
  sk.raw(`<ellipse cx="200" cy="58" rx="27" ry="34" fill="${skin.fill}"/>`);
  sk.stroke('M188 92 Q200 98 212 92', darken(SKIN, 0.12), 1);
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
    sk.shape(sym([[200, waist], [158, waist, 'c'], [154, 320], [143, 408, 'c'], [200, 412]]), g);
    sk.stroke('M158 290 H242', g.c, 1.1);
    sk.stroke('M176 300 L170 404 M224 300 L230 404', g.c, 1);
    return waist;
  }
  const leg = t.includes('bermuda')
    ? [[158, waist, 'c'], [154, 320], [152, hem, 'c'], [197, hem, 'c'], [199, 328, 'c'], [200, waist, 'c']]
    : [[158, waist, 'c'], [155, 320], [knee[0], 410], [ankle[0], hem, 'c'], [ankle[1], hem, 'c'], [knee[1], 410], [200, 330, 'c'], [200, waist, 'c']];
  sk.shape(pair(leg), g);
  sk.raw(`<rect x="158" y="${waist}" width="84" height="16" fill="${g.fill}"/>`);
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
    else sk.stroke('M163 530 Q172 524 178 527 M237 530 Q228 524 222 527', '#ffffff', 1.4, 'opacity=".55"');
  }
}

// Maglie e camicie. tucked = infilata nei pantaloni.
function top(sk, kind, g, tucked) {
  const t = String(kind).toLowerCase();
  const hem = tucked ? 292 : 304;
  const short = /t-shirt|polo|^top|maglia sportiva|camicetta/.test(t);
  const tank = t === 'top';
  const neckDeep = /cardigan/.test(t) ? 176 : 122;
  if (!tank) {
    const end = sleeve(sk, g, short ? 0.32 : 0.97, short ? 30 : 27);
    if (!short) cuff(sk, g, end, 26, /felpa|maglione|cardigan|sportiva/.test(t) ? 10 : 7);
  }
  if (/felpa/.test(t)) {
    // Cappuccio abbassato dietro il collo.
    sk.shape(sym([[200, 96], [182, 98], [168, 110], [164, 126, 'c'], [200, 126]]), garment(sk, darken(g.c, 0.12)));
  }
  const half = tank
    ? [[200, 128], [184, 112], [172, 118], [158, 150], [158, 200], [162, hem, 'c'], [200, hem + 2]]
    : [[200, neckDeep], [183, 112], [149, 125], [153, 175], [160, 240], [159, hem, 'c'], [200, hem + 2]];
  sk.shape(sym(half), g);
  const c = g.c;
  if (/camicia|camicetta/.test(t)) {
    // Colletto, abbottonatura e bottoni.
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
    sk.stroke('M176 250 L224 250 L232 292 L168 292 Z', c, 1.1);
    sk.stroke('M193 124 v26 M207 124 v26', lighten(c, 0.55), 1.4);
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
  sk.stroke('M151 128 Q156 150 154 172 M249 128 Q244 150 246 172', c, 0.8, 'opacity=".6"');
  if (tucked) sk.stroke('M168 280 Q178 288 186 282 M232 280 Q222 288 214 282', c, 0.9);
}

function belt(sk, c) {
  sk.raw(`<rect x="158" y="283" width="84" height="9" fill="${css(c)}"/><rect x="194" y="282" width="12" height="11" rx="1.5" fill="none" stroke="#c9a85a" stroke-width="2"/>`);
}

// Giacche e cappotti, aperti davanti per far vedere la maglia.
function outer(sk, kind, g) {
  const t = String(kind).toLowerCase();
  const c = g.c;
  let hem = 312; let closed = false; let lapels = true; let quilt = false; let rib = false;
  if (/cappotto/.test(t)) hem = 430;
  if (/trench/.test(t)) hem = 440;
  if (/impermeabile/.test(t)) { hem = 372; closed = true; lapels = false; }
  if (/piumino/.test(t)) { hem = 300; closed = true; lapels = false; quilt = true; }
  if (/giubbotto/.test(t)) { hem = 298; closed = true; lapels = false; rib = true; }
  if (/jeans/.test(t)) { hem = 290; lapels = false; }
  const end = sleeve(sk, g, 0.95, quilt ? 34 : 31);
  if (rib || quilt) cuff(sk, g, end, 28, 9);
  const w = quilt ? 6 : 0;
  if (closed) {
    sk.shape(sym([[200, 110], [181, 106], [144 - w, 123], [148 - w, 180], [151 - w, 250], [150 - w, hem, 'c'], [200, hem + 2]]), g);
    // Colletto alto e cerniera.
    sk.shape(curve([[178, 102], [200, 96], [222, 102], [224, 120, 'c'], [176, 120, 'c']]), garment(sk, darken(c, 0.06)));
    sk.stroke(`M200 104 V${hem}`, c, 1.6);
  } else {
    const front = /blazer|cappotto/.test(t) ? [[199, 238, 'c'], [192, hem - 30], [186, hem, 'c']] : [[193, 238], [192, hem, 'c']];
    const half = [[183, 110], [143, 123], [147, 180], [150, 250], [149, hem, 'c'], ...front.slice().reverse().map((p, i) => (i === 0 ? [p[0], p[1], 'c'] : p)), [190, 150]];
    // Metà sinistra e destra della giacca, con lo spazio davanti per la maglia.
    const right = half.map(mx);
    sk.shape(curve(half) + curve(right), g);
    if (lapels) {
      const lap = garment(sk, lighten(c, 0.07));
      sk.shape(pair([[184, 110, 'c'], [198, 232, 'c'], [180, 166], [173, 142, 'c'], [181, 134, 'c'], [176, 124]]), lap);
      sk.stroke('M184 110 L198 232 L180 166 L173 142 L181 134 M216 110 L202 232 L220 166 L227 142 L219 134', c, 0.9);
    }
    if (/blazer|cappotto/.test(t)) {
      sk.raw(`<circle cx="203" cy="246" r="2.6" fill="${line(c)}"/>`);
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
  sk.stroke('M146 128 Q152 150 150 176 M254 128 Q248 150 250 176', c, 0.9, 'opacity=".7"');
}

function dress(sk, kind, g) {
  const t = String(kind).toLowerCase();
  const hem = /elegante/.test(t) ? 512 : 412;
  const flare = /elegante/.test(t) ? 144 : 138;
  sleeve(sk, g, 0.3, 30);
  sk.shape(sym([[200, 124], [183, 112], [150, 125], [155, 175], [163, 250], [158, 290], [flare, hem, 'c'], [200, hem + 4]]), g);
  sk.stroke('M163 250 Q200 258 237 250', g.c, 1.1);
  sk.stroke(`M180 262 L170 ${hem - 4} M220 262 L230 ${hem - 4}`, g.c, 0.9, 'opacity=".7"');
  sk.stroke('M183 113 Q200 134 217 113', g.c, 2);
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

  backdrop(sk);
  const skin = body(sk);
  if (isDress) {
    shoes(sk, s.kind, garment(sk, s.c, s.pattern, s.c2));
    dress(sk, drKind || 'vestito', garment(sk, drC, dr.pattern, colorOf(dr.colors?.[1])));
  } else {
    bottoms(sk, b.kind, garment(sk, b.c, b.pattern, b.c2));
    shoes(sk, s.kind, garment(sk, s.c, s.pattern, s.c2));
    if (tucked) {
      top(sk, t.kind, garment(sk, t.c, t.pattern, t.c2), true);
      const bl = accOf('cintura');
      belt(sk, (bl && colorOf(bl.colors?.[0])) || colorOf(lum(s.c) < 0.2 ? 'nero' : 'marrone') || [90, 60, 40]);
    } else {
      top(sk, t.kind, garment(sk, t.c, t.pattern, t.c2), false);
    }
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
