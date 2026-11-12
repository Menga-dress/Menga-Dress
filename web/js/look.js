// Anteprima visiva dell'outfit: una foto generata gratis da Pollinations (nessuna chiave),
// con i capi indossati da un manichino da negozio.

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
  const who = gender === 'donna' ? 'female' : gender === 'uomo' ? 'male' : 'unisex';
  const parts = pieces.filter((p) => p.category !== 'accessory').map((p) => {
    const c = String(p.colors?.[0] || '').toLowerCase().trim();
    return `${EN_COLOR[c] || c} ${EN_TYPE[p.subcategory] || EN_CAT[p.category] || ''}`.trim();
  });
  const prompt = `E-commerce catalog photo of a headless white ${who} store mannequin, full body, front view, `
    + `dressed in: ${parts.join(', ')}. Exact colors: ${parts.join('; ')}. `
    + 'Plain light grey seamless studio background, soft even lighting, sharp focus, no people, no face, no text';
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=704&nologo=true&model=flux&seed=${seed}`;
}
