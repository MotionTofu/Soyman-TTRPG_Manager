import { build } from '../client/node_modules/vite/dist/node/index.js';
import config from './vite.config.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function buildStandalone() {
  const transport = path.resolve(root, '../client/src/api/client.ts').replaceAll('\\', '/');
  const result = await build({ ...config, configFile: false, publicDir: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{ name: 'standalone-transport', enforce: 'pre', resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return;
      const resolved = path.resolve(path.dirname(importer.split('?')[0]), source).replaceAll('\\', '/');
      if (resolved === transport || resolved + '.ts' === transport) return path.join(root, 'app/standalone-transport.ts');
    } }],
    build: { write: false, minify: true, cssCodeSplit: false, lib: { entry: path.join(root, 'app/standalone.tsx'), name: 'OneShot', formats: ['iife'] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const script = output.filter(x => x.type === 'chunk').map(x => x.code).join('\n');
  let css = output.filter(x => x.type === 'asset' && x.fileName.endsWith('.css')).map(x => x.source).join('\n');
  for (const match of [...css.matchAll(/url\(["']?(\/[^)"']+)["']?\)/g)]) {
    const file = path.resolve(root, '../client/public', '.' + match[1]);
    const ext = path.extname(file); const mime = { '.ttf': 'font/ttf', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext];
    if (!mime) throw Error('Unknown standalone asset: ' + match[1]);
    const bytes = await readFile(file);
    css = css.replaceAll(match[0], `url("data:${mime};base64,${bytes.toString('base64')}")`);
  }
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>OneShot SoyMan</title><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div><script id="oneshot-payload" type="application/json">__ONESHOT_PAYLOAD__</script><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
  await mkdir(path.join(root, 'generated'), { recursive: true });
  await writeFile(path.join(root, 'generated/standalone-template.html'), html);
  return html;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildStandalone();
