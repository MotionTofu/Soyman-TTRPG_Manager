// Проставляет умениям на уже созданных листах персонажей ссылку на запись
// компендиума (`entryId`). Поле появилось вместе с переходом на живые данные:
// без него лист не может подтянуть время накладывания и эффекты и продолжает
// показывать то, что было скопировано в него при выборе класса.
//
//   npx tsx src/scripts/backfillFeatureEntryIds.ts          — отчёт
//   npx tsx src/scripts/backfillFeatureEntryIds.ts --apply  — записать
//
// Ищем по паре «родитель + имя»: у автозаполненного умения уже есть
// sourceParentId (id класса, подкласса или вида), а внутри одного родителя
// имена умений уникальны. Умения, вписанные руками (без sourceParentId),
// не трогаем — им не на что ссылаться.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

interface Feature {
  name?: string;
  level?: number | null;
  entryId?: number | null;
  sourceParentId?: number | null;
  [k: string]: unknown;
}

// Имена в листах и в компендиуме расходятся хвостовыми пробелами и точкой
// («Исцеляющие руки. » против «Исцеляющие руки») — это следы ручного ввода,
// а не разные умения.
function normalize(name: string): string {
  return name.trim().replace(/\.\s*$/, "").replace(/\s+/g, " ").toLowerCase();
}

const FEATURE_GROUPS = ["classFeatures", "speciesFeatures", "feats", "specialAbilities"] as const;

function run(): void {
  const entries = db
    .prepare("SELECT id, name, level, parent_id FROM compendium_entries WHERE kind IN ('feature','class_option')")
    .all() as { id: number; name: string; level: number | null; parent_id: number | null }[];

  // Одно и то же имя законно повторяется у одного родителя: «Увеличение
  // характеристик» стоит на 4, 8, 12, 16 и 19 уровнях. Поэтому основной ключ
  // — «родитель|имя|уровень», а ключ без уровня остаётся запасным для
  // листов, где уровень не сохранён.
  const byKey = new Map<string, number>();
  const byParentName = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const e of entries) {
    byKey.set(`${e.parent_id}|${normalize(e.name)}|${e.level ?? ""}`, e.id);
    const loose = `${e.parent_id}|${normalize(e.name)}`;
    if (byParentName.has(loose)) ambiguous.add(e.name.trim());
    else byParentName.set(loose, e.id);
  }

  const sheets = db
    .prepare("SELECT id, content FROM statblocks WHERE format = 'dnd_character'")
    .all() as { id: number; content: string }[];

  const updates: { id: number; content: string }[] = [];
  let linked = 0;
  let already = 0;
  let handAdded = 0;
  const unmatched: string[] = [];

  for (const sheet of sheets) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(sheet.content || "{}");
    } catch {
      continue;
    }
    let touched = false;
    for (const group of FEATURE_GROUPS) {
      const list = data[group];
      if (!Array.isArray(list)) continue;
      for (const f of list as Feature[]) {
        if (f.entryId != null) {
          already += 1;
          continue;
        }
        if (f.sourceParentId == null) {
          handAdded += 1;
          continue;
        }
        const loose = `${f.sourceParentId}|${normalize(String(f.name ?? ""))}`;
        const id =
          (f.level != null ? byKey.get(`${loose}|${f.level}`) : undefined) ?? byParentName.get(loose);
        if (id == null) {
          unmatched.push(`${String(f.name ?? "").trim()} (родитель ${f.sourceParentId})`);
          continue;
        }
        f.entryId = id;
        linked += 1;
        touched = true;
      }
    }
    if (touched) updates.push({ id: sheet.id, content: JSON.stringify(data) });
  }

  console.log("\n=== Ссылки умений на компендиум: сухой прогон ===\n");
  console.log(`  листов D&D                      ${sheets.length}`);
  console.log(`  листов будет изменено           ${updates.length}`);
  console.log(`  умений получит ссылку           ${linked}`);
  console.log(`  ссылка уже была                 ${already}`);
  console.log(`  вписаны руками (пропущено)      ${handAdded}`);
  console.log(`  не нашлось в компендиуме        ${unmatched.length}`);
  if (ambiguous.size > 0) {
    console.log(`\n— имена, повторяющиеся у одного родителя (различаются по уровню) —`);
    for (const c of [...ambiguous].slice(0, 20)) console.log(`  ${c}`);
  }
  if (unmatched.length > 0) {
    console.log(`\n— не нашлось (умение удалили или переименовали в компендиуме) —`);
    for (const u of [...new Set(unmatched)].slice(0, 30)) console.log(`  ${u}`);
  }

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.content, u.id);
  })(updates);
  console.log(`\nЗаписано листов: ${updates.length}.`);
}

run();
