#!/usr/bin/env node
/**
 * Барьер шкалы кегля.
 *
 * Шкала v2 объявлена в index.css (docs/design-system.md §3.2): девять
 * ступеней 11/12/13/14/15/16/26/40/64 — `--fs-micro` / `--fs-meta` /
 * `--fs-label` / `--fs-data` / `--fs-lead` / `--fs-body` (`--fs-h3`) /
 * `--fs-h2` (`--fs-stat`) / `--fs-h1` / `--fs-hero`. Но объявить мало.
 * До этой проверки в коде жило 570 мест с сырым кеглем, включая 14 разных
 * значений и половинные 9.5/10.5/12.5/14.5. Шкала была документом, а не
 * правилом: удержать §1.6 при таком разбросе нельзя даже теоретически.
 *
 * Поэтому правило принуждается механически, как и «одна рамка на область»
 * (index.css схлопывает `.card .card`): сырой кегль — ошибка сборки, а не
 * замечание в ревью.
 *
 * ИСКЛЮЧЕНИЕ ПЕРВОЕ — печатная шпаргалка. `.cheatsheet-*` и `.dnd-cheatsheet-*`
 * верстаются в миллиметрах под бумагу, с захардкоженными бумажными цветами;
 * экранная шкала им не указ. Список намеренно короткий и перечислен здесь.
 *
 * ИСКЛЮЧЕНИЕ ВТОРОЕ — лист и визард персонажа: `fantasy-punk-skin.css`,
 * `dnd-sheet.css`, `components/dnd/*.css`. Это облик OneShot, который
 * встраивает тот же лист; до перевода OneShot на светлую тему v2 он не
 * трогается (§13), а «предметы листа» и вовсе свои (§6.10). Исключение —
 * по файлам, чтобы не вешать на лист сотню одинаковых меток.
 *
 * ИСКЛЮЧЕНИЕ ТРЕТЬЕ — отступление с названной причиной. Барьер не только
 * запрещает, но и ПРИНИМАЕТ ОТСТУПЛЕНИЕ, если рядом написано зачем:
 *
 *     // кегль мимо шкалы намеренно — <причина>
 *     /* кегль мимо шкалы намеренно — <причина> *\/
 *
 * Метка ищется в строках непосредственно перед правилом. Причина обязана
 * быть непустой; «намеренно» без объяснения не считается.
 *
 * Зачем так. Запрет без выхода перешагивают молча — и правильно делают:
 * новый экран строится раньше, чем его форма попадает в шкалу. Так уже
 * вышло с рабочим столом сущностей, где понадобилась ступень между Body и
 * Lead, и двенадцать мест ушли мимо барьера, а причина осталась в
 * комментариях, которых барьер не видел. Метка переводит отступление из
 * нарушения в запись: причины читаются подряд, и повторившаяся несколько
 * раз возвращает ступень в шкалу по собственному следу, а не по спору.
 * Тот же приём, что `CONTEXT.md` держит для копии реестра видов сущностей
 * и `rasterAssets.ts` — для веса растровых ассетов.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Селекторы, которым сырой кегль разрешён — печатная шпаргалка.
 * `.combat-*` и `.fill-box` попадают сюда же: это строки боевого листа,
 * который печатают и заполняют ручкой (рядом с ними живут #999/#ccc и
 * клетка `.fill-box`), просто в их именах нет слова cheatsheet.
 */
const ALLOW_SELECTOR = /cheatsheet|\.combat-(row|field)|\.fill-box/i;

/** Файлы листа и визарда — облик OneShot (см. ИСКЛЮЧЕНИЕ ВТОРОЕ). */
const ALLOW_FILE = /^(fantasy-punk-skin\.css|dnd-sheet\.css|components\/dnd\/[^/]+\.css)$/;

/** Метка отступления: «намеренно — <причина>», причина обязательна. */
const EXCUSE = /кегль мимо шкалы намеренно\s*[—-]\s*(\S[^\r\n*]*)/;

/** Ищем метку в промежутке перед правилом — комментарий, а не соседний код. */
function excuseIn(chunk) {
  const m = EXCUSE.exec(chunk);
  return m && m[1].trim() ? m[1].trim().replace(/\s*\*\/\s*$/, "").trim() : null;
}

const offenders = [];
const excused = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx)$/.test(name)) check(p);
  }
}

function check(path) {
  const text = readFileSync(path, "utf8");
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  if (ALLOW_FILE.test(rel)) return;

  if (path.endsWith(".css")) {
    // Разбираем по правилам, чтобы знать селектор и простить шпаргалке.
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = rule.exec(text))) {
      // Комментарий перед правилом попадает сюда же — его и отрезаем,
      // предварительно поискав в нём метку отступления.
      const head = m[1].replace(/\s+/g, " ").trim();
      const selector = head.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      if (ALLOW_SELECTOR.test(selector)) continue;
      const hit = /font-size:\s*[0-9.]+px/.exec(m[2]);
      if (!hit) continue;
      const line = text.slice(0, m.index + m[2].indexOf(hit[0])).split("\n").length;
      const where = `${rel}:${line}  ${selector.slice(0, 48)} — ${hit[0]}`;
      // Метка годится и перед правилом, и внутри него.
      const reason = excuseIn(head) ?? excuseIn(m[2]);
      if (reason) excused.push(`${where}\n      причина: ${reason}`);
      else offenders.push(where);
    }
  } else {
    const re = /fontSize:\s*([0-9.]+)\b/g;
    let m;
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split("\n").length;
      const where = `${rel}:${line}  fontSize: ${m[1]}`;
      const reason = excuseIn(text.slice(Math.max(0, m.index - 400), m.index));
      if (reason) excused.push(`${where}\n      причина: ${reason}`);
      else offenders.push(where);
    }
  }
}

walk(ROOT);

if (excused.length) {
  console.log(`Мимо шкалы, но с названной причиной — ${excused.length}:
`);
  for (const e of excused) console.log("  " + e);
  console.log("");
}

if (offenders.length) {
  console.error("Кегль мимо шкалы — " + offenders.length + " мест:\n");
  for (const o of offenders) console.error("  " + o);
  console.error(
    "\nШкала: var(--fs-micro) 11 · var(--fs-meta) 12 · var(--fs-label) 13 · var(--fs-data) 14 · var(--fs-lead) 15 · var(--fs-body) 16" +
      "\nПлюс var(--fs-h2) 26 · var(--fs-h1) 40 · var(--fs-hero) 64 для крупного и чисел." +
      "\nСм. комментарий к шкале в client/src/index.css."
  );
  process.exit(1);
}

console.log(`Шкала кегля: сырых значений нет${excused.length ? ` (${excused.length} с причиной)` : ""}.`);
