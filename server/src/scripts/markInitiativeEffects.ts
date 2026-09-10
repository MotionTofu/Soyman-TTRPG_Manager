/**
 * Разметка записей справочника 5.5 под бонус инициативы.
 *
 * Ставит `appliesTo: "initiative"` и величину тем умениям, которые по правилам
 * дают ЧИСЛО к броску инициативы. Преимущество числом не является и не
 * размечается: «Дикий инстинкт», «Выдающийся атлет» и одиннадцать магических
 * предметов дают преимущество, а не прибавку.
 *
 * Пишет в рабочую базу. Прежние значения `data` сохраняются в файл рядом —
 * откат возможен. Без `--apply` только показывает, что сделал бы.
 *
 *   npx tsx src/scripts/markInitiativeEffects.ts           — показать
 *   npx tsx src/scripts/markInitiativeEffects.ts --apply   — записать
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { DndEffect } from "@soyman/shared";

interface Mark {
  id: number;
  name: string;
  /** Что именно даёт умение — попадает в свободный текст модификатора. */
  modifier: string;
  effect: Pick<DndEffect, "appliesTo" | "flat" | "proficiency">;
  why: string;
}

const MARKS: Mark[] = [
  {
    id: 12000,
    name: "Бдительный",
    modifier: "бонус мастерства к броску инициативы",
    effect: { appliesTo: "initiative", proficiency: "full" },
    why: "«Владение инициативой»: когда вы совершаете бросок инициативы, вы можете добавить к броску свой бонус мастерства",
  },
  {
    id: 12307,
    name: "Мастер на все руки",
    modifier: "половина бонуса мастерства к броску инициативы",
    effect: { appliesTo: "initiative", proficiency: "half" },
    why: "половина бонуса мастерства к любой проверке характеристики без владения; инициатива в 5.5 — проверка Ловкости",
  },
];

function main() {
  const apply = process.argv.includes("--apply");
  const serverDir = path.join(__dirname, "..", "..");
  const registry = JSON.parse(fs.readFileSync(path.join(serverDir, "config", "storages.json"), "utf-8"));
  const active =
    registry.storages.find((s: { id: string }) => s.id === registry.activeId) ?? registry.storages[0];
  const dbPath = path.join(active.dbDir, "app.db");
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
  console.log("База:", dbPath, apply ? "(ЗАПИСЬ)" : "(только показ)");
  console.log("");

  const backup: Record<number, string> = {};
  const get = db.prepare("SELECT id, kind, name, data FROM compendium_entries WHERE id = ?");
  const update = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

  for (const mark of MARKS) {
    const row = get.get(mark.id) as { id: number; kind: string; name: string; data: string } | undefined;
    if (!row) {
      console.log(`[${mark.id}] НЕ НАЙДЕНА — пропуск`);
      continue;
    }
    if (row.name.trim() !== mark.name) {
      // Id записи справочника не вечен: система переимпортируется. Имя —
      // страховка от того, чтобы разметить чужую запись.
      console.log(`[${mark.id}] имя не совпало: в базе «${row.name}», ожидалось «${mark.name}» — пропуск`);
      continue;
    }
    backup[row.id] = row.data;
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    const effects = Array.isArray(data.effects) ? (data.effects as DndEffect[]) : [];
    const already = effects.find((e) => e.type === "roll_modifier" && e.appliesTo === "initiative");
    if (already) {
      console.log(`[${row.id}] ${row.name} — уже размечена, пропуск`);
      continue;
    }
    const effect: DndEffect = {
      id: `init-${row.id}`,
      type: "roll_modifier",
      when: "always",
      modifier: mark.modifier,
      ...mark.effect,
    };
    data.effects = [...effects, effect];
    console.log(`[${row.id}] ${row.kind} «${row.name}»`);
    console.log(`   было:  effects = ${JSON.stringify(effects)}`);
    console.log(`   стало: + ${JSON.stringify(effect)}`);
    console.log(`   почему: ${mark.why}`);
    console.log("");
    if (apply) update.run(JSON.stringify(data), row.id);
  }

  if (apply) {
    const file = path.join(serverDir, `initiative-marks-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf-8");
    console.log("Прежние значения сохранены:", file);
  } else {
    console.log("Ничего не записано. Повторите с --apply.");
  }
  db.close();
}

main();
