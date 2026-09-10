/**
 * «До и после» по бонусу инициативы на живых листах.
 *
 * До: что лежит в поле `initiative` листа (вписанный руками модификатор).
 * После: что отдаст `deriveSheet` — Ловкость плюс размеченные прибавки от
 * умений и надетых вещей, минус истощение.
 *
 * Умения на листе своих эффектов не хранят: в JSON у них только имя и
 * `entryId`, а живые поля подставляются из записи справочника при отрисовке
 * (`resolveFeature` в чарнике). Поэтому здесь делается ровно то же — иначе
 * отчёт показал бы бонус без прибавок и соврал бы в меньшую сторону.
 *
 * Только чтение. Запуск:  npx tsx src/scripts/initiativeBeforeAfter.ts
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { normalizeDndCharacter, deriveSheet } from "@soyman/shared";
import type { DndCharacterData, DndFeature } from "@soyman/shared";

function main() {
  const serverDir = path.join(__dirname, "..", "..");
  const registryPath = path.join(serverDir, "config", "storages.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const active =
    registry.storages.find((s: { id: string }) => s.id === registry.activeId) ?? registry.storages[0];
  const db = new Database(path.join(active.dbDir, "app.db"), { readonly: true, fileMustExist: true });

  const entry = db.prepare("SELECT data FROM compendium_entries WHERE id = ?");
  /** Подмешивает эффекты записи справочника, как это делает чарник. */
  function resolve(f: DndFeature): DndFeature {
    if (typeof f.entryId !== "number") return f;
    const row = entry.get(f.entryId) as { data: string } | undefined;
    if (!row) return f;
    try {
      const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
      return { ...f, effects: (data.effects as DndFeature["effects"]) ?? [] };
    } catch {
      return f;
    }
  }

  const rows = db
    .prepare(
      `SELECT s.id, s.owner_id, s.content, c.character_name AS character_name
         FROM statblocks s LEFT JOIN characters c ON c.id = s.owner_id
        WHERE s.format = 'dnd_character' AND s.owner_type = 'character'
        ORDER BY s.id`
    )
    .all() as { id: number; owner_id: number; content: string; character_name: string | null }[];

  console.log("лист | персонаж | было (поле) | стало (бонус) | из чего");
  console.log("-".repeat(96));
  let changed = 0;
  for (const row of rows) {
    let c: DndCharacterData;
    try {
      c = normalizeDndCharacter(JSON.parse(row.content || "{}"));
    } catch {
      console.log(`${row.id} | ${row.character_name ?? "?"} | НЕ РАЗОБРАЛСЯ`);
      continue;
    }
    const resolved: DndCharacterData = {
      ...c,
      speciesFeatures: c.speciesFeatures.map(resolve),
      classFeatures: c.classFeatures.map(resolve),
      feats: c.feats.map(resolve),
      specialAbilities: c.specialAbilities.map(resolve),
    };
    const sheet = deriveSheet(resolved);
    // «Было» берётся из СЫРОГО json: поле сменило и тип, и смысл, а нормализация
    // уже приводит его к новому виду — сравнивать после неё значит сравнивать
    // с самим собой.
    const raw = (JSON.parse(row.content || "{}") as { initiative?: unknown }).initiative;
    const before = raw == null ? "" : String(raw).trim();
    const after = sheet.initiative.value;
    const beforeNum = before === "" ? null : Number(before.replace("+", ""));
    const same = beforeNum !== null && Number.isFinite(beforeNum) && beforeNum === after;
    const parts = sheet.initiative.parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`);
    const mark = before === "" ? "было пусто" : same ? "совпало" : "РАЗОШЛОСЬ";
    if (!same) changed++;
    console.log(
      `${row.id} | ${(row.character_name ?? "?").padEnd(18)} | ${(before || "—").padStart(5)} | ` +
        `${(after >= 0 ? "+" : "") + after} | ${parts.join(", ")}   ← ${mark}`
    );
  }
  console.log("-".repeat(96));
  console.log(`Листов: ${rows.length}. Число изменится у ${changed}.`);

  // Прибавки вообще: сколько записей справочника уже размечены под инициативу.
  const marked = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM compendium_entries WHERE data LIKE '%"appliesTo":"initiative"%'`
      )
      .get() as { c: number }
  ).c;
  console.log(`Записей справочника с разметкой под инициативу: ${marked} (разметка — отдельный шаг).`);
  db.close();
}

main();
