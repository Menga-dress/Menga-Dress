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

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Posizione non disponibile'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => reject(new Error('Posizione non concessa')),
      { maximumAge: 3 * 3600 * 1000, timeout: 10000 },
    );
  });
}

export async function getWeather() {
  const { latitude, longitude } = await position();
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
    now, min, max, rain, sky,
    summary: `${sky}, ora ${now}°C, minima ${min}°C, massima ${max}°C, probabilità di pioggia ${rain}%`,
  };
}
