import Database from "better-sqlite3";

// Проверка грантов короткого отдыха: данные + арифметика применения.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  for (const id of [12706, 12813]) {
    const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(id) as { name: string; data: string };
    console.log(`[${id}]`, row.name, "cost =", JSON.stringify((JSON.parse(row.data) as { cost?: unknown }).cost));
  }
  // used=2 из max=3 (INT 16): +1 -> 1; full -> 0.
  const apply = (used: number, amount: number | "full") => (amount === "full" ? 0 : Math.max(0, used - amount));
  console.log("short +1:", apply(2, 1), "| full:", apply(2, "full"), "| empty pool:", apply(0, 1));
} finally {
  db.close();
}
