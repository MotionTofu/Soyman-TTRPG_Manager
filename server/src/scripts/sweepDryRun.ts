/**
 * Сухой прогон уборки сирот: показывает, что уборка удалила бы, ничего не
 * удаляя.
 *
 * Работает по КОПИИ базы, а не по живой: рабочая база открыта в приложении, за
 * ней в этот момент сидит Мастер, и брать на неё блокировку записи ради отчёта
 * незачем. Копия снимается `backup()`, как в сборке сида, — она согласована
 * даже при включённом WAL.
 *
 * Запуск:  npx tsx src/scripts/sweepDryRun.ts
 */
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";

async function main() {
  const serverDir = path.join(__dirname, "..", "..");
  const registryPath = path.join(serverDir, "config", "storages.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const active = registry.storages.find((s: { id: string }) => s.id === registry.activeId) ?? registry.storages[0];
  const srcDbPath = path.join(active.dbDir, "app.db");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-dry-run-"));
  const copyPath = path.join(tmpDir, "app.db");

  const src = new Database(srcDbPath, { readonly: true, fileMustExist: true });
  await src.backup(copyPath);
  src.close();

  console.log("Источник:", srcDbPath);
  console.log("Копия:   ", copyPath);
  console.log("");

  // DB_DIR выставляется ДО импорта db (у него побочный эффект — открытие
  // базы), поэтому импорты динамические.
  process.env.DB_DIR = tmpDir;
  const { collectOrphans, getLastSweepProblems } = await import("../services/orphans");
  const { kindOf } = await import("../db/entityKinds");

  const found = collectOrphans();
  const keys = Object.keys(found).sort();

  if (!keys.length) {
    console.log("Сирот не найдено.");
  } else {
    let total = 0;
    console.log("Что удалила бы уборка:");
    for (const key of keys) {
      const rows = found[key];
      total += rows.length;
      console.log(`  ${key.padEnd(42)} ${String(rows.length).padStart(5)}`);
      // Показываем по одной строке на вид — чтобы было видно, что это за
      // данные, а не только сколько их.
      const sample = rows[0] as Record<string, unknown>;
      const label = sample.title ?? sample.name ?? sample.format ?? sample.file_path ?? "";
      const owner = sample.owner_type ? `${sample.owner_type}#${sample.owner_id}` : `${sample.from_type ?? ""}#${sample.from_id ?? ""}→${sample.to_type ?? ""}#${sample.to_id ?? ""}`;
      console.log(`      пример: id=${sample.id} ${owner} ${label ? `«${String(label).slice(0, 60)}»` : ""}`);
    }
    console.log(`  ${"ВСЕГО".padEnd(42)} ${String(total).padStart(5)}`);
  }

  const problems = getLastSweepProblems();
  if (problems.length) {
    console.log("\nНе удалось проверить (обычно — нет таблицы на этой базе):");
    for (const p of problems) console.log("  " + p);
  }

  // Виды, встречающиеся в базе, но отсутствующие в реестре: именно такое
  // незнание в сборке сида означало удаление данных.
  const db = new Database(copyPath, { readonly: true });
  const unknown = new Set<string>();
  const probes: [string, string][] = [
    ["statblocks", "owner_type"], ["gallery_images", "owner_type"], ["important_dates", "owner_type"],
    ["generic_links", "from_type"], ["generic_links", "to_type"],
    ["entity_relations", "from_type"], ["entity_relations", "to_type"],
  ];
  for (const [table, col] of probes) {
    try {
      for (const r of db.prepare(`SELECT DISTINCT ${col} k FROM ${table}`).all() as { k: string }[]) {
        if (r.k && !kindOf(r.k)) unknown.add(`${table}.${col} = ${r.k}`);
      }
    } catch { /* нет таблицы — покажется выше */ }
  }
  db.close();
  console.log(unknown.size ? "\nВиды в базе, которых нет в реестре:\n  " + [...unknown].join("\n  ") : "\nВсе виды из базы есть в реестре.");

  // Копию держит ещё открытым модуль базы; на Windows каталог из-под живого
  // файла не удаляется, и это не повод падать после того, как отчёт напечатан.
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  catch { console.log(`\nКопия осталась в ${tmpDir} — база ещё открыта.`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
