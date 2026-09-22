import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
if (process.argv.slice(2).some(a => a.startsWith('--') && !['--catalog', '--catalog-version', '--language'].includes(a))
  || (catalogVersion && !catalogPath) || (!catalogPath && !catalogVersion && process.argv.length > 2)) {
  throw Error('Usage: node package-server.mjs [--catalog path/to/catalog.json [--catalog-version 2026.09 [--language ru]]]');
}
// Validate the explicitly selected public catalog before building; never copy private/.
const catalog = catalogPath ? parseCatalog(JSON.parse(await readFile(path.resolve(catalogPath), 'utf8'))) : null;
const result = spawnSync(process.execPath, ['run-app.mjs', '--build'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) throw Error('Site build failed');
const name = `soyman-server-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const directory = path.join(root, 'releases', name);
await mkdir(directory, { recursive: true });
await cp(path.join(root, 'deploy'), directory, { recursive: true });
await cp(path.join(root, 'app-dist'), path.join(directory, 'site'), { recursive: true });
await cp(path.join(root, 'DEPLOY.md'), path.join(directory, 'README.md'));
await writeFile(path.join(directory, 'site/server-config.json'), JSON.stringify({ catalog: catalog ? '/catalog.json' : null }));
if (catalog) await writeFile(path.join(directory, 'site/catalog.json'), JSON.stringify(catalog));
// Catalog Delivery v2 (phase 1): parallel new-format release next to the
// legacy /catalog.json (deprecated since A2.3, still served for old deployed
// clients during the grace period). The running app prefers site/catalog/ but
// keeps the legacy fallback — do not delete until the cleanup micro-phase.
if (catalog && catalogVersion) {
  const system = 'dnd55';
  if (catalog.system.code !== system) throw Error(`Релиз v2 пока собирается только для dnd55, получено: ${catalog.system.code}`);
  const catalogId = makeCatalogId({ system, language, catalogVersion });
  const releasedAt = new Date().toISOString();
  const core = buildCatalogCore(catalog, { catalogId, catalogVersion, system, language, releasedAt });
  const previews = buildCatalogPreviews(catalog, { catalogId });
  const coreBytes = Buffer.from(serializeArtifact(core), 'utf8');
  const previewsBytes = Buffer.from(serializeArtifact(previews), 'utf8');
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
  const catalogDir = path.join(directory, 'site', 'catalog');
  await mkdir(catalogDir, { recursive: true });
  await writeFile(path.join(catalogDir, coreFileName(catalogId)), coreBytes);
  await writeFile(path.join(catalogDir, previewsFileName(catalogId)), previewsBytes);
  await writeFile(path.join(catalogDir, 'manifest.json'), serializeArtifact(manifest));
  console.log(`Catalog release v2: ${catalogId} (${coreBytes.length} + ${previewsBytes.length} bytes)`);
}
const archive = path.join(root, 'releases', `${name}.tar.gz`);
const packed = spawnSync('tar', ['-czf', archive, '-C', directory, '.'], { stdio: 'inherit' });
if (packed.status !== 0) throw Error(`Archive failed; ready directory: ${directory}`);
console.log(`Server package: ${archive}`);
