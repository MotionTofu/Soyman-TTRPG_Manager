// Проставляет умениям и опциям классов время накладывания, вычитывая его из
// собственного описания: «Бонусным действием вы можете…», «Действием Магия вы
// касаетесь…», «Реакцией…». Без этого поля умение не попадает во вкладку
// «Действия» листа персонажа.
//
//   npx tsx src/scripts/backfillFeatureTiming.ts          — отчёт
//   npx tsx src/scripts/backfillFeatureTiming.ts --apply  — записать
//
// Записи, у которых время уже проставлено, не трогаются: ручная правка важнее
// догадки по тексту.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

// В тексте могут встретиться несколько упоминаний («Бонусным действием вы
// впадаете в Ярость… действий не требует»), поэтому выигрывает то, что
// встретилось РАНЬШЕ: умение почти всегда объявляет свою активацию в первом
// же предложении, а остальное — уже описание последствий.
const PATTERNS: { timing: string; re: RegExp }[] = [
  { timing: "Бонусное действие", re: /бонусны[мх]\s+действи(ем|й)/i },
  { timing: "Реакция", re: /реакцие[йю]|как\s+реакци[яю]|своей\s+реакцией/i },
  { timing: "Действие", re: /(магическим\s+действием|действием\s+магия|действием\s+[а-яё]|как\s+действие)/i },
];

interface Hit {
  timing: string;
  at: number;
  quote: string;
}

function detect(description: string): Hit | null {
  // Разметка **жирным** стоит ровно на этих словах и ломает поиск по фразе.
  const text = (description || "").replace(/\*+/g, "");
  let best: Hit | null = null;
  for (const { timing, re } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const at = m.index;
    if (best === null || at < best.at) {
      best = { timing, at, quote: text.slice(Math.max(0, at - 20), at + 45).replace(/\s+/g, " ").trim() };
    }
  }
  return best;
}

function run(): void {
  const system = db.prepare("SELECT id FROM systems WHERE name = 'D&D 5.5'").get() as { id: number } | undefined;
  if (!system) {
    console.error("Система «D&D 5.5» не найдена.");
    process.exit(1);
  }
  const rows = db
    .prepare(
      "SELECT id, name, data, description FROM compendium_entries WHERE system_id = ? AND kind IN ('feature','class_option')"
    )
    .all(system.id) as { id: number; name: string; data: string; description: string }[];

  const updates: { id: number; data: string }[] = [];
  const byTiming: Record<string, { name: string; quote: string }[]> = {};
  let alreadySet = 0;
  let passive = 0;

  for (const row of rows) {
    const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
    if (data.casting_timing) {
      alreadySet += 1;
      continue;
    }
    const hit = detect(row.description);
    if (!hit) {
      passive += 1;
      continue;
    }
    data.casting_timing = hit.timing;
    updates.push({ id: row.id, data: JSON.stringify(data) });
    (byTiming[hit.timing] ??= []).push({ name: row.name.trim(), quote: hit.quote });
  }

  console.log("\n=== Время накладывания умений: сухой прогон ===\n");
  console.log(`  всего умений и опций            ${rows.length}`);
  console.log(`  время уже проставлено           ${alreadySet}`);
  console.log(`  пассивные (активации в тексте нет) ${passive}`);
  console.log(`  будет проставлено               ${updates.length}`);
  for (const [timing, list] of Object.entries(byTiming)) {
    console.log(`\n— ${timing} (${list.length}) —`);
    for (const item of list.slice(0, 12)) console.log(`  ${item.name}\n      …${item.quote}…`);
    if (list.length > 12) console.log(`  … и ещё ${list.length - 12}`);
  }

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  db.transaction((list: typeof updates) => {
    for (const u of list) stmt.run(u.data, u.id);
  })(updates);
  console.log(`\nЗаписано: ${updates.length}.`);
}

run();
