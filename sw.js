const CACHE = 'tradeos-v1';
const ASSETS = [
  '/tradeos/',
  '/tradeos/index.html',
  '/tradeos/journal.html',
  '/tradeos/candies.html',
  '/tradeos/calculator.html',
  '/tradeos/playbook.html',
  '/tradeos/notes.html',
  '/tradeos/css/app.css',
  '/tradeos/js/api.js',
  '/tradeos/js/nav.js',
  '/tradeos/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
