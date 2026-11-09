// Chiamate a Claude direttamente dal telefono, con la chiave salvata nelle impostazioni.
import { getKV } from './db.js';
import { CATEGORIES, SEASONS, STYLES, PATTERNS, MOODS, OCCASIONS } from './catalog.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export async function getSettings() {
  return (await getKV('settings')) || {};
}

export async function hasKey() {
  const s = await getSettings();
  return Boolean(s.apiKey);
}

async function callClaude({ system, content, schema, maxTokens = 4000 }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('Manca la chiave API: aggiungila nelle impostazioni (icona in alto a destra).');
  }
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema },
        },
        messages: [{ role: 'user', content }],
      }),
    });
  } catch {
    throw new Error('Connessione non riuscita. Controlla di essere online e riprova.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('La chiave API non è valida. Controllala nelle impostazioni.');
    if (res.status === 429) throw new Error('Troppe richieste in poco tempo. Riprova tra un minuto.');
    if (res.status === 400 && /credit/i.test(msg)) throw new Error('Credito esaurito sull\'account Anthropic.');
    throw new Error(`Errore dell'AI (${res.status}): ${msg}`);
  }
  if (data.stop_reason === 'refusal') throw new Error('L\'AI non ha potuto rispondere a questa richiesta.');
  if (data.stop_reason === 'max_tokens') throw new Error('Risposta troppo lunga, riprova.');

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Risposta dell\'AI non leggibile, riprova.');
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---- Riconoscimento di un capo da foto ----

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_clothing', 'category', 'subcategory', 'colors', 'pattern', 'material', 'seasons', 'formality', 'styles', 'description'],
  properties: {
    is_clothing: { type: 'boolean', description: 'false se la foto non mostra un capo o un accessorio' },
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    subcategory: { type: 'string', description: 'Nome breve in italiano, es. "Camicia oxford", "Jeans slim", "Sneakers"' },
    colors: { type: 'array', items: { type: 'string' }, description: 'Da 1 a 3 colori in italiano, il principale per primo' },
    pattern: { type: 'string', enum: Object.keys(PATTERNS) },
    material: { type: 'string', description: 'Materiale probabile in italiano, es. "cotone", "lana", "denim"' },
    seasons: { type: 'array', items: { type: 'string', enum: Object.keys(SEASONS) } },
    formality: { type: 'integer', description: 'Da 1 (molto casual) a 5 (molto elegante)' },
    styles: { type: 'array', items: { type: 'string', enum: Object.keys(STYLES) }, description: 'Da 1 a 3 stili' },
    description: { type: 'string', description: 'Una frase in italiano che descrive il capo' },
  },
};

export async function analyzeItem(imageBlob) {
  const b64 = await blobToBase64(imageBlob);
  const out = await callClaude({
    system: 'Sei un consulente di stile. Analizzi foto di capi di abbigliamento per catalogare un armadio personale. Rispondi in italiano.',
    schema: ITEM_SCHEMA,
    maxTokens: 2000,
    content: [
      { type: 'image', source: { type: 'base64', media_type: imageBlob.type || 'image/jpeg', data: b64 } },
      { type: 'text', text: 'Cataloga il capo principale in questa foto.' },
    ],
  });
  out.formality = Math.min(5, Math.max(1, Math.round(Number(out.formality) || 3)));
  return out;
}

// ---- Outfit del giorno ----

const OUTFIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outfits'],
  properties: {
    outfits: {
      type: 'array',
      description: 'Esattamente 3 proposte diverse tra loro',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'item_ids', 'reason', 'missing'],
        properties: {
          title: { type: 'string', description: 'Nome breve dell\'outfit' },
          item_ids: { type: 'array', items: { type: 'string' }, description: 'Id dei capi presi SOLO dall\'elenco' },
          reason: { type: 'string', description: 'Due frasi: perché funziona con umore, occasione e meteo' },
          missing: { type: 'string', description: 'Un capo che completerebbe l\'outfit e che manca nell\'armadio, oppure stringa vuota' },
        },
      },
    },
  },
};

function itemLine(it) {
  const f = [
    `id=${it.id}`,
    CATEGORIES[it.category] || it.category,
    it.subcategory,
    it.colors?.length ? `colori: ${it.colors.join(', ')}` : '',
    it.pattern ? `fantasia: ${PATTERNS[it.pattern] || it.pattern}` : '',
    it.material ? `materiale: ${it.material}` : '',
    it.seasons?.length ? `stagioni: ${it.seasons.map((s) => SEASONS[s] || s).join(', ')}` : '',
    `formalità: ${it.formality || 3}/5`,
    it.styles?.length ? `stili: ${it.styles.map((s) => STYLES[s] || s).join(', ')}` : '',
    it.lastWorn ? `ultimo uso: ${it.lastWorn.slice(0, 10)}` : 'mai indossato',
  ];
  return '- ' + f.filter(Boolean).join(' | ');
}

function profileText(p) {
  if (!p) return 'Nessun profilo compilato.';
  const lines = [];
  if (p.gender) lines.push(`Si veste prevalentemente da: ${p.gender}`);
  if (p.styles?.length) lines.push(`Stili preferiti: ${p.styles.map((s) => STYLES[s] || s).join(', ')}`);
  if (p.likedColors) lines.push(`Colori che ama: ${p.likedColors}`);
  if (p.avoidColors) lines.push(`Colori da evitare: ${p.avoidColors}`);
  if (p.notes) lines.push(`Note: ${p.notes}`);
  return lines.join('\n') || 'Nessuna preferenza indicata.';
}

function feedbackText(history, itemsById) {
  const rated = history.filter((o) => o.rating).slice(0, 15);
  if (!rated.length) return 'Ancora nessun voto.';
  return rated.map((o) => {
    const names = o.itemIds.map((id) => itemsById[id]).filter(Boolean)
      .map((it) => `${it.subcategory || CATEGORIES[it.category]} ${it.colors?.[0] || ''}`.trim());
    return `- ${o.rating === 'up' ? 'PIACIUTO' : 'NON PIACIUTO'}: ${names.join(' + ')} (${MOODS[o.mood] || o.mood}, ${OCCASIONS[o.occasion] || o.occasion})`;
  }).join('\n');
}

export async function suggestOutfits({ items, profile, history, mood, occasion, weather, extra }) {
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const text = [
    `Oggi è ${today}.`,
    `Umore: ${MOODS[mood] || mood}. Occasione: ${OCCASIONS[occasion] || occasion}.`,
    `Meteo: ${weather ? weather.summary : 'non disponibile'}.`,
    extra ? `Richiesta in più: ${extra}` : '',
    '',
    'PROFILO',
    profileText(profile),
    '',
    'VOTI SUGLI OUTFIT PASSATI',
    feedbackText(history, itemsById),
    '',
    'ARMADIO',
    items.map(itemLine).join('\n'),
    '',
    'Proponi 3 outfit completi e diversi tra loro usando solo i capi dell\'armadio (indica gli id esatti). Ogni outfit deve avere parte sopra e sotto oppure un abito, scarpe se disponibili, e uno strato in più se fa freddo. Preferisci i capi non indossati di recente.',
  ].filter((l) => l !== null).join('\n');

  const out = await callClaude({
    system: 'Sei uno stylist personale attento e concreto. Abbini capi dell\'armadio dell\'utente tenendo conto di umore, occasione, meteo e gusti. Rispondi in italiano.',
    schema: OUTFIT_SCHEMA,
    maxTokens: 4000,
    content: [{ type: 'text', text }],
  });

  return (out.outfits || []).map((o) => ({
    ...o,
    item_ids: (o.item_ids || []).filter((id) => itemsById[id]),
  })).filter((o) => o.item_ids.length >= 2);
}
