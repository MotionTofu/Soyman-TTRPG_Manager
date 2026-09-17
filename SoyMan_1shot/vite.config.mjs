import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '../client/node_modules/@vitejs/plugin-react/dist/index.js';
import { readFile } from 'node:fs/promises';
const root = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(root, '../client');
const transport = path.join(client, 'src/api/client.ts').replaceAll('\\', '/');
export default {
  root: path.join(root, 'app'),
  publicDir: path.join(client, 'public'),
  plugins: [{ name: 'oneshot-local-transport', enforce: 'pre', resolveId(source, importer) {
    if (!importer || !source.startsWith('.')) return;
    const resolved = path.resolve(path.dirname(importer.split('?')[0]), source).replaceAll('\\', '/');
    if (resolved === transport || resolved + '.ts' === transport) return path.join(root, 'app/transport.ts');
  }, configureServer(server) {
    server.middlewares.use('/standalone-template.html', async (_req, res) => {
      try { const html = await readFile(path.join(root, 'generated/standalone-template.html'), 'utf8'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
      catch (e) { res.statusCode = 500; res.end('Standalone build failed'); server.config.logger.error(String(e)); }
    });
    // Development only; private catalog is never copied to app-dist.
    server.middlewares.use('/__local/catalog', async (req, res) => {
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
      try { const data = await readFile(path.join(root, 'private/catalog.json')); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(data); }
      catch { res.statusCode = 404; res.end('Local catalog not prepared'); }
    });
  } }, react()],
  resolve: { alias: {
    '@shared': path.resolve(root, '../shared/src'),
    'react': path.join(client, 'node_modules/react'),
    'react-dom': path.join(client, 'node_modules/react-dom'),
    'react-router-dom': path.join(client, 'node_modules/react-router-dom'),
    '@tanstack/react-query': path.join(client, 'node_modules/@tanstack/react-query'),
  }, dedupe: ['react', 'react-dom', '@tanstack/react-query'] },
  server: { host: '127.0.0.1', port: 4318, strictPort: true, fs: { allow: [path.resolve(root, '..')] } },
  build: { outDir: path.join(root, 'app-dist'), emptyOutDir: true },
};
