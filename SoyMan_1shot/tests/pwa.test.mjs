import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPwa } from '../build-pwa.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(path.join(root, p), 'utf8');

// --- build integration on a fixture dist ---

async function fixtureDist() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pwa-'));
  await writeFile(path.join(dir, 'index.html'), '<html></html>');
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'assets', 'app-abc.js'), 'js');
  await writeFile(path.join(dir, 'standalone-template.html'), 'big');
  await writeFile(path.join(dir, 'catalog.json'), 'legacy');
  await mkdir(path.join(dir, 'catalog'), { recursive: true });
  await writeFile(path.join(dir, 'catalog', 'x.core.json'), 'no-precache');
  return dir;
}

test('buildPwa writes versioned sw, manifest and icons, excludes non-shell files', async () => {
  const dir = await fixtureDist();
  const first = await buildPwa(dir);
  assert.match(first.version, /^[0-9a-f]{16}$/);
  assert.ok(first.files.includes('index.html'));
  assert.ok(first.files.includes('assets/app-abc.js'));
  assert.ok(!first.files.some(f => f.includes('catalog')));
  assert.ok(!first.files.includes('standalone-template.html'));
  assert.ok(!first.files.includes('sw.js'));
  // manifest + generated icons exist on disk but stay out of the versioned set
  assert.ok(!first.files.includes('manifest.webmanifest'));
  assert.ok(!first.files.some(f => f.startsWith('icons/')));
  const sw = await readFile(path.join(dir, 'sw.js'), 'utf8');
  assert.ok(sw.includes(`const VERSION = '${first.version}'`));
  assert.ok(sw.includes(`'soyman-shell-' + VERSION`));
  assert.ok(!sw.includes('__SHELL_VERSION__') && !sw.includes('__PRECACHE_JSON__'));
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  const icon192 = await readFile(path.join(dir, 'icons', 'icon-192.png'));
  assert.deepEqual([icon192[16], icon192[17], icon192[18], icon192[19]], [0, 0, 0, 192]);
  // determinism: same input, same output
  const second = await buildPwa(dir);
  assert.equal(first.version, second.version);
});

// --- SW logic in a fake worker scope ---

function loadSw(version = 'testv1', precache = ['index.html', 'assets/app.js', 'manifest.webmanifest']) {
  const template = readText('../app/pwa/sw.js');
  const code = template.replaceAll('__SHELL_VERSION__', () => version).replaceAll('__PRECACHE_JSON__', () => JSON.stringify(precache));
  const stores = new Map();
  const state = { claimed: false, fetched: [], responded: [] };
  const fakeCache = (name) => ({
    addAll: async (urls) => { for (const u of urls) stores.get(name).set(String(u), new Response(`cached:${u}`, { status: 200 })); },
    match: async (url) => stores.get(name).get(String(url)) ?? null,
    put: async (url, res) => { stores.get(name).set(String(url), res); },
  });
  const sandbox = {
    console,
    URL, Request, Response, TextEncoder,
    fetch: async (req) => {
      const url = String(typeof req === 'string' ? req : req.url);
      state.fetched.push(url);
      if (sandbox.offline) throw Error('offline');
      return new Response(`live:${url}`, { status: 200 });
    },
    caches: {
      open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); return fakeCache(name); },
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    offline: false,
    self: null,
  };
  const listeners = {};
  sandbox.self = {
    registration: { scope: 'http://x/' },
    location: { origin: 'http://x' },
    clients: { claim: async () => { state.claimed = true; } },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'sw.js' });
  const fire = async (type, event) => {
    let promise;
    await listeners[type][0]({ ...event, waitUntil: (p) => { promise = p; }, respondWith: (p) => { promise = p; state.responded.push(true); } });
    if (promise === undefined) state.responded.push(false);
    return promise;
  };
  return { sandbox, state, stores, fire };
}

const req = (url, mode = undefined, method = 'GET') => ({ url, method, mode });

test('sw install caches the shell; activate drops only old shell caches', async () => {
  const { state, stores, fire } = loadSw();
  await fire('install', {});
  assert.ok(stores.get('soyman-shell-testv1').has('http://x/index.html'));
  assert.ok(stores.get('soyman-shell-testv1').has('http://x/assets/app.js'));
  stores.set('soyman-shell-old', new Map([['a', 1]]));
  stores.set('foreign-cache', new Map([['b', 2]]));
  await fire('activate', {});
  assert.ok(!stores.has('soyman-shell-old'));
  assert.ok(stores.has('foreign-cache'));
  assert.equal(state.claimed, true);
});

test('sw navigation: online refreshes, offline falls back to cached shell', async () => {
  const { fire } = loadSw();
  await fire('install', {});
  const online = await fire('fetch', { request: req('http://x/?character=12', 'navigate') });
  assert.equal(await online.text(), 'live:http://x/?character=12');
  const { sandbox, fire: fire2 } = loadSw();
  sandbox.offline = true;
  await fire2('install', {});
  const offline = await fire2('fetch', { request: req('http://x/?character=12', 'navigate') });
  assert.equal(await offline.text(), 'cached:http://x/index.html');
});

test('sw assets cache-first; catalog, legacy files and writes pass through', async () => {
  const { state, fire } = loadSw();
  await fire('install', {});
  state.responded.length = 0;
  const hit = await fire('fetch', { request: req('http://x/assets/app.js') });
  assert.equal(await hit.text(), 'cached:http://x/assets/app.js');
  assert.ok(!state.fetched.includes('http://x/assets/app.js'));
  state.responded.length = 0;
  await fire('fetch', { request: req('http://x/catalog/dnd55-ru-2026.09.core.json') });
  await fire('fetch', { request: req('http://x/catalog/manifest.json') });
  await fire('fetch', { request: req('http://x/catalog.json') });
  await fire('fetch', { request: req('http://x/server-config.json') });
  await fire('fetch', { request: req('http://x/standalone-template.html') });
  await fire('fetch', { request: req('http://x/', undefined, 'POST') });
  await fire('fetch', { request: req('https://cdn.example/x.js') });
  assert.deepEqual(state.responded, [false, false, false, false, false, false, false]);
  assert.deepEqual(state.fetched, []);
});

// --- source-level contracts ---

test('index.html links the manifest; registration is guarded and silent', async () => {
  const index = readText('../app/index.html');
  assert.ok(index.includes('rel="manifest"'));
  assert.ok(index.includes('viewport-fit=cover'));
  const main = readText('../app/main.tsx');
  assert.ok(main.includes(`navigator.serviceWorker.register('./sw.js'`));
  assert.ok(main.includes('!import.meta.env.DEV'));
  assert.ok(main.includes("console.warn('SW registration failed:'"));
});

test('manifest source has installability fields and noir theme colors', async () => {
  const manifest = JSON.parse(readText('../app/pwa/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512'));
  assert.equal(manifest.background_color, '#e8e4da');
  assert.equal(manifest.theme_color, '#1c1c1c');
});
