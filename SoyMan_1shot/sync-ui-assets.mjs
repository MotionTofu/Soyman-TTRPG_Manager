// The archive is the sole editable source; client/public contains only the
// manifest-selected runtime mirror shared by the main client and OneShot.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(root, 'assets/fantasy-punk');
const runtimeRoot = path.resolve(root, '../client/public/ui/fantasy-punk');
const skinPath = path.resolve(root, '../client/src/fantasy-punk-skin.css');
const manifestPath = path.join(sourceRoot, 'runtime-manifest.json');

function safeRelative(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9/.-]*\.webp$/.test(value)
      || value.includes('..') || value.startsWith('/') || value.includes('//')) {
    throw Error(`Invalid runtime asset path: ${value}`);
  }
  return value;
}

async function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function syncUiAssets({ check = false } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Number.isSafeInteger(manifest.maxBytes)
      || !Array.isArray(manifest.files)) throw Error('Invalid Fantasy Punk runtime manifest');
  const files = manifest.files.map(safeRelative);
  const selected = new Set(files);
  if (selected.size !== files.length) throw Error('Duplicate Fantasy Punk runtime asset');

  const css = await readFile(skinPath, 'utf8');
  const referenced = new Set([...css.matchAll(/url\(["']?\/ui\/fantasy-punk\/([^"')]+)/g)].map(match => safeRelative(match[1])));
  for (const file of referenced) {
    if (!selected.has(file)) throw Error(`CSS asset missing from runtime manifest: ${file}`);
  }
  for (const file of selected) {
    if (!referenced.has(file)) throw Error(`Unused asset in runtime manifest: ${file}`);
  }

  let bytesTotal = 0;
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    const output = path.join(runtimeRoot, file);
    const sourceBytes = await readFile(source);
    bytesTotal += sourceBytes.length;
    if (bytesTotal > manifest.maxBytes) throw Error(`Fantasy Punk runtime exceeds ${manifest.maxBytes} bytes`);
    if (!check) {
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(source, output);
    }
    const runtimeBytes = await readFile(output).catch(() => { throw Error(`Missing runtime asset: ${file}`); });
    if (digest(sourceBytes) !== digest(runtimeBytes)) throw Error(`Runtime asset differs from source: ${file}`);
  }

  let present = [];
  try {
    await stat(runtimeRoot);
    present = await listFiles(runtimeRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const extra = present.filter(file => !selected.has(file));
  if (extra.length) throw Error(`Unlisted runtime assets: ${extra.join(', ')}`);
  return { count: files.length, bytes: bytesTotal };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await syncUiAssets({ check: process.argv.includes('--check') });
  console.log(`Fantasy Punk runtime: ${result.count} WebP, ${result.bytes} bytes`);
}
