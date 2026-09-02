#!/usr/bin/env node
/**
 * Барьер шкалы кегля.
 *
 * Шкала объявлена в index.css (`--fs-micro` 10 / `--fs-meta` 12 / `--fs-h3` 16 /
 * `--fs-h2` 26 плюс clamp-ступени для героя и чисел) — но объявить мало.
 * До этой проверки в коде жило 570 мест с сырым кеглем, включая 14 разных
 * значений и половинные 9.5/10.5/12.5/14.5. Шкала была документом, а не
 * правилом: удержать §1.6 при таком разбросе нельзя даже теоретически.
 *
 * Поэтому правило принуждается механически, как и «одна рамка на область»
 * (index.css схлопывает `.card .card`): сырой кегль — ошибка сборки, а не
 * замечание в ревью.
 *
 * ИСКЛЮЧЕНИЕ — печатная шпаргалка. `.cheatsheet-*` и `.dnd-cheatsheet-*`
 * верстаются в миллиметрах под бумагу, с захардкоженными бумажными цветами;
 * экранная шкала им не указ. Список исключений намеренно короткий и
 * перечислен здесь, а не размазан по коду.
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

const offenders = [];

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

  if (path.endsWith(".css")) {
    // Разбираем по правилам, чтобы знать селектор и простить шпаргалке.
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = rule.exec(text))) {
      const selector = m[1].replace(/\s+/g, " ").trim();
      if (ALLOW_SELECTOR.test(selector)) continue;
      const hit = /font-size:\s*[0-9.]+px/.exec(m[2]);
      if (!hit) continue;
      const line = text.slice(0, m.index + m[2].indexOf(hit[0])).split("\n").length;
      offenders.push(`${rel}:${line}  ${selector.slice(0, 48)} — ${hit[0]}`);
    }
  } else {
    const re = /fontSize:\s*([0-9.]+)\b/g;
    let m;
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split("\n").length;
      offenders.push(`${rel}:${line}  fontSize: ${m[1]}`);
    }
  }
}

walk(ROOT);

if (offenders.length) {
  console.error("Кегль мимо шкалы — " + offenders.length + " мест:\n");
  for (const o of offenders) console.error("  " + o);
  console.error(
    "\nШкала: var(--fs-micro) 10 · var(--fs-meta) 12 · var(--fs-h3) 16 · var(--fs-h2) 26" +
      "\nПлюс var(--fs-h1) / var(--fs-hero) / var(--fs-stat) для крупного и чисел." +
      "\nСм. комментарий к шкале в client/src/index.css."
  );
  process.exit(1);
}

console.log("Шкала кегля: сырых значений нет.");
