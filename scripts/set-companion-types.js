// Проставляет тип существа чертежам спутников (`data.companion.type` /
// `data.summon.type`) в компендиуме ДнД 5.5.
//
// Зачем. Подвал спутников на листе персонажа рисует знак типа существа
// (`client/src/components/dnd/creatureTypeIcons.tsx`). Спутники из бестиария
// берут тип из своей записи (`data.creature_type`), а тела по чертежу —
// из самого чертежа, и вот там поля не было ни у одного: пушка, защитник,
// гомункул и реанимированный спутник оставались без знака (решение владельца
// 2026-09-09 — дописать тип чертежам).
//
// Скрипт идемпотентен: уже проставленный тип не трогает и говорит об этом.
// Ничего, кроме одного поля внутри чертежа, не меняет.
//
// Usage:
//   node scripts/set-companion-types.js [--db <путь к app.db>] [--dry]
//
// Без --db берётся активное хранилище из server/config/storages.json.

const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "..");
// Тем же путём, что build-seed.js: свой node_modules у скриптов не заводится.
const Database = require(path.join(repoRoot, "server", "node_modules", "better-sqlite3"));

// Имя чертежа → тип существа. Имена — те, что лежат в самих записях
// компендиума; сверять по ним, а не по id: id у каждой установки свои.
const TYPES = {
  "Мистическая пушка": "Конструкт",
  "Стальной защитник": "Конструкт",
  "Гомункул-слуга": "Конструкт",
  "Реанимированный спутник": "Нежить",
};

function resolveDbPath(argv) {
  const at = argv.indexOf("--db");
  if (at >= 0 && argv[at + 1]) return path.resolve(argv[at + 1]);
  const cfgPath = path.join(repoRoot, "server", "config", "storages.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`не нашёл ${cfgPath} — укажите базу явно: --db <путь к app.db>`);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const list = Array.isArray(cfg.storages) ? cfg.storages : [];
  const active = list.find((s) => s.id === cfg.activeId) ?? list[0];
  if (!active) throw new Error("в storages.json нет ни одного хранилища");
  return path.join(active.dataDir ?? active.path ?? "", "app.db");
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const dbPath = resolveDbPath(argv);
  if (!fs.existsSync(dbPath)) throw new Error(`базы нет: ${dbPath}`);
  console.log(`База: ${dbPath}${dry ? " (--dry, ничего не пишу)" : ""}`);

  const db = new Database(dbPath);
  const rows = db.prepare("SELECT id, name, data FROM compendium_entries").all();
  const update = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

  let changed = 0;
  let already = 0;
  let unknown = 0;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data || "{}");
    } catch {
      continue;
    }
    let dirty = false;
    for (const key of ["companion", "summon"]) {
      const bp = data[key];
      if (!bp || typeof bp !== "object" || Array.isArray(bp)) continue;
      const label = String(bp.name ?? row.name ?? "").trim();
      const want = TYPES[label];
      if (!want) {
        unknown += 1;
        console.log(`  ? ${row.id} «${label}» — типа для этого чертежа в таблице нет, пропускаю`);
        continue;
      }
      if (bp.type === want) {
        already += 1;
        continue;
      }
      bp.type = want;
      dirty = true;
      changed += 1;
      console.log(`  + ${row.id} «${label}» → ${want}`);
    }
    if (dirty && !dry) update.run(JSON.stringify(data), row.id);
  }
  db.close();
  console.log(`Готово: проставлено ${changed}, уже стояло ${already}, без таблицы ${unknown}.`);
}

main();
