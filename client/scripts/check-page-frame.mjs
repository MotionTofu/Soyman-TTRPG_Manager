#!/usr/bin/env node
/**
 * Барьер: каждая страница — на каркасе или в списке «без обвязки» (П3.6,
 * разбор Q65–Q71, 2026-09-18).
 *
 * ЗАЧЕМ. У карточки сущности и каталога каркасы есть и держатся своими
 * барьерами (`check-entity-page.mjs`, `check-list.mjs`). Остальные страницы
 * с шапкой собирали её каждая сама: `<h1>`, `SectionHeading` с рядом кнопок
 * под ним или рядом, своя карточка ошибки. Лёгкий каркас `PageFrame`
 * закрыл это, но без барьера новая страница снова начнёт со своей шапки.
 *
 * ПРАВИЛА.
 *  1. Файл в `src/pages` идёт через один из каркасов — `PageFrame`,
 *     `ListPage`, `EntityPage` — или стоит в списке NO_FRAME ниже с причиной.
 *     Новая страница вне списка — нарушение: либо каркас, либо строка в
 *     списке, видимая в диффе.
 *  2. Список не врёт: строка на файл, которого нет, или на файл, который
 *     уже идёт через каркас, — тоже нарушение.
 *  3. Страница на `PageFrame` не рисует свою шапку рядом: `<h1>` и
 *     `SectionHeading` уровня страницы (без `level="section"`) в ней —
 *     нарушение. Осознанное место пропускается меткой в 400 знаках перед
 *     ним, причина обязана быть непустой:
 *
 *         {/* шапка мимо каркаса намеренно — <причина> *\/}
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src/pages", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Страницы без обвязки — намеренно (Q65). Причина — та, что прочтёт
// следующий, кто захочет «привести к общему виду».
const NO_FRAME = {
  "CanvasPage.tsx": "полноэкранный инструмент: своя раскладка во всю ширину",
  "MapEditorPage.tsx": "полноэкранный инструмент: своя раскладка во всю ширину",
  "GraphPage.tsx": "полноэкранный инструмент: граф во всю ширину",
  "SessionLivePage.tsx": "стол игры: живая сессия со своей раскладкой панелей",
  "sessionLivePanels.tsx": "не страница — панели живой сессии",
  "SessionPanelPopoutPage.tsx": "отдельное окно одной панели",
  "PresentationShowPage.tsx": "проектор: показ игрокам, без интерфейса",
  "PresentationPreviewPage.tsx": "предпросмотр проектора: тот же экран, что у игроков",
  "NowPlayingPage.tsx": "мини-экран «сейчас играет»",
  "SoundConsolePage.tsx": "отдельное окно пульта звука со своей шапкой",
  "CharacterSheetPage.tsx": "лист персонажа во весь экран",
  "CompendiumEntryRedirectPage.tsx": "не страница — перенаправление в систему или карточку",
  "PlayerDetailPage.tsx": "не страница — обёртка PlayersWorkspace",
  "PlayersListPage.tsx": "не страница — обёртка PlayersWorkspace",
  "HomeCalendarPage.tsx": "главная Мастера: шапки нет по устройству, начинается с ближайшей игры (решение владельца открыто, П3.6)",
};

const FRAME = /<(PageFrame|ListPage|EntityPage)\b/;
const EXCUSE = /шапка мимо каркаса намеренно[ \t]*[—-][ \t]*(\S[^\r\n*}]*)/;
const OWN_HEAD = /<h1\b|<SectionHeading\b(?![^>]*level="section")/g;

function excused(text, index) {
  const m = EXCUSE.exec(text.slice(Math.max(0, index - 400), index));
  return m && m[1].trim() ? m[1].trim() : null;
}

const files = readdirSync(ROOT).filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"));
const offenders = [];
const notes = [];

for (const name of files) {
  const text = readFileSync(join(ROOT, name), "utf8");
  const framed = FRAME.test(text);
  if (name in NO_FRAME) {
    if (framed) offenders.push(`${name}: в списке «без обвязки», но уже идёт через каркас — уберите строку из NO_FRAME`);
    continue;
  }
  if (!framed) {
    offenders.push(`${name}: страница без каркаса — PageFrame / ListPage / EntityPage или строка в NO_FRAME с причиной`);
    continue;
  }
  if (!/<PageFrame\b/.test(text)) continue;
  let m;
  OWN_HEAD.lastIndex = 0;
  while ((m = OWN_HEAD.exec(text))) {
    const line = text.slice(0, m.index).split("\n").length;
    const why = excused(text, m.index);
    if (why) notes.push(`${name}:${line}\n      причина: ${why}`);
    else offenders.push(`${name}:${line}: своя шапка рядом с PageFrame — заголовок страницы даёт каркас`);
  }
}
for (const name of Object.keys(NO_FRAME)) {
  if (!existsSync(join(ROOT, name))) offenders.push(`${name}: в списке «без обвязки», но файла нет — уберите строку из NO_FRAME`);
}

if (notes.length) {
  console.log(`Шапки мимо каркаса с названной причиной — ${notes.length}:\n`);
  for (const n of notes) console.log("  " + n);
  console.log("");
}
if (offenders.length) {
  console.error(`Каркас страниц — нарушений ${offenders.length}:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`
Шапка страницы — через каркас (components/PageFrame.tsx). Осознанное
отступление назовите строкой рядом:
  {/* шапка мимо каркаса намеренно — <причина> */}`);
  process.exit(1);
}
console.log(`Каркас страниц: ${files.length - Object.keys(NO_FRAME).length} на каркасе, ${Object.keys(NO_FRAME).length} без обвязки по списку.`);
