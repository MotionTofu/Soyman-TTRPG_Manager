// Разделяет колонки, которым разбор markdown огульно выдал роль
// «Расходуемый ресурс», на действительно расходуемые пулы и просто
// показатели по уровню.
//
//   npx tsx src/scripts/reclassifyProgressionColumns.ts          — отчёт
//   npx tsx src/scripts/reclassifyProgressionColumns.ts --apply  — записать
//
// Признак простой: пул — это целое число («Ярость 3»), а показатель почти
// всегда несёт что-то ещё («к8», «+2», «1к6», «+10 фт»). Колонки, где
// значение числовое, но тратить нечего (сколько воззваний известно, сколько
// схем изучено), автоматика отличить не может — они перечислены в отчёте
// отдельно, и роль у них правится в редакторе класса одним нажатием.

import { db } from "../db/db";
import type { ClassProgression } from "../../../client/src/components/dnd/progression";

const APPLY = process.argv.includes("--apply");

// Целое число и ничего больше. «3» — пул, «к8», «+2», «1к6» — нет.
function isPlainCount(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

// Числом записано и то, что тратят, и то, что просто «сколько ты знаешь».
// Автоматика их не различает, поэтому известные исключения перечислены здесь
// поимённо. Это разовая правка данных, а не правило приложения: в рантайме
// имён классов и колонок по-прежнему нигде нет, а роль правится в редакторе.
const KNOWN_COUNTS_NOT_POOLS = [
  "известные схемы",
  "магические предметы",
  "оружейное мастерство",
  "таинств. воззвания",
  "таинственные воззвания",
];

function classify(progression: ClassProgression, columnKey: string): "resource" | "stat" {
  const values = progression.rows
    .map((r) => (r[columnKey] ?? "").trim())
    .filter((v) => v && v !== "-" && v !== "—");
  if (values.length === 0) return "stat";
  return values.every(isPlainCount) ? "resource" : "stat";
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
  console.log("\n=== Роли колонок: сухой прогон ===\n");

  for (const row of rows) {
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const progression = data.progression as ClassProgression | undefined;
    if (!progression?.columns?.length) continue;

    const changes: string[] = [];
    const columns = progression.columns.map((c) => {
      if (c.role !== "resource") return c;
      const role = KNOWN_COUNTS_NOT_POOLS.includes(c.label.trim().toLowerCase())
        ? "stat"
        : classify(progression, c.key);
      if (role !== c.role) changes.push(`${c.label} → показатель`);
      else changes.push(`${c.label} → расходуемый`);
      return { ...c, role };
    });
    if (changes.length === 0) continue;

    console.log(`  ${row.name}`);
    for (const c of changes) console.log(`      ${c}`);
    data.progression = { ...progression, columns };
    updates.push({ id: row.id, data: JSON.stringify(data) });
  }

  console.log(
    "\nПроверьте глазами: числовые колонки вроде «Таинств. воззвания» или\n" +
      "«Известные схемы» считаются расходуемыми, хотя это счётчики известного.\n" +
      "Роль правится в редакторе класса, в шапке колонки."
  );

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
