// Meteo del giorno da Open-Meteo (gratuito, senza chiave).

const CODES = [
  [[0], 'sereno'],
  [[1, 2], 'poco nuvoloso'],
  [[3], 'nuvoloso'],
  [[45, 48], 'nebbia'],
  [[51, 53, 55, 56, 57], 'pioviggine'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'pioggia'],
  [[71, 73, 75, 77, 85, 86], 'neve'],
  [[95, 96, 99], 'temporale'],
];

function describe(code) {
  const hit = CODES.find(([list]) => list.includes(code));
  return hit ? hit[1] : 'variabile';
}

// Città scritta a mano: serve quando il telefono non dà la posizione.
const CITY_KEY = 'menga-citta';
export function savedCity() {
  try { return JSON.parse(localStorage.getItem(CITY_KEY) || 'null'); } catch { return null; }
}
export function forgetCity() {
  try { localStorage.removeItem(CITY_KEY); } catch { /* niente */ }
}

// Cerca la città con il servizio gratuito di Open-Meteo (senza chiave) e la ricorda.
export async function setCity(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(name.trim())}&count=1&language=it&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ricerca non riuscita, riprova');
  const hit = (await res.json()).results?.[0];
  if (!hit) throw new Error(`Non trovo "${name.trim()}"`);
  const city = { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
  try { localStorage.setItem(CITY_KEY, JSON.stringify(city)); } catch { /* niente */ }
  return city;
}

function gps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Posizione non disponibile'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => reject(new Error('Posizione non concessa')),
      { maximumAge: 3 * 3600 * 1000, timeout: 10000 },
    );
  });
}

// Prima la città scelta da te (se c'è), altrimenti la posizione del telefono.
async function position() {
  const city = savedCity();
  if (city) return city;
  try {
    return await gps();
  } catch (e) {
    e.needCity = true;
    throw e;
  }
}

export async function getWeather() {
  const { latitude, longitude, name } = await position();
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}`
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + '&timezone=auto&forecast_days=1';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Meteo non disponibile');
  const d = await res.json();
  const now = Math.round(d.current.temperature_2m);
  const min = Math.round(d.daily.temperature_2m_min[0]);
  const max = Math.round(d.daily.temperature_2m_max[0]);
  const rain = d.daily.precipitation_probability_max?.[0] ?? 0;
  const sky = describe(d.daily.weather_code[0]);
  return {
    now, min, max, rain, sky, place: name || null,
    summary: `${sky}, ora ${now}°C, minima ${min}°C, massima ${max}°C, probabilità di pioggia ${rain}%`,
  };
}

// Previsioni dei prossimi giorni: [{ day: 'AAAA-MM-GG', min, max, rain, sky, summary }].
export async function getForecast(days = 7) {
  const { latitude, longitude } = await position();
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + `&timezone=auto&forecast_days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Meteo non disponibile');
  const d = (await res.json()).daily;
  return d.time.map((day, i) => {
    const min = Math.round(d.temperature_2m_min[i]);
    const max = Math.round(d.temperature_2m_max[i]);
    const rain = d.precipitation_probability_max?.[i] ?? 0;
    const sky = describe(d.weather_code[i]);
    return { day, min, max, rain, sky, now: Math.round((min + max) / 2), summary: `${sky}, minima ${min}°C, massima ${max}°C, probabilità di pioggia ${rain}%` };
  });
}
