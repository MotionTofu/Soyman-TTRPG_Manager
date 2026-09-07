import Database from "better-sqlite3";

// Проверка таблицы эликсиров.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = 12243").get() as { name: string; data: string };
  const t = (JSON.parse(row.data) as { elixirTable?: { key: string; name: string; short: string }[] }).elixirTable;
  console.log(`[${row.name}] rows=${t?.length ?? 0}`);
  for (const r of t ?? []) console.log(`  ${r.key}: ${r.name} — ${r.short}`);
  console.log(t?.length === 6 ? "OK" : "FAIL");
} finally {
  db.close();
}
