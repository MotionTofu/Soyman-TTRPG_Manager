// SoyMan_1shot production Service Worker (template).
//
// The build (build-pwa.mjs) injects the content-derived VERSION and the
// precache URL list into the two sentinel constants below.
// Same-origin scope-relative URLs keep subpath deployments working.
//
// Strategy:
// - navigation (incl. query strings like ?character=12): network-first,
//   cached index.html fallback. Online users always get the fresh shell;
//   offline they get the last successfully cached one.
// - precached shell files + immutable /assets/*: cache-first, network fills
//   gaps on first online run.
// - everything else same-origin (catalog release, legacy catalog.json,
//   server-config.json, standalone-template.html): passthrough, never cached.
//   Catalog/characters live in IndexedDB — no second truth in Cache Storage.
// - no automatic skipWaiting: a new SW waits until the player explicitly
//   applies the update from the banner (SKIP_WAITING message below) and never
//   reloads a player mid-session. activate() only drops old soyman-shell-*
//   caches and claims clients (no reload) so already-open tabs go
//   offline-capable.
const VERSION = '__SHELL_VERSION__';
const CACHE = 'soyman-shell-' + VERSION;
const PRECACHE = JSON.parse('__PRECACHE_JSON__');
const PRECACHE_SET = new Set(PRECACHE);
const INDEX = 'index.html';

function scopeUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scopeUrl))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('soyman-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isShellAsset(relative) {
  return PRECACHE_SET.has(relative) || relative.startsWith('assets/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  const relative = url.pathname.slice(scopePath.length);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(scopeUrl(INDEX), copy));
        }
        return response;
      }).catch(() => caches.open(CACHE).then((cache) => cache.match(scopeUrl(INDEX)))),
    );
    return;
  }

  if (isShellAsset(relative)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(request.url).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            cache.put(request.url, copy);
          }
          return response;
        });
      })),
    );
  }
  // Passthrough: catalog release, legacy files, templates — never cached.
});

// Explicit user gesture only: the update banner posts SKIP_WAITING after
// pending character writes have flushed. Never skipWaiting automatically on
// install — that would reload a player mid-session.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
