#!/usr/bin/env node
/**
 * Барьер каркаса списка/каталога.
 *
 * ЗАЧЕМ. Семь каталогов — Кампании, Сеттинги, Системы, Игроки, Ресурсы,
 * Архив, Карты — были согласованы по устройству, но расходились разметкой:
 * своя шапка, своя полоса групп, свой тулбар. А карточка ошибки загрузки и
 * скелет были переписаны вручную 29 и 35 раз по всему приложению. Теперь
 * каталоги собираются `components/ListPage.tsx`, а состояния живут в
 * `components/Loadable.tsx`.
 *
 * Почему механически: шапки карточек разошлись у людей, знавших про
 * остальные пятнадцать. Правило в документе проверяется только чтением, а
 * читают его не тогда, когда пишут новую страницу.
 *
 * ЧТО ЛОВИТСЯ.
 *
 *   1. каталог из списка ниже — без `<ListPage`;
 *   2. в каталоге своя полоса (`className="tabs"`) или свой тулбар
 *      (`className="res-toolbar"`) — у каркаса они уже есть, второй экземпляр
 *      и есть расхождение;
 *   3. по всему `src` — своя карточка ошибки (`3px solid
 *      var(--status-cancelled)`) или свой скелет (`search-skeleton-pulse`)
 *      вне `Loadable.tsx`.
 *
 * Тулбар `res-toolbar` в целом не запрещён: он же служит панелью
 * инструментов редактора карт и Мастерения. Запрещён второй тулбар внутри
 * каталога.
 *
 * ОТСТУПЛЕНИЕ С ПРИЧИНОЙ — та же метка, что у каркаса карточки:
 *
 *     {/* каркас в обход намеренно — <причина> *\/}
 *     // каркас в обход намеренно — <причина>
 *
 * Причина обязана быть непустой. Метка ищется в 400 знаках перед местом.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Каталоги, обязанные идти через каркас (решения Q52–Q59, 2026-09-18). */
const CATALOGUES = [
  "pages/CampaignsListPage.tsx",
  "pages/SettingsListPage.tsx",
  "pages/SystemsListPage.tsx",
  "pages/PlayersWorkspace.tsx",
  "pages/ResourcesListPage.tsx",
  "pages/ArchivePage.tsx",
  "pages/MapsListPage.tsx",
];

/** Где общие состояния живут по праву. */
const STATES_HOME = "components/Loadable.tsx";

// Пробелы вокруг тире — только внутри строки: `\s` съедал перевод строки,
// и пустая метка брала причиной следующую строку кода (найдено 2026-09-18).
const EXCUSE = /каркас в обход намеренно[ \t]*[—-][ \t]*(\S[^\r\n*}]*)/;

function reasonBefore(text, index) {
  const chunk = text.slice(Math.max(0, index - 400), index);
  const m = EXCUSE.exec(chunk);
  return m && m[1].trim() ? m[1].trim().replace(/\s*\*\/\s*$/, "").trim() : null;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const offenders = [];
const excused = [];

function report(where, text, index) {
  const why = reasonBefore(text, index);
  if (why) excused.push(`${where}\n      причина: ${why}`);
  else offenders.push(where);
}

function scan(text, rel, re, what) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) report(`${rel}:${lineOf(text, m.index)}  ${what}`, text, m.index);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// 1–2. Каталоги.
for (const rel of CATALOGUES) {
  let text;
  try {
    text = readFileSync(join(SRC, rel), "utf8");
  } catch {
    offenders.push(`${rel}  каталог из списка не найден — переименован? поправьте CATALOGUES`);
    continue;
  }
  if (!/<ListPage\b/.test(text)) report(`${rel}  каталог без каркаса ListPage`, text, text.length);
  scan(text, rel, /className="tabs"/g, "своя полоса вкладок в каталоге");
  scan(text, rel, /className="res-toolbar"/g, "свой тулбар в каталоге");
}

// 3. Состояния по всему src.
for (const path of walk(SRC)) {
  const rel = relative(SRC, path).replace(/\\/g, "/");
  if (rel === STATES_HOME || basename(path).endsWith(".test.tsx")) continue;
  const text = readFileSync(path, "utf8");
  scan(text, rel, /3px solid var\(--status-cancelled\)/g, "своя карточка ошибки");
  scan(text, rel, /search-skeleton-pulse/g, "свой скелет");
}

if (excused.length) {
  console.log(`Мимо каркаса списка, но с названной причиной — ${excused.length}:\n`);
  for (const e of excused) console.log("  " + e);
  console.log("");
}

if (offenders.length) {
  console.error(`Каркас списка в обход — ${offenders.length} мест:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`
Шапка, полоса вкладок и тулбар каталога живут в
client/src/components/ListPage.tsx; карточка ошибки и скелет — в
client/src/components/Loadable.tsx (LoadErrorCard, ListSkeleton, Loadable).

Если отступление осознанное — назовите причину строкой рядом:
  {/* каркас в обход намеренно — <причина> */}
Барьер пропустит и сохранит запись, зачем так сделано.`);
  process.exit(1);
}

console.log(
  `Каркас списка: в обход никто не идёт${excused.length ? ` (${excused.length} с причиной)` : ""}.`
);
