const CACHE = 'tradeos-v7';
const ASSETS = [
  '/tradeos/',
  '/tradeos/index.html',
  '/tradeos/journal.html',
  '/tradeos/candies.html',
  '/tradeos/calculator.html',
  '/tradeos/tools.html',
  '/tradeos/scanner.html',
  '/tradeos/plays.html',
  '/tradeos/css/app.css',
  '/tradeos/js/api.js',
  '/tradeos/js/nav.js',
  '/tradeos/js/muninn-widget.js',
  '/tradeos/settings.html',
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
  // Never cache Worker API calls or external requests
  if (
    e.request.url.includes('workers.dev') ||
    e.request.url.includes('script.google.com') ||
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('finviz.com') ||
    e.request.url.includes('benzinga.com') ||
    e.request.method !== 'GET'
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});