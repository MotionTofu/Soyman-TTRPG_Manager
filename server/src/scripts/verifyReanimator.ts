import Database from "better-sqlite3";
import { featuresFromEntries } from "../../../client/src/components/dnd/dndFeatures";
import { checksLabel, costSummary, effectsLabel, resolveLevelDice, type DndCheck, type DndCost, type DndEffect } from "../../../client/src/components/dnd/effects";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { companionStats, blueprintFromEntryData } from "../../../client/src/components/dnd/companionFormula";

// Проверка Реаниматора: подкласс, гранты, строки, пулы, тело.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const sub = db.prepare("SELECT id, name, data FROM compendium_entries WHERE parent_id = 12812 AND name = 'Реаниматор'").get() as { id: number; name: string; data: string } | undefined;
  console.log("subclass:", sub?.id, sub?.name);
  const gs = (JSON.parse(sub?.data ?? "{}") as { granted_spells?: { id: number; name: string; grantLevel: number }[] }).granted_spells ?? [];
  console.log(`grants: ${gs.length}:`, gs.map((g) => `${g.name}@${g.grantLevel}`).join(", "));
  let dead = 0;
  for (const g of gs) {
    if (!db.prepare("SELECT id FROM compendium_entries WHERE id = ?").get(g.id)) { dead++; console.log("DEAD:", g); }
  }
  console.log("dead links:", dead);
  const rawKids = db.prepare("SELECT id, name, level, position, description, data FROM compendium_entries WHERE parent_id = ? ORDER BY level, position").all(sub!.id) as { id: number; name: string; level: number; position: number; description: string; data: string }[];
  const kids = rawKids.map((r) => ({ ...r, data: JSON.parse(r.data || "{}") })) as never[];
  console.log(`children: ${kids.length}`);
  const feats = featuresFromEntries(kids, sub!.id, 15);
  const abilities = { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 };
  for (const f of feats as never as { name: string; castingTiming?: string; castingTimingOther?: string; checks?: DndCheck[]; effects?: DndEffect[]; cost?: DndCost }[]) {
    if (!f.castingTiming) continue;
    console.log(`[${f.castingTiming}${f.castingTimingOther ? ` (${f.castingTimingOther})` : ""}] ${f.name} | ${checksLabel(f.checks ?? [], 7, 15)} | ${effectsLabel(resolveLevelDice(f.effects ?? [], 15), f.checks ?? [])} | ${costSummary(f.cost) ?? "—"}`);
  }
  console.log("pools(INT18):", featurePools(feats as never, abilities).map((p) => `${p.label} max=${p.max}/${p.recharge}`));
  const comp = kids.find((k) => (k as { name: string }).name === "Реанимированный спутник") as never as { id: number };
  const bp = blueprintFromEntryData(JSON.parse((db.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(comp.id) as { data: string }).data) as Record<string, unknown>);
  console.log("blueprint:", JSON.stringify(bp));
  const classes = [{ classId: 12812, level: 7 } as never];
  console.log("body lvl7:", companionStats(bp, classes, 12812, { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 } as never));
} finally {
  db.close();
}
