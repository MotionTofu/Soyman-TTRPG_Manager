/**
 * Собирает «сид» — базу и файлы хранилища только с Системами и Сеттингами,
 * без кампаний, сессий, игроков, финансов и заметок мастерения, — чтобы
 * вложить его в портативную сборку и отдать друзьям вместе с компендиумами
 * и мирами, но без личных данных.
 *
 * Запуск:  npx tsx src/scripts/buildSeed.ts   (или npm run build-seed из корня)
 * Читает активное хранилище из server/config/storages.json,
 * пишет в <repo>/seed-full/{data/app.db, vault/{Systems,Settings}}.
 *
 * Почему это больше не отдельный скрипт на JS. Здесь лежала переписанная от
 * руки копия уборки сирот: те же полиморфные спутники, те же концы связей,
 * то же правило «спутник жив, пока жив владелец». Копия разошлась с
 * оригиналом — не знала про сцены и приключения, зато считала владельцами
 * картинок локации и общины, — и один раз это уже стоило утечки: в сид уехали
 * 17 статблоков и 4 изображения персонажей игроков. Теперь уборка одна на
 * оба случая (`services/orphans.ts`), а виды сущностей — в реестре
 * (`db/entityKinds.ts`); отличие сида от боевой базы только в том, ЧТО
 * удаляется до уборки, а не в том, КАК убирается за этим.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const SUMMARY_TABLES = [
  "systems", "settings", "campaigns", "players",
  "characters", "sessions", "resources", "compendium_entries",
];

function summarize(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of SUMMARY_TABLES) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}

async function main() {
  const serverDir = path.join(__dirname, "..", "..");
  const repoRoot = path.join(serverDir, "..");

  const registryPath = path.join(serverDir, "config", "storages.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const active =
    registry.storages.find((s: { id: string }) => s.id === registry.activeId) ?? registry.storages[0];

  const srcDbPath = path.join(active.dbDir, "app.db");
  const srcVaultRoot: string = active.vaultRoot;

  const outRoot = path.join(repoRoot, "seed-full");
  const outDataDir = path.join(outRoot, "data");
  const outVaultRoot = path.join(outRoot, "vault");
  const outDbPath = path.join(outDataDir, "app.db");

  console.log("Source DB:", srcDbPath);
  console.log("Source vault:", srcVaultRoot);
  console.log("Output:", outRoot);

  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outDataDir, { recursive: true });
  fs.mkdirSync(outVaultRoot, { recursive: true });

  // Снимок, а не копия файла: рабочая база может быть открыта dev-сервером в
  // режиме WAL, и обычный copy дал бы рассогласованный файл.
  const src = new Database(srcDbPath, { readonly: true, fileMustExist: true });
  await src.backup(outDbPath);
  src.close();

  // Порядок важен: сначала миграции, потом чистка. Наоборот — и миграция
  // допишет обратно то, что чистка только что убрала (так в сид уезжали
  // семьдесят пять строк app_settings, восстановленных значениями по
  // умолчанию уже после `DELETE`). Импорт модуля базы её больше не открывает,
  // поэтому каталог задаётся аргументом initDatabase, а не переменной среды.
  const { db, initDatabase } = await import("../db/db");
  initDatabase(outDataDir);
  const { sweepOrphans, getLastSweepProblems } = await import("../services/orphans");

  db.pragma("foreign_keys = ON");
  const before = summarize(db);

  // Личные данные: кампании каскадом уносят персонажей, сессии, состав,
  // записи кампании, преподготовку, календарь кампании, посещаемость и
  // ресурсы, привязанные к кампании или сессии.
  db.exec("DELETE FROM campaigns");
  db.exec("DELETE FROM players");
  db.exec("DELETE FROM mastering_notes");
  // Оставляем только ресурсы, привязанные к системе или сеттингу (например
  // шаблоны статблоков); «глобальные» могут быть личными заметками и файлами.
  db.exec("DELETE FROM resources WHERE scope NOT IN ('system','setting')");
  // Общие настройки интерфейса (фон главной и прочее) — личные, не контент.
  db.exec("DELETE FROM app_settings");
  // Обёртки модулей: пересоздаются лениво из систем и сеттингов при первом
  // GET /api/modules, так что чистить безопасно.
  db.exec("DELETE FROM modules");
  // Напоминания мастера висят на кампаниях и игроках — тех и других уже нет,
  // а сами записки личные насквозь.
  db.exec("DELETE FROM gm_reminders");

  // Полиморфные спутники внешнего ключа не имеют, поэтому каскад их не
  // уносит: после удаления персонажей их листы, галереи и важные даты
  // остались бы в базе целыми. Уборку зовём ту же самую, что работает на
  // боевой базе, — второй копии правила здесь больше нет.
  const removed = sweepOrphans();
  console.log(`Уборка сирот: удалено ${removed} строк.`);
  const problems = getLastSweepProblems();
  if (problems.length) {
    console.log("Не удалось проверить:");
    for (const p of problems) console.log("  " + p);
  }

  const after = summarize(db);
  console.log("Before prune:", before);
  console.log("After prune:", after);
  // VACUUM не работает внутри транзакции и должен идти последним по базе.
  db.exec("VACUUM");
  db.close();

  // SEED_SKIP_VAULT=1 собирает только базу. Хранилище — гигабайты, а проверять
  // после правок чистки нужно именно базу: копирование файлов к утечке личных
  // данных отношения не имеет и в проверку не входит.
  if (process.env.SEED_SKIP_VAULT === "1") {
    console.log("SEED_SKIP_VAULT=1 — файлы хранилища не копируются.");
  } else {
    for (const folder of ["Systems", "Settings"]) {
      const from = path.join(srcVaultRoot, folder);
      const to = path.join(outVaultRoot, folder);
      if (fs.existsSync(from)) {
        fs.cpSync(from, to, { recursive: true });
        console.log(`Copied vault/${folder}`);
      }
    }
  }

  // Колонки folder_path/image_path всё ещё держат абсолютный путь хранилища
  // ЭТОЙ машины. seedIfNeeded() в electron/main.js при первом запуске
  // переписывает этот префикс на путь устанавливающего — вот файл-маркер,
  // ОТ которого он переписывает.
  fs.writeFileSync(path.join(outRoot, "vault-root.txt"), srcVaultRoot, "utf-8");

  console.log("Seed package ready at", outRoot);
  // openDatabase ставит отложенные задачи (добивка legacy-меншенов), которые
  // сработали бы уже по закрытой базе и напечатали бы ошибку в конце удачной
  // сборки. Скрипту здесь делать больше нечего — выходим явно.
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
