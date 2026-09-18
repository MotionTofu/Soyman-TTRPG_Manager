#!/usr/bin/env node
/**
 * Барьер каркаса карточки сущности.
 *
 * ЗАЧЕМ. Шестнадцать карточек верстали одну и ту же шапку вручную, и она
 * разошлась: где `<h1>`, где `<h2>`, где `SectionHeading`; значок вида то до
 * имени, то после; крошек не было у четырёх самых глубоких мест приложения.
 * Теперь шапка и полоса вкладок живут в `components/EntityPage.tsx`.
 *
 * Почему проверяется механически, а не остаётся памяткой: шестнадцать шапок
 * разошлись при том, что писавшие их знали про остальные пятнадцать. Правило,
 * живущее в документе, эту судьбу и повторяет — проверяется оно только
 * чтением, а читают его не в тот момент, когда пишут новую страницу.
 *
 * (Прежняя редакция этого абзаца ссылалась на `EntityTabWorkspace` как на
 * «заготовку, которая не разошлась». Замер был неверен: он используется
 * 19 раз в 7 файлах. Довод убран, а не подправлен.)
 *
 * ЧТО ЛОВИТСЯ. Три грубые и однозначные вещи в `src/pages`:
 *
 *   1. свой `<div className="tabs">` вместо полосы каркаса;
 *   2. свой заголовок страницы — `<h1>` вне каркаса;
 *   3. у карточки сущности (`*DetailPage.tsx`) — отсутствие каркаса вовсе.
 *
 * ОТСТУПЛЕНИЕ С ПРИЧИНОЙ. Барьер не запрещает, а требует объяснения:
 *
 *     {/* каркас в обход намеренно — <причина> *\/}
 *     // каркас в обход намеренно — <причина>
 *
 * Причина обязана быть непустой. Метка ищется в 400 знаках перед местом.
 *
 * Тот же приём в `check-type-scale.mjs`, `check-spacing.mjs`,
 * `check-raster-assets.mjs` и `CONTEXT.md`: запрет без выхода перешагивают
 * молча — новое строится раньше, чем его форма попадает в систему, — а метка
 * переводит отступление из нарушения в запись. Причины читаются подряд, и
 * повторившаяся несколько раз меняет каркас по собственному следу.
 *
 * ЧЕГО БАРЬЕР НЕ КАСАЕТСЯ. Страниц, которые не являются карточкой сущности:
 * списки, полотно, редактор карт, стол игры, визарды. У них свой вид и свой
 * каркас — пока не построенный.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = new URL("../src/pages", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Метка отступления: «намеренно — <причина>», причина обязательна. */
// Пробелы вокруг тире — только внутри строки: `\s` съедал перевод строки,
// и пустая метка брала причиной следующую строку кода (найдено 2026-09-18).
const EXCUSE = /каркас в обход намеренно[ \t]*[—-][ \t]*(\S[^\r\n*}]*)/;

function reasonBefore(text, index) {
  const chunk = text.slice(Math.max(0, index - 400), index);
  const m = EXCUSE.exec(chunk);
  return m && m[1].trim() ? m[1].trim().replace(/\s*\*\/\s*$/, "").trim() : null;
}

const offenders = [];
const excused = [];

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function check(path) {
  const text = readFileSync(path, "utf8");
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  const name = basename(path);
  const usesFrame = /\bEntityPage\b/.test(text);

  // 1. Своя полоса вкладок.
  const tabs = /className="tabs"/g;
  let m;
  while ((m = tabs.exec(text))) {
    const where = `${rel}:${lineOf(text, m.index)}  своя полоса вкладок`;
    const why = reasonBefore(text, m.index);
    if (why) excused.push(`${where}\n      причина: ${why}`);
    else offenders.push(where);
  }

  // 2. Свой заголовок страницы.
  const h1 = /<h1[\s>]/g;
  while ((m = h1.exec(text))) {
    const where = `${rel}:${lineOf(text, m.index)}  свой <h1>`;
    const why = reasonBefore(text, m.index);
    if (why) excused.push(`${where}\n      причина: ${why}`);
    else offenders.push(where);
  }

  // 3. Карточка сущности вообще без каркаса.
  if (/DetailPage\.tsx$/.test(name) && !usesFrame) {
    const why = reasonBefore(text, text.length);
    const where = `${rel}  карточка сущности без каркаса`;
    if (why) excused.push(`${where}\n      причина: ${why}`);
    else offenders.push(where);
  }
}

for (const nameEntry of readdirSync(ROOT)) {
  const p = join(ROOT, nameEntry);
  if (statSync(p).isDirectory()) continue;
  if (nameEntry.endsWith(".tsx")) check(p);
}

if (excused.length) {
  console.log(`Мимо каркаса, но с названной причиной — ${excused.length}:\n`);
  for (const e of excused) console.log("  " + e);
  console.log("");
}

if (offenders.length) {
  console.error(`Каркас в обход — ${offenders.length} мест:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`
Шапка и полоса вкладок карточки сущности живут в
client/src/components/EntityPage.tsx — там же записан состав гнёзд.

Если отступление осознанное — назовите причину строкой рядом:
  {/* каркас в обход намеренно — <причина> */}
Барьер пропустит и сохранит запись, зачем так сделано.`);
  process.exit(1);
}

console.log(
  `Каркас карточки сущности: в обход никто не идёт${excused.length ? ` (${excused.length} с причиной)` : ""}.`
);
