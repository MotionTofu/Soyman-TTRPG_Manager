import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, buildCatalog } from './asset-library.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

export async function serveCatalog({ root = ROOT, port = 5188 } = {}) {
  await buildCatalog(root);
  const indexFile = path.join(root, 'assets/catalog/index.json');
  const catalog = JSON.parse(await readFile(indexFile, 'utf8'));
  // Expose only files explicitly listed by this catalog, never the whole repo.
  const allowlist = data => new Set(['assets/catalog/index.html', 'assets/catalog/index.json',
    ...data.assets.flatMap(asset => [asset.source, ...asset.outputs, ...asset.references.map(ref => ref.file)]),
  ]);
  let allowed = allowlist(catalog), revision = (await stat(indexFile)).mtimeMs;
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let file;
    try { file = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, ''); }
    catch { res.writeHead(400).end(); return; }
    try {
      const latest = (await stat(indexFile)).mtimeMs;
      if (latest !== revision) {
        allowed = allowlist(JSON.parse(await readFile(indexFile, 'utf8')));
        revision = latest;
      }
      if (!file) file = 'assets/catalog/index.html';
      if (!allowed.has(file)) { res.writeHead(404).end(); return; }
      const bytes = await readFile(path.join(root, file));
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveCatalog().then(server => {
    console.log(`Картотека ассетов: http://127.0.0.1:${server.address().port}/assets/catalog/index.html`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
