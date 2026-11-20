// Stylist interno: compone gli outfit con regole di stile, senza AI esterne né costi.
import { NEUTRALS, SUBTYPES, findSubtype } from './catalog.js';

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

// Dress code: eleganza fissa e capi ammessi. "only" = solo questi tipi per categoria, "no" = tipi vietati.
// I capi con un nome libero (non tra i tipi dell'app) passano se la loro formalità è vicina.
export const DRESS_CODES = {
  libero: { label: 'Libero', icon: '✨', text: 'Nessuna regola: decide l\'occasione.' },
  casual: {
    label: 'Casual', icon: '👕', formality: [1, 2], check: 'comodo, senza capi da cerimonia',
    text: 'Jeans, t-shirt, felpa e sneakers. Niente capi da cerimonia.',
    no: ['Camicia elegante', 'Pantaloni eleganti', 'Abito elegante', 'Completo', 'Scarpe eleganti', 'Décolleté', 'Blazer'],
  },
  smart: {
    label: 'Smart casual', icon: '👞', formality: [2, 4], check: 'curato ma non formale',
    text: 'Chino o jeans scuri, camicia o polo, mocassini o sneakers pulite. Niente felpe, tute o abbigliamento sportivo.',
    no: ['Felpa', 'Maglia sportiva', 'Pantaloni sportivi', 'Leggings', 'Bermuda', 'Cargo', 'Scarpe da corsa', 'Tuta', 'Completo', 'Abito elegante', 'Sandali'],
  },
  business: {
    label: 'Business', icon: '👔', formality: [4, 5], jacket: true, check: 'giacca presente, niente jeans né sneakers',
    text: 'Giacca e camicia, pantalone elegante, scarpe in pelle. Niente jeans, felpe o sneakers.',
    only: {
      top: ['Camicia', 'Camicia elegante', 'Camicetta', 'Maglione', 'Cardigan'],
      bottom: ['Pantaloni eleganti', 'Chino', 'Gonna'],
      dress: ['Completo', 'Abito elegante', 'Vestito'],
      outerwear: ['Blazer', 'Cappotto', 'Trench'],
      shoes: ['Scarpe eleganti', 'Mocassini', 'Décolleté', 'Stivaletti'],
    },
  },
  elegante: {
    label: 'Elegante', icon: '🎩', formality: [4, 5], jacket: true, check: 'abito e scarpe eleganti',
    text: 'Abito o completo, camicia elegante e scarpe eleganti. Per cerimonie, matrimoni e serate importanti.',
    only: {
      top: ['Camicia elegante', 'Camicetta'],
      bottom: ['Pantaloni eleganti', 'Gonna'],
      dress: ['Completo', 'Abito elegante'],
      outerwear: ['Blazer', 'Cappotto'],
      shoes: ['Scarpe eleganti', 'Décolleté'],
    },
  },
  sportivo: {
    label: 'Sportivo', icon: '🏃', formality: [1, 2], check: 'tutto comodo e tecnico',
    text: 'Abbigliamento tecnico e scarpe da corsa: per palestra, corsa o partita.',
    only: {
      top: ['Maglia sportiva', 'T-shirt', 'Felpa'],
      bottom: ['Pantaloni sportivi', 'Leggings', 'Bermuda'],
      dress: ['Tuta'],
      outerwear: ['Piumino', 'Impermeabile', 'Giubbotto'],
      shoes: ['Scarpe da corsa', 'Sneakers'],
    },
  },
};

// Il capo va bene per il dress code?
export function fitsDressCode(it, code) {
  const dc = DRESS_CODES[code];
  if (!dc || !dc.formality) return true;
  const sub = findSubtype(it.category, it.subcategory);
  if (!sub) {
    const f = it.formality || 3;
    return f >= dc.formality[0] - 1 && f <= dc.formality[1] + 1;
  }
  if (dc.only?.[it.category]) return dc.only[it.category].includes(sub.name);
  return !(dc.no || []).includes(sub.name);
}

// Legge un invito o un messaggio e indovina il dress code (e l'occasione). Tutto sul telefono.
const INVITE_RULES = [
  [/black tie|white tie|cravatta nera|smoking|frac|gala|abito lungo|cerimoni|matrimoni|nozze|sposi|battesim|comunion|cresim|laurea/, 'elegante', 'evento'],
  [/cocktail|formale|formal\b|elegant/, 'elegante', 'serata'],
  [/business casual|smart casual|smart|aperitiv|cena|ristorante|teatro|elegante informale/, 'smart', 'serata'],
  [/business|giacca e cravatta|colloquio|riunione|meeting|conferenza|ufficio|cliente|presentazione|lavoro/, 'business', 'lavoro'],
  [/sport|palestra|gym|corsa|running|calcetto|partita|trekking|escursion|bici/, 'sportivo', 'sport'],
  [/casual|informale|grigliata|barbecue|picnic|spiaggia|mare|festa|compleanno|amici|gita/, 'casual', 'tempo_libero'],
];
export function readInvite(text) {
  const all = String(text || '').toLowerCase();
  // Se l'invito scrive "dress code: …", conta prima quello che segue.
  const dcAt = all.search(/dress ?code|abbigliamento/);
  if (dcAt >= 0) {
    const r = readInviteText(all.slice(dcAt).slice(0, 60));
    if (r) {
      const occ = readInviteText(all.slice(0, dcAt));
      return occ ? { ...r, occasion: occ.occasion } : r;
    }
  }
  return readInviteText(all);
}

function readInviteText(t) {
  for (const [re, code, occasion] of INVITE_RULES) {
    const m = t.match(re);
    if (m) {
      // La parola intera, per dire cosa ho letto ("aperitivo", non "aperitiv").
      let end = m.index + m[0].length;
      while (end < t.length && /\p{L}/u.test(t[end])) end++;
      return { code, occasion, word: t.slice(m.index, end) };
    }
  }
  return null;
}

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

// Capi "idea": quando nell'armadio manca qualcosa, lo stylist propone un capo da aggiungere.
const IDEA_COLORS = {
  top: ['bianco', 'azzurro', 'blu navy', 'grigio chiaro', 'nero', 'verde oliva', 'bordeaux', 'rosa'],
  bottom: ['blu navy', 'beige', 'grigio', 'nero'],
  dress: ['nero', 'blu navy', 'verde oliva', 'bordeaux'],
  outerwear: ['blu navy', 'beige', 'nero', 'grigio'],
  shoes: ['bianco', 'marrone', 'nero'],
};
const IDEA_COLOR_BY_TYPE = {
  Jeans: ['denim', 'nero'], 'Giacca di jeans': ['denim'], Trench: ['beige'], Piumino: ['nero', 'blu navy'],
  'Scarpe da corsa': ['grigio', 'nero'], Sneakers: ['bianco'], Stivaletti: ['marrone', 'nero'],
  Mocassini: ['marrone', 'nero'], 'Scarpe eleganti': ['nero', 'marrone'], Sandali: ['marrone'], Décolleté: ['nero', 'beige'], Leggings: ['nero'], 'Pantaloni sportivi': ['nero', 'grigio'],
  'Maglia sportiva': ['nero', 'blu'], 'Abito elegante': ['nero', 'blu navy'], Completo: ['blu navy', 'grigio'],
};
const WOMEN_ONLY = new Set(['Camicetta', 'Top', 'Gonna', 'Leggings', 'Vestito', 'Abito elegante', 'Décolleté']);

function ideaItems(gender) {
  const out = [];
  for (const cat of Object.keys(IDEA_COLORS)) {
    for (const sub of SUBTYPES[cat]) {
      if (gender !== 'donna' && WOMEN_ONLY.has(sub.name)) continue;
      if (cat === 'dress' && sub.name === 'Tuta') continue;
      for (const c of IDEA_COLOR_BY_TYPE[sub.name] || IDEA_COLORS[cat]) {
        out.push({
          id: `idea:${cat}:${sub.name}:${c}`, idea: true, category: cat, subcategory: sub.name,
          colors: [c], formality: sub.formality, seasons: sub.seasons, styles: sub.styles, pattern: 'solid',
          timesWorn: 1,
        });
      }
    }
  }
  return out;
}

// Nome dell'idea in italiano corretto: "camicia bianca", "pantaloni neri".
const FEM = new Set(['Camicia', 'Camicia elegante', 'Camicetta', 'Felpa', 'Maglia sportiva', 'Gonna', 'Tuta', 'Giacca di jeans', 'T-shirt', 'Polo']);
const PLURAL_M = new Set(['Jeans', 'Chino', 'Pantaloni eleganti', 'Pantaloni sportivi', 'Bermuda', 'Leggings', 'Mocassini', 'Stivaletti', 'Sandali']);
const PLURAL_F = new Set(['Scarpe da corsa', 'Scarpe eleganti', 'Sneakers', 'Décolleté']);
export function ideaName(it) {
  const n = it.subcategory;
  const g = FEM.has(n) ? 'a' : PLURAL_M.has(n) ? 'i' : PLURAL_F.has(n) ? 'e' : 'o';
  const words = (it.colors?.[0] || '').split(' ').map((w, i) => {
    if (i > 0) return w;
    if (w === 'bianco') return { o: 'bianco', a: 'bianca', i: 'bianchi', e: 'bianche' }[g];
    if (w === 'grigio') return { o: 'grigio', a: 'grigia', i: 'grigi', e: 'grigie' }[g];
    if (/^(nero|rosso|giallo|azzurro)$/.test(w)) return w.slice(0, -1) + g;
    if (/^(marrone|verde|arancione)$/.test(w) && (g === 'i' || g === 'e')) return w.slice(0, -1) + 'i';
    return w;
  });
  return `${n.toLowerCase()} ${words.join(' ')}`.trim();
}

const RAIN_COATS = new Set(['Trench', 'Impermeabile', 'Piumino', 'Cappotto']);

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
    if (ctx.weather.rain >= 50 && it.category === 'outerwear') s += RAIN_COATS.has(it.subcategory) ? 2 : -1.5;
    if (ctx.weather.rain >= 50 && it.subcategory === 'Sandali') s -= 3;
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
  if (ctx.code) {
    parts.push(`Adatto al dress code ${DRESS_CODES[ctx.code].label.toLowerCase()}`);
    return explainRest(pieces, ctx, extras, parts);
  }
  const occ = { lavoro: 'il lavoro', tempo_libero: 'il tempo libero', serata: 'la serata', sport: 'lo sport', evento: 'un evento', viaggio: 'il viaggio' }[ctx.occasion] || 'oggi';
  const [lo, hi] = ctx.formality;
  const fits = pieces.every((x) => (x.formality || 3) >= lo - 0.5 && (x.formality || 3) <= hi + 0.5);
  const allIdeas = pieces.every((x) => x.idea);
  parts.push(fits || allIdeas ? `Livello di eleganza giusto per ${occ}` : `La scelta più adatta per ${occ} tra i tuoi capi`);
  return explainRest(pieces, ctx, extras, parts);
}

function explainRest(pieces, ctx, extras, parts) {
  const colors = pieces.flatMap((p) => (p.colors || []).slice(0, 1));
  const bright = [...new Set(colors.filter((c) => !isNeutral(c)))];
  if (!bright.length) parts.push('colori neutri che stanno bene insieme');
  else if (bright.length === 1) parts.push(`${/^[aeiou]/.test(bright[0]) ? "l'" : 'il '}${bright[0]} come unico colore protagonista`);
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

// fresh: un outfit con UN capo che non hai (tipo e colore nuovi per te), abbinato ai tuoi capi.
export function suggestOutfits({ items, profile, history, mood, occasion, weather, dressCode = 'libero', count = 3, seed = Math.random(), fresh = false }) {
  const dc = DRESS_CODES[dressCode]?.formality ? DRESS_CODES[dressCode] : null;
  const ok = (it) => !dc || fitsDressCode(it, dressCode);
  // Ai tuoi capi si aggiungono le idee: se in una categoria hai già qualcosa, l'idea
  // parte svantaggiata e vince solo se i tuoi capi non vanno proprio bene.
  // Con un dress code restano solo i capi ammessi (tuoi e idee).
  const ideas = ideaItems(profile?.gender).filter(ok);
  const owned = (cat) => items.filter((i) => i.category === cat && ok(i));
  const by = (cat) => [...owned(cat), ...ideas.filter((i) => i.category === cat)];
  const have = new Set(items.map((i) => `${i.subcategory}|${i.colors?.[0] || ''}`));
  const ideaPenalty = (it) => {
    if (!it.idea) return 0;
    if (fresh) return have.has(`${it.subcategory}|${it.colors[0]}`) ? 99 : 0; // uguale a un tuo capo: non è una novità
    return owned(it.category).length ? 6 : 0;
  };
  const moodPrefs = MOOD_PREFS[mood] || MOOD_PREFS.rilassato;
  let formality = [...(OCCASION_FORMALITY[occasion] || [1, 3])];
  if (moodPrefs.formality) formality = formality.map((v) => Math.min(5, Math.max(1, v + moodPrefs.formality)));
  if (dc) formality = [...dc.formality]; // il dress code vince sull'occasione e sull'umore
  const ctx = {
    moodKey: mood, occasion, weather, history, code: dc ? dressCode : null,
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
  const ranked = (list) => list.map((it) => ({ it, s: scoreItem(it, ctx) - ideaPenalty(it) + rand() * 1.5 }))
    .sort((a, b) => b.s - a.s)
    // Poche idee per categoria, così restano varie.
    .filter((x, i, arr) => !x.it.idea || arr.slice(0, i).filter((y) => y.it.idea).length < 4)
    .slice(0, 8);

  const tops = ranked(by('top'));
  const bottoms = ranked(by('bottom'));
  const dresses = ranked(by('dress'));
  const shoes = ranked(by('shoes'));
  const outers = ranked(by('outerwear'));
  const coldOrRain = weather ? (weather.max <= 17 || weather.rain >= 50) : ctx.season === 'winter';

  const bases = [];
  for (const t of tops) for (const b of bottoms) bases.push({ pieces: [t.it, b.it], s: t.s + b.s });
  for (const d of dresses) bases.push({ pieces: [d.it], s: d.s * 2 });
  // Anche tutto da comprare va bene, ma il tuo armadio ha la precedenza.
  for (const b of bases) if (b.pieces.every((p) => p.idea) && items.length) b.s -= 4;

  const candidates = bases.map((base) => {
    const pieces = [...base.pieces];
    let s = base.s;
    const extras = {};
    // Business ed Elegante vogliono la giacca, a meno che la base sia già un completo o un abito.
    const needOuter = coldOrRain || (dc?.jacket && !pieces.some((p) => p.category === 'dress'));
    if (needOuter && outers.length) {
      const o = outers.map((x) => ({ x, v: x.s + harmony([...pieces, x.it], ctx) })).sort((a, b) => b.v - a.v)[0];
      if (weather?.max <= 10 && warmthOf(o.x.it) < 3) s -= 1;
      pieces.push(o.x.it); s += o.x.s; if (coldOrRain) extras.outer = o.x.it;
    }
    if (shoes.length) {
      const sh = shoes.map((x) => ({ x, v: x.s + harmony([...pieces, x.it], ctx) })).sort((a, b) => b.v - a.v)[0];
      pieces.push(sh.x.it); s += sh.x.s;
    }
    s += harmony(pieces, ctx) * 1.5;
    return { pieces, s, extras };
  }).filter((c) => !fresh || (c.pieces.filter((p) => p.idea).length === 1 && c.pieces.some((p) => !p.idea)))
    .sort((a, b) => b.s - a.s);

  // Scelgo outfit diversi tra loro: niente stessa parte sopra o sotto ripetuta.
  const chosen = [];
  const used = new Set();
  for (const c of candidates) {
    const key = c.pieces.filter((p) => ['top', 'bottom', 'dress'].includes(p.category)).map((p) => p.id);
    const sig = c.pieces.map((p) => p.id).join('|');
    if (chosen.some((x) => x.pieces.map((p) => p.id).join('|') === sig)) continue;
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

  return chosen.map((c) => ({
    fresh,
    title: fresh ? `Con ${articleFor(c.pieces.find((p) => p.idea))}` : titleFor(c.pieces, ctx),
    item_ids: c.pieces.map((p) => p.id),
    pieces: c.pieces,
    reason: fresh ? `Un capo che non hai ancora e che sta bene con ${c.pieces.filter((p) => !p.idea).map((p) => p.subcategory?.toLowerCase()).join(', ')} del tuo armadio. ${explain(c.pieces, ctx, c.extras)}` : explain(c.pieces, ctx, c.extras),
    ideas: c.pieces.filter((p) => p.idea),
    dressCode: dc ? { key: dressCode, label: dc.label, icon: dc.icon, check: dc.check } : null,
  }));
}

// "un blazer beige", "una camicia bianca", "dei jeans neri".
function articleFor(it) {
  const n = ideaName(it);
  const sub = it.subcategory;
  if (PLURAL_M.has(sub)) return `dei ${n}`;
  if (PLURAL_F.has(sub)) return `delle ${n}`;
  if (FEM.has(sub)) return `una ${n}`;
  return /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x)/i.test(n) ? `uno ${n}` : `un ${n}`;
}

export { SEASON_LABEL };
