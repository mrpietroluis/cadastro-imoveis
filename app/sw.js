// Service worker: deixa o app funcionando sem internet (vistoria em lugar sem sinal).
// Ao mudar qualquer arquivo, aumente VERSION para os aparelhos baixarem a versão nova.
const VERSION = 'v1.2.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/glm.js', 'js/ui.js', 'js/geometry.js',
  'js/tools/index.js', 'js/tools/rooms.js', 'js/tools/sketch.js', 'js/tools/photos.js', 'js/tools/export.js',
  'vendor/jspdf.umd.min.js', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (pega atualizações quando há sinal), cache quando offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
