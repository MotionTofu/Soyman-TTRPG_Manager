// Стоимость накладывания у заклинаний: заклинание тратит ячейку своего круга,
// заговор не тратит ничего.
//
//   npx tsx src/scripts/fixSpellCost.ts          — отчёт
//   npx tsx src/scripts/fixSpellCost.ts --apply  — записать
//
// Это правило системы, а не свойство конкретного заклинания, поэтому его и
// выводит импортёр (см. spellData в systemApply.ts). Скрипт нужен для того,
// что заведено раньше: часть заклинаний осталась вовсе без стоимости, а
// заговорам старая миграция проставила ячейку, которой у них нет.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: number;
  name: string;
  level: number | null;
  data: string;
  system: string;
}

function run(): void {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.level, e.data, s.name AS system
         FROM compendium_entries e JOIN systems s ON s.id = e.system_id
        WHERE e.kind = 'spell' ORDER BY s.name, e.level, e.name`
    )
    .all() as Row[];

  const updates: { id: number; data: string }[] = [];
  const report: Record<string, string[]> = {};

  for (const row of rows) {
    // Круг неизвестен — не угадываем: заклинание без уровня заведено криво, и
    // приписать ему ячейку значит закрепить ошибку.
    if (row.level == null) continue;
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const current = (data.cost as { kind?: string } | undefined)?.kind ?? null;
    const wanted = row.level === 0 ? "none" : "spell_slot";
    if (current === wanted) continue;

    const what = current === null ? "стоимости не было" : `было «${current}»`;
    const bucket = `${row.level === 0 ? "заговоры" : "заклинания"}: ${what} → «${wanted}»`;
    (report[bucket] ??= []).push(`${row.name} (${row.system})`);

    data.cost = { kind: wanted };
    updates.push({ id: row.id, data: JSON.stringify(data) });
  }

  console.log("\n=== Стоимость заклинаний: сухой прогон ===\n");
  for (const [bucket, names] of Object.entries(report)) {
    console.log(`  ${bucket} — ${names.length}`);
    console.log(`      ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}`);
  }
  console.log(`\n  всего к правке: ${updates.length} из ${rows.length}`);

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.data, u.id);
  })(updates);
  console.log(`\nЗаписано: ${updates.length}.`);
}

run();
