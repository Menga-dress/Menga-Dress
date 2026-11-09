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
