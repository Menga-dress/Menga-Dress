// Rende l'app installabile e utilizzabile anche offline (le chiamate AI e meteo richiedono la rete).
const CACHE = 'dress-v21';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/colors.js',
  './js/stylist.js',
  './js/weather.js',
  './js/catalog.js',
  './js/look.js',
  './img/manichino/casual.jpg',
  './img/manichino/casual-zone.png',
  './img/manichino/blazer.jpg',
  './img/manichino/blazer-zone.png',
  './img/manichino/blazer-sneakers.jpg',
  './img/manichino/blazer-sneakers-zone.png',
  './img/manichino/felpa.jpg',
  './img/manichino/felpa-zone.png',
  './img/manichino/blazer-tshirt.jpg',
  './img/manichino/blazer-tshirt-zone.png',
  './icons/favicon-v3.png',
  './icons/icon-192-v3.png',
  './icons/icon-512-v3.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dress-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Prima la rete (così gli aggiornamenti arrivano subito), poi la copia salvata se offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: chiede sempre al server se il file è cambiato (GitHub Pages altrimenti
    // lascia usare per 10 minuti la copia vecchia del browser).
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) return res;
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
