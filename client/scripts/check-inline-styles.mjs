#!/usr/bin/env node
/**
 * Барьер на рост инлайновых стилей в `src/pages` (П3.5, 2026-09-18).
 *
 * ЗАЧЕМ. Инлайновый `style={…}` — место, где страница решает про вид сама,
 * мимо классов и токенов: шаг, кегль, цвет, обводка расходятся именно там,
 * и барьеры шкал (`check-spacing.mjs`, `check-type-scale.mjs`) их не видят —
 * они читают CSS. В `pages/` таких мест больше тысячи двухсот. Разовая
 * чистка вслепую невозможна: половина из них — честная вёрстка вроде
 * ширины колонки, которую не отличить от расхождения без чтения. Поэтому
 * барьер не требует убрать старое, а запрещает прирост.
 *
 * КАК. У каждого файла — потолок, `inline-styles-baseline.json`: сколько
 * `style={` в нём было, когда барьер ставили. Больше потолка — нарушение.
 * Новая страница начинает с нуля. Стало меньше — барьер подскажет опустить
 * потолок: `node scripts/check-inline-styles.mjs --update`. Этот флаг только
 * опускает; поднять потолок можно лишь руками в JSON, и такая правка видна в
 * диффе — это и есть запись отступления.
 *
 * ОТСТУПЛЕНИЕ С ПРИЧИНОЙ. Отдельный стиль сверх потолка пропускается меткой
 * рядом (ищется в 400 знаках перед местом) и в счёт не идёт:
 *
 *     {/* инлайн-стиль намеренно — <причина> *\/}
 *     // инлайн-стиль намеренно — <причина>
 *
 * Причина обязана быть непустой. Тот же приём, что у остальных барьеров.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/pages", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BASELINE = new URL("./inline-styles-baseline.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const EXCUSE = /инлайн-стиль намеренно[ \t]*[—-][ \t]*(\S[^\r\n*}]*)/;
const STYLE = /\bstyle=\{/g;

function reasonBefore(text, index) {
  const chunk = text.slice(Math.max(0, index - 400), index);
  const m = EXCUSE.exec(chunk);
  return m && m[1].trim() ? m[1].trim().replace(/\s*\*\/\s*$/, "").trim() : null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const counts = {};
const excused = [];
for (const path of walk(ROOT)) {
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  const text = readFileSync(path, "utf8");
  let n = 0;
  let m;
  STYLE.lastIndex = 0;
  while ((m = STYLE.exec(text))) {
    const why = reasonBefore(text, m.index);
    if (why) excused.push(`${rel}:${text.slice(0, m.index).split("\n").length}\n      причина: ${why}`);
    else n++;
  }
  if (n > 0) counts[rel] = n;
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch {
  baseline = {};
}

if (process.argv.includes("--update")) {
  // Только вниз: поднять потолок — правка JSON руками, видимая в диффе.
  const next = {};
  for (const [file, ceiling] of Object.entries(baseline)) {
    const now = counts[file] ?? 0;
    if (now > 0) next[file] = Math.min(ceiling, now);
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Потолки опущены до текущих: ${Object.keys(sorted).length} файлов.`);
  process.exit(0);
}

const offenders = [];
const lower = [];
for (const [file, n] of Object.entries(counts)) {
  const ceiling = baseline[file] ?? 0;
  if (n > ceiling) offenders.push(`${file}  ${n} при потолке ${ceiling} (+${n - ceiling})`);
  else if (n < ceiling) lower.push(`${file}  ${n} < ${ceiling}`);
}
for (const [file, ceiling] of Object.entries(baseline)) {
  if (!(file in counts) && ceiling > 0) lower.push(`${file}  0 < ${ceiling}`);
}

if (excused.length) {
  console.log(`Инлайн-стили сверх потолка, но с названной причиной — ${excused.length}:\n`);
  for (const e of excused) console.log("  " + e);
  console.log("");
}

if (offenders.length) {
  console.error(`Инлайн-стилей стало больше — ${offenders.length} файлов:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`
Вид — в классах и токенах (index.css), а не в style={…} страницы.

Если стиль осознанный — назовите причину строкой рядом:
  {/* инлайн-стиль намеренно — <причина> */}
Барьер пропустит и сохранит запись, зачем так сделано.`);
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Инлайн-стили в pages/: ${total}, прироста нет.`);
if (lower.length) {
  console.log(`Стало меньше в ${lower.length} файлах — опустите потолок: node scripts/check-inline-styles.mjs --update`);
}
