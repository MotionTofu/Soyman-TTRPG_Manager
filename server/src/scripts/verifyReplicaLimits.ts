import Database from "better-sqlite3";
import { columnsAtLevel } from "../../../client/src/components/dnd/progression";
import { replicaLimits } from "../../../client/src/components/dnd/dndResources";

// Проверка: лимиты реплик Артефактора считаются из живой БД.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT data FROM compendium_entries WHERE id = 12812").get() as { data: string };
  const data = JSON.parse(row.data) as {
    progression: import("../../../client/src/components/dnd/progression").ClassProgression;
    replicate_schemes: { entryId: number; minLevel: number }[];
  };
  for (const level of [1, 2, 6, 10, 14, 20]) {
    const out = replicaLimits([
      {
        entry: { classId: 12812, className: "Артефактор", level } as never,
        progression: data.progression,
        replicateSchemes: data.replicate_schemes,
      },
    ]);
    const lim = out[0];
    console.log(
      `level ${level}: ${lim ? `schemes=${lim.schemes} items=${lim.items} available=${lim.available.length}` : "(no block)"}`
    );
  }
  // Санити: колонки по ролям находятся
  console.log("by-role check:", JSON.stringify(columnsAtLevel(data.progression, 2, "replica_schemes").map((c) => c.value)));
} finally {
  db.close();
}
