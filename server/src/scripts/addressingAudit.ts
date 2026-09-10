/**
 * Сверка полиморфной адресации: у каждой пары `<что-то>_type` +
 * `<что-то>_id` проверяет, что id действительно указывает в таблицу своего
 * вида.
 *
 * Зачем. У преподготовки связь хранит id КАМПАНИИ, а не id строки
 * `preproduction` — уборка, наведённая на «свою» таблицу, снесла бы живые
 * связи. Нашлось это случайно, сухим прогоном. Проверка «все ли виды так же
 * адресуются, как думает реестр» должна быть систематической: здесь она
 * прогоняется по всем парам сразу, включая те пятнадцать, которые уборка не
 * трогает вовсе.
 *
 * Читается так:
 *   - «вид неизвестен реестру» — в базе живёт значение `*_type`, которого нет
 *     в `entityKinds.ts`. Реестр неполон.
 *   - «не нашлось ни одного» — подозрение на ловушку адресации: id ведут не в
 *     ту таблицу, которую назначил реестр.
 *   - «не нашлось N из M» — обычные сироты: владелец удалён, спутник остался.
 *
 * Работает по КОПИИ базы (как `sweepDryRun.ts`): за живой в этот момент сидит
 * Мастер, и блокировать её ради отчёта незачем.
 *
 * Запуск:  npx tsx src/scripts/addressingAudit.ts
 */
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import { kindOf, endpointTableOf, UNSWEPT_PAIRS } from "../db/entityKinds";

/** Пара колонок, которой адресуется полиморфная ссылка. */
interface Pair {
  table: string;
  typeCol: string;
  idCol: string;
}

function polymorphicPairs(db: Database.Database): Pair[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const pairs: Pair[] = [];
  for (const { name } of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
    const set = new Set(cols);
    for (const col of cols) {
      if (!col.endsWith("_type")) continue;
      const idCol = `${col.slice(0, -"_type".length)}_id`;
      if (set.has(idCol)) pairs.push({ table: name, typeCol: col, idCol });
    }
  }
  return pairs.sort((a, b) => a.table.localeCompare(b.table) || a.typeCol.localeCompare(b.typeCol));
}

async function main() {
  const serverDir = path.join(__dirname, "..", "..");
  const registryPath = path.join(serverDir, "config", "storages.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const active =
    registry.storages.find((s: { id: string }) => s.id === registry.activeId) ?? registry.storages[0];
  const srcDbPath = path.join(active.dbDir, "app.db");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "addressing-audit-"));
  const copyPath = path.join(tmpDir, "app.db");
  const src = new Database(srcDbPath, { readonly: true, fileMustExist: true });
  await src.backup(copyPath);
  src.close();

  const db = new Database(copyPath, { readonly: true });
  console.log("Источник:", srcDbPath);
  console.log("");

  const pairs = polymorphicPairs(db);
  const traps: string[] = [];
  const unknown: string[] = [];
  const orphans: string[] = [];

  for (const p of pairs) {
    const rows = db
      .prepare(
        `SELECT ${p.typeCol} AS kind, COUNT(*) AS n FROM ${p.table}
          WHERE ${p.typeCol} IS NOT NULL AND ${p.idCol} IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC`
      )
      .all() as { kind: string; n: number }[];
    if (rows.length === 0) continue;
    // У пары может быть объявлен свой словарь (`own`) или диалект — тогда
    // «вид неизвестен реестру» не находка, а ожидаемое. Без этого прогон
    // кричал двадцатью тремя строками, из которых по делу было три.
    const declared = UNSWEPT_PAIRS[`${p.table}.${p.typeCol}`];
    const foreign = declared && declared.vocabulary !== "registry";
    console.log(`${p.table}.${p.typeCol}${foreign ? `   [${declared.vocabulary}: ${declared.why}]` : ""}`);
    for (const r of rows) {
      const kind = kindOf(r.kind);
      if (!kind) {
        const label = foreign ? "не вид сущности (объявлено)" : "ВИД НЕИЗВЕСТЕН РЕЕСТРУ";
        console.log(`   ${r.kind.padEnd(20)} ${String(r.n).padStart(5)}   ${label}`);
        if (!foreign) unknown.push(`${p.table}.${p.typeCol} = '${r.kind}' (${r.n})`);
        continue;
      }
      const target = endpointTableOf(kind);
      const missing = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ${p.table} s
              WHERE s.${p.typeCol} = ? AND s.${p.idCol} IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM ${target} t WHERE t.id = s.${p.idCol})`
          )
          .get(r.kind) as { c: number }
      ).c;
      // Ловушкой считается только промах ВСЕХ строк и не меньше трёх: одна
      // мёртвая ссылка — это сирота, а не схема адресации.
      const trap = missing === r.n && r.n >= 3;
      const note =
        missing === 0
          ? ""
          : trap
            ? `  ← НИ ОДНОГО в ${target}: ловушка адресации?`
            : `  ← сирот ${missing} из ${r.n}`;
      console.log(`   ${r.kind.padEnd(20)} ${String(r.n).padStart(5)} → ${target.padEnd(24)}${note}`);
      if (trap) traps.push(`${p.table}.${p.typeCol} = '${r.kind}' → ${target} (${r.n})`);
      else if (missing > 0) orphans.push(`${p.table}.${p.typeCol} = '${r.kind}': ${missing} из ${r.n}`);
    }
    console.log("");
  }

  console.log("=".repeat(70));
  console.log(`Пар с полиморфной адресацией: ${pairs.length}`);
  const section = (title: string, list: string[]) => {
    console.log(`\n${title}: ${list.length}`);
    for (const l of list) console.log(`  - ${l}`);
  };
  section("Виды, неизвестные реестру (не объявлены чужим словарём)", unknown);
  section("Подозрение на ловушку адресации", traps);
  section("Сироты", orphans);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
