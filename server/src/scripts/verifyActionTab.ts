import Database from "better-sqlite3";
import { featuresFromEntries } from "../../../client/src/components/dnd/dndFeatures";
import { checksLabel, costSummary, effectsLabel, resolveLevelDice, type DndCheck, type DndCost, type DndEffect } from "../../../client/src/components/dnd/effects";

// Симуляция вкладки Действия: какие строки видит артефактор на уровнях.
const db = new Database("data/app.db", { readonly: true });
try {
  const raw = db.prepare("SELECT id, parent_id, name, level, position, description, data FROM compendium_entries WHERE id=12812 OR parent_id=12812 OR parent_id IN (12843,12870,12895,12919,12942)").all() as { id: number; parent_id: number; name: string; level: number; position: number; description: string; data: string }[];
  const all = raw.map((r) => ({ ...r, data: JSON.parse(r.data || "{}") })) as never[];
  const byParent = new Map<number, never[]>();
  for (const e of all as never as { parent_id: number }[]) {
    const l = byParent.get(e.parent_id) ?? [];
    l.push(e as never);
    byParent.set(e.parent_id, l);
  }
  const sub = Number(process.argv[3] ?? 12870);
  for (const artLevel of [3, 6, 9, 15, 20].map(Number)) {
    const feats = [
      ...featuresFromEntries((byParent.get(12812) ?? []) as never[], 12812, artLevel),
      ...featuresFromEntries((byParent.get(sub) ?? []) as never[], sub, artLevel),
    ];
    console.log(`===== ARTILLERIST ${artLevel} (${feats.length} features) =====`);
    const groups = new Map<string, string[]>();
    for (const f of feats as never as { name: string; castingTiming?: string; castingTimingOther?: string; checks?: DndCheck[]; effects?: DndEffect[]; cost?: DndCost }[]) {
      if (!f.castingTiming) continue;
      const bonus = checksLabel(f.checks ?? [], 7, 15);
      const dmg = effectsLabel(resolveLevelDice(f.effects ?? [], artLevel), f.checks ?? []);
      const cost = costSummary(f.cost) ?? "—";
      const when = f.castingTiming === "other" ? `Иное${f.castingTimingOther ? ` (${f.castingTimingOther})` : ""}` : f.castingTiming;
      const line = `${f.name} | ${bonus} | ${dmg} | ${cost}`;
      const g = groups.get(when) ?? [];
      g.push(line);
      groups.set(when, g);
    }
    for (const [k, v] of groups) {
      console.log(` -- ${k} --`);
      for (const l of v) console.log("   " + l);
    }
  }
} finally {
  db.close();
}
