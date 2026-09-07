import Database from "better-sqlite3";
import { migrateDndReplicaColumnRoles } from "../db/dndReplicaSchemes";

// Одноразовый прогон догоняющей миграции ролей колонок реплик.
// Использование: npx tsx src/scripts/runReplicaColumnRoles.ts [path-to-db]
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath);
try {
  migrateDndReplicaColumnRoles(db);
  const flag = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("dnd_replica_columns_typed") as
    | { value: string }
    | undefined;
  console.log(`[run] flag dnd_replica_columns_typed = ${flag?.value ?? "(missing)"}`);
} finally {
  db.close();
}
