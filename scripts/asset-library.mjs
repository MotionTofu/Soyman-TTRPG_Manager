import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = /\.(webp|png|jpe?g|gif|svg|avif|ico|woff2?|ttf|otf|mp3|wav|ogg)$/i;
const TEXT = /\.(tsx?|jsx?|mjs|cjs|css|html|json)$/i;
const FONT = /\.(woff2?|ttf|otf)$/i;
const OUTPUT_ROOTS = ['client/public', 'client/src/assets', 'build'];
const ARCHIVES = ['SoyMan_1shot/assets/fantasy-punk'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const slash = value => value.split(path.sep).join('/');

export const CATEGORY_LABELS = {
  branding: 'Логотипы и бренд', cards: 'Карточки', conditions: 'Состояния', schools: 'Школы магии',
  coins: 'Монеты', inventory: 'Предметы', tokens: 'Жетоны', textures: 'Текстуры', mascot: 'Маскоты',
  cartography: 'Картография', crypt: 'Склеп', cursors: 'Курсоры', fonts: 'Шрифты', icons: 'Иконки',
  'ui/fantasy-punk': 'Fantasy Punk', 'ui/wizard': 'Визард', 'ui/sheet': 'Лист персонажа',
  'ui/oneshot': 'OneShot', 'ui/campaign-dossier': 'Досье кампании', other: 'Прочее',
  'ui/plot-restyle': 'Сюжет',
};

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':')
      || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error(`Unsafe asset path: ${value}`);
  }
  return value;
}

async function safeFile(root, relative) {
  safeRelative(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw Error(`Symlink is not an asset source or destination: ${relative}`);
  }
  return current;
}

async function walk(root, relative) {
  const folder = await safeFile(root, relative);
  const entries = await readdir(folder, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw Error(`Symlink in asset inventory: ${file}`);
    if (entry.isDirectory()) found.push(...await walk(root, file));
    else if (entry.isFile()) found.push(file);
  }
  return found;
}

function isRuntimeFile(file) {
  if (file.startsWith('build/')) return file === 'build/icon.png';
  return MEDIA.test(file) || (file.startsWith('client/public/fonts/') && /\.(txt|css)$/i.test(file));
}

async function runtimeFiles(root) {
  return (await Promise.all(OUTPUT_ROOTS.map(folder => walk(root, folder)))).flat().filter(isRuntimeFile).sort();
}

function categoryOf(file) {
  if (file.startsWith('build/') || /\/assets\/logos\//.test(file) || /\/(app-icon|logo)\.png$/.test(file)) return 'branding';
  if (file.includes('/assets/cards/')) return 'cards';
  const relative = file.replace(/^client\/public\//, '');
  const category = relative.startsWith('ui/') ? relative.split('/').slice(0, 2).join('/') : relative.split('/')[0];
  return CATEGORY_LABELS[category] ? category : (file.endsWith('/icons.svg') ? 'icons' : 'other');
}

function kindOf(file) {
  if (FONT.test(file)) return 'font';
  if (/\.css$/i.test(file)) return 'stylesheet';
  if (/\.txt$/i.test(file)) return 'license';
  if (/\.(mp3|wav|ogg)$/i.test(file)) return 'audio';
  return 'image';
}

function sourceOf(file) {
  if (file.startsWith('client/public/')) return `assets/library/${file.slice('client/public/'.length)}`;
  if (file.startsWith('client/src/assets/')) return `assets/library/bundled/${file.slice('client/src/assets/'.length)}`;
  return `assets/library/desktop/${file.slice('build/'.length)}`;
}

export async function loadManifest(root = ROOT) {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw Error('Invalid asset manifest');
  const ids = new Set(), sources = new Set(), outputs = new Set();
  for (const asset of manifest.assets) {
    if (typeof asset.id !== 'string' || !asset.id || ids.has(asset.id)) throw Error(`Duplicate or missing asset id: ${asset.id}`);
    ids.add(asset.id);
    safeRelative(asset.source);
    if (!asset.source.startsWith('assets/library/') || sources.has(asset.source)) throw Error(`Invalid or duplicate source: ${asset.source}`);
    sources.add(asset.source);
    if (!CATEGORY_LABELS[asset.category] || !asset.title || !/^[a-f0-9]{64}$/.test(asset.baselineSha256)
        || !Array.isArray(asset.outputs) || !asset.outputs.length) throw Error(`Invalid asset metadata: ${asset.id}`);
    for (const output of asset.outputs) {
      safeRelative(output);
      if (!OUTPUT_ROOTS.some(folder => output.startsWith(`${folder}/`)) || !isRuntimeFile(output)
          || outputs.has(output)) throw Error(`Invalid or duplicate output: ${output}`);
      outputs.add(output);
    }
  }
  return manifest;
}

// Explicit adoption is the only operation that imports edits from runtime copies.
// Normal builds always copy in the other direction, from the central library.
export async function adoptAssets(root = ROOT, onlyFile = null) {
  const manifest = await loadManifest(root).catch(error => {
    if (error.code === 'ENOENT') return { version: 1, assets: [] };
    throw error;
  });
  const files = onlyFile ? [safeRelative(onlyFile)] : await runtimeFiles(root);
  const byHash = new Map();
  for (const asset of manifest.assets) byHash.set(hash(await readFile(await safeFile(root, asset.source))), asset);
  const imported = [];
  for (const file of files) {
    if (!isRuntimeFile(file) || !OUTPUT_ROOTS.some(folder => file.startsWith(`${folder}/`))) throw Error(`Not a runtime asset: ${file}`);
    const existing = manifest.assets.find(asset => asset.outputs.includes(file));
    if (existing && !onlyFile) continue;
    const bytes = await readFile(await safeFile(root, file));
    const digest = hash(bytes);
    if (existing) {
      // A shared source cannot be replaced through just one of its mirrors.
      if (existing.outputs.length > 1 && hash(await readFile(await safeFile(root, existing.source))) !== digest) {
        throw Error(`Shared asset ${existing.id}: edit ${existing.source} to update all ${existing.outputs.length} copies`);
      }
      await writeFile(await safeFile(root, existing.source), bytes);
      existing.baselineSha256 = digest;
      imported.push(file);
      continue;
    }
    const same = byHash.get(digest);
    if (same) same.outputs.push(file);
    else {
      const source = sourceOf(file);
      const destination = await safeFile(root, source);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      const asset = {
        id: source.slice('assets/library/'.length),
        title: path.basename(file, path.extname(file)),
        category: categoryOf(file), source, outputs: [file], baselineSha256: digest,
      };
      manifest.assets.push(asset);
      byHash.set(digest, asset);
    }
    imported.push(file);
  }
  for (const asset of manifest.assets) asset.outputs.sort();
  manifest.assets.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets/manifest.json'), stable(manifest));
  return { imported: imported.length, assets: manifest.assets.length };
}

export async function syncAssets({ root = ROOT, check = false } = {}) {
  const manifest = await loadManifest(root);
  const stateFile = path.join(root, 'assets/.cache/sync-state.json');
  const previous = JSON.parse(await readFile(stateFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  const planned = [], state = {}, problems = [];
  const listedSources = new Set(manifest.assets.map(asset => asset.source));
  const listedOutputs = new Set(manifest.assets.flatMap(asset => asset.outputs));
  for (const file of await walk(root, 'assets/library')) {
    if (!listedSources.has(file)) problems.push(`Source absent from manifest: ${file}`);
  }
  for (const file of await runtimeFiles(root)) {
    if (!listedOutputs.has(file)) problems.push(`Runtime asset absent from manifest: ${file}; adopt it explicitly`);
  }
  for (const asset of manifest.assets) {
    const source = await safeFile(root, asset.source);
    const bytes = await readFile(source).catch(error => {
      if (error.code === 'ENOENT') { problems.push(`Missing source: ${asset.source}`); return null; }
      throw error;
    });
    if (!bytes) continue;
    const digest = hash(bytes);
    for (const output of asset.outputs) {
      const destination = await safeFile(root, output);
      const current = await readFile(destination).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const currentHash = current && hash(current);
      state[output] = digest;
      if (currentHash === digest) continue;
      if (check) problems.push(`Missing or stale copy: ${output} (source: ${asset.source})`);
      else if (current && currentHash !== (previous[output] ?? asset.baselineSha256)) {
        problems.push(`Edited runtime copy: ${output}; preserved. Edit ${asset.source} or adopt this file explicitly`);
      } else planned.push({ source, destination });
    }
  }
  // Preflight every source and destination before writing any runtime file.
  if (problems.length) throw Error(problems.join('\n'));
  if (!check) {
    for (const { source, destination } of planned) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, stable(state));
  }
  const duplicateSources = new Map();
  for (const asset of manifest.assets) {
    const digest = hash(await readFile(await safeFile(root, asset.source)));
    duplicateSources.set(digest, [...(duplicateSources.get(digest) ?? []), asset.source]);
  }
  return {
    assets: manifest.assets.length, copies: listedOutputs.size, updated: planned.length,
    duplicateSources: [...duplicateSources.values()].filter(files => files.length > 1),
  };
}

export function imageSize(bytes, file) {
  if (/\.png$/i.test(file) && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (/\.webp$/i.test(file) && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (type === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (type === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

async function sourceTexts(root) {
  const files = (await Promise.all(['client/src', 'SoyMan_1shot/app', 'electron'].map(folder => walk(root, folder)))).flat();
  for (const file of ['client/index.html', 'SoyMan_1shot/build-pwa.mjs', 'package.json']) {
    if (await lstat(path.join(root, file)).catch(() => null)) files.push(file);
  }
  files.push(...(await walk(root, 'client/public/fonts')).filter(file => /\.css$/i.test(file)));
  const texts = await Promise.all(files.filter(file => TEXT.test(file) && !/\.(test|spec)\./.test(file)).map(async file => ({
    file, text: await readFile(path.join(root, file), 'utf8'),
  })));
  return texts;
}

function references(asset, texts, rasterRegistry) {
  const found = new Map();
  for (const output of asset.outputs) {
    if (output.startsWith('client/public/')) {
      const url = `/${output.slice('client/public/'.length)}`;
      for (const item of texts) if (item.text.includes(url)) found.set(item.file, 'direct');
      for (const item of texts) {
        for (const match of item.text.matchAll(/url\(\s*["']?(\.[^"')\s]+)["']?\s*\)/g)) {
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(item.file), match[1]));
          if (resolved === output) found.set(item.file, 'direct');
        }
      }
      const relative = output.slice('client/public/'.length);
      const category = path.posix.dirname(relative), key = path.posix.basename(relative, '.webp');
      if (rasterRegistry.get(category)?.includes(key) && output.endsWith('.webp')) {
        found.set('client/src/rasterAssets.ts', 'registry');
        for (const item of texts) {
          if (new RegExp(`rasterAsset\\(\\s*["']${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(item.text)) {
            found.set(item.file, 'category');
          }
        }
      }
    } else if (output.startsWith('client/src/assets/')) {
      for (const item of texts) {
        for (const match of item.text.matchAll(/["']([^"'\n]*(?:assets\/[^"'\n]+))["']/g)) {
          const resolved = slash(path.relative(rootForResolution, path.resolve(rootForResolution, path.posix.dirname(item.file), match[1])));
          if (resolved === output || (match[1].endsWith('/*.webp') && output.startsWith(`${path.posix.dirname(resolved)}/`) && output.endsWith('.webp'))) {
            found.set(item.file, match[1].includes('*') ? 'collection' : 'direct');
          }
        }
      }
    }
    if (output === 'build/icon.png') found.set('package.json', 'packaging');
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, evidence]) => ({ file, evidence }));
}
// Resolve lexical imports consistently on any host without touching the filesystem.
const rootForResolution = path.resolve('/asset-catalog');

function readRasterRegistry(src) {
  const block = src.match(/RASTER_ASSETS: Record<RasterCategory, readonly string\[\]> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  return new Map([...block.matchAll(/(?:"([^"]+)"|(\w+)):\s*\[([^\]]*)\]/g)].map(match => [
    match[1] ?? match[2], [...match[3].matchAll(/"([^"]+)"/g)].map(key => key[1]),
  ]));
}

export async function makeCatalog(root = ROOT) {
  const manifest = await loadManifest(root);
  const texts = await sourceTexts(root);
  const registry = readRasterRegistry(await readFile(path.join(root, 'client/src/rasterAssets.ts'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  }));
  const provenance = new Map(), names = new Map();
  for (const category of ['cartography', 'crypt']) {
    const file = `client/src/maps/assets/${category}-pack.json`;
    const pack = JSON.parse(await readFile(path.join(root, file), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    }));
    for (const entry of pack.assets ?? []) provenance.set(`client/public/${category}/${entry.file}`, { manifest: file, ...entry });
    const definitions = await readFile(path.join(root, `client/src/maps/assets/${category}.ts`), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    for (const match of definitions.matchAll(/\{\s*key:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g)) {
      names.set(`${category}/${match[1]}`, match[2]);
    }
  }
  const runtime = [];
  for (const asset of manifest.assets) {
    const bytes = await readFile(await safeFile(root, asset.source));
    const mapFile = asset.outputs.find(output => /^client\/public\/(cartography|crypt)\//.test(output));
    let title = asset.title;
    if (mapFile && title === path.basename(mapFile, path.extname(mapFile))) {
      const key = mapFile.slice('client/public/'.length).replace(/\.webp$/, '');
      const base = key.replace(/-(s|w|n|e)$/, '');
      const side = { s: 'юг', w: 'запад', n: 'север', e: 'восток' }[key.slice(-1)];
      title = names.get(key) ?? (names.has(base) && side ? `${names.get(base)} · ${side}` : title);
    }
    runtime.push({ ...asset, title, status: 'runtime', kind: kindOf(asset.source), bytes: bytes.length,
      sha256: hash(bytes), dimensions: imageSize(bytes, asset.source),
      references: references(asset, texts, registry),
      provenance: asset.outputs.map(output => provenance.get(output)).filter(Boolean),
    });
  }
  const runtimeByHash = new Map(runtime.map(asset => [asset.sha256, asset.id]));
  const archives = [];
  for (const folder of ARCHIVES) {
    for (const source of (await walk(root, folder)).filter(file => MEDIA.test(file))) {
      const bytes = await readFile(await safeFile(root, source));
      const digest = hash(bytes);
      archives.push({ id: `archive:${source}`, title: path.basename(source, path.extname(source)),
        category: 'ui/fantasy-punk', source, outputs: [], status: 'archive', kind: kindOf(source),
        bytes: bytes.length, sha256: digest, dimensions: imageSize(bytes, source), references: [],
        runtimeAssetId: runtimeByHash.get(digest) ?? null,
      });
    }
  }
  return { version: 1, categories: CATEGORY_LABELS, assets: [...runtime, ...archives],
    summary: { runtime: runtime.length, copies: runtime.reduce((n, asset) => n + asset.outputs.length, 0),
      archives: archives.length, bytes: runtime.reduce((n, asset) => n + asset.bytes, 0),
      withoutDetectedReferences: runtime.filter(asset => !asset.references.length).length,
    },
  };
}

export async function buildCatalog(root = ROOT) {
  const catalog = await makeCatalog(root);
  const template = await readFile(path.join(root, 'scripts/asset-catalog.html'), 'utf8');
  // JSON is embedded as inert data; filenames never become HTML or executable JS.
  const json = JSON.stringify(catalog).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const folder = path.join(root, 'assets/catalog');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'index.json'), stable(catalog));
  await writeFile(path.join(folder, 'index.html'), template.replace('/* CATALOG_DATA */', json));
  return catalog.summary;
}

async function main() {
  const [command = 'check', file] = process.argv.slice(2);
  if (command === 'adopt') console.log(await adoptAssets(ROOT, file ?? null));
  else if (command === 'sync' || command === 'check') console.log(await syncAssets({ check: command === 'check' }));
  else if (command === 'catalog') console.log(await buildCatalog());
  else throw Error(`Unknown command: ${command}; use adopt [runtime-file], sync, check or catalog`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
