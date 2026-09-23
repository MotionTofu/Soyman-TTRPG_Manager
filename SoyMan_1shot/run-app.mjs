import { createServer, build } from '../client/node_modules/vite/dist/node/index.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { syncUiAssets } from './sync-ui-assets.mjs';
const configFile = fileURLToPath(new URL('./vite.config.mjs', import.meta.url));
// The browser bundle and node tests resolve the shared portable contract
// from ../shared/dist. Rebuild it on every standard entry point (dev and
// production) so a stale dist can never surface as a missing export at
// runtime — e.g. "does not provide an export named 'PORTABLE_FORMAT'".
function buildShared() {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync('npm', ['--prefix', '../shared', 'run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw Error('Shared build failed — refusing to start with a stale ../shared/dist');
}
// Development: serve the managed catalog the same way production does.
// Rebuilt only when private/catalog.json is newer than the release; without
// a private catalog the dev site falls back to manual import, as before.
function buildDevCatalog() {
  const source = fileURLToPath(new URL('./private/catalog.json', import.meta.url));
  const manifest = fileURLToPath(new URL('./catalog/manifest.json', import.meta.url));
  if (!existsSync(source)) return;
  if (existsSync(manifest) && statSync(manifest).mtimeMs >= statSync(source).mtimeMs) return;
  const root = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, ['build-catalog-release.mjs', '--catalog', 'private/catalog.json', '--catalog-version', 'dev'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) console.warn('Dev catalog release failed; manual catalog import still works');
}
if (process.argv.includes('--build')) {
  buildShared();
  await syncUiAssets();
  const { buildStandalone } = await import('./build-standalone.mjs');
  await buildStandalone();
  await build({ configFile });
  await copyFile(new URL('./generated/standalone-template.html', import.meta.url), new URL('./app-dist/standalone-template.html', import.meta.url));
  const { buildPwa } = await import('./build-pwa.mjs');
  const pwa = await buildPwa();
  console.log(`PWA packaged: soyman-shell-${pwa.version}, ${pwa.files.length} precached files`);
}
else {
  buildShared();
  buildDevCatalog();
  await syncUiAssets();
  const { buildStandalone } = await import('./build-standalone.mjs');
  // Vite's production build sets NODE_ENV for this process. Restore it before
  // starting the development host, otherwise DEV and React Refresh disagree.
  const previousNodeEnv = process.env.NODE_ENV;
  try { await buildStandalone(); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
  const server = await createServer({ configFile }); await server.listen(); server.printUrls();
}
