// CLI: build a Catalog Delivery v2 release (core + previews + manifest).
//
//   node build-catalog-release.mjs --catalog private/catalog.json \
//     --catalog-version 2026.09 [--language ru] [--out catalog/] [--released-at <iso>]
//
// Validates the input with the legacy parseCatalog, then writes:
//   <out>/manifest.json
//   <out>/dnd55-ru-<catalogVersion>.core.json
//   <out>/dnd55-ru-<catalogVersion>.previews.json
// Prints raw/gzip/brotli sizes for measurement. Does not touch the app runtime.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from './app/catalog.mjs';
import {
  buildCatalogCore, buildCatalogPreviews, buildCatalogManifest,
  makeCatalogId, coreFileName, previewsFileName,
  serializeArtifact, hashArtifact,
} from './app/catalog-release.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw Error(`Параметр --${name} требует значения`);
  return value;
}

const catalogPath = arg('catalog');
const catalogVersion = arg('catalog-version');
const language = arg('language', 'ru');
const outDir = arg('out', path.join(root, 'catalog'));
const releasedAt = arg('released-at', new Date().toISOString());
if (!catalogPath || !catalogVersion) {
  throw Error('Usage: node build-catalog-release.mjs --catalog path/to/catalog.json --catalog-version 2026.09 [--language ru] [--out catalog/] [--released-at <iso>]');
}

const system = 'dnd55';
const catalog = parseCatalog(JSON.parse(await readFile(path.resolve(catalogPath), 'utf8')));
if (catalog.system.code !== system) throw Error(`Релиз v2 пока собирается только для dnd55, получено: ${catalog.system.code}`);
const catalogId = makeCatalogId({ system, language, catalogVersion });

const core = buildCatalogCore(catalog, { catalogId, catalogVersion, system, language, releasedAt });
const previews = buildCatalogPreviews(catalog, { catalogId });
const coreText = serializeArtifact(core);
const previewsText = serializeArtifact(previews);
const coreBytes = Buffer.from(coreText, 'utf8');
const previewsBytes = Buffer.from(previewsText, 'utf8');
const manifest = buildCatalogManifest({
  catalogId,
  metadata: core.metadata,
  coreFile: coreFileName(catalogId),
  coreHash: hashArtifact(coreBytes),
  coreBytes: coreBytes.length,
  previewsFile: previewsFileName(catalogId),
  previewsHash: hashArtifact(previewsBytes),
  previewsBytes: previewsBytes.length,
});

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, coreFileName(catalogId)), coreBytes);
await writeFile(path.join(outDir, previewsFileName(catalogId)), previewsBytes);
await writeFile(path.join(outDir, 'manifest.json'), serializeArtifact(manifest));

const MIB = 1024 * 1024;
function report(label, bytes) {
  const gz = gzipSync(bytes, { level: 9 }).length;
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  console.log(`${label}: raw ${(bytes.length / MIB).toFixed(2)} MiB, gzip ${(gz / MIB).toFixed(2)} MiB, brotli ${(br / MIB).toFixed(2)} MiB`);
}
console.log(`Catalog release ${catalogId}: ${catalog.entries.length} entries, ${Object.keys(previews.images).length} previews`);
console.log(`Wrote ${outDir}`);
report('core', coreBytes);
report('previews', previewsBytes);
