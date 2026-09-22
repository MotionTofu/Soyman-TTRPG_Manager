import { createServer, build } from '../client/node_modules/vite/dist/node/index.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
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
if (process.argv.includes('--build')) {
  buildShared();
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
