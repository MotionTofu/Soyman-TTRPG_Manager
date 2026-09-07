import Database from "better-sqlite3";
import { classPreparedFormula, formulaPreparedLimit, preparedAtLevel } from "../../../client/src/components/dnd/progression";
import { abilityModifier, parseAbilityNames } from "../../../client/src/components/dnd/AbilityScores";

// Проверка формульного лимита подготовленных: маркер из БД + расчёт.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT data FROM compendium_entries WHERE id = 12812").get() as { data: string };
  const data = JSON.parse(row.data) as {
    progression: Parameters<typeof preparedAtLevel>[0];
    spellcasting_ability?: unknown;
    prepared_formula?: unknown;
  };
  console.log("marker:", data.prepared_formula, "| spellcasting:", data.spellcasting_ability);
  const formula = classPreparedFormula(data as unknown as Record<string, unknown>);
  const key = parseAbilityNames(data.spellcasting_ability)[0];
  console.log("formula:", formula, "| ability key:", key);
  if (!formula || !key) {
    console.log("NO FORMULA PATH — table fallback would apply");
    process.exit(1);
  }
  for (const [level, int] of [[1, 8], [3, 18], [5, 16], [20, 20]] as const) {
    const table = preparedAtLevel(data.progression, level);
    const mod = abilityModifier(int);
    const calc = formulaPreparedLimit(formula, level, mod);
    console.log(`art ${level}, INT ${int} (mod ${mod >= 0 ? "+" : ""}${mod}): formula=${calc} table=${table}`);
  }
} finally {
  db.close();
}
