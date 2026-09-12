#!/usr/bin/env node
/**
 * Барьер шага и толщины обводки.
 *
 * ШАГ. Шкала объявлена в `index.css` — одиннадцать ступеней
 * `--sp-0…--sp-10` = 1/2/4/6/8/12/16/24/32/48/64. Пересобрана 2026-09-12 по
 * замеру, а не взята из документа: прежние восемь ступеней писались до
 * реализации, и самого частого значения приложения — 6px, 240 мест — в них
 * не было вовсе, как и 2px и 10px. Поэтому шкала описывает то, чем
 * приложение построено, и сырой `padding: 10px` теперь действительно
 * означает «мимо системы», а не «система не подходит».
 *
 * ОБВОДКА. Толщина — пара токенов на поверхность: `--card-border-width`
 * (обычная) и `--card-border-width-strong` (усиленная). В приложении обе
 * равны 1px: глубину даёт инверсия и обводка, а не толщина (инвариант §1.2).
 * Поверхность, которой тени запрещены, а глубина нужна, объявляет свою пару
 * у себя — так сделано у Полотна (`canvas.css`) и статблока
 * (`statblock.css`). Замкнутость — правило, состав — дело поверхности.
 *
 * ОТСТУПЛЕНИЕ С ПРИЧИНОЙ. Барьер не запрещает, а требует объяснения. Рядом
 * с правилом:
 *
 *     // шаг мимо шкалы намеренно — <причина>
 *     // обводка мимо шкалы намеренно — <причина>
 *
 * Причина обязана быть непустой. Запрет без выхода перешагивают молча —
 * новое строится раньше, чем его форма попадает в шкалу; метка переводит
 * отступление из нарушения в запись. Тот же приём в
 * `check-type-scale.mjs`, `rasterAssets.ts` и `CONTEXT.md`.
 *
 * ИСКЛЮЧЕНИЕ БЕЗ МЕТКИ — печатная вёрстка: `.cheatsheet-*`, `.dnd-cheatsheet-*`,
 * `.combat-*`, `.fill-box` верстаются в миллиметрах под бумагу.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ALLOW_SELECTOR = /cheatsheet|\.combat-(row|field)|\.fill-box/i;
const EXCUSE_SP = /шаг мимо шкалы намеренно\s*[—-]\s*(\S[^\r\n*]*)/;
const EXCUSE_BW = /обводка мимо шкалы намеренно\s*[—-]\s*(\S[^\r\n*]*)/;

const SPACING = /\b(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?:\s*([^;{}]+);/g;
// Только контур целиком. `border-left: 3px` и подобное — не обводка, а
// полоса-метка или CSS-треугольник: правило «одна толщина» к ним не
// относится, и ловить их значило бы ловить не то.
const BORDER = /\bborder:\s*([0-9.]+)px/;

function reasonIn(chunk, re) {
  const m = re.exec(chunk);
  return m && m[1].trim() ? m[1].trim().replace(/\s*\*\/\s*$/, "").trim() : null;
}

const offenders = [];
const excused = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".css")) check(p);
  }
}

function check(path) {
  const text = readFileSync(path, "utf8");
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(text))) {
    const head = m[1].replace(/\s+/g, " ").trim();
    const selector = head.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
    if (ALLOW_SELECTOR.test(selector)) continue;
    const body = m[2];
    const line = () => text.slice(0, m.index).split("\n").length;

    // Шаг: сырые px в padding/margin/gap. calc(), env(), проценты и 0 — мимо.
    SPACING.lastIndex = 0;
    let s;
    while ((s = SPACING.exec(body))) {
      const value = s[3];
      if (!/(?<![\w-])-?\d+px/.test(value)) continue;
      if (/var\(--(pad|player|app|card)/.test(value) && !/(?<![\w(-])\d+px/.test(value.replace(/var\([^)]*\)/g, ""))) continue;
      const bare = value.replace(/var\([^)]*\)/g, "").replace(/calc\([^)]*\)/g, "");
      if (!/-?\d+px/.test(bare)) continue;
      const where = `${rel}:${line()}  ${selector.slice(0, 44)} — ${s[1]}${s[2] || ""}: ${value.trim()}`;
      const why = reasonIn(head, EXCUSE_SP) ?? reasonIn(body, EXCUSE_SP);
      if (why) excused.push(`${where}\n      причина: ${why}`);
      else offenders.push(where);
    }

    // Обводка: сырая толщина вместо токена.
    // Сырой `1px` — то же число, что в :root, дрейфа не даёт; ловим
    // промежуточные толщины, из-за которых «одна рамка» и разъезжалась.
    // Перевод литеральных 1px на токен — отдельная работа, см. ToDo/01.
    // Коробка нулевого размера с толстой рамкой — это CSS-треугольник
    // (носик поповера, каретка), а не обводка. Форма, а не контур.
    const isTriangle = /\bwidth:\s*0\b/.test(body) && /\bheight:\s*0\b/.test(body);
    const b = isTriangle ? null : BORDER.exec(body);
    if (b && b[1] !== "0" && b[1] !== "1") {
      const where = `${rel}:${line()}  ${selector.slice(0, 44)} — border: ${b[1]}px`;
      const why = reasonIn(head, EXCUSE_BW) ?? reasonIn(body, EXCUSE_BW);
      if (why) excused.push(`${where}\n      причина: ${why}`);
      else offenders.push(where);
    }
  }
}

walk(ROOT);

if (excused.length) {
  console.log(`Мимо шкалы, но с названной причиной — ${excused.length}:\n`);
  for (const e of excused) console.log("  " + e);
  console.log("");
}

if (offenders.length) {
  console.error(`Шаг или обводка мимо шкалы — ${offenders.length} мест:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`
Шаг: var(--sp-0) 1 · --sp-1 2 · --sp-2 4 · --sp-3 6 · --sp-4 8 · --sp-5 12
     --sp-6 16 · --sp-7 24 · --sp-8 32 · --sp-9 48 · --sp-10 64
Обводка: var(--card-border-width) и var(--card-border-width-strong);
     поверхность со своей глубиной объявляет пару у себя.

Если отступление осознанное — назовите причину строкой рядом:
  /* шаг мимо шкалы намеренно — <причина> */
  /* обводка мимо шкалы намеренно — <причина> */
Барьер пропустит и сохранит запись, зачем так сделано.`);
  process.exit(1);
}

console.log(`Шаг и обводка: сырых значений нет${excused.length ? ` (${excused.length} с причиной)` : ""}.`);
