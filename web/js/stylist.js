// Stylist interno: compone gli outfit con regole di stile, senza AI esterne né costi.
import { NEUTRALS, findSubtype } from './catalog.js';

// Formalità ideale per occasione (1 molto casual … 5 molto elegante).
const OCCASION_FORMALITY = {
  lavoro: [3, 4], tempo_libero: [1, 3], serata: [3, 4], sport: [1, 1], evento: [4, 5], viaggio: [1, 2],
};

// Cosa cerca ogni umore: stili preferiti, colori vivaci o neutri, fantasie.
const MOOD_PREFS = {
  energico: { styles: ['sporty', 'streetwear', 'casual'], bright: 1, patterns: 0 },
  rilassato: { styles: ['casual', 'minimal'], bright: -0.5, patterns: 0 },
  elegante: { styles: ['formal', 'classic', 'smart_casual'], bright: -0.5, patterns: -0.5, formality: 1 },
  creativo: { styles: ['edgy', 'boho', 'streetwear', 'romantic'], bright: 1, patterns: 1 },
  comodo: { styles: ['casual', 'sporty'], bright: 0, patterns: 0, formality: -1 },
  sicuro: { styles: ['classic', 'smart_casual', 'minimal'], bright: 0, patterns: -0.5 },
};

const SEASON_LABEL = { spring: 'primavera', summer: 'estate', autumn: 'autunno', winter: 'inverno' };

function currentSeason(weather) {
  if (weather) {
    const avg = (weather.min + weather.max) / 2;
    if (avg < 9) return 'winter';
    if (avg > 22) return 'summer';
  }
  const m = new Date().getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

const warmthOf = (it) => findSubtype(it.category, it.subcategory)?.warmth ?? 2;
const isNeutral = (c) => NEUTRALS.has(c);
const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86400000 : Infinity);

function scoreItem(it, ctx) {
  let s = 0;
  const [lo, hi] = ctx.formality;
  const f = it.formality || 3;
  if (f < lo) s -= (lo - f) * 2.5;
  if (f > hi) s -= (f - hi) * 2.5;
  if (it.seasons?.length && !it.seasons.includes(ctx.season)) s -= 3;
  for (const st of it.styles || []) {
    if (ctx.mood.styles.includes(st)) s += 1;
    if (ctx.profileStyles.includes(st)) s += 0.7;
  }
  for (const c of it.colors || []) {
    if (ctx.avoid.some((a) => c.includes(a))) s -= 3;
    if (ctx.liked.some((a) => c.includes(a))) s += 0.8;
    if (!isNeutral(c)) s += 0.5 * ctx.mood.bright;
  }
  if (it.pattern && it.pattern !== 'solid') s += 0.6 * ctx.mood.patterns;
  // Capi indossati di recente: meglio lasciarli riposare.
  const d = daysSince(it.lastWorn);
  if (d < 2) s -= 3; else if (d < 5) s -= 1.2;
  // Capi mai messi: una piccola spinta per usarli.
  if (!it.timesWorn) s += 0.4;
  // Caldo e freddo.
  const w = warmthOf(it);
  if (ctx.weather) {
    if (ctx.weather.max >= 25 && w === 3) s -= 3;
    if (ctx.weather.max <= 10 && w === 1 && it.category !== 'top') s -= 1.5;
  }
  return s;
}

function harmony(pieces, ctx) {
  let s = 0;
  const colors = pieces.flatMap((p) => (p.colors || []).slice(0, 1));
  const bright = [...new Set(colors.filter((c) => !isNeutral(c)))];
  if (bright.length === 0) s += 1; // tutto neutro: sempre elegante
  else if (bright.length === 1) s += 2; // un solo colore protagonista
  else if (bright.length === 2) s += ctx.mood.bright > 0 ? 0.5 : -1;
  else s -= 3;
  const patterned = pieces.filter((p) => p.pattern && p.pattern !== 'solid').length;
  if (patterned > 1) s -= 2.5;
  // Formalità coerente tra i pezzi.
  const fs = pieces.map((p) => p.formality || 3);
  s -= (Math.max(...fs) - Math.min(...fs) > 2 ? 2 : 0);
  // Ricordi: abbinamenti già votati.
  const ids = new Set(pieces.map((p) => p.id));
  for (const o of ctx.history) {
    if (!o.rating) continue;
    const shared = o.itemIds.filter((id) => ids.has(id)).length;
    if (shared >= 2) s += o.rating === 'up' ? 1.5 : -3;
  }
  return s;
}

function explain(pieces, ctx, extras) {
  const parts = [];
  const occ = { lavoro: 'il lavoro', tempo_libero: 'il tempo libero', serata: 'la serata', sport: 'lo sport', evento: 'un evento', viaggio: 'il viaggio' }[ctx.occasion] || 'oggi';
  const [lo, hi] = ctx.formality;
  const fits = pieces.every((x) => (x.formality || 3) >= lo - 0.5 && (x.formality || 3) <= hi + 0.5);
  parts.push(fits ? `Livello di eleganza giusto per ${occ}` : `La scelta più adatta per ${occ} tra i tuoi capi`);
  const colors = pieces.flatMap((p) => (p.colors || []).slice(0, 1));
  const bright = [...new Set(colors.filter((c) => !isNeutral(c)))];
  if (!bright.length) parts.push('colori neutri che stanno bene insieme');
  else if (bright.length === 1) parts.push(`il ${bright[0]} come unico colore protagonista`);
  else parts.push(`un abbinamento vivace (${bright.join(' e ')})`);
  if (extras.outer) parts.push(`${extras.outer.subcategory?.toLowerCase() || 'giacca'} perché ${ctx.weather?.rain >= 50 ? 'è prevista pioggia' : 'fa fresco'}`);
  const mood = { energico: 'energico', rilassato: 'rilassato', elegante: 'elegante', creativo: 'creativo', comodo: 'in vena di comodità', sicuro: 'sicuro di te' }[ctx.moodKey] || 'bene';
  return `${parts.join(', ')}. Pensato per quando ti senti ${mood}.`;
}

function titleFor(pieces, ctx) {
  const main = pieces[0];
  const color = main.colors?.[0] || '';
  const names = { lavoro: 'Ufficio', tempo_libero: 'Tempo libero', serata: 'Sera', sport: 'Sport', evento: 'Evento', viaggio: 'Viaggio' };
  return `${names[ctx.occasion] || 'Look'} ${color ? 'in ' + color : ''}`.trim();
}

export function suggestOutfits({ items, profile, history, mood, occasion, weather, count = 3, seed = Math.random() }) {
  const by = (cat) => items.filter((i) => i.category === cat);
  const moodPrefs = MOOD_PREFS[mood] || MOOD_PREFS.rilassato;
  let formality = [...(OCCASION_FORMALITY[occasion] || [1, 3])];
  if (moodPrefs.formality) formality = formality.map((v) => Math.min(5, Math.max(1, v + moodPrefs.formality)));
  const ctx = {
    moodKey: mood, occasion, weather, history,
    mood: moodPrefs,
    formality,
    season: currentSeason(weather),
    profileStyles: profile?.styles || [],
    liked: (profile?.likedColors || '').toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    avoid: (profile?.avoidColors || '').toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
  };

  // Un pizzico di casualità così "Altre proposte" dà risultati diversi.
  let r = Math.floor(seed * 2 ** 31) || 1;
  const rand = () => { r = (r * 48271) % 2147483647; return r / 2147483647; };
  const ranked = (list) => list.map((it) => ({ it, s: scoreItem(it, ctx) + rand() * 1.5 }))
    .sort((a, b) => b.s - a.s).slice(0, 8);

  const tops = ranked(by('top'));
  const bottoms = ranked(by('bottom'));
  const dresses = ranked(by('dress'));
  const shoes = ranked(by('shoes'));
  const outers = ranked(by('outerwear'));
  const needOuter = weather ? (weather.max <= 17 || weather.rain >= 50) : ctx.season === 'winter';

  const bases = [];
  for (const t of tops) for (const b of bottoms) bases.push({ pieces: [t.it, b.it], s: t.s + b.s });
  for (const d of dresses) bases.push({ pieces: [d.it], s: d.s * 2 });

  const candidates = bases.map((base) => {
    const pieces = [...base.pieces];
    let s = base.s;
    const extras = {};
    if (needOuter && outers.length) {
      const o = outers.map((x) => ({ x, v: x.s + harmony([...pieces, x.it], ctx) })).sort((a, b) => b.v - a.v)[0];
      if (weather?.max <= 10 && warmthOf(o.x.it) < 3) s -= 1;
      pieces.push(o.x.it); s += o.x.s; extras.outer = o.x.it;
    }
    if (shoes.length) {
      const sh = shoes.map((x) => ({ x, v: x.s + harmony([...pieces, x.it], ctx) })).sort((a, b) => b.v - a.v)[0];
      pieces.push(sh.x.it); s += sh.x.s;
    }
    s += harmony(pieces, ctx) * 1.5;
    return { pieces, s, extras };
  }).sort((a, b) => b.s - a.s);

  // Scelgo outfit diversi tra loro: niente stessa parte sopra o sotto ripetuta.
  const chosen = [];
  const used = new Set();
  for (const c of candidates) {
    const key = c.pieces.filter((p) => ['top', 'bottom', 'dress'].includes(p.category)).map((p) => p.id);
    if (key.some((id) => used.has(id)) && candidates.length > count * 2) continue;
    chosen.push(c);
    key.forEach((id) => used.add(id));
    if (chosen.length === count) break;
  }
  if (chosen.length < count) {
    for (const c of candidates) {
      if (!chosen.includes(c)) chosen.push(c);
      if (chosen.length === count) break;
    }
  }

  return chosen.map((c) => {
    const missing = [];
    if (!shoes.length) missing.push('un paio di scarpe');
    if (needOuter && !outers.length) missing.push(weather?.rain >= 50 ? 'una giacca impermeabile' : 'una giacca');
    return {
      title: titleFor(c.pieces, ctx),
      item_ids: c.pieces.map((p) => p.id),
      reason: explain(c.pieces, ctx, c.extras),
      missing: missing.length ? `aggiungi all'armadio ${missing.join(' e ')}` : '',
    };
  });
}

export function canSuggest(items) {
  const has = (c) => items.some((i) => i.category === c);
  return (has('top') && has('bottom')) || has('dress');
}

export { SEASON_LABEL };
