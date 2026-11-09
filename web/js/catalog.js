// Vocabolario condiviso tra interfaccia e AI.

export const CATEGORIES = {
  top: 'Maglie e camicie',
  bottom: 'Pantaloni e gonne',
  dress: 'Abiti e tute',
  outerwear: 'Giacche e cappotti',
  shoes: 'Scarpe',
  accessory: 'Accessori',
};

export const SEASONS = {
  spring: 'Primavera',
  summer: 'Estate',
  autumn: 'Autunno',
  winter: 'Inverno',
};

export const STYLES = {
  casual: 'Casual',
  minimal: 'Minimal',
  smart_casual: 'Smart casual',
  formal: 'Elegante',
  sporty: 'Sportivo',
  streetwear: 'Streetwear',
  classic: 'Classico',
  boho: 'Boho',
  romantic: 'Romantico',
  edgy: 'Rock',
};

export const PATTERNS = {
  solid: 'Tinta unita',
  striped: 'Righe',
  checked: 'Quadri',
  floral: 'Fiori',
  dotted: 'Pois',
  printed: 'Stampa',
  other: 'Altro',
};

export const MOODS = {
  energico: 'Energico',
  rilassato: 'Rilassato',
  elegante: 'Elegante',
  creativo: 'Creativo',
  comodo: 'Comodo',
  sicuro: 'Sicuro di me',
};

export const OCCASIONS = {
  lavoro: 'Lavoro',
  tempo_libero: 'Tempo libero',
  serata: 'Serata',
  sport: 'Sport',
  evento: 'Evento',
  viaggio: 'Viaggio',
};

export const FORMALITY = {
  1: '1 · Molto casual',
  2: '2 · Casual',
  3: '3 · Smart casual',
  4: '4 · Elegante',
  5: '5 · Molto elegante',
};

export function describeItem(it) {
  const parts = [it.subcategory || CATEGORIES[it.category] || 'Capo'];
  if (it.colors?.length) parts.push(it.colors.join('/'));
  return parts.join(' ');
}

// Tipi di capo per categoria, con valori di partenza che l'utente può cambiare.
// warmth: 1 leggero, 2 medio, 3 caldo.
const ALL = ['spring', 'summer', 'autumn', 'winter'];
const MID = ['spring', 'autumn'];
const t = (name, formality, seasons, styles, warmth = 2) => ({ name, formality, seasons, styles, warmth });

export const SUBTYPES = {
  top: [
    t('T-shirt', 1, ['spring', 'summer', 'autumn'], ['casual', 'minimal'], 1),
    t('Polo', 2, ['spring', 'summer'], ['casual', 'smart_casual'], 1),
    t('Camicia', 3, ALL, ['smart_casual', 'classic'], 1),
    t('Camicia elegante', 4, ALL, ['formal', 'classic'], 1),
    t('Camicetta', 3, ALL, ['smart_casual', 'romantic'], 1),
    t('Top', 2, ['spring', 'summer'], ['casual', 'romantic'], 1),
    t('Felpa', 1, ['autumn', 'winter', 'spring'], ['casual', 'sporty', 'streetwear'], 2),
    t('Maglione', 2, ['autumn', 'winter'], ['casual', 'classic'], 3),
    t('Cardigan', 2, ['autumn', 'winter', 'spring'], ['casual', 'classic'], 2),
    t('Maglia sportiva', 1, ALL, ['sporty'], 1),
  ],
  bottom: [
    t('Jeans', 2, ALL, ['casual', 'streetwear'], 2),
    t('Chino', 3, ALL, ['smart_casual', 'classic'], 2),
    t('Pantaloni eleganti', 4, ALL, ['formal', 'classic'], 2),
    t('Pantaloni sportivi', 1, ALL, ['sporty'], 2),
    t('Bermuda', 1, ['summer'], ['casual'], 1),
    t('Gonna', 3, ['spring', 'summer', 'autumn'], ['romantic', 'smart_casual'], 1),
    t('Leggings', 1, ALL, ['sporty', 'casual'], 2),
  ],
  dress: [
    t('Vestito', 3, ['spring', 'summer'], ['romantic', 'smart_casual'], 1),
    t('Abito elegante', 5, ALL, ['formal'], 2),
    t('Completo', 5, ALL, ['formal', 'classic'], 2),
    t('Tuta', 2, ALL, ['casual', 'streetwear'], 2),
  ],
  outerwear: [
    t('Giubbotto', 2, MID, ['casual', 'streetwear'], 2),
    t('Giacca di jeans', 2, MID, ['casual'], 2),
    t('Blazer', 4, ALL, ['smart_casual', 'formal', 'classic'], 2),
    t('Trench', 3, MID, ['classic'], 2),
    t('Cappotto', 4, ['autumn', 'winter'], ['classic', 'formal'], 3),
    t('Piumino', 2, ['winter'], ['casual', 'sporty'], 3),
    t('Impermeabile', 2, MID, ['casual', 'sporty'], 2),
  ],
  shoes: [
    t('Sneakers', 2, ALL, ['casual', 'streetwear', 'minimal'], 2),
    t('Scarpe da corsa', 1, ALL, ['sporty'], 2),
    t('Mocassini', 3, ALL, ['smart_casual', 'classic'], 2),
    t('Scarpe eleganti', 5, ALL, ['formal', 'classic'], 2),
    t('Stivaletti', 3, ['autumn', 'winter'], ['classic', 'edgy'], 3),
    t('Sandali', 2, ['summer'], ['casual', 'boho'], 1),
    t('Décolleté', 5, ALL, ['formal', 'romantic'], 2),
  ],
  accessory: [
    t('Cintura', 3, ALL, ['classic'], 2),
    t('Borsa', 3, ALL, ['classic'], 2),
    t('Sciarpa', 2, ['autumn', 'winter'], ['casual', 'classic'], 3),
    t('Cappello', 2, ALL, ['casual'], 2),
    t('Cravatta', 5, ALL, ['formal'], 2),
  ],
};

export function findSubtype(category, name) {
  return (SUBTYPES[category] || []).find((s) => s.name.toLowerCase() === String(name || '').toLowerCase());
}

// Colori riconosciuti dalla foto (nome italiano → RGB di riferimento).
export const PALETTE = {
  nero: [25, 25, 28],
  grigio: [128, 128, 128],
  'grigio chiaro': [195, 195, 195],
  bianco: [242, 242, 238],
  beige: [215, 196, 160],
  marrone: [115, 75, 45],
  blu: [35, 65, 140],
  'blu navy': [28, 36, 66],
  azzurro: [120, 170, 220],
  denim: [70, 100, 140],
  verde: [50, 130, 70],
  'verde oliva': [100, 105, 55],
  rosso: [190, 35, 40],
  bordeaux: [110, 25, 40],
  rosa: [235, 160, 180],
  arancione: [235, 125, 40],
  giallo: [240, 205, 60],
  viola: [110, 60, 140],
};

// Colori che stanno bene con tutto.
export const NEUTRALS = new Set(['nero', 'grigio', 'grigio chiaro', 'bianco', 'beige', 'marrone', 'blu navy', 'denim']);
