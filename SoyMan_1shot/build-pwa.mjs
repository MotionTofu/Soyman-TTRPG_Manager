// PWA packaging for the production build (phase A2.1).
//
// Reads app-dist/, writes:
//   app-dist/manifest.webmanifest (from app/pwa source)
//   app-dist/icons/icon-192.png + icon-512.png (resized artwork, see below)
//   app-dist/sw.js (app/pwa/sw.js template + injected version + precache list)
//
// Icons reuse the existing client artwork (client/public/app-icon.png, 342px)
// resized with sharp — same artwork, no redesign. No maskable icon: the source
// has no guaranteed safe zone, so purpose stays "any" (recorded gap, A2.1).
// Precached: every vite output EXCEPT sw.js itself, the catalog release
// (catalog/**), legacy catalog.json, server-config.json and the standalone
// template (fetched online on explicit export click). The manifest and the
// generated icons are also excluded on purpose: they only matter for the
// online install flow, and keeping generated outputs out of the versioned set
// makes reruns byte-stable. Catalog/characters stay in IndexedDB only —
// never duplicated into Cache Storage.
//
// VERSION is a content hash over the precache set, so the SW (and its cache
// namespace soyman-shell-<version>) changes if and only if shell content does.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from '../server/node_modules/sharp/dist/index.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED = new Set(['sw.js', 'manifest.webmanifest', 'catalog.json', 'server-config.json', 'standalone-template.html']);

async function walk(dir, base = '') {
  const out = [];
  for (const name of await readdir(path.join(dir, base))) {
    const rel = base ? `${base}/${name}` : name;
    const st = await stat(path.join(dir, rel));
    if (st.isDirectory()) {
      // Own generated outputs (never precache): release dir + pwa icons.
      if (rel === 'catalog' || rel === 'icons') continue;
      out.push(...await walk(dir, rel));
    } else if (!EXCLUDED.has(name)) {
      out.push(rel);
    }
  }
  return out.sort();
}

export async function buildPwa(distDir = path.join(root, 'app-dist')) {
  const files = await walk(distDir);
  if (!files.includes('index.html')) throw Error('app-dist/index.html missing — run the vite build first');
  const fingerprints = [];
  for (const rel of files) {
    const bytes = await readFile(path.join(distDir, rel));
    fingerprints.push(`${rel}:${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`);
  }
  const version = createHash('sha256').update(fingerprints.join('\n')).digest('hex').slice(0, 16);

  await copyFile(path.join(root, 'app/pwa/manifest.webmanifest'), path.join(distDir, 'manifest.webmanifest'));

  const iconsDir = path.join(distDir, 'icons');
  await mkdir(iconsDir, { recursive: true });
  const source = path.join(root, '../client/public/app-icon.png');
  for (const size of [192, 512]) {
    await sharp(source).resize(size, size, { fit: 'cover' }).png().toFile(path.join(iconsDir, `icon-${size}.png`));
  }

  const template = await readFile(path.join(root, 'app/pwa/sw.js'), 'utf8');
  if (!template.includes('__SHELL_VERSION__') || !template.includes('__PRECACHE_JSON__')) {
    throw Error('SW template placeholders missing');
  }
  // replaceAll: the sentinel names also appear in comments above.
  const sw = template
    .replaceAll('__SHELL_VERSION__', () => version)
    .replaceAll('__PRECACHE_JSON__', () => JSON.stringify(files));
  await writeFile(path.join(distDir, 'sw.js'), sw);
  return { version, files, icons: ['icons/icon-192.png', 'icons/icon-512.png'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPwa();
  console.log(`PWA packaged: soyman-shell-${result.version}, ${result.files.length} precached files`);
}
