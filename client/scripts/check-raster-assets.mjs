#!/usr/bin/env node
/**
 * Барьер растровых ассетов интерфейса.
 *
 * Правило целиком — в реестре `client/src/rasterAssets.ts`. Здесь только
 * то, что можно проверить механически:
 *
 *   1. формат `webp` (png/jpg в раздаче интерфейса не место);
 *   2. вес не больше 100 КБ;
 *   3. каждый файл назван в реестре, и каждый ключ реестра лежит на диске;
 *   4. имя файла — нижний регистр (Linux чувствителен к нему, а
 *      `deploy/nginx.conf` предполагает самостоятельный хостинг).
 *
 * Барьер НЕ запрещает, а ТРЕБУЕТ ПРИЧИНУ. Ассет тяжелее нормы проходит,
 * если назван в `raster-exceptions.json` с непустым `reason`. Так поиск
 * перестаёт быть нарушением и становится записью: через месяц причины
 * читаются подряд, и повторившаяся пять раз переписывает норму по
 * собственному следу, а не по ощущениям. Запрет без выхода перешагивают
 * молча — это уже проверено на шкале кегля.
 *
 * Решения гриллинга 2026-09-12, см. `MainWorks/Растр_как_материал_—
 * _решения_2026-09-12.md`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const publicDir = join(clientRoot, "public");
const registryPath = join(clientRoot, "src", "rasterAssets.ts");
const exceptionsPath = join(here, "raster-exceptions.json");

const MAX_BYTES = 100 * 1024;

/** Категории и ключи берём из самого реестра — второго списка быть не должно. */
function readRegistry() {
  const src = readFileSync(registryPath, "utf8");
  const block = src.match(/RASTER_ASSETS: Record<RasterCategory, readonly string\[\]> = \{([\s\S]*?)\n\};/);
  if (!block) {
    console.error(`Не нашёл RASTER_ASSETS в ${registryPath} — барьер не может работать вслепую.`);
    process.exit(2);
  }
  const out = new Map();
  const re = /(\w+):\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const keys = [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
    out.set(m[1], keys);
  }
  return out;
}

function readExceptions() {
  if (!existsSync(exceptionsPath)) return new Map();
  const raw = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  const out = new Map();
  for (const entry of raw.exceptions ?? []) {
    if (entry && entry.file && typeof entry.reason === "string" && entry.reason.trim()) {
      out.set(entry.file, entry.reason.trim());
    }
  }
  return out;
}

const registry = readRegistry();
const exceptions = readExceptions();
const problems = [];
const excused = [];

for (const [category, keys] of registry) {
  const dir = join(publicDir, category);
  if (!existsSync(dir)) {
    problems.push(`${category}/ — категория есть в реестре, каталога в раздаче нет`);
    continue;
  }
  const onDisk = readdirSync(dir).filter((f) => /\.(webp|png|jpe?g|gif|avif)$/i.test(f));

  for (const file of onDisk) {
    const rel = `${category}/${file}`;
    const ext = extname(file).toLowerCase();
    const stem = basename(file, extname(file));

    if (ext !== ".webp") {
      problems.push(`${rel} — формат ${ext}, нужен .webp`);
      continue;
    }
    if (file !== file.toLowerCase()) {
      problems.push(`${rel} — прописные в имени файла; на Linux это 404`);
    }
    if (!keys.includes(stem)) {
      problems.push(`${rel} — лежит в раздаче, но не назван в реестре rasterAssets.ts`);
    }
    const size = statSync(join(dir, file)).size;
    if (size > MAX_BYTES) {
      const reason = exceptions.get(rel);
      if (reason) excused.push(`${rel} — ${(size / 1024).toFixed(0)} КБ: ${reason}`);
      else problems.push(`${rel} — ${(size / 1024).toFixed(0)} КБ, норма 100 КБ`);
    }
  }

  for (const key of keys) {
    if (!existsSync(join(dir, `${key}.webp`))) {
      problems.push(`${category}/${key}.webp — назван в реестре, на диске нет`);
    }
  }
}

if (excused.length) {
  console.log(`Тяжелее нормы, но с причиной — ${excused.length}:\n`);
  for (const line of excused) console.log(`  ${line}`);
  console.log("");
}

if (problems.length) {
  console.error(`Растровые ассеты мимо правила — ${problems.length}:\n`);
  for (const line of problems) console.error(`  ${line}`);
  console.error(`
Правило: формат webp, сторона не больше двойной экранной, вес до 100 КБ,
имя в нижнем регистре, ключ — в реестре client/src/rasterAssets.ts.

Ассет должен быть тяжелее — это можно, но с причиной: допишите его в
client/scripts/raster-exceptions.json полем reason. Барьер пропустит и
сохранит запись, зачем так сделано.`);
  process.exit(1);
}

console.log(`Растровые ассеты в норме: ${[...registry.values()].reduce((n, k) => n + k.length, 0)} файлов.`);
