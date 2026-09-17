const scopePath = new URL(self.registration.scope).pathname;
const cacheName = 'oneshot-v1-' + scopePath;
const assets = [scopePath, scopePath + 'manifest.webmanifest', '/sheet.html', '/style.css', '/state.js', '/app.js', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !assets.includes(url.pathname)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
