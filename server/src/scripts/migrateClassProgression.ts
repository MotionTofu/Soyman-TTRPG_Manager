// Разбирает markdown-таблицу прогрессии каждого класса в структуру
// data.progression (см. client/src/components/dnd/progression.ts). Исходный
// текст остаётся на месте: он читаемый, и пока структура не проверена
// глазами, терять его нельзя.
//
//   npx tsx src/scripts/migrateClassProgression.ts          — отчёт
//   npx tsx src/scripts/migrateClassProgression.ts --apply  — записать

import { db } from "../db/db";
import { parseProgressionTable, type ClassProgression } from "../../../client/src/components/dnd/progression";

const APPLY = process.argv.includes("--apply");

function describe(p: ClassProgression): string {
  const roles = p.columns.filter((c) => c.role && c.role !== "resource").length;
  const resources = p.columns.filter((c) => c.role === "resource").map((c) => c.label);
  const slots = p.columns.filter((c) => c.role.startsWith("slot")).length;
  return `строк ${String(p.rows.length).padStart(2)} · колонок ${String(p.columns.length).padStart(2)} · ячеек ${slots} · распознано ${roles}${
    resources.length ? ` · ресурсы: ${resources.join(", ")}` : ""
  }`;
}

function run(): void {
  const system = db.prepare("SELECT id FROM systems WHERE name = 'D&D 5.5'").get() as { id: number } | undefined;
  if (!system) {
    console.error("Система «D&D 5.5» не найдена.");
    process.exit(1);
  }
  const rows = db
    .prepare("SELECT id, name, data FROM compendium_entries WHERE system_id = ? AND kind = 'class' ORDER BY name")
    .all(system.id) as { id: number; name: string; data: string }[];

  const updates: { id: number; data: string }[] = [];
  const problems: string[] = [];

  console.log("\n=== Прогрессия классов: сухой прогон ===\n");
  for (const row of rows) {
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const table = typeof data.progression_table === "string" ? data.progression_table : "";
    const parsed = parseProgressionTable(table);
    console.log(`  ${row.name.padEnd(26)} ${describe(parsed)}`);

    if (parsed.rows.length === 0) {
      problems.push(`${row.name}: таблица не разобрана`);
      continue;
    }
    if (parsed.rows.length !== 20) {
      problems.push(`${row.name}: строк ${parsed.rows.length}, а уровней должно быть 20`);
    }
    if (!parsed.columns.some((c) => c.role === "level")) {
      problems.push(`${row.name}: не найдена колонка уровня`);
    }
    data.progression = parsed;
    updates.push({ id: row.id, data: JSON.stringify(data) });
  }

  if (problems.length > 0) {
    console.log("\n— требует внимания —");
    for (const p of problems) console.log(`  ${p}`);
  }

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.data, u.id);
  })(updates);
  console.log(`\nЗаписано классов: ${updates.length}.`);
}

run();
