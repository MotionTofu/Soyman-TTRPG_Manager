import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adoptAssets, loadManifest, syncAssets, makeCatalog, buildCatalog, imageSize, ROOT } from './asset-library.mjs';
import { serveCatalog } from './serve-asset-catalog.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'soyman-assets-'));
  assert.ok(path.resolve(root).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) await put(root, file, content);
  return root;
}
async function put(root, file, content) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}

test('adoption stores identical runtime files once and preserves both deployment paths', async t => {
  const root = await fixture(t, { 'client/public/ui/wizard/paper.webp': 'same', 'client/public/textures/paper.webp': 'same' });
  assert.deepEqual(await adoptAssets(root), { imported: 2, assets: 1 });
  const { assets } = await loadManifest(root);
  assert.equal(assets[0].outputs.length, 2);
  await syncAssets({ root });
  await put(root, assets[0].source, 'new artwork');
  await syncAssets({ root });
  for (const file of assets[0].outputs) assert.equal(await readFile(path.join(root, file), 'utf8'), 'new artwork');
  assert.equal((await syncAssets({ root, check: true })).copies, 2);
});

test('a build preserves edited runtime copies and writes nothing when preflight fails', async t => {
  const root = await fixture(t, { 'client/public/a.webp': 'a', 'client/public/b.webp': 'b' });
  await adoptAssets(root); await syncAssets({ root });
  const { assets } = await loadManifest(root);
  await put(root, assets[0].source, 'updated a');
  await put(root, assets[1].outputs[0], 'work in progress');
  await assert.rejects(syncAssets({ root }), /Edited runtime copy/);
  assert.equal(await readFile(path.join(root, assets[0].outputs[0]), 'utf8'), 'a');
  assert.equal(await readFile(path.join(root, assets[1].outputs[0]), 'utf8'), 'work in progress');
  await adoptAssets(root, assets[1].outputs[0]);
  await syncAssets({ root });
  assert.equal(await readFile(path.join(root, assets[1].source), 'utf8'), 'work in progress');
});

test('missing runtime mirrors are regenerated; missing and unregistered sources fail checks', async t => {
  const root = await fixture(t, { 'client/public/a.webp': 'a' });
  await adoptAssets(root);
  await rm(path.join(root, 'client/public/a.webp'));
  await assert.rejects(syncAssets({ root, check: true }), /Missing or stale copy/);
  await syncAssets({ root });
  await put(root, 'assets/library/unlisted.webp', 'new');
  await assert.rejects(syncAssets({ root }), /Source absent from manifest/);
  await rm(path.join(root, 'assets/library/unlisted.webp'));
  await rm(path.join(root, (await loadManifest(root)).assets[0].source));
  await assert.rejects(syncAssets({ root }), /Missing source/);
});

test('new runtime files require explicit registration and unrelated application data is excluded', async t => {
  const root = await fixture(t, {
    'client/public/a.webp': 'a', 'client/public/standalone-template.html': '<html>app</html>',
    'server/data/portrait.png': 'private', 'build/unrelated.png': 'unrelated',
  });
  assert.equal((await adoptAssets(root)).assets, 1);
  await put(root, 'client/public/new.webp', 'new');
  await assert.rejects(syncAssets({ root }), /Runtime asset absent from manifest/);
  await adoptAssets(root, 'client/public/new.webp');
  assert.equal((await syncAssets({ root, check: true })).assets, 2);
});

test('manifest cannot escape the workspace or overwrite files outside asset destinations', async t => {
  const root = await fixture(t, { 'client/public/a.webp': 'a' });
  await adoptAssets(root);
  const manifest = await loadManifest(root);
  const asset = manifest.assets[0];
  for (const bad of ['../outside.webp', 'C:/outside.webp', 'assets/library/../outside.webp', '/outside.webp']) {
    await put(root, 'assets/manifest.json', JSON.stringify({ ...manifest, assets: [{ ...asset, source: bad }] }));
    await assert.rejects(loadManifest(root), /Unsafe|Invalid/);
  }
  await put(root, 'assets/manifest.json', JSON.stringify({ ...manifest, assets: [{ ...asset, outputs: ['server/data/a.webp'] }] }));
  await assert.rejects(loadManifest(root), /Invalid or duplicate output/);
});

test('catalog distinguishes archive matches, static uses, registry uses and undetected uses', async t => {
  const root = await fixture(t, {
    'client/public/coins/gp.webp': 'coin', 'client/public/unknown.webp': 'unknown',
    'client/src/assets/logos/logo.webp': 'logo',
    'client/src/rasterAssets.ts': 'export const RASTER_ASSETS: Record<RasterCategory, readonly string[]> = {\n coins: ["gp"],\n};',
    'client/src/example.css': '.coin{background:url("/coins/gp.webp")}',
    'client/src/icons.ts': 'rasterAsset("coins", key)',
    'client/src/brand.ts': 'import.meta.glob("./assets/logos/*.webp")',
    'SoyMan_1shot/assets/fantasy-punk/coin.png': 'coin',
  });
  await adoptAssets(root);
  const catalog = await makeCatalog(root);
  const coin = catalog.assets.find(asset => asset.outputs.includes('client/public/coins/gp.webp'));
  assert.ok(coin.references.some(ref => ref.file === 'client/src/example.css' && ref.evidence === 'direct'));
  assert.ok(coin.references.some(ref => ref.file === 'client/src/icons.ts' && ref.evidence === 'category'));
  assert.ok(catalog.assets.find(asset => asset.status === 'archive').runtimeAssetId);
  assert.ok(catalog.assets.find(asset => asset.category === 'branding').references.some(ref => ref.evidence === 'collection'));
  assert.equal(catalog.summary.withoutDetectedReferences, 1);
});

test('generated gallery embeds filenames as inert JSON and produces reproducible output', async t => {
  const root = await fixture(t, { 'client/public/a.webp': 'a' });
  await adoptAssets(root);
  const manifest = await loadManifest(root);
  manifest.assets[0].title = '</script><script>alert(1)</script>';
  await put(root, 'assets/manifest.json', JSON.stringify(manifest));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(path.join(ROOT, 'scripts/asset-catalog.html'), path.join(root, 'scripts/asset-catalog.html'));
  await buildCatalog(root);
  const first = await readFile(path.join(root, 'assets/catalog/index.html'), 'utf8');
  assert.ok(!first.includes(manifest.assets[0].title));
  assert.ok(first.includes('\\u003c/script'));
  await buildCatalog(root);
  assert.equal(first, await readFile(path.join(root, 'assets/catalog/index.html'), 'utf8'));
});

test('PNG and WebP dimensions are read without loading an image decoder', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(400,16); png.writeUInt32BE(200,20);
  assert.deepEqual(imageSize(png, 'paper.png'), { width: 400, height: 200 });
  const webp = Buffer.alloc(30);
  webp.write('RIFF',0); webp.write('WEBP',8); webp.write('VP8X',12);
  webp.writeUIntLE(511,24,3); webp.writeUIntLE(255,27,3);
  assert.deepEqual(imageSize(webp, 'paper.webp'), { width: 512, height: 256 });
});

test('the local viewer serves listed assets and refuses private files and traversal', async t => {
  const root = await fixture(t, { 'client/public/a.webp': 'a', 'server/data/private.json': 'secret' });
  await adoptAssets(root);
  await mkdir(path.join(root, 'scripts'));
  await copyFile(path.join(ROOT, 'scripts/asset-catalog.html'), path.join(root, 'scripts/asset-catalog.html'));
  const server = await serveCatalog({ root, port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal(await (await fetch(`${url}/assets/library/a.webp`)).text(), 'a');
  assert.equal((await fetch(`${url}/server/data/private.json`)).status, 404);
  assert.equal((await fetch(`${url}/assets/%2e%2e/server/data/private.json`)).status, 404);
  assert.equal((await fetch(`${url}/assets/library/a.webp`, { method: 'POST' })).status, 405);
  await put(root, 'client/public/new.webp', 'new');
  await adoptAssets(root, 'client/public/new.webp');
  await buildCatalog(root);
  assert.equal(await (await fetch(`${url}/assets/library/new.webp`)).text(), 'new');
});
