import { createServer, build } from '../client/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
const configFile = fileURLToPath(new URL('./vite.config.mjs', import.meta.url));
if (process.argv.includes('--build')) {
  const { buildStandalone } = await import('./build-standalone.mjs');
  await buildStandalone();
  await build({ configFile });
  await copyFile(new URL('./generated/standalone-template.html', import.meta.url), new URL('./app-dist/standalone-template.html', import.meta.url));
}
else { const { buildStandalone } = await import('./build-standalone.mjs'); await buildStandalone(); const server = await createServer({ configFile }); await server.listen(); server.printUrls(); }
