import Database from "better-sqlite3";
import { computeSpellSlots, effectiveCasterLevel, isRoundUpCaster } from "../../../client/src/components/dnd/dndSlots";
import type { ClassProgression } from "../../../client/src/components/dnd/progression";

// Честная проверка округления на живых таблицах: артефактор 3 + волшебник 1.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const load = (name: string) => {
    const row = db.prepare("SELECT id, data FROM compendium_entries WHERE name = ? AND parent_id IS NULL").get(name) as { id: number; data: string };
    const data = JSON.parse(row.data) as { progression?: ClassProgression; round_up_multiclass?: unknown };
    return { id: row.id, progression: data.progression, roundUp: isRoundUpCaster(data as Record<string, unknown>) };
  };
  const art = load("Артефактор");
  const wiz = load("Волшебник");
  console.log(`artificer id=${art.id} roundUp=${art.roundUp}`);
  const mk = (roundUp: boolean) => [
    { level: 3, progression: art.progression, roundUp },
    { level: 1, progression: wiz.progression },
  ];
  for (const ru of [false, true]) {
    const eff = effectiveCasterLevel(mk(ru));
    const slots = computeSpellSlots(mk(ru), [wiz.progression]);
    console.log(`roundUp=${ru}: effLevel=${eff} slots=[${slots.slots.join(",")}] basis=${slots.basis}`);
  }
  // Контроль: одиночка не меняется (своя строка таблицы).
  const single = computeSpellSlots([{ level: 3, progression: art.progression, roundUp: true }], []);
  console.log(`single art3: slots=[${single.slots.join(",")}] basis=${single.basis}`);
  // Контроль: паладин без флага — вниз как было.
  const pal = load("Паладин");
  console.log(`paladin roundUp=${pal.roundUp} eff(pal3)=${effectiveCasterLevel([{ level: 3, progression: pal.progression }])}`);
} finally {
  db.close();
}
