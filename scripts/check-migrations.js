#!/usr/bin/env node
/**
 * Проверка миграций на исторических схемах.
 *
 * Ловит один класс ошибок, который иначе находится только жалобой
 * пользователя: колонку добавили в `schema.sql`, а миграцию в `db.ts` не
 * написали. На новой установке всё хорошо — таблица создаётся сразу с
 * колонкой; на установке, которая обновляется, `CREATE TABLE IF NOT EXISTS`
 * не делает ничего, колонки нет, и первый же запрос отвечает
 * «no such column». Так уже случилось с `canvas_boards.name` и
 * `canvas_nodes.z_index` (28.08.2026).
 *
 * Как проверяет: берёт `schema.sql` из последних N коммитов, для каждой
 * версии заводит пустую базу той эпохи, прогоняет на ней СЕГОДНЯШНИЕ миграции
 * (`openDatabase`) и сверяет получившийся набор колонок с эталоном — базой,
 * созданной из сегодняшней схемы. Расхождение означает недостающую миграцию.
 *
 * Запуск (перед релизом, из корня репозитория):
 *   npm run build:server   # скрипту нужен собранный server/dist
 *   node scripts/check-migrations.js [сколько версий, по умолчанию 15]
 *
 * Код возврата 1, если нашлись расхождения, — годится для CI.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(ROOT, "server", "src", "db", "schema.sql");
const DB_MODULE = path.join(ROOT, "server", "dist", "db", "db.js");
const DEPTH = Number(process.argv[2]) || 15;

if (!fs.existsSync(DB_MODULE)) {
  console.error("Нет server/dist — сначала `npm run build:server`.");
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "migration-check-"));

// Миграции запускаются в отдельном процессе: openDatabase держит соединение и
// пишет в переменные окружения, а нам нужно повторить это N раз подряд с
// разными базами.
function columnsAfterMigrations(dir) {
  const script = `
    process.env.DB_DIR = ${JSON.stringify(dir)};
    process.env.VAULT_ROOT = ${JSON.stringify(path.join(dir, "vault"))};
    process.env.CONFIG_DIR = ${JSON.stringify(path.join(dir, "config"))};
    process.env.SEED_DEFAULT_SYSTEMS = "false";
    const d = require(${JSON.stringify(DB_MODULE)}).openDatabase(process.env.DB_DIR);
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = ?").all("table").map((r) => r.name);
    const out = {};
    for (const t of tables) out[t] = d.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
    console.log("@@" + JSON.stringify(out));
  `;
  // Скрипт кладётся файлом, а не передаётся через `node -e`: многострочный
  // код в аргументе командной строки Windows перевирает кавычки и переносы.
  const runner = path.join(dir, "run-migrations.js");
  fs.writeFileSync(runner, script);
  const stdout = cp.execSync(`node ${JSON.stringify(runner)}`, {
    encoding: "utf8",
    maxBuffer: 1e8,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = stdout.split("\n").find((l) => l.startsWith("@@"));
  if (!line) throw new Error("миграции ничего не вернули");
  return JSON.parse(line.slice(2));
}

function freshDatabase(schemaText, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const Database = require(path.join(ROOT, "server", "node_modules", "better-sqlite3"));
  const db = new Database(path.join(dir, "app.db"));
  db.exec(schemaText);
  db.close();
}

const revisions = cp
  .execSync(`git log --format=%h -${DEPTH} -- server/src/db/schema.sql`, { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

console.log(`Эталон — сегодняшняя схема; проверяется ${revisions.length} версий schema.sql.\n`);

freshDatabase(fs.readFileSync(SCHEMA, "utf8"), path.join(work, "ref"));
const reference = columnsAfterMigrations(path.join(work, "ref"));

let failures = 0;
for (const rev of revisions) {
  const subject = cp
    .execSync(`git log -1 --format=%ad --date=short ${rev}`, { cwd: ROOT, encoding: "utf8" })
    .trim();
  const dir = path.join(work, rev);
  let got;
  try {
    const old = cp.execSync(`git show ${rev}:server/src/db/schema.sql`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1e8,
    });
    freshDatabase(old, dir);
    got = columnsAfterMigrations(dir);
  } catch (err) {
    const reason = String(err.stderr || err.message)
      .split("\n")
      .find((l) => l.includes("Error")) || "не открылась";
    console.log(`${rev}  ${subject}  БАЗА НЕ ОТКРЫЛАСЬ: ${reason.trim()}`);
    failures++;
    continue;
  }

  const problems = [];
  for (const [table, cols] of Object.entries(reference)) {
    if (!got[table]) {
      problems.push(`${table}: таблицы нет`);
      continue;
    }
    const missing = cols.filter((c) => !got[table].includes(c));
    if (missing.length) problems.push(`${table}: ${missing.join(", ")}`);
  }

  if (problems.length) {
    console.log(`${rev}  ${subject}  НЕ ХВАТАЕТ КОЛОНОК -> ${problems.join(" | ")}`);
    failures++;
  } else {
    console.log(`${rev}  ${subject}  ок`);
  }
}

fs.rmSync(work, { recursive: true, force: true });

if (failures) {
  console.log(
    `\nПроблемных версий: ${failures}. Каждая — это установка, которая после обновления` +
      `\nполучит «no such column». Нужна миграция ALTER TABLE в server/src/db/db.ts.`
  );
  process.exit(1);
}
console.log("\nВсе проверенные версии домигрировали до сегодняшней схемы без потерь.");
