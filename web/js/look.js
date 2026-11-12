// Anteprima visiva dell'outfit: un figurino disegnato sul telefono (sempre disponibile)
// e, se la rete lo permette, una foto generata gratis da Pollinations (nessuna chiave).
import { PALETTE } from './catalog.js';

const SKIN = '#d9b49a';
const rgb = (name) => {
  const c = PALETTE[String(name || '').toLowerCase().trim()];
  return c ? `rgb(${c.join(',')})` : '#9a948c';
};

const SHORT_SLEEVES = new Set(['T-shirt', 'Polo', 'Top', 'Maglia sportiva']);
const LONG_COATS = new Set(['Cappotto', 'Trench', 'Impermeabile']);

// Figurino SVG: le forme cambiano con il tipo di capo, i colori sono quelli dei capi.
export function lookSVG(pieces) {
  const get = (cat) => pieces.find((p) => p.category === cat);
  const top = get('top');
  const bottom = get('bottom');
  const dress = get('dress');
  const outer = get('outerwear');
  const shoes = get('shoes');
  const col = (p) => rgb(p?.colors?.[0]);
  const s = [];
  const line = 'stroke="rgba(0,0,0,.35)" stroke-width="1" stroke-linejoin="round"';

  // Pelle di base: testa, collo, braccia, gambe.
  s.push(`<circle cx="60" cy="20" r="12" fill="${SKIN}"/>`);
  s.push(`<rect x="55" y="30" width="10" height="10" fill="${SKIN}"/>`);
  s.push(`<path d="M30 44 L24 110 L31 111 L38 50 Z M90 44 L96 110 L89 111 L82 50 Z" fill="${SKIN}"/>`);
  s.push(`<path d="M42 110 L44 192 L57 192 L59 112 Z M78 110 L76 192 L63 192 L61 112 Z" fill="${SKIN}"/>`);

  const sleeves = (fill, short) => short
    ? `<path d="M36 42 L27 72 L36 75 L42 52 Z M84 42 L93 72 L84 75 L78 52 Z" fill="${fill}" ${line}/>`
    : `<path d="M36 42 L24 108 L32 110 L42 52 Z M84 42 L96 108 L88 110 L78 52 Z" fill="${fill}" ${line}/>`;

  if (dress) {
    const c = col(dress);
    if (dress.subcategory === 'Tuta' || dress.subcategory === 'Completo') {
      s.push(sleeves(c, false));
      s.push(`<path d="M36 42 L84 42 L80 112 L77 192 L62 192 L60 120 L58 192 L43 192 L40 112 Z" fill="${c}" ${line}/>`);
    } else {
      s.push(sleeves(c, dress.subcategory === 'Vestito'));
      s.push(`<path d="M38 42 L82 42 L78 100 L90 168 L30 168 L42 100 Z" fill="${c}" ${line}/>`);
    }
  } else {
    if (bottom) {
      const c = col(bottom);
      const n = bottom.subcategory;
      if (n === 'Gonna') s.push(`<path d="M40 104 L80 104 L88 160 L32 160 Z" fill="${c}" ${line}/>`);
      else if (n === 'Bermuda') s.push(`<path d="M40 104 L80 104 L80 148 L62 148 L60 122 L58 148 L40 148 Z" fill="${c}" ${line}/>`);
      else s.push(`<path d="M40 104 L80 104 L78 192 L62 192 L60 124 L58 192 L42 192 Z" fill="${c}" ${line}/>`);
    }
    if (top) {
      const c = col(top);
      s.push(sleeves(c, SHORT_SLEEVES.has(top.subcategory)));
      s.push(`<path d="M36 42 L84 42 L81 112 L39 112 Z" fill="${c}" ${line}/>`);
    }
  }

  if (outer) {
    const c = col(outer);
    const end = LONG_COATS.has(outer.subcategory) ? 160 : 122;
    s.push(sleeves(c, false));
    s.push(`<path d="M35 41 L54 41 L54 ${end} L37 ${end} Z M85 41 L66 41 L66 ${end} L83 ${end} Z" fill="${c}" ${line}/>`);
  }

  if (shoes) {
    const c = col(shoes);
    s.push(`<path d="M42 190 L58 190 L58 199 L36 199 Q36 192 42 190 Z M78 190 L62 190 L62 199 L84 199 Q84 192 78 190 Z" fill="${c}" ${line}/>`);
  }

  return `<svg viewBox="0 0 120 206" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Figurino dell'outfit">${s.join('')}</svg>`;
}

// Traduzioni per la descrizione inviata al generatore di immagini (funziona meglio in inglese).
const EN_TYPE = {
  'T-shirt': 't-shirt', Polo: 'polo shirt', Camicia: 'button-up shirt', 'Camicia elegante': 'dress shirt',
  Camicetta: 'blouse', Top: 'top', Felpa: 'sweatshirt', Maglione: 'sweater', Cardigan: 'cardigan',
  'Maglia sportiva': 'sports top', Jeans: 'jeans', Chino: 'chino trousers', 'Pantaloni eleganti': 'tailored trousers',
  'Pantaloni sportivi': 'track pants', Bermuda: 'bermuda shorts', Gonna: 'skirt', Leggings: 'leggings',
  Vestito: 'dress', 'Abito elegante': 'evening gown', Completo: 'two-piece suit', Tuta: 'jumpsuit',
  Giubbotto: 'casual jacket', 'Giacca di jeans': 'denim jacket', Blazer: 'blazer', Trench: 'trench coat',
  Cappotto: 'wool coat', Piumino: 'puffer jacket', Impermeabile: 'raincoat', Sneakers: 'sneakers',
  'Scarpe da corsa': 'running shoes', Mocassini: 'loafers', 'Scarpe eleganti': 'oxford shoes',
  Stivaletti: 'ankle boots', Sandali: 'sandals', Décolleté: 'pumps',
};
const EN_COLOR = {
  nero: 'black', grigio: 'grey', 'grigio chiaro': 'light grey', bianco: 'white', beige: 'beige', marrone: 'brown',
  blu: 'blue', 'blu navy': 'navy', azzurro: 'light blue', denim: 'denim blue', verde: 'green', 'verde oliva': 'olive',
  rosso: 'red', bordeaux: 'burgundy', rosa: 'pink', arancione: 'orange', giallo: 'yellow', viola: 'purple',
};
const EN_CAT = { top: 'top', bottom: 'trousers', dress: 'dress', outerwear: 'jacket', shoes: 'shoes' };

export function lookPhotoURL(pieces, gender, seed) {
  const who = gender === 'donna' ? 'a woman' : gender === 'uomo' ? 'a man' : 'a person';
  const parts = pieces.filter((p) => p.category !== 'accessory').map((p) => {
    const c = String(p.colors?.[0] || '').toLowerCase().trim();
    return `${EN_COLOR[c] || c} ${EN_TYPE[p.subcategory] || EN_CAT[p.category] || ''}`.trim();
  });
  const prompt = `Full body fashion photo of ${who} wearing ${parts.join(', ')}. Plain light studio background, natural light, realistic, face not visible`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=384&height=576&nologo=true&seed=${seed}`;
}
