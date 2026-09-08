import Database from "better-sqlite3";

// Проверка оракула: пул, дубли, идемпотентность.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT data FROM compendium_entries WHERE id = 12812").get() as { data: string };
  const pool = (JSON.parse(row.data) as { oracle_quotes?: unknown }).oracle_quotes;
  const list = Array.isArray(pool) ? pool as string[] : [];
  const norm = (s: string) => s.trim().replace(/^«+|»+$/g, "").trim().toLowerCase();
  const seen = new Set<string>();
  let dups = 0;
  for (const q of list) {
    const n = norm(q);
    if (seen.has(n)) dups++;
    seen.add(n);
  }
  console.log(`pool=${list.length} dups=${dups}`);
  console.log(list.length === 107 && dups === 0 ? "OK" : "FAIL");
} finally {
  db.close();
}
