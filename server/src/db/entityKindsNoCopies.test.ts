import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Страж против новых копий реестра.
 *
 * Реестр видов сам по себе не мешает завтра написать в новом роуте
 * `const TABLES = { character: "characters", ... }` — а именно так и
 * появились те двадцать пять карт, которые разошлись между собой и стоили
 * утечки личных данных в сборочный артефакт.
 *
 * Тест ищет литералы вида `<ключ>: "<таблица>"`, где ключ — вид сущности из
 * реестра, а значение — его таблица. Законные локальные копии помечаются
 * строкой-комментарием над литералом:
 *
 *     // entity-kinds: локальная копия намеренно — <причина>
 *
 * Пометка стоит рядом с кодом, а не в списке в стороне: список протухает
 * ровно так же, как протухли карты.
 */
const SRC = path.join(__dirname, "..");
const MARKER = "entity-kinds:";

/** Пары «вид → таблица», по которым узнаётся копия реестра. */
const PAIRS: [string, string][] = [
  ["campaign", "campaigns"],
  ["setting", "settings"],
  ["player", "players"],
  ["character", "characters"],
  ["location", "setting_locations"],
  ["being", "setting_beings"],
  ["community", "setting_communities"],
  ["artifact", "artifacts"],
  ["resource", "resources"],
  ["mastering", "mastering_notes"],
  ["session", "sessions"],
  ["compendium_entry", "compendium_entries"],
  ["scene", "story_scenes"],
  ["adventure", "story_arcs"],
  ["setting_event", "setting_calendar_events"],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("карты «вид → таблица» не заводятся заново", () => {
  it("страж вообще что-то видит", () => {
    // Иначе тест ничего не сканирует и проходит вхолостую — так уже вышло с
    // первой версией проверки схемы.
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(50);
    const registry = fs.readFileSync(path.join(SRC, "db", "entityKinds.ts"), "utf-8");
    for (const [, table] of PAIRS) expect(registry).toContain(`"${table}"`);
  });

  it("переведённые на реестр файлы своих карт не держат", () => {
    // Жёстко: эти файлы в реестр уже переведены, и возврат литерала сюда —
    // регресс, а не «ещё не дошли руки».
    const CONVERTED = [
      "services/orphans.ts",
      "routes/archive.ts",
      "routes/health.ts",
      "scripts/buildSeed.ts",
      "scripts/sweepDryRun.ts",
    ];
    expect(findCopies().filter((o) => CONVERTED.some((f) => o.startsWith(f)))).toEqual([]);
  });

  it("новых копий не появилось", () => {
    // Базовая линия, а не ноль: по решению от 2026-09-10 на реестр переведён
    // путь удаления и выгрузки, а читающие места (импорт, поиск, упоминания,
    // канвас, story) переводятся следующим заходом. Красный с рождения тест
    // читать перестают, поэтому фиксируем список как есть — рост списка и
    // будет сигналом, что завели новую копию.
    expect(findCopies()).toMatchSnapshot();
  });
});

/** Файлы и строки, где заведена своя карта «вид → таблица». */
function findCopies(): string[] {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    if (rel === "db/entityKinds.ts") continue;
    const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const hit = PAIRS.some(([k, t]) =>
        new RegExp(`\\b${k}["']?:\\s*\\{?\\s*(table:\\s*)?["']${t}["']`).test(lines[i])
      );
      if (!hit) continue;
      // Пометка ищется в пяти строках над литералом: карта обычно объявляется
      // блоком, и комментарий стоит над всем блоком.
      if (lines.slice(Math.max(0, i - 5), i).join("\n").includes(MARKER)) continue;
      offenders.push(`${rel}:${i + 1}  ${lines[i].trim().slice(0, 90)}`);
    }
  }
  return offenders.sort();
}
