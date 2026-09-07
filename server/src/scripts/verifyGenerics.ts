import Database from "better-sqlite3";
import { replicaLimits } from "../../../client/src/components/dnd/dndResources";
import type { ClassProgression } from "../../../client/src/components/dnd/progression";

// Проверка общих строк: сид + лимиты по уровням.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT data FROM compendium_entries WHERE id = 12812").get() as { data: string };
  const data = JSON.parse(row.data) as {
    progression: ClassProgression;
    replicate_schemes: { entryId: number; minLevel: number }[];
    replicate_generics?: { id: string; label: string; minLevel: number }[];
  };
  console.log("generics:", JSON.stringify(data.replicate_generics));
  for (const level of [2, 6, 10, 14]) {
    const out = replicaLimits([
      {
        entry: { classId: 12812, className: "Артефактор", level } as never,
        progression: data.progression,
        replicateSchemes: data.replicate_schemes,
        replicateGenerics: data.replicate_generics as never,
      },
    ]);
    console.log(`level ${level}: generics=[${(out[0]?.generics ?? []).map((g) => g.id).join(",")}]`);
  }
} finally {
  db.close();
}
