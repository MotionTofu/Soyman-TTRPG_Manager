// Разбирает текстовые наборы стартового снаряжения классов и предысторий
// («2 Кинжала, Секира, Набор путешественника и 15 ЗМ») в ссылки на записи
// раздела «Снаряжение» — чтобы «взять набор А» могло положить вещи в
// инвентарь, а не оставлять игрока перепечатывать список руками.
//
//   npx tsx src/scripts/migrateStartingEquipment.ts          — отчёт
//   npx tsx src/scripts/migrateStartingEquipment.ts --apply  — записать
//
// Исходный текст остаётся: он читается лучше любого списка ссылок, а всё,
// что не опозналось, только в нём и хранится.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

interface EquipmentPick {
  entryId: number;
  name: string;
  qty: number;
}

// Названия в тексте стоят в любом падеже и числе («2 Кинжала», «4 Одноручных
// топора»), а в компендиуме — в именительном единственном. Сравниваем по
// основе: отбрасываем у обоих окончание, поскольку склонение русского
// существительного его не трогает.
// Основа — фиксированные первые пять букв, а не «длина минус окончание»:
// при плавающей длине «Кинжал» давал «кинжа», а «Кинжала» — «кинжал», и
// одно и то же слово переставало совпадать само с собой.
function stem(word: string): string {
  return word.toLowerCase().replace(/ё/g, "е").slice(0, 5);
}

function normalizeName(name: string): string {
  // Английский хвост в скобках на сопоставление не влияет.
  return name.replace(/\[[^\]]*\]/g, "").replace(/\([^)]*\)/g, "").trim();
}

function stemKey(name: string): string {
  return normalizeName(name)
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .join(" ");
}

// «2 Кинжала» → количество 2 и остаток названия. «Секира» → 1.
function splitQty(part: string): { qty: number; text: string } {
  const m = /^(\d+)\s+(.*)$/.exec(part.trim());
  if (m) return { qty: Number(m[1]), text: m[2].trim() };
  return { qty: 1, text: part.trim() };
}

function parseGold(text: string): string {
  const m = /(\d+)\s*ЗМ/i.exec(text);
  return m ? m[1] : "";
}

function run(): void {
  const equipment = db
    .prepare("SELECT id, name, system_id FROM compendium_entries WHERE kind IN ('equipment','magic_item')")
    .all() as { id: number; name: string; system_id: number }[];

  // Индекс по основе названия, отдельный для каждой системы.
  const index = new Map<string, { id: number; name: string }>();
  for (const e of equipment) index.set(`${e.system_id}|${stemKey(e.name)}`, { id: e.id, name: e.name });

  const rows = db
    .prepare(
      "SELECT id, name, kind, system_id, data FROM compendium_entries WHERE kind IN ('class','background') ORDER BY kind, name"
    )
    .all() as { id: number; name: string; kind: string; system_id: number; data: string }[];

  const updates: { id: number; data: string }[] = [];
  let matched = 0;
  const unmatched: string[] = [];

  console.log("\n=== Стартовое снаряжение: сухой прогон ===\n");

  for (const row of rows) {
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    let touched = false;

    for (const slot of ["a", "b"] as const) {
      const text = typeof data[`equipment_${slot}`] === "string" ? (data[`equipment_${slot}`] as string) : "";
      if (!text.trim()) continue;

      const picks: EquipmentPick[] = [];
      const misses: string[] = [];
      // Разделители — запятая и «и» перед последним пунктом; хвост «15 ЗМ»
      // уходит в отдельное поле, а не в список вещей.
      for (const rawPart of text.split(/[,;]|\sи\s/)) {
        const part = rawPart.trim().replace(/[.;]+$/, "");
        if (!part || /^\d+\s*ЗМ$/i.test(part)) continue;
        const { qty, text: nameText } = splitQty(part);
        const hit = index.get(`${row.system_id}|${stemKey(nameText)}`);
        if (hit) {
          picks.push({ entryId: hit.id, name: hit.name, qty });
          matched += 1;
        } else {
          misses.push(nameText);
        }
      }

      data[`equipment_${slot}_items`] = picks;
      const gold = parseGold(text);
      if (gold) data[`equipment_${slot}_gold`] = gold;
      touched = true;

      if (picks.length > 0 || misses.length > 0) {
        console.log(`  ${row.name} · набор ${slot.toUpperCase()}`);
        if (picks.length > 0) console.log(`      опознано: ${picks.map((p) => `${p.qty}× ${p.name}`).join(", ")}`);
        if (misses.length > 0) {
          console.log(`      не найдено: ${misses.join(", ")}`);
          unmatched.push(...misses);
        }
        if (gold) console.log(`      золото: ${gold} ЗМ`);
      }
    }
    if (touched) updates.push({ id: row.id, data: JSON.stringify(data) });
  }

  const uniqueMisses = [...new Set(unmatched)];
  console.log(`\n  опознано позиций: ${matched}`);
  console.log(`  не найдено (уникальных): ${uniqueMisses.length}`);
  console.log("\n  Ненайденное остаётся в текстовом описании набора и добавляется вручную в редакторе.");

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.data, u.id);
  })(updates);
  console.log(`\nЗаписано записей: ${updates.length}.`);
}

run();
