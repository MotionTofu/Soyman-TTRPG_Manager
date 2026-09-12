import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import fs from "fs";
import { MENTIONABLE_TABLE } from "./entityKinds";
import path from "path";
import { entryImageFolder, systemFolder, vaultAbs } from "../services/filesystem";
import { backfillDefaultMechanicsSections, backfillDefaultVehicleSections, migrateBastionsToOwnSection } from "./defaultSections";
import { migrateDndSkillNames } from "./dndSkillNames";
import { migrateDndGrantedSpells } from "./dndGrantedSpells";
import { migrateDndOriginGrants } from "./dndOriginGrants";
import { migrateDndSpeedStructure } from "./dndSpeedStructure";
import { migrateDndSheetRefs } from "./dndSheetRefs";
import { migrateDndStartingSets } from "./dndStartingSets";
import { migrateDndReplicaColumnRoles, migrateDndReplicaSchemes } from "./dndReplicaSchemes";
import {
  migrateDndArtificerCompanionActions,
  migrateDndArtificerLevelDice,
  migrateDndArtificerMasterworker,
  migrateDndArtificerPoolRows,
  migrateDndArtificerTouchups,
} from "./dndArtificerCompanions";
import { migrateDndArtificerReanimator } from "./dndArtificerReanimator";
import { migrateDndArtificerOracle } from "./dndArtificerOracle";
import {
  ensureNamedReplicaSchemes,
  migrateDndReplicaGenerics,
  migrateDndReplicaTiers,
} from "./dndReplicaTiers";

function tableExists(database: Database.Database, name: string): boolean {
  return !!database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

// Отметка «разовый проход уже сделан» — тем же приёмом, что и у остальных
// разовых миграций в этом файле (`default_vehicle_section_backfilled` и
// прочие): строка в app_settings, а не догадка по состоянию данных.
function appSettingFlag(database: Database.Database, key: string): boolean {
  return !!database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
}

function setAppSettingFlag(database: Database.Database, key: string): void {
  database
    .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
    .run(key);
}

function columnIsNotNull(database: Database.Database, table: string, column: string): boolean {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
  }[];
  return cols.some((c) => c.name === column && c.notnull === 1);
}

// ─── Разовый перевод ссылок в текстах на глобальные ключи ────────────────────
//
// Всё, что относится к этой миграции, живёт здесь и ни от чего не зависит.
// services/mentions.ts делает то же самое для работающего приложения, но ходит
// в базу через прокси `db`, который во время openDatabase указывает ещё на
// прежнее подключение, — поэтому разовый проход знает грамматику сам.

/**
 * Типы, на которые можно сослаться, и их таблицы. Берётся из реестра видов:
 * раньше здесь лежал побайтовый двойник `MENTIONABLE` из services/mentions.ts,
 * и жили они раздельно только из-за цикла импортов. Реестр ни от чего не
 * зависит и в базу не ходит, поэтому цикла с ним нет.
 */
const MENTION_TABLES: Record<string, string> = MENTIONABLE_TABLE;

/** Тексты, которые нельзя трогать. Совпадает с NEVER_REWRITE. */
const MENTION_FROZEN = new Set([
  "modules",
  "import_batches",
  "import_records",
  "system_import_batches",
  "system_import_records",
  "archived_files",
  "app_settings",
  "vault_files",
]);

const LEGACY_MENTION_RE = /\[\[(\w+):(\d+)\|([^\]]*)\]\]/g;

/**
 * Кратчайшие однозначные префиксы uid для одного типа: `id → префикс`.
 *
 * Восемь шестнадцатеричных символов на три сотни целей — запас в миллионы раз,
 * и он ещё шире, потому что однозначность нужна только внутри своего типа.
 * Двойник всё же возможен, и тогда именно этой паре достаётся префикс подлиннее,
 * а не всем остальным заодно.
 */
function mentionPrefixes(database: Database.Database, table: string): Map<number, string> {
  const rows = database.prepare(`SELECT id, uid FROM ${table} WHERE uid IS NOT NULL`).all() as {
    id: number;
    uid: string;
  }[];
  const norm = (u: string) => u.replace(/-/g, "").toLowerCase();
  const out = new Map<number, string>();
  const buckets = new Map<string, { id: number; uid: string }[]>();
  for (const r of rows) {
    const uid = norm(r.uid);
    const head = uid.slice(0, 8);
    const list = buckets.get(head) ?? [];
    list.push({ id: r.id, uid });
    buckets.set(head, list);
  }
  for (const [head, list] of buckets) {
    if (list.length === 1) {
      out.set(list[0].id, head);
      continue;
    }
    for (const self of list) {
      let chosen = self.uid;
      for (let len = 12; len < self.uid.length; len += 4) {
        const candidate = self.uid.slice(0, len);
        if (!list.some((o) => o.id !== self.id && o.uid.startsWith(candidate))) {
          chosen = candidate;
          break;
        }
      }
      out.set(self.id, chosen);
    }
  }
  return out;
}

/** `id → код или имя модуля`, откуда сущность родом. */
function mentionSources(database: Database.Database, type: string): Map<number, string> {
  const table = MENTION_TABLES[type];
  const out = new Map<number, string>();
  const pick = (code: string | null, name: string) => (code || "").trim() || name;
  if (type === "setting") {
    for (const r of database.prepare("SELECT id, code, name FROM settings").all() as {
      id: number;
      code: string | null;
      name: string;
    }[]) {
      out.set(r.id, pick(r.code, r.name));
    }
    return out;
  }
  const owner =
    type === "compendium_entry"
      ? { column: "system_id", table: "systems" }
      : { column: "setting_id", table: "settings" };
  if (!columnExists(database, table, owner.column)) return out;
  const rows = database
    .prepare(
      `SELECT t.id AS id, o.code AS code, o.name AS name FROM ${table} t
         JOIN ${owner.table} o ON o.id = t.${owner.column}`
    )
    .all() as { id: number; code: string | null; name: string }[];
  for (const r of rows) out.set(r.id, pick(r.code, r.name));
  return out;
}

/**
 * Переписывает каждую ссылку `[[тип:id|Подпись]]` в `[[тип@префикс|код|Подпись]]`.
 *
 * Идёт по текстовым колонкам, а не по именам полей: меншен можно поставить в
 * несколько десятков разных мест, часть из которых — JSON внутри
 * `statblocks.content` и `compendium_entries.data`. Перечислять их поимённо
 * значит гарантированно что-то забыть, а забытое поле — это ссылка, которая
 * после перехода останется на локальном id и однажды уедет не туда.
 *
 * Ссылка, чью цель уже удалили, схлопывается в обычный текст: опознать её нечем
 * — глобального ключа у пропавшей строки не осталось, — а оставить её живой
 * значит сохранить ссылку в никуда.
 *
 * Возвращает false, если снимок сделать не удалось: без него необратимый проход
 * по всем текстам сразу не запускается, и переход просто откладывается до
 * следующего запуска.
 */
function migrateMentionTokens(database: Database.Database, dbDir: string): boolean {
  const anyTokens = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'app_settings'")
    .get();
  if (!anyTokens) return false;

  const snapshot = path.join(dbDir, "app-before-uid-mentions.db");
  try {
    if (!fs.existsSync(snapshot)) {
      database.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    }
  } catch (e) {
    console.error("Меншены на uid: снимок базы не сделан, переход отложен:", e);
    return false;
  }

  const prefixes = new Map<string, Map<number, string>>();
  const sources = new Map<string, Map<number, string>>();
  for (const [type, table] of Object.entries(MENTION_TABLES)) {
    if (!tableExists(database, table) || !columnExists(database, table, "uid")) continue;
    prefixes.set(type, mentionPrefixes(database, table));
    sources.set(type, mentionSources(database, type));
  }

  const clean = (s: string) => s.replace(/[|\]\[]/g, " ").trim();
  let fields = 0;
  let tokens = 0;
  let dropped = 0;

  const run = database.transaction(() => {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      if (MENTION_FROZEN.has(name)) continue;
      const cols = database.prepare(`PRAGMA table_info(${name})`).all() as {
        name: string;
        type: string;
      }[];
      if (!cols.some((c) => c.name === "id")) continue;
      for (const col of cols) {
        if (!/TEXT|CLOB|CHAR/i.test(col.type)) continue;
        const rows = database
          .prepare(`SELECT id, "${col.name}" AS value FROM ${name} WHERE "${col.name}" LIKE '%[[%'`)
          .all() as { id: number; value: string | null }[];
        if (!rows.length) continue;
        const update = database.prepare(`UPDATE ${name} SET "${col.name}" = ? WHERE id = ?`);
        for (const row of rows) {
          if (!row.value) continue;
          LEGACY_MENTION_RE.lastIndex = 0;
          const next = row.value.replace(
            LEGACY_MENTION_RE,
            (whole, type: string, rawId: string, label: string) => {
              const prefix = prefixes.get(type)?.get(Number(rawId));
              if (!prefix) {
                if (MENTION_TABLES[type]) {
                  dropped++;
                  return label;
                }
                return whole;
              }
              tokens++;
              const source = sources.get(type)?.get(Number(rawId)) ?? "";
              return `[[${type}@${prefix}|${clean(source)}|${label}]]`;
            }
          );
          if (next !== row.value) {
            update.run(next, row.id);
            fields++;
          }
        }
      }
    }
  });
  run();

  if (fields) {
    console.log(
      `Меншены на uid: переведено ссылок ${tokens} в ${fields} полях` +
        (dropped ? `, снято потерявших цель ${dropped}` : "") +
        `. Снимок до перехода: ${snapshot}`
    );
  }
  return true;
}

/**
 * Добивка остатков `[[type:id|label]]` без снимка и без флага.
 * После первой миграции `systemApply` и `crossLinks` ещё писали `id` — эти
 * хвосты надо перевести тем же правилом, иначе DnD-компендиум остаётся с legacy.
 */
function fixResidualLegacyMentions(database: Database.Database): void {
  const prefixes = new Map<string, Map<number, string>>();
  const sources = new Map<string, Map<number, string>>();
  for (const [type, table] of Object.entries(MENTION_TABLES)) {
    if (!tableExists(database, table) || !columnExists(database, table, "uid")) continue;
    prefixes.set(type, mentionPrefixes(database, table));
    sources.set(type, mentionSources(database, type));
  }
  if (!prefixes.size) return;
  const clean = (s: string) => s.replace(/[|\]\[]/g, " ").trim();
  let fields = 0;
  let tokens = 0;
  let dropped = 0;
  const run = database.transaction(() => {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      if (MENTION_FROZEN.has(name)) continue;
      const cols = database.prepare(`PRAGMA table_info(${name})`).all() as {
        name: string;
        type: string;
      }[];
      if (!cols.some((c) => c.name === "id")) continue;
      for (const col of cols) {
        if (!/TEXT|CLOB|CHAR/i.test(col.type)) continue;
        const rows = database
          .prepare(`SELECT id, "${col.name}" AS value FROM ${name} WHERE "${col.name}" LIKE '%[[%:%|%'`)
          .all() as { id: number; value: string | null }[];
        if (!rows.length) continue;
        const update = database.prepare(`UPDATE ${name} SET "${col.name}" = ? WHERE id = ?`);
        for (const row of rows) {
          if (!row.value || !row.value.includes("[[")) continue;
          LEGACY_MENTION_RE.lastIndex = 0;
          if (!LEGACY_MENTION_RE.test(row.value)) continue;
          LEGACY_MENTION_RE.lastIndex = 0;
          const next = row.value.replace(
            LEGACY_MENTION_RE,
            (whole, type: string, rawId: string, label: string) => {
              const prefix = prefixes.get(type)?.get(Number(rawId));
              if (!prefix) {
                if (MENTION_TABLES[type]) {
                  dropped++;
                  return label;
                }
                return whole;
              }
              tokens++;
              const source = sources.get(type)?.get(Number(rawId)) ?? "";
              return `[[${type}@${prefix}|${clean(source)}|${label}]]`;
            }
          );
          if (next !== row.value) {
            update.run(next, row.id);
            fields++;
          }
        }
      }
    }
  });
  try {
    run();
  } catch (e) {
    console.error("Добивка legacy-меншенов не удалась:", e);
    return;
  }
  if (fields) {
    console.log(`Меншены-добивка: переведено ссылок ${tokens} в ${fields} полях${dropped ? `, снято ${dropped}` : ""}.`);
  }
}

// ── Шаги, поднятые на своё историческое место ───────────────────────────────
//
// Эти три шага написаны 13, 20 и 31 августа 2026. Шаги, которые ищут по их
// колонкам (выборы подклассов, воззвания колдуна, стартовые наборы…), написаны
// 8 сентября, но вставлены в файл ВЫШЕ. База, мигрировавшая непрерывно, прошла
// их в порядке написания; база, пропустившая версии, шла по порядку строк и
// падала «no such column: name_original» — приложение у неё не запускалось
// (все релизы с 30 июля по 19 августа). Поэтому они вызываются в самом начале
// migrateDatabase, где стояли бы, если бы файл рос только вниз. На уже
// мигрировавшей базе все три — пустые проверки.
//
// Гардом «пропустить шаг, пока колонки нет» это не чинится: шаг до разреза
// увидел бы пустой name_original, записал бы пустой результат и поставил флаг
// навсегда — тихая порча вместо падения.

function ensureSettingNameColumns(database: Database.Database): void {
  // Синонимы имени и имя в оригинале. Один и тот же район книги разные
  // переводчики зовут «Морской округ» и «Приморский район», а сходится это
  // надёжнее всего по оригинальному «Sea Ward» — без этих двух полей вторая
  // книга про тот же город создаёт второй комплект локаций.
  for (const table of [
    "setting_locations",
    "setting_beings",
    "setting_communities",
    "artifacts",
  ]) {
    if (!tableExists(database, table)) continue;
    if (!columnExists(database, table, "aliases")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!columnExists(database, table, "name_original")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN name_original TEXT NOT NULL DEFAULT ''`);
    }
  }
}

function ensureCompendiumNameColumns(database: Database.Database): void {
  // Имена записи компендиума — как у сущностей сеттинга. Синонимы и
  // оригинальное название нужны поиску (иначе «Goblin Boss» не находит
  // «Гоблина-вожака»), короткое имя подписывает пин: карта принимает
  // перетаскиванием любой результат поиска, включая запись бестиария.
  for (const [column, def] of [
    ["aliases", "TEXT NOT NULL DEFAULT '[]'"],
    ["name_original", "TEXT NOT NULL DEFAULT ''"],
    ["short_name", "TEXT"],
  ] as const) {
    if (!columnExists(database, "compendium_entries", column)) {
      database.exec(`ALTER TABLE compendium_entries ADD COLUMN ${column} ${def}`);
    }
  }
}

function splitBracketNames(database: Database.Database): void {
  // П2.6 — разрез «Имя [Original]» по колонкам. Импорт бестиария вклеивал
  // оригинал в name, поиск по name_original/aliases не находил. Миграция
  // одноразовая и идемпотентна: режет bracket-хвост только если он есть.
  for (const table of ["compendium_entries", "setting_beings", "setting_locations", "setting_communities", "artifacts"] as const) {
    if (!tableExists(database, table) || !columnExists(database, table, "name_original")) continue;
    const rows = database
      .prepare(`SELECT id, name, name_original FROM ${table} WHERE name LIKE '%[%'`)
      .all() as { id: number; name: string; name_original: string }[];
    if (rows.length === 0) continue;
    const upd = database.prepare(`UPDATE ${table} SET name = ?, name_original = ? WHERE id = ?`);
    let fixed = 0;
    for (const r of rows) {
      const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(r.name ?? "");
      if (!m) continue;
      const clean = m[1].trim();
      const en = m[2].trim();
      const keepEn = r.name_original && r.name_original.trim() ? r.name_original : en;
      upd.run(clean, keepEn, r.id);
      fixed++;
    }
    if (fixed) console.log(`[migrate] ${table}: split bracket names ${fixed}`);
  }
}

const SCHEMA_INDEX_RE = /^[ \t]*CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b[^;]*;/gim;

/**
 * Прогоняет schema.sql так, чтобы база ЛЮБОГО возраста её переживала.
 *
 * `CREATE TABLE IF NOT EXISTS` на существующей таблице ничего не делает, а
 * `CREATE INDEX` рядом с ней — делает, и если индекс стоит на колонке, которую
 * добавляет миграция НИЖЕ, старая база падает с «no such column» прямо на
 * старте. Раньше это чинили поштучно, перенося индекс из schema.sql в миграцию
 * (следы — комментарии в schema.sql), и пятый такой индекс (`archived_at`)
 * уронил старт на базах до конца августа 2026.
 *
 * Здесь класс закрыт целиком: таблицы создаются как раньше, индексы — каждый
 * отдельно, и тот, что упёрся в отсутствующую колонку, пропускается. В конце
 * миграций все индексы schema.sql прогоняются ещё раз (см. migrateDatabase):
 * это доделывает пропущенные и возвращает те, что унесла перестройка таблицы
 * (DROP TABLE забирает индексы с собой — так на базах конца августа пропадал
 * idx_story_arc_transitions_from). Все они `IF NOT EXISTS`, и `DROP INDEX` в
 * миграциях нет, так что на базе, где всё на месте, повтор ничего не делает.
 * Уникальных индексов в schema.sql нет, так что откладывание влияет только на
 * скорость запросов внутри миграций, а не на их смысл.
 */
function execSchema(database: Database.Database, schema: string): string[] {
  const indexes = schema.match(SCHEMA_INDEX_RE) ?? [];
  database.exec(schema.replace(SCHEMA_INDEX_RE, ""));
  for (const sql of indexes) {
    try {
      database.exec(sql);
    } catch (e) {
      if (!/no such column/i.test((e as Error).message)) throw e;
    }
  }
  return indexes;
}

// Opens (creating if needed) the SQLite database at dbDir/app.db and brings
// it up to the current schema. Used both at startup and whenever the active
// storage profile changes, so it must be safe to run repeatedly and against
// any dbDir — no dependency on module-level state.
export function openDatabase(dbDir: string, opts: { migrate?: boolean } = {}): Database.Database {
  fs.mkdirSync(dbDir, { recursive: true });
  const database = new Database(path.join(dbDir, "app.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  // Ревизии и сверки открывают чужие (часто старые) снимки, чтобы в них
  // ЗАГЛЯНУТЬ. Прогон миграций такой снимок переписывает необратимо, поэтому
  // «посмотреть» и «обновить» — разные намерения, а не одно по умолчанию.
  if (opts.migrate === false) return database;
  // 3.3 — integrity_check не блокирует старт: уходим в фон через 2с после открытия
  setTimeout(() => {
    try {
      const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
      if (row && row.integrity_check !== "ok") console.error(`[db] integrity_check: ${row.integrity_check}`);
    } catch {}
  }, 2000);
  migrateDatabase(database, dbDir);
  return database;
}

// Вся накопленная история изменений схемы и разовых починок данных, по порядку.
// Идемпотентна: каждый шаг сам проверяет, нужен ли он, — поэтому её гоняют на
// каждом открытии, и она обязана быть безопасна на базе ЛЮБОГО возраста.
// Схлопывать историю в baseline нельзя: приложение уехало наружу, и там лежат
// базы неизвестного возраста, которые некому чинить.
function migrateDatabase(database: Database.Database, dbDir: string): void {

  // Migrate the old `player_characters` table (pre-characters-feature) into
  // `characters` before schema.sql creates the new table, so existing data survives.
  if (tableExists(database, "player_characters") && !tableExists(database, "characters")) {
    database.exec("ALTER TABLE player_characters RENAME TO characters");
  }

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  const schemaIndexes = execSchema(database, schema);
  // Имена сущностей и записей компендиума — раньше всех шагов, которые по ним
  // ищут (см. «Шаги, поднятые на своё историческое место»).
  ensureSettingNameColumns(database);
  ensureCompendiumNameColumns(database);
  splitBracketNames(database);

  const archivableTables = [
    "settings",
    "campaigns",
    "players",
    "characters",
    "sessions",
    "resources",
    "mastering_notes",
  ];
  for (const table of archivableTables) {
    if (!columnExists(database, table, "archived_at")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
    }
  }
  // Мастерение: сворачиваемые разделы (плашка — инверсия §1.4). Живая база могла
  // быть заведена до появления таблицы, поэтому column/table создаются отдельно.
  if (!columnExists(database, "mastering_notes", "section_id")) {
    database.exec(
      "ALTER TABLE mastering_notes ADD COLUMN section_id INTEGER REFERENCES mastering_sections(id) ON DELETE SET NULL"
    );
  }
  if (!columnExists(database, "mastering_sections", "system_id")) {
    // Старую таблицу (без системы) догнать — система теперь на всех категориях.
    if (tableExists(database, "mastering_sections")) {
      database.exec("ALTER TABLE mastering_sections ADD COLUMN system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL");
    }
  }
  if (!columnExists(database, "mastering_sections", "position")) {
    if (tableExists(database, "mastering_sections")) {
      database.exec("ALTER TABLE mastering_sections ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    }
  }
  for (const [column, def] of [
    ["backstory", "TEXT DEFAULT ''"],
    ["statblock", "TEXT DEFAULT ''"],
    ["current_situation", "TEXT DEFAULT ''"],
    ["personal_arc", "TEXT DEFAULT ''"],
    ["future_thoughts", "TEXT DEFAULT ''"],
    ["connections_notes", "TEXT DEFAULT ''"],
    ["folder_path", "TEXT"],
    ["created_at", "TEXT"],
  ] as const) {
    if (!columnExists(database, "characters", column)) {
      database.exec(`ALTER TABLE characters ADD COLUMN ${column} ${def}`);
    }
  }

  // The rebuild below (for old DBs with campaign_id NOT NULL) selects
  // avatar_image_path/thumbnail_image_path — make sure they exist on the
  // pre-rebuild table first, since their own ADD COLUMN migration further
  // down would otherwise run too late on a sufficiently old DB.
  if (!columnExists(database, "characters", "avatar_image_path")) {
    database.exec("ALTER TABLE characters ADD COLUMN avatar_image_path TEXT");
  }
  if (!columnExists(database, "characters", "thumbnail_image_path")) {
    database.exec("ALTER TABLE characters ADD COLUMN thumbnail_image_path TEXT");
  }

  // Standalone characters (not tied to any campaign) — player-app lets a
  // player create one from the "Персонажи" section. SQLite can't just drop
  // a NOT NULL constraint, so an existing characters.campaign_id NOT NULL
  // requires a full table rebuild (create → copy → drop → rename).
  if (!columnExists(database, "characters", "system_id")) {
    database.exec("ALTER TABLE characters ADD COLUMN system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL");
  }
  if (columnIsNotNull(database, "characters", "campaign_id")) {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("DROP TABLE IF EXISTS characters_new");
    database.exec(`CREATE TABLE characters_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      character_name TEXT NOT NULL,
      backstory TEXT DEFAULT '',
      statblock TEXT DEFAULT '',
      current_situation TEXT DEFAULT '',
      personal_arc TEXT DEFAULT '',
      future_thoughts TEXT DEFAULT '',
      connections_notes TEXT DEFAULT '',
      avatar_image_path TEXT,
      thumbnail_image_path TEXT,
      folder_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
    database.exec(`INSERT INTO characters_new (
      id, player_id, campaign_id, system_id, character_name, backstory, statblock,
      current_situation, personal_arc, future_thoughts, connections_notes,
      avatar_image_path, thumbnail_image_path, folder_path, created_at, archived_at
    ) SELECT
      id, player_id, campaign_id, system_id, character_name, backstory, statblock,
      current_situation, personal_arc, future_thoughts, connections_notes,
      avatar_image_path, thumbnail_image_path, folder_path, COALESCE(created_at, datetime('now')), archived_at
    FROM characters`);
    database.exec("DROP TABLE characters");
    database.exec("ALTER TABLE characters_new RENAME TO characters");
    database.exec("PRAGMA foreign_keys = ON");
  }

  // Payment model migration: campaign-level payment_type, session payment_override/title,
  // per-player amount_paid (replacing the old boolean paid/is_paid_session flags).
  if (!columnExists(database, "campaigns", "payment_type")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'free'");
    database.exec(
      "UPDATE campaigns SET payment_type = 'paid' WHERE payment_type = 'free' AND session_rate > 0"
    );
  }
  if (!columnExists(database, "sessions", "title")) {
    database.exec("ALTER TABLE sessions ADD COLUMN title TEXT");
  }
  if (!columnExists(database, "sessions", "payment_override")) {
    database.exec("ALTER TABLE sessions ADD COLUMN payment_override TEXT");
  }
  if (columnExists(database, "sessions", "is_paid_session")) {
    try {
      database.exec("ALTER TABLE sessions DROP COLUMN is_paid_session");
    } catch {
      // Older SQLite without DROP COLUMN support: leave the unused column in place.
    }
  }
  if (!columnExists(database, "session_attendance", "amount_paid")) {
    database.exec("ALTER TABLE session_attendance ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0");
    if (columnExists(database, "session_attendance", "paid")) {
      database.exec(
        `UPDATE session_attendance SET amount_paid = (
           SELECT COALESCE(s.stake_override, c.session_rate, 0)
           FROM sessions s JOIN campaigns c ON c.id = s.campaign_id
           WHERE s.id = session_attendance.session_id
         ) WHERE paid = 1`
      );
      try {
        database.exec("ALTER TABLE session_attendance DROP COLUMN paid");
      } catch {
        // Older SQLite without DROP COLUMN support: leave the unused column in place.
      }
    }
  }

  if (!columnExists(database, "campaigns", "background_image_path")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN background_image_path TEXT");
  }
  if (!columnExists(database, "campaigns", "thumbnail_image_path")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN thumbnail_image_path TEXT");
  }

  if (!columnExists(database, "sessions", "main_events")) {
    database.exec("ALTER TABLE sessions ADD COLUMN main_events TEXT DEFAULT ''");
  }

  if (!columnExists(database, "characters", "avatar_image_path")) {
    database.exec("ALTER TABLE characters ADD COLUMN avatar_image_path TEXT");
  }

  if (!columnExists(database, "characters", "thumbnail_image_path")) {
    database.exec("ALTER TABLE characters ADD COLUMN thumbnail_image_path TEXT");
  }

  if (!columnExists(database, "campaign_roster", "status")) {
    database.exec("ALTER TABLE campaign_roster ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!columnExists(database, "resources", "system_id")) {
    database.exec("ALTER TABLE resources ADD COLUMN system_id INTEGER REFERENCES systems(id)");
  }
  if (!columnExists(database, "resources", "template_kind")) {
    database.exec("ALTER TABLE resources ADD COLUMN template_kind TEXT");
  }
  if (!columnExists(database, "generic_links", "section")) {
    database.exec("ALTER TABLE generic_links ADD COLUMN section TEXT");
  }
  // Distinguishes links created ahead of time via the session profile page
  // ('planned', the default) from ones dropped in live during the session
  // pult ('live') — the live ones get a reddish highlight on the profile
  // page afterward so the GM can see what got added on the fly.
  if (!columnExists(database, "generic_links", "origin")) {
    database.exec("ALTER TABLE generic_links ADD COLUMN origin TEXT NOT NULL DEFAULT 'planned'");
  }
  // Старый уникальный ключ был (from_type,from_id,to_type,to_id) без section — из-за
  // него нельзя было воткнуть один и тот же sound_set в два разъёма (audio+battle).
  // Схема уже поменялась на 5 полей, а живая база крутится на старой — ловим это
  // и пересобираем таблицу, сохранив строки.
  {
    const ddl = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='generic_links'").get() as { sql: string } | undefined)?.sql ?? "";
    if (ddl.includes("UNIQUE(from_type, from_id, to_type, to_id)") && !ddl.includes("UNIQUE(from_type, from_id, to_type, to_id, section)")) {
      database.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE generic_links_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_type TEXT NOT NULL,
          from_id INTEGER NOT NULL,
          to_type TEXT NOT NULL,
          to_id INTEGER NOT NULL,
          section TEXT,
          origin TEXT NOT NULL DEFAULT 'planned',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(from_type, from_id, to_type, to_id, section)
        );
        INSERT INTO generic_links_new (id, from_type, from_id, to_type, to_id, section, origin, created_at)
          SELECT id, from_type, from_id, to_type, to_id, section, origin, created_at FROM generic_links;
        DROP TABLE generic_links;
        ALTER TABLE generic_links_new RENAME TO generic_links;
        PRAGMA foreign_keys=ON;
      `);
    }
  }
  if (!columnExists(database, "character_chapters", "image_path")) {
    database.exec("ALTER TABLE character_chapters ADD COLUMN image_path TEXT");
  }
  if (!columnExists(database, "campaigns", "role")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN role TEXT NOT NULL DEFAULT 'gm'");
  }
  if (!columnExists(database, "resources", "link_url")) {
    database.exec("ALTER TABLE resources ADD COLUMN link_url TEXT");
  }
  if (!columnExists(database, "settings", "background_image_path")) {
    database.exec("ALTER TABLE settings ADD COLUMN background_image_path TEXT");
  }
  if (!columnExists(database, "settings", "thumbnail_image_path")) {
    database.exec("ALTER TABLE settings ADD COLUMN thumbnail_image_path TEXT");
  }
  if (!columnExists(database, "setting_beings", "location_id")) {
    database.exec(
      "ALTER TABLE setting_beings ADD COLUMN location_id INTEGER REFERENCES setting_locations(id) ON DELETE SET NULL"
    );
  }
  if (!tableExists(database, "setting_communities")) {
    database.exec(`CREATE TABLE setting_communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      folder_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
  }
  for (const column of ["history", "current_situation", "features", "goals"]) {
    if (!columnExists(database, "setting_communities", column)) {
      database.exec(`ALTER TABLE setting_communities ADD COLUMN ${column} TEXT DEFAULT ''`);
    }
  }
  if (!tableExists(database, "being_communities")) {
    database.exec(`CREATE TABLE being_communities (
      being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
      community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
      PRIMARY KEY (being_id, community_id)
    )`);
  }
  if (!columnExists(database, "statblocks", "format")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN format TEXT NOT NULL DEFAULT 'text'");
  }
  if (!columnExists(database, "statblocks", "theme")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN theme TEXT");
  }
  if (!columnExists(database, "statblocks", "density")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN density TEXT");
  }
  // Мягкое удаление статблока. Чарник — это часы работы (или импорт из LSS),
  // а сносился он по одному `confirm` и физическим DELETE, без отката. Строка
  // теперь помечается, а не удаляется; GET её не отдаёт, PUT /:id/restore
  // возвращает. В общий экран «Архив» статблоки не попадают: это часть
  // персонажа, а не самостоятельная сущность (см. SideWorks, Этап 0 п.4).
  if (!columnExists(database, "statblocks", "archived_at")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN archived_at TEXT");
  }
  if (!columnExists(database, "resources", "template_format")) {
    database.exec("ALTER TABLE resources ADD COLUMN template_format TEXT NOT NULL DEFAULT 'text'");
  }

  // The `ALTER TABLE resources ADD COLUMN system_id ...` above (when it first
  // ran, on any pre-existing DB) wrote a bare `REFERENCES systems(id)` with no
  // ON DELETE clause, unlike schema.sql's `ON DELETE SET NULL` — SQLite's
  // ALTER TABLE ADD COLUMN stores exactly the text given, and column FK
  // clauses can't be altered in place afterward. The mismatch means deleting
  // a system whose templates are `resources` rows fails with a FOREIGN KEY
  // constraint error instead of nulling system_id as intended. Detected by
  // checking the live column definition text (idempotent — a fresh DB or an
  // already-rebuilt one already has the clause and is left alone) and fixed
  // via SQLite's standard rebuild-and-swap (no in-place ALTER for this).
  const resourcesSql = (
    database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resources'")
      .get() as { sql: string } | undefined
  )?.sql;
  if (resourcesSql && !/REFERENCES systems\(id\)\s+ON DELETE SET NULL/i.test(resourcesSql)) {
    database.exec(`
      CREATE TABLE resources_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'note',
        scope TEXT NOT NULL DEFAULT 'global',
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
        system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
        template_kind TEXT,
        template_format TEXT NOT NULL DEFAULT 'text',
        file_path TEXT,
        link_url TEXT,
        tags TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      INSERT INTO resources_rebuild
        (id, name, type, scope, campaign_id, session_id, setting_id, system_id,
         template_kind, template_format, file_path, link_url, tags, notes, created_at, archived_at)
      SELECT
        id, name, type, scope, campaign_id, session_id, setting_id, system_id,
        template_kind, template_format, file_path, link_url, tags, notes, created_at, archived_at
      FROM resources;
      DROP TABLE resources;
      ALTER TABLE resources_rebuild RENAME TO resources;
    `);
  }
  if (!columnExists(database, "campaigns", "group_theme_litm")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN group_theme_litm TEXT");
  }
  if (!columnExists(database, "setting_locations", "map_image_path")) {
    database.exec("ALTER TABLE setting_locations ADD COLUMN map_image_path TEXT");
  }
  if (!tableExists(database, "location_pins")) {
    database.exec(`CREATE TABLE location_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      color TEXT,
      size REAL,
      border_color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  for (const column of ["color", "size", "border_color"]) {
    if (!columnExists(database, "location_pins", column)) {
      database.exec(`ALTER TABLE location_pins ADD COLUMN ${column} ${column === "size" ? "REAL" : "TEXT"}`);
    }
  }
  for (const column of ["map_max_zoom", "map_start_zoom", "map_goto_zoom"]) {
    if (!columnExists(database, "setting_locations", column)) {
      database.exec(`ALTER TABLE setting_locations ADD COLUMN ${column} REAL`);
    }
  }
  if (!columnExists(database, "setting_locations", "map_labels_always")) {
    database.exec(
      "ALTER TABLE setting_locations ADD COLUMN map_labels_always INTEGER NOT NULL DEFAULT 0"
    );
  }
  // Вес поведения локации: location — место, sector — контейнер, spot — точка
  // внутри родителя (план «Зоны локаций», этап 1). NOT NULL DEFAULT закрывает
  // существующие строки значением 'location' — поведение старых миров не меняется.
  // Подписи живут в словаре и меняются без миграции, стабильны только id.
  if (!columnExists(database, "setting_locations", "role")) {
    database.exec(
      "ALTER TABLE setting_locations ADD COLUMN role TEXT NOT NULL DEFAULT 'location'"
    );
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_setting_locations_role ON setting_locations(setting_id, role)"
  );
  // Backlink «сделать локацией» (план «Зоны», этап 8).
  if (!columnExists(database, "setting_locations", "origin_location_id")) {
    database.exec(
      "ALTER TABLE setting_locations ADD COLUMN origin_location_id INTEGER REFERENCES setting_locations(id) ON DELETE SET NULL"
    );
  }
  // Наполнение локаций/точек (план «Зоны локаций», этап 6).
  if (!tableExists(database, "location_content")) {
    database.exec(`CREATE TABLE location_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'feature',
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_location_content_location ON location_content(location_id)"
  );
  if (!columnExists(database, "setting_communities", "parent_id")) {
    database.exec(
      "ALTER TABLE setting_communities ADD COLUMN parent_id INTEGER REFERENCES setting_communities(id) ON DELETE CASCADE"
    );
  }
  if (!columnExists(database, "setting_communities", "thumbnail_image_path")) {
    database.exec("ALTER TABLE setting_communities ADD COLUMN thumbnail_image_path TEXT");
  }
  if (!columnExists(database, "setting_communities", "avatar_image_path")) {
    database.exec("ALTER TABLE setting_communities ADD COLUMN avatar_image_path TEXT");
  }
  if (!tableExists(database, "community_chapters")) {
    database.exec(`CREATE TABLE community_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!columnExists(database, "settings", "calendar_era")) {
    database.exec("ALTER TABLE settings ADD COLUMN calendar_era TEXT DEFAULT ''");
  }
  if (!tableExists(database, "setting_calendar_months")) {
    database.exec(`CREATE TABLE setting_calendar_months (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      days INTEGER NOT NULL DEFAULT 30
    )`);
  }
  if (!tableExists(database, "setting_calendar_weekdays")) {
    database.exec(`CREATE TABLE setting_calendar_weekdays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL
    )`);
  }
  for (const column of ["inworld_year", "inworld_month", "inworld_day"]) {
    if (!columnExists(database, "sessions", column)) {
      database.exec(`ALTER TABLE sessions ADD COLUMN ${column} INTEGER`);
    }
  }
  for (const column of ["inworld_year_end", "inworld_month_end", "inworld_day_end"]) {
    if (!columnExists(database, "sessions", column)) {
      database.exec(`ALTER TABLE sessions ADD COLUMN ${column} INTEGER`);
    }
  }
  if (!tableExists(database, "campaign_calendar_events")) {
    database.exec(`CREATE TABLE campaign_calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      inworld_year INTEGER NOT NULL,
      inworld_month INTEGER NOT NULL,
      inworld_day INTEGER NOT NULL,
      important INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "being_locations")) {
    database.exec(`CREATE TABLE being_locations (
      being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      PRIMARY KEY (being_id, location_id)
    )`);
    // Backfill from the old single-location column so existing data isn't lost.
    database.exec(`INSERT OR IGNORE INTO being_locations (being_id, location_id)
      SELECT id, location_id FROM setting_beings WHERE location_id IS NOT NULL`);
  }
  if (!tableExists(database, "community_locations")) {
    database.exec(`CREATE TABLE community_locations (
      community_id INTEGER NOT NULL REFERENCES setting_communities(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      PRIMARY KEY (community_id, location_id)
    )`);
  }
  if (!tableExists(database, "important_dates")) {
    database.exec(`CREATE TABLE important_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'once',
      year INTEGER,
      month INTEGER,
      day INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!columnExists(database, "setting_beings", "avatar_image_path")) {
    database.exec("ALTER TABLE setting_beings ADD COLUMN avatar_image_path TEXT");
  }
  if (!columnExists(database, "setting_beings", "thumbnail_image_path")) {
    database.exec("ALTER TABLE setting_beings ADD COLUMN thumbnail_image_path TEXT");
  }
  if (!columnExists(database, "important_dates", "source_event_id")) {
    database.exec("ALTER TABLE important_dates ADD COLUMN source_event_id INTEGER REFERENCES setting_calendar_events(id) ON DELETE CASCADE");
  }
  if (!columnExists(database, "campaigns", "pinned_calendar_year")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN pinned_calendar_year INTEGER");
  }
  if (!columnExists(database, "campaigns", "pinned_calendar_month")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN pinned_calendar_month INTEGER");
  }
  if (!columnExists(database, "campaigns", "type")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN type TEXT NOT NULL DEFAULT 'campaign'");
  }
  if (!columnExists(database, "campaigns", "payment_frequency")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN payment_frequency TEXT NOT NULL DEFAULT 'per_session'");
  }
  if (!columnExists(database, "campaigns", "rate_split")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN rate_split TEXT NOT NULL DEFAULT 'per_person'");
  }
  if (!columnExists(database, "settings", "pinned_calendar_year")) {
    database.exec("ALTER TABLE settings ADD COLUMN pinned_calendar_year INTEGER");
  }
  if (!columnExists(database, "settings", "pinned_calendar_month")) {
    database.exec("ALTER TABLE settings ADD COLUMN pinned_calendar_month INTEGER");
  }
  if (!tableExists(database, "setting_calendar_events")) {
    database.exec(`CREATE TABLE setting_calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      inworld_year INTEGER NOT NULL,
      inworld_month INTEGER NOT NULL,
      inworld_day INTEGER NOT NULL,
      important INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "app_settings")) {
    database.exec(`CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  }
  if (!tableExists(database, "system_sections")) {
    database.exec(`CREATE TABLE system_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'wiki',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "compendium_entries")) {
    database.exec(`CREATE TABLE compendium_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
      section_id INTEGER NOT NULL REFERENCES system_sections(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES compendium_entries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'wiki',
      name TEXT NOT NULL DEFAULT '',
      level INTEGER,
      data TEXT DEFAULT '{}',
      description TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // One-time backfill: migrate old single-value statblock/backstory-style fields into the
  // new multi-entry statblocks / character_chapters tables, so existing data isn't lost.
  const statblocksEmpty = (
    database.prepare("SELECT COUNT(*) as c FROM statblocks").get() as { c: number }
  ).c === 0;
  if (statblocksEmpty) {
    const charsWithStatblock = database
      .prepare("SELECT id, statblock FROM characters WHERE statblock IS NOT NULL AND statblock != ''")
      .all() as { id: number; statblock: string }[];
    const insertStatblock = database.prepare(
      "INSERT INTO statblocks (owner_type, owner_id, kind, content) VALUES (?, ?, ?, ?)"
    );
    for (const c of charsWithStatblock) {
      insertStatblock.run("character", c.id, "full", c.statblock);
    }
    const beingsWithStatblock = database
      .prepare(
        "SELECT id, statblock_short, statblock_full FROM setting_beings WHERE (statblock_short IS NOT NULL AND statblock_short != '') OR (statblock_full IS NOT NULL AND statblock_full != '')"
      )
      .all() as { id: number; statblock_short: string; statblock_full: string }[];
    for (const b of beingsWithStatblock) {
      if (b.statblock_short) insertStatblock.run("being", b.id, "short", b.statblock_short);
      if (b.statblock_full) insertStatblock.run("being", b.id, "full", b.statblock_full);
    }
  }

  const chaptersEmpty = (
    database.prepare("SELECT COUNT(*) as c FROM character_chapters").get() as { c: number }
  ).c === 0;
  if (chaptersEmpty) {
    const chars = database
      .prepare(
        "SELECT id, backstory, personal_arc, current_situation, future_thoughts FROM characters"
      )
      .all() as {
      id: number;
      backstory: string;
      personal_arc: string;
      current_situation: string;
      future_thoughts: string;
    }[];
    const insertChapter = database.prepare(
      "INSERT INTO character_chapters (character_id, section, title, content) VALUES (?, ?, '', ?)"
    );
    for (const c of chars) {
      if (c.backstory) insertChapter.run(c.id, "backstory", c.backstory);
      if (c.personal_arc) insertChapter.run(c.id, "personal_arc", c.personal_arc);
      if (c.current_situation) insertChapter.run(c.id, "current_situation", c.current_situation);
      if (c.future_thoughts) insertChapter.run(c.id, "future_thoughts", c.future_thoughts);
    }
  }

  // One-time backfill: fold each location's old single-text "description"
  // into the new location_chapters (articles) list, so it isn't lost.
  const locationChaptersEmpty = (
    database.prepare("SELECT COUNT(*) as c FROM location_chapters").get() as { c: number }
  ).c === 0;
  if (locationChaptersEmpty) {
    const locations = database
      .prepare("SELECT id, description FROM setting_locations WHERE description IS NOT NULL AND description != ''")
      .all() as { id: number; description: string }[];
    const insertLocationChapter = database.prepare(
      "INSERT INTO location_chapters (location_id, title, content) VALUES (?, '', ?)"
    );
    for (const l of locations) {
      insertLocationChapter.run(l.id, l.description);
    }
  }

  // One-time backfill: fold each community's four old single-text fields into
  // community_chapters (one initial article per section), so nothing is lost.
  const communityChaptersEmpty = (
    database.prepare("SELECT COUNT(*) as c FROM community_chapters").get() as { c: number }
  ).c === 0;
  if (communityChaptersEmpty) {
    const communitiesData = database
      .prepare("SELECT id, history, current_situation, features, goals FROM setting_communities")
      .all() as {
      id: number;
      history: string;
      current_situation: string;
      features: string;
      goals: string;
    }[];
    const insertCommunityChapter = database.prepare(
      "INSERT INTO community_chapters (community_id, section, title, content) VALUES (?, ?, '', ?)"
    );
    for (const c of communitiesData) {
      if (c.history) insertCommunityChapter.run(c.id, "history", c.history);
      if (c.current_situation) insertCommunityChapter.run(c.id, "current_situation", c.current_situation);
      if (c.features) insertCommunityChapter.run(c.id, "features", c.features);
      if (c.goals) insertCommunityChapter.run(c.id, "goals", c.goals);
    }
  }

  // Renamed from the earlier (incorrect) "Legends in the Mist". Runs before the seed
  // below so a plain rename is enough on most installs; on ones where a prior run
  // already seeded the correctly-named row (leaving both present), repoint anything
  // using the old row's id before dropping it, so campaigns/resources don't end up
  // with a dangling system_id.
  const oldSystem = database
    .prepare("SELECT id FROM systems WHERE name = 'Legends in the Mist'")
    .get() as { id: number } | undefined;
  if (oldSystem) {
    const newSystem = database
      .prepare("SELECT id FROM systems WHERE name = 'Legend in the Mist'")
      .get() as { id: number } | undefined;
    if (newSystem) {
      database.prepare("UPDATE campaigns SET system_id = ? WHERE system_id = ?").run(newSystem.id, oldSystem.id);
      database.prepare("UPDATE resources SET system_id = ? WHERE system_id = ?").run(newSystem.id, oldSystem.id);
      database.prepare("UPDATE mastering_notes SET system_id = ? WHERE system_id = ?").run(newSystem.id, oldSystem.id);
      database.prepare("DELETE FROM systems WHERE id = ?").run(oldSystem.id);
    } else {
      database.prepare("UPDATE systems SET name = 'Legend in the Mist' WHERE id = ?").run(oldSystem.id);
    }
  }

  // Skipped for the packaged "empty" build (see electron/main.js, which sets
  // this env var when it finds no bundled `seed` resources folder) — the
  // whole point of that flavor is a genuinely blank app, not four
  // already-created (if content-less) systems.
  //
  // П.0.4: сид выполняется ровно один раз за жизнь базы (флаг в app_settings),
  // а не на каждом старте. Раньше `INSERT OR IGNORE` шёл на каждом запуске
  // сервера, а AUTOINCREMENT резервирует слот из sqlite_sequence ещё до
  // проверки ограничения — то есть даже «проигнорированная» вставка
  // подкручивала счётчик systems без создания реальной системы. За месяц
  // разработки это раздуло seq до ~6900 при 4 живых системах. Флаг замыкает
  // сид на первую инициализацию — дальше он пропускается и счётчик не растёт.
  // П0.4: INSERT OR IGNORE с AUTOINCREMENT двигает sqlite_sequence даже при
  // игноре дубликата — 4× каждый перезапуск = тысячи за месяц. Проверяем
  // существование явно, чтобы не трогать последовательность впустую.
  if (process.env.SEED_DEFAULT_SYSTEMS !== "false" && !appSettingFlag(database, "default_systems_seeded")) {
    const exists = database.prepare("SELECT id FROM systems WHERE name = ?");
    const insert = database.prepare("INSERT INTO systems (name) VALUES (?)");
    for (const name of ["D&D 5.5", "Legend in the Mist", "City of Mist", "Daggerheart"]) {
      if (!exists.get(name)) insert.run(name);
    }
    setAppSettingFlag(database, "default_systems_seeded");
  }

  for (const column of ["description", "folder_path", "created_at", "archived_at", "thumbnail_image_path"]) {
    if (!columnExists(database, "systems", column)) {
      database.exec(
        `ALTER TABLE systems ADD COLUMN ${column} ${
          column === "description" ? "TEXT DEFAULT ''" : "TEXT"
        }`
      );
    }
  }
  const systemsWithoutFolder = database
    .prepare("SELECT id, name FROM systems WHERE folder_path IS NULL")
    .all() as { id: number; name: string }[];
  for (const s of systemsWithoutFolder) {
    database
      .prepare("UPDATE systems SET folder_path = ? WHERE id = ?")
      .run(systemFolder(s.name), s.id);
  }

  if (!tableExists(database, "modules")) {
    database.exec(`CREATE TABLE modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'system' | 'setting'
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local', -- 'local' (wraps a pre-existing row) | 'imported' (has source_json)
      source_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      setting_id INTEGER REFERENCES settings(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  if (!tableExists(database, "gallery_images")) {
    database.exec(`CREATE TABLE gallery_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL, -- 'character' | 'being'
      owner_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      caption TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  if (!tableExists(database, "gallery_image_undo")) {
    database.exec(`CREATE TABLE gallery_image_undo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archived_file_id INTEGER NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      caption TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  if (!columnExists(database, "players", "thumbnail_image_path")) {
    database.exec("ALTER TABLE players ADD COLUMN thumbnail_image_path TEXT");
  }
  if (!columnExists(database, "players", "avatar_image_path")) {
    database.exec("ALTER TABLE players ADD COLUMN avatar_image_path TEXT");
  }
  if (!columnExists(database, "setting_locations", "avatar_image_path")) {
    database.exec("ALTER TABLE setting_locations ADD COLUMN avatar_image_path TEXT");
  }
  if (!columnExists(database, "setting_locations", "thumbnail_image_path")) {
    database.exec("ALTER TABLE setting_locations ADD COLUMN thumbnail_image_path TEXT");
  }

  // Requirement 4: free-form tag capsules shown in the one-row Население/
  // Сообщества list layout — a JSON array of strings, same convention as
  // resources.tags.
  if (!columnExists(database, "setting_beings", "tags")) {
    database.exec("ALTER TABLE setting_beings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columnExists(database, "setting_communities", "tags")) {
    database.exec("ALTER TABLE setting_communities ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }

  // Being profiles: История/Поведение/Текущая ситуация become chapter-based
  // (mirroring community_chapters), with Текущая ситуация additionally
  // taggable to a campaign and markable as important.
  if (!tableExists(database, "being_chapters")) {
    database.exec(`CREATE TABLE being_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      important INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // One-time backfill so nothing is lost: history/behavior each become a
    // single initial chapter, and every existing being_events row becomes a
    // current_situation chapter (campaign derived transitively through its
    // linked session, since being_events never stored campaign_id directly).
    const beingsData = database
      .prepare("SELECT id, history, behavior FROM setting_beings")
      .all() as { id: number; history: string; behavior: string }[];
    const insertBeingChapter = database.prepare(
      "INSERT INTO being_chapters (being_id, section, title, content) VALUES (?, ?, '', ?)"
    );
    for (const b of beingsData) {
      if (b.history) insertBeingChapter.run(b.id, "history", b.history);
      if (b.behavior) insertBeingChapter.run(b.id, "behavior", b.behavior);
    }

    const events = database
      .prepare(
        `SELECT be.being_id, be.title, be.description, be.created_at, s.campaign_id
         FROM being_events be
         LEFT JOIN sessions s ON s.id = be.session_id`
      )
      .all() as { being_id: number; title: string; description: string; created_at: string; campaign_id: number | null }[];
    const insertEventChapter = database.prepare(
      `INSERT INTO being_chapters (being_id, section, title, content, campaign_id, created_at)
       VALUES (?, 'current_situation', ?, ?, ?, ?)`
    );
    for (const e of events) {
      insertEventChapter.run(e.being_id, e.title, e.description, e.campaign_id, e.created_at);
    }
  }

  // Supersedes being_relations: directional (from's opinion of to, not
  // assumed mutual) and polymorphic (being/character/community on either
  // side), so factions and player characters can carry described relations
  // too, not just being<->being.
  if (!tableExists(database, "entity_relations")) {
    database.exec(`CREATE TABLE entity_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_type TEXT NOT NULL,
      from_id INTEGER NOT NULL,
      to_type TEXT NOT NULL,
      to_id INTEGER NOT NULL,
      tone TEXT NOT NULL DEFAULT 'neutral',
      label TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_entity_relations_from ON entity_relations(from_type, from_id)`);
    database.exec(`CREATE INDEX idx_entity_relations_to ON entity_relations(to_type, to_id)`);

    // Backfill: old being_relations rows had no direction or tone, and were
    // shown identically from both beings' Связи tabs — mirror each row into
    // both directions here so nothing appears to vanish, defaulting tone to
    // neutral (the user can tune it per-direction afterwards).
    if (tableExists(database, "being_relations")) {
      const oldRelations = database
        .prepare("SELECT being_a_id, being_b_id, relation_type, description, created_at FROM being_relations")
        .all() as {
        being_a_id: number;
        being_b_id: number;
        relation_type: string;
        description: string;
        created_at: string;
      }[];
      const insertRelation = database.prepare(
        `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description, created_at)
         VALUES ('being', ?, 'being', ?, 'neutral', ?, ?, ?)`
      );
      for (const r of oldRelations) {
        insertRelation.run(r.being_a_id, r.being_b_id, r.relation_type, r.description, r.created_at);
        insertRelation.run(r.being_b_id, r.being_a_id, r.relation_type, r.description, r.created_at);
      }
    }
  }

  // Unified relations: extend entity_relations with section and origin from
  // generic_links, then migrate all generic_links rows into entity_relations.
  if (!columnExists(database, "entity_relations", "section")) {
    database.exec("ALTER TABLE entity_relations ADD COLUMN section TEXT");
  }
  if (!columnExists(database, "entity_relations", "origin")) {
    database.exec("ALTER TABLE entity_relations ADD COLUMN origin TEXT NOT NULL DEFAULT 'planned'");
  }
  // Migrate generic_links → entity_relations (one-time, idempotent via NOT EXISTS)
  if (tableExists(database, "generic_links")) {
    const glCount = (database.prepare("SELECT COUNT(*) as c FROM generic_links").get() as { c: number }).c;
    const erCount = (database.prepare("SELECT COUNT(*) as c FROM entity_relations").get() as { c: number }).c;
    // Only migrate if generic_links has rows that aren't yet in entity_relations
    if (glCount > 0) {
      const existingPairs = new Set(
        (database.prepare("SELECT from_type, from_id, to_type, to_id, section FROM entity_relations").all() as {
          from_type: string; from_id: number; to_type: string; to_id: number; section: string | null;
        }[]).map((r) => `${r.from_type}:${r.from_id}:${r.to_type}:${r.to_id}:${r.section ?? ""}`)
      );
      const links = database.prepare("SELECT * FROM generic_links").all() as {
        id: number; from_type: string; from_id: number; to_type: string; to_id: number;
        section: string | null; origin: string; created_at: string;
      }[];
      const insert = database.prepare(
        `INSERT OR IGNORE INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description, section, origin, created_at)
         VALUES (?, ?, ?, ?, 'neutral', '', '', ?, ?, ?)`
      );
      let migrated = 0;
      for (const l of links) {
        const key = `${l.from_type}:${l.from_id}:${l.to_type}:${l.to_id}:${l.section ?? ""}`;
        if (existingPairs.has(key)) continue;
        insert.run(l.from_type, l.from_id, l.to_type, l.to_id, l.section, l.origin ?? "planned", l.created_at);
        migrated++;
      }
      if (migrated > 0) console.log(`[db] Migrated ${migrated} generic_links → entity_relations`);
    }
  }

  // Sub-grouping within a resource's "type" — currently only used by the
  // session-page "Ресурсы" section (folder/pdf/image/audio/link/other), kept
  // separate from `type` so it doesn't collide with the existing
  // map/handout/note/statblock_template vocabulary.
  if (!columnExists(database, "resources", "category")) {
    database.exec("ALTER TABLE resources ADD COLUMN category TEXT");
  }

  // Optional real-world "HH:MM" start time, set from the Home calendar's new
  // session-creation flow and shown alongside the session on that calendar.
  if (!columnExists(database, "sessions", "start_time")) {
    database.exec("ALTER TABLE sessions ADD COLUMN start_time TEXT");
  }

  // Named, manually-ordered playlists of audio resources, owned by a session
  // or a setting. A session can also attach (not copy) a setting's playlist
  // via generic_links (section='attached_playlist'), same pattern as
  // attached_resource above.
  if (!tableExists(database, "playlists")) {
    database.exec(`CREATE TABLE playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "playlist_items")) {
    database.exec(`CREATE TABLE playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      custom_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!columnExists(database, "playlist_items", "custom_name")) {
    database.exec("ALTER TABLE playlist_items ADD COLUMN custom_name TEXT");
  }

  // Accounts for the remote/hosted deployment (see routes/auth.ts,
  // routes/player.ts) — irrelevant to the plain local desktop GM app.
  if (!tableExists(database, "users")) {
    database.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // "Видно игрокам" flags — the narrow, explicit-reveal content set (session
  // recap, setting lore articles, world chronicle). Secrets already model
  // reveal state via campaign_entries.status ('done' = revealed), reused
  // as-is rather than duplicated here.
  if (!columnExists(database, "sessions", "main_events_visible")) {
    database.exec("ALTER TABLE sessions ADD COLUMN main_events_visible INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "location_chapters", "visible_to_players")) {
    database.exec("ALTER TABLE location_chapters ADD COLUMN visible_to_players INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "being_chapters", "visible_to_players")) {
    database.exec("ALTER TABLE being_chapters ADD COLUMN visible_to_players INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "setting_calendar_events", "visible_to_players")) {
    database.exec("ALTER TABLE setting_calendar_events ADD COLUMN visible_to_players INTEGER NOT NULL DEFAULT 0");
  }

  // "Для игроков" tabs on campaign/setting profiles: GM-authored custom
  // sections on a campaign, plus per-player/per-campaign reveal grants that
  // also cover reused setting content (locations/beings/communities/chronicle).
  if (!tableExists(database, "campaign_player_sections")) {
    database.exec(`CREATE TABLE campaign_player_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'articles',
      folder_path TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "campaign_player_articles")) {
    database.exec(`CREATE TABLE campaign_player_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES campaign_player_sections(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  // Base alphabetical order with a persisted manual override — same "sort by
  // name, unless you've dragged it" pattern already used for gallery images
  // and playlist tracks (both already have a position column).
  if (!columnExists(database, "resources", "position")) {
    database.exec("ALTER TABLE resources ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Backfill: every existing resource gets an initial alphabetical
    // position within its scope, so the column starts useful instead of
    // all-zeros (which would fall back to insertion order).
    const groups = database
      .prepare(
        `SELECT id, COALESCE(scope,'') || '|' || COALESCE(campaign_id,'') || '|' || COALESCE(session_id,'') || '|' || COALESCE(setting_id,'') || '|' || COALESCE(system_id,'') as grp, name
         FROM resources ORDER BY grp, name COLLATE NOCASE`
      )
      .all() as { id: number; grp: string; name: string }[];
    const setPos = database.prepare("UPDATE resources SET position = ? WHERE id = ?");
    let lastGrp: string | null = null;
    let pos = 0;
    const backfill = database.transaction(() => {
      for (const row of groups) {
        if (row.grp !== lastGrp) {
          lastGrp = row.grp;
          pos = 0;
        }
        setPos.run(pos, row.id);
        pos++;
      }
    });
    backfill();
  }

  // "Идеи из интернета" and "Заметки по ведению" were the same tool (a free
  // title+content list) split across two tabs by category alone — merged
  // into one tab, so fold any existing internet_ideas rows into gm_notes.
  // Safe to re-run: a no-op once no rows remain in the old category.
  database.exec("UPDATE campaign_entries SET category = 'gm_notes' WHERE category = 'internet_ideas'");
  // Same merge, same reason, for the Setting profile's identical Заметки/
  // Идеи из интернета split.
  database.exec("UPDATE setting_entries SET category = 'notes' WHERE category = 'internet_ideas'");

  if (!tableExists(database, "setting_calendar_eras")) {
    database.exec(`CREATE TABLE setting_calendar_eras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_year INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // Generic creatures ("Гоблин-воин") move up to the system-level compendium
  // Бестиарий (compendium_entries, kind='monster') so they're defined once
  // per system instead of recreated in every setting. A setting-level being
  // (a named "личность") can optionally be created "on the basis of" one of
  // those templates — its statblock is cloned in at creation time (not live-
  // linked), this column just keeps the "based on: X" reference for display.
  if (!columnExists(database, "setting_beings", "base_monster_id")) {
    database.exec(
      "ALTER TABLE setting_beings ADD COLUMN base_monster_id INTEGER REFERENCES compendium_entries(id) ON DELETE SET NULL"
    );
  }

  if (!tableExists(database, "player_visibility_grants")) {
    database.exec(`CREATE TABLE player_visibility_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, player_id, target_type, target_id)
    )`);
    database.exec(`CREATE INDEX idx_player_visibility_grants_target ON player_visibility_grants(target_type, target_id)`);
    database.exec(`CREATE INDEX idx_player_visibility_grants_campaign_player ON player_visibility_grants(campaign_id, player_id)`);
  }

  // Player-authored "Исследование мира" journal — shared party-wide per
  // campaign, see schema.sql for field notes.
  if (!tableExists(database, "world_exploration_entries")) {
    database.exec(`CREATE TABLE world_exploration_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      extra_field TEXT NOT NULL DEFAULT '',
      avatar_image_path TEXT,
      folder_path TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
    database.exec(`CREATE INDEX idx_world_exploration_entries_campaign ON world_exploration_entries(campaign_id, kind)`);
  }

  // GM-authored reminders shown on a player's Главная in player-app — see
  // schema.sql for field notes.
  if (!tableExists(database, "gm_reminders")) {
    database.exec(`CREATE TABLE gm_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_gm_reminders_target ON gm_reminders(target_type, target_id)`);
  }

  // Пометка прочтения у посланий (2026-09-04). Нужна не для порядка, а
  // Мастеру за столом: отправив секрет, он хочет знать, дошло ли, не
  // спрашивая вслух. Существующие напоминания остаются непрочитанными —
  // это их честное состояние, ack у них никогда не было.
  if (tableExists(database, "gm_reminders") && !columnExists(database, "gm_reminders", "read_at")) {
    database.exec("ALTER TABLE gm_reminders ADD COLUMN read_at TEXT");
  }

  // Передачи вещей между персонажами игроков (этап 4б): оффер → принять /
  // отклонить → вернуть / сделать своим, деньги — мгновенно. Игрок не пишет
  // в чужой лист напрямую, поэтому посредником выступает сервер: он же
  // кладёт locked-строки в оба листа и рассылает обновления. Имена обеих
  // сторон хранятся рядом с id (правило «имя рядом с id»).
  if (!tableExists(database, "character_transfers")) {
    database.exec(`CREATE TABLE character_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL DEFAULT '',
      recipient_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      recipient_name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'item',
      item_name TEXT NOT NULL DEFAULT '',
      item_json TEXT NOT NULL DEFAULT '{}',
      qty INTEGER NOT NULL DEFAULT 1,
      coins_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'offered',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(
      `CREATE INDEX idx_character_transfers_parties ON character_transfers(sender_character_id, recipient_character_id, state)`
    );
  }

  // Стоимости способностей (структурность, гриллинг 2026-09-06): uses-стабы
  // без флага ownResource механики не имеют, а resource-стабы без ключа —
  // мёртвую кнопку траты. Миграция размечает детерминированные случаи;
  // остальное — флагом в редакторе. Одноразовая (флаг): повторный проход
  // затоптал бы ручные правки Мастера в справочнике.
  // Подпись владельца — в треде 2026-09-06 (списки A–D).
  if (!appSettingFlag(database, "ability_costs_v2")) {
    const setIfMissing = (id: number, cost: unknown) => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        return;
      }
      if (data.cost != null) return;
      data.cost = cost;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const replace = (id: number, cost: unknown) => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        return;
      }
      data.cost = cost;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const U = (amount: number, per: string) => ({ kind: "uses", amount, per, ownResource: true });
    // A: uses-стабы — флаг (значения уже стоят).
    for (const id of [12048, 12050, 12057, 12058, 12108, 12207, 12529, 12472, 12538, 12540, 12586, 12669]) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as { cost?: Record<string, unknown> };
        if (!data.cost || (data.cost.kind as string) !== "uses" || data.cost.ownResource) continue;
        data.cost = { ...data.cost, ownResource: true };
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    // C: resource-стабы без ключа.
    replace(12047, { kind: "resource", resourceKey: "bardic_inspiration", amount: 1 });
    replace(12239, { kind: "resource", resourceLabel: "Очки чародейства", amount: 5 });
    replace(12467, { kind: "resource", resourceLabel: "Очки чародейства", amount: 1 });
    // Подчинение удачи: редакция 2024 — 1 очко чародейства (не 2 как в 2014).
    replace(12241, { kind: "resource", resourceLabel: "Очки чародейства", amount: 1 });
    replace(12366, { kind: "uses", amount: 1, per: "long_rest", ownResource: true, restore: { pool: "Очки чародейства", amount: 3 } });
    replace(12468, { kind: "uses", amount: 1, per: "long_rest", ownResource: true, restore: { pool: "Очки чародейства", amount: 7 } });
    // D: с нуля.
    setIfMissing(12477, U(1, "long_rest"));
    setIfMissing(12103, U(2, "long_rest"));
    setIfMissing(12248, U(1, "long_rest"));
    setAppSettingFlag(database, "ability_costs_v2");
  }

  // Пулы Артефактора от модификатора Интеллекта (аудит класса, 2026-09-07):
  // по книге лимит использований — мод INT, а не константа. Код пулы от
  // характеристики уже умеет (DndCost.maxAbility/maxMultiplier), редактор —
  // тоже, данные — нет. Дописываем слиянием в существующий cost, чужие поля
  // (kind/per/ownResource/restore) не трогаем. Одноразовая (флаг): повторный
  // проход затоптал бы ручные правки Мастера в справочнике.
  // 12108 Магия вещей — мод INT (мин. 1); 12586 Проблеск гениальности — мод
  // INT (мин. 1); 12472 Восстанавливающие реагенты — мод INT (мин. 1);
  // 12669 Хранящий заклинания предмет — удвоенный мод INT (мин. дважды).
  if (!appSettingFlag(database, "ability_costs_int_pools")) {
    const setIntPool = (id: number, maxMultiplier?: number) => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        return;
      }
      const prev =
        data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
          ? (data.cost as Record<string, unknown>)
          : {};
      const fallbackAmount = typeof prev.amount === "number" && prev.amount > 0 ? prev.amount : maxMultiplier && maxMultiplier > 1 ? maxMultiplier : 1;
      const next: Record<string, unknown> = {
        kind: "uses",
        amount: fallbackAmount,
        per: "long_rest",
        ownResource: true,
        ...prev,
      };
      // Ручную характеристику Мастера не перебиваем — дописываем только
      // недостающее (миграция одноразовая, но аккуратность дешевле споров).
      if (typeof next.maxAbility !== "string" || !next.maxAbility) next.maxAbility = "int";
      if (maxMultiplier && maxMultiplier > 1 && next.maxMultiplier == null) next.maxMultiplier = maxMultiplier;
      data.cost = next;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    setIntPool(12108);
    setIntPool(12586);
    setIntPool(12472);
    setIntPool(12669, 2);
    setAppSettingFlag(database, "ability_costs_int_pools");
  }

  // Активация умений тратой ячейки (аудит Артефактора, 2026-09-07): повторное
  // создание пушки и доп. эликсиры — за слот сверх бесплатных использований,
  // воскрешение защитника — всегда за слот. Карточка умения (SpendAction)
  // такую кнопку уже умеет (DndCost.slotSpend), данные — нет. Слиянием:
  // отсутствующий cost выставляем целиком, у существующего дописываем только
  // недостающий флаг. Одноразовая (флаг).
  // 12244 Мистическая пушка — 1/долгий + слот; 12243 Экспериментальный
  // эликсир — 2/долгий + слот; 12371 Стальной защитник — только слот.
  if (!appSettingFlag(database, "ability_costs_slot_spend")) {
    const setSlotSpend = (id: number, poolAmount: number | null) => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        return;
      }
      const prev =
        data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
          ? (data.cost as Record<string, unknown>)
          : null;
      if (!prev) {
        data.cost =
          poolAmount != null
            ? { kind: "uses", amount: poolAmount, per: "long_rest", ownResource: true, slotSpend: true }
            : { kind: "none", slotSpend: true };
      } else if (prev.slotSpend == null) {
        prev.slotSpend = true;
      }
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    setSlotSpend(12244, 1);
    setSlotSpend(12243, 2);
    setSlotSpend(12371, null);
    setAppSettingFlag(database, "ability_costs_slot_spend");
  }

  // Формульный лимит подготовленных (аудит Артефактора, 2026-09-07): готовит
  // мод INT + половина уровня (вниз, мин. 1), а статика колонки «Подготовленные
  // заклинания» при нештатном INT врёт тихо. Маркер — поле prepared_formula у
  // записи класса: код имён классов не знает, счётчик формулу уже умеет
  // (classPreparedFormula). Только недостающее поле, во всех системах;
  // ручной маркер Мастера не перебиваем. Одноразовая (флаг).
  if (!appSettingFlag(database, "class_prepared_formula_artificer")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.prepared_formula != null) continue;
      data.prepared_formula = "mod_plus_half_level";
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Формула подготовленных Артефактора: записей: ${fixed}`);
    setAppSettingFlag(database, "class_prepared_formula_artificer");
  }

  // Откат маркера выше (2026-09-07, текст умения): в этой редакции
  // («Кузня Артефактора») лимит подготовленных — столбец таблицы, а не
  // мод INT + пол-уровня (то было правило Таши). Механизм формулы в коде
  // остаётся (без маркера инертен, годится хоумбрю), с записи — снимаем.
  if (!appSettingFlag(database, "class_prepared_formula_artificer_revert")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.prepared_formula == null) continue;
      delete data.prepared_formula;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Маркер формулы подготовленных снят: записей: ${fixed}`);
    setAppSettingFlag(database, "class_prepared_formula_artificer_revert");
  }

  // Округление вверх в мультиклассе (аудит Артефактора, 2026-09-07): его
  // собственный подсчёт — уровень/2 вверх, у остальных половинчатых вниз.
  // Маркер — поле round_up_multiclass у записи класса (effectiveCasterLevel
  // его уже умеет). Только недостающее поле, во всех системах. Одноразовая.
  if (!appSettingFlag(database, "class_round_up_artificer")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.round_up_multiclass != null) continue;
      data.round_up_multiclass = true;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Округление вверх Артефактора: записей: ${fixed}`);
    setAppSettingFlag(database, "class_round_up_artificer");
  }

  // Откат маркера выше (2026-09-07): округление вверх — правило Таши, а в
  // данных этой редакции подтверждающего текста нет (поиск по справочнику
  // пуст). Без доказательств — общий знаменатель: половина вниз, как у всех
  // половинчатых. Механизм в коде остаётся (без маркера инертен): найдётся
  // правило в книге — вернётся одной миграцией.
  if (!appSettingFlag(database, "class_round_up_artificer_revert")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.round_up_multiclass == null) continue;
      delete data.round_up_multiclass;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Маркер округления вверх снят: записей: ${fixed}`);
    setAppSettingFlag(database, "class_round_up_artificer_revert");
  }

  // Возврат маркера (2026-09-07, аудит по эталону): next.dnd.su, раздел
  // мультикласса — «вы добавляете в уровень заклинателя половину уровней
  // Артефактора (округляя вверх)». Дословно, сомнения сняты. Механизм в коде
  // всё это время был на месте (isRoundUpCaster), маркер — только данным.
  if (!appSettingFlag(database, "class_round_up_artificer_v2")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Артефактор'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.round_up_multiclass === true) continue;
      data.round_up_multiclass = true;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Округление вверх Артефактора (подтверждено эталоном): записей: ${fixed}`);
    setAppSettingFlag(database, "class_round_up_artificer_v2");
  }

  // Переименование «Скольжение» → «Намасливание» (2026-09-07): запись 13571 —
  // это Grease (name_original), а «Скольжение» уходит в алиасы, чтобы старый
  // поиск и упоминания не осиротели. Ссылки-mention идут по uid и переживают
  // переименование сами; три текстовых упоминания правим точечно (предмет
  // «Масло скольжения» — другое имя, не трогаем). Листы подхватят новое имя
  // сами (resolveSpell берёт имя из записи). Одноразовая (флаг).
  if (!appSettingFlag(database, "spell_rename_grease")) {
    const spell = database.prepare("SELECT name, aliases FROM compendium_entries WHERE id = 13571").get() as
      | { name: string; aliases: string | null }
      | undefined;
    if (spell) {
      let aliases: string[];
      try {
        const v: unknown = JSON.parse(spell.aliases || "[]");
        aliases = Array.isArray(v) ? (v as unknown[]).filter((a): a is string => typeof a === "string") : [];
      } catch {
        aliases = [];
      }
      if (spell.name !== "Намасливание") {
        if (!aliases.includes("Скольжение")) aliases.push("Скольжение");
        database
          .prepare("UPDATE compendium_entries SET name = ?, aliases = ? WHERE id = 13571")
          .run("Намасливание", JSON.stringify(aliases));
      }
      const fixDesc = (id: number, from: string, to: string) => {
        const row = database.prepare("SELECT description FROM compendium_entries WHERE id = ?").get(id) as
          | { description: string | null }
          | undefined;
        if (!row?.description || !row.description.includes(from)) return;
        database
          .prepare("UPDATE compendium_entries SET description = ? WHERE id = ?")
          .run(row.description.replace(from, to), id);
      };
      // Таблица дикой магии, рекомендация в Сотворении (метка uid-ссылки),
      // эффект масла: везде имеется в виду заклинание.
      fixDesc(11970, "5 — Скольжение;", "5 — Намасливание;");
      fixDesc(11971, "|Скольжение]]", "|Намасливание]]");
      fixDesc(13597, "эффект заклинания Скольжение", "эффект заклинания Намасливание");
    }
    setAppSettingFlag(database, "spell_rename_grease");
  }

  // Призыв гомункула заклинанием (2026-09-07): чертёж тела в data.summon
  // записи 14812 «Гомункул-слуга» — КЗ 13, хиты 5+5×круг ячейки, лимит 1
  // (новый каст заменяет), перманентный (отдыхом не трогаем). Механизм общий
  // (companionFormula + ряд спутников), слиянием только недостающее.
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "spell_summon_homunculus")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 14812").get() as
      | { data: string }
      | undefined;
    if (row) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        data = {};
      }
      if (data.summon == null && data && typeof data === "object" && !Array.isArray(data)) {
        data.summon = {
          name: "Гомункул-слуга",
          ac: "13",
          hp: "5+5*spell",
          maxCount: 1,
          expiry: "permanent",
          actions: [
            { name: "Силовой удар", note: "атака заклинанием, 5 фт/30 фт, 1к6+круг силовым полем" },
            { name: "Проведение магии", note: "реакция: передать касательное заклинание в пределах 120 футов" },
          ],
        };
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 14812").run(JSON.stringify(data));
      }
    }
    setAppSettingFlag(database, "spell_summon_homunculus");
  }

  // Эликсиры 2→3→4→5 (аудит 2026-09-07, эталон): бесплатных эликсиров за
  // долгий отдых 2 на 3-м, 3 на 5-м, 4 на 9-м, 5 на 15-м. Механизм levelSteps
  // в коде (featurePools считает по уровню класса-хозяина), сюда — только
  // пороги слиянием. Одноразовая (флаг).
  if (!appSettingFlag(database, "ability_costs_elixir_steps")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12243").get() as
      | { data: string }
      | undefined;
    if (row) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        data = {};
      }
      const cost =
        data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
          ? (data.cost as Record<string, unknown>)
          : null;
      if (cost && cost.levelSteps == null) {
        cost.levelSteps = [
          { level: 3, max: 2 },
          { level: 5, max: 3 },
          { level: 9, max: 4 },
          { level: 15, max: 5 },
        ];
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12243").run(JSON.stringify(data));
        console.log("[db] Эликсиры: скейл 2→3→4→5 проставлен");
      }
    }
    setAppSettingFlag(database, "ability_costs_elixir_steps");
  }

  // Гранты короткого отдыха (аудит 2026-09-07, эталон): 12706 «Отдохнувший
  // гений» — +1 использование Проблеска; 12813 «Магическое наставление» —
  // всё, если настроен хотя бы на один предмет (условие проверяет лист по
  // attunementCount). Обе записи пассивные (без тайминга) — грант виден
  // только в модалке отдыха. Слиянием, только недостающее. Одноразовая.
  if (!appSettingFlag(database, "ability_short_rest_grants")) {
    const grant = (id: number, shortRest: Record<string, unknown>) => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        return;
      }
      const cost =
        data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
          ? (data.cost as Record<string, unknown>)
          : null;
      if (cost) {
        if (cost.shortRest == null) {
          cost.shortRest = shortRest;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } else {
        data.cost = { kind: "none", shortRest };
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        console.log(`[db] Грант короткого отдыха: cost создан для ${id}`);
      }
    };
    grant(12706, { pool: "Проблеск гениальности", amount: 1 });
    grant(12813, { pool: "Проблеск гениальности", amount: "full", needsAttuned: true });
    setAppSettingFlag(database, "ability_short_rest_grants");
  }

  // Обман смерти (аудит 2026-09-07, эталон): «Душа творения» — на нуле хитов
  // (не мгновенная смерть) разрушить N необычных/редких реплик → хиты 20×N.
  // Кнопка живёт в блоке спасбросков (компонент SoulCheat), редкость читается
  // из записи схемы. Слиянием, только недостающее. Одноразовая (флаг).
  if (!appSettingFlag(database, "artificer_death_cheat")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12813").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        const cost =
          data.cost && typeof data.cost === "object" && !Array.isArray(data.cost)
            ? (data.cost as Record<string, unknown>)
            : null;
        if (cost && cost.deathCheat == null) {
          cost.deathCheat = { rarities: ["Необычный", "Редкий"], hpPer: 20 };
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12813").run(JSON.stringify(data));
          console.log("[db] Обман смерти: флаг на Душе творения");
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }
    setAppSettingFlag(database, "artificer_death_cheat");
  }

  // Бонус бронника-9 к репликам (аудит 2026-09-07, эталон): +1 известная схема
  // и +1 создаваемый предмет, оба строго доспехи. Маркер replicaBonus у записи
  // 12541; лист показывает строкой в блоке реплик (не форсинг — R4).
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "artificer_armorer_bonus")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12541").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data && typeof data === "object" && !Array.isArray(data) && data.replicaBonus == null) {
          data.replicaBonus = { schemes: 1, items: 1, note: "только доспехи" };
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12541").run(JSON.stringify(data));
          console.log("[db] Бонус бронника к репликам проставлен");
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }
    setAppSettingFlag(database, "artificer_armorer_bonus");
  }

  // Таблица эликсиров 1к6 (аудит, удобство алхимика): коробка «Эликсиры на
  // руках» в карточке умения читает её из данных. Короткие строки с числами
  // книги (скейл 9/15 — в строке, полный текст — в описании рядом).
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "artificer_elixir_table")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12243").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data && typeof data === "object" && !Array.isArray(data) && data.elixirTable == null) {
          data.elixirTable = [
            { key: "heal", name: "Лечение", short: "2к8 + INT хитов; 9/15 ур.: 3к8/4к6" },
            { key: "swift", name: "Стремительность", short: "+10 к скорости, 1 час; 9/15: 15/20 футов" },
            { key: "tough", name: "Устойчивость", short: "+1 КЗ, 10 мин; 9/15: 1 час/8 часов" },
            { key: "bold", name: "Смелость", short: "+1к4 к атакам и спасброскам, 1 мин; 9/15: 10 мин/1 час" },
            { key: "flight", name: "Полёт", short: "полёт 10 футов, 10 мин; 9/15: 20/30 футов" },
            { key: "choice", name: "На выбор", short: "эффект на ваш выбор (кубик 6, эликсир за ячейку)" },
          ];
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12243").run(JSON.stringify(data));
          console.log("[db] Таблица эликсиров проставлена");
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }
    setAppSettingFlag(database, "artificer_elixir_table");
  }

  // Дубли строк «Действий» (аудит вкладки, 2026-09-07): у 12538 и 12588 всё
  // trackable-содержимое переехало в дочерние строки (котёл; полёт/притяжка),
  // а сами они висят без бросков/цен. Тайминг снимаем — тексты остаются в
  // списке особенностей. Одноразовая (флаг).
  if (!appSettingFlag(database, "artificer_dedup_rows")) {
    for (const id of [12538, 12588]) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.casting_timing != null) {
          delete data.casting_timing;
          delete data.casting_timing_other;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
          console.log(`[db] Строка-дубль убрана из Действий: ${id}`);
        }
      } catch {
        // Битый JSON — не наша авария.
      }
    }
    setAppSettingFlag(database, "artificer_dedup_rows");
  }

  // Воин (аудит класса, 2026-09-07): три расходуемых пула вместо полутора.
  // Второе дыхание жило дважды — колонкой таблицы развития и собственным
  // пулом умения (cost uses+ownResource с фиксированным запасом 2): в
  // «Ресурсах» висели два одинаковых пула с разными максимумами, а кнопка
  // траты из карточки списывала только свой. Всплеск действий и Упорный не
  // отслеживались вовсе — ни колонок в прогрессии, ни cost у умений.
  // Чинится данными, код трогать не надо: лист читает cost
  // (resolveFeature) и прогрессию (resourceSources) живьём, правки
  // подхватываются существующими персонажами без их миграций.
  // Одноразовая (флаг): повторный проход затоптал бы ручные правки Мастера
  // в справочнике, поэтому всё ниже — setIfMissing либо замена строго
  // известной плохой формы.
  if (!appSettingFlag(database, "fighter_costs_v1")) {
    const readEntryData = (id: number): Record<string, unknown> | null => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.data || "{}") as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const writeEntryData = (id: number, data: Record<string, unknown>) => {
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const setCostIfMissing = (id: number, cost: unknown) => {
      const data = readEntryData(id);
      if (!data || data.cost != null) return;
      data.cost = cost;
      writeEntryData(id, data);
    };
    // 1. Второе дыхание (12058): собственный пул -> ссылка на табличный
    // («Второе дыхание» из прогрессии, ключ prog:12191:c4). Заменяем только
    // известную плохую форму {uses, 2, short_rest, ownResource}.
    {
      const data = readEntryData(12058);
      const cost = (data?.cost ?? null) as Record<string, unknown> | null;
      if (
        data &&
        cost &&
        cost.kind === "uses" &&
        cost.amount === 2 &&
        cost.per === "short_rest" &&
        cost.ownResource === true
      ) {
        data.cost = { kind: "resource", resourceLabel: "Второе дыхание" };
        writeEntryData(12058, data);
      }
    }
    // 2. Умения без стоимости — ссылка на свой пул из прогрессии.
    // Тактический разум тратит использование Второго дыхания (кнопка жмётся
    // по факту успеха — игрок видит бросок раньше, чем трату, поэтому
    // «не тратится при провале» остаётся на его совести, как и было).
    setCostIfMissing(12317, { kind: "resource", resourceLabel: "Всплеск действий" });
    setCostIfMissing(12695, { kind: "resource", resourceLabel: "Упорный" });
    setCostIfMissing(12423, { kind: "resource", resourceLabel: "Второе дыхание" });
    // 3. Прогрессия Воина (12191): колонке Второго дыхания — короткий отдых,
    // плюс две новые resource-колонки. «—» скрывает пул на уровнях, где
    // умения ещё нет (columnsAtLevel отбрасывает прочерки).
    {
      const data = readEntryData(12191);
      const progression = (data?.progression ?? null) as {
        columns?: { key: string; label: string; role: string; recharge?: string }[];
        rows?: Record<string, string>[];
      } | null;
      const keys = new Set((progression?.columns ?? []).map((c) => c.key));
      if (data && progression && Array.isArray(progression.columns) && Array.isArray(progression.rows)) {
        const levelOf = (row: Record<string, string>): number => {
          const levelCol = progression.columns!.find((c) => c.role === "level");
          const n = parseInt(String(row[levelCol?.key ?? "c1"] ?? "").replace(/[^\d]/g, ""), 10);
          return Number.isFinite(n) ? n : 0;
        };
        for (const col of progression.columns) {
          if (col.key === "c4" && !col.recharge) col.recharge = "short";
        }
        if (!keys.has("c6")) {
          progression.columns.push({ key: "c6", label: "Всплеск действий", role: "resource", recharge: "short" });
          for (const row of progression.rows) {
            const lvl = levelOf(row);
            row.c6 = lvl < 2 ? "—" : lvl < 17 ? "1" : "2";
          }
        }
        if (!keys.has("c7")) {
          progression.columns.push({ key: "c7", label: "Упорный", role: "resource", recharge: "long" });
          for (const row of progression.rows) {
            const lvl = levelOf(row);
            row.c7 = lvl < 9 ? "—" : lvl < 13 ? "1" : lvl < 17 ? "2" : "3";
          }
        }
        data.progression = progression;
        writeEntryData(12191, data);
      }
    }
    setAppSettingFlag(database, "fighter_costs_v1");
  }

  // Подклассы Воина (аудит класса, 2026-09-07, заход 2): у Мистического рыцаря
  // появляются ячейки/заговоры/подготовленные, у Мастера боевых искусств —
  // кости превосходства, у Пси-воина — кости пси-энергии. Числа — по таблице
  // PHB 2024 (ЭК: заговоры 2→3 на 10, ячейки 1–4 кругов, подготовленные
  // 3→13; БМ: кости 4→5 на 7→6 на 15, грань к8→к10 на 10→к12 на 18, манёвры
  // 3→5→7→9; Пси: 4к6→6к8→8к8→8к10→10к10→12к12).
  // Прогрессия лежит в data.progression записи подкласса и читается листом
  // наравне с классовой (subProgression в слотах/лимитах/ресурсах), уровень —
  // уровень базового класса. Редактор справочника её тоже умеет (вкладка
  // «Таблица развития» у подкласса), поэтому сеем только при отсутствии:
  // правка Мастера главнее посева.
  // Речардж костей Пси — приближение: по книге на коротком возвращается 1
  // кость, а модель recharge умеет только «все/ничего» (та же оговорка, что
  // у Второго дыхания).
  if (!appSettingFlag(database, "fighter_subclass_v1")) {
    const readSub = (id: number): Record<string, unknown> | null => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.data || "{}") as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const writeSub = (id: number, data: Record<string, unknown>) => {
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const setSubCostIfMissing = (id: number, cost: unknown) => {
      const data = readSub(id);
      if (!data || data.cost != null) return;
      data.cost = cost;
      writeSub(id, data);
    };
    type ProgCol = { key: string; label: string; role: string; recharge?: string };
    const levels = Array.from({ length: 20 }, (_, i) => i + 1);
    const prog = (columns: ProgCol[], cell: (level: number) => Record<string, string>) => ({
      columns,
      rows: levels.map((lvl) => ({ c1: String(lvl), ...cell(lvl) })),
    });
    // Мистический рыцарь (12937):cantrips/prepared/slot1-4. Пустые строки на
    // 1–2 уровнях — подкласса там ещё нет, лимитов быть не должно.
    {
      const data = readSub(12937);
      if (data && data.progression == null) {
        const ek: Record<number, { cant: string; prep: string; s: [string, string, string, string] }> = {
          3: { cant: "2", prep: "3", s: ["2", "", "", ""] },
          4: { cant: "2", prep: "4", s: ["3", "", "", ""] },
          5: { cant: "2", prep: "4", s: ["3", "", "", ""] },
          6: { cant: "2", prep: "4", s: ["3", "", "", ""] },
          7: { cant: "2", prep: "5", s: ["4", "2", "", ""] },
          8: { cant: "2", prep: "6", s: ["4", "2", "", ""] },
          9: { cant: "2", prep: "6", s: ["4", "2", "", ""] },
          10: { cant: "3", prep: "7", s: ["4", "3", "", ""] },
          11: { cant: "3", prep: "8", s: ["4", "3", "", ""] },
          12: { cant: "3", prep: "8", s: ["4", "3", "", ""] },
          13: { cant: "3", prep: "9", s: ["4", "3", "2", ""] },
          14: { cant: "3", prep: "10", s: ["4", "3", "2", ""] },
          15: { cant: "3", prep: "10", s: ["4", "3", "2", ""] },
          16: { cant: "3", prep: "11", s: ["4", "3", "3", ""] },
          17: { cant: "3", prep: "11", s: ["4", "3", "3", ""] },
          18: { cant: "3", prep: "11", s: ["4", "3", "3", ""] },
          19: { cant: "3", prep: "12", s: ["4", "3", "3", "1"] },
          20: { cant: "3", prep: "13", s: ["4", "3", "3", "1"] },
        };
        data.progression = prog(
          [
            { key: "c1", label: "Ур.", role: "level" },
            { key: "c2", label: "Заговоры", role: "cantrips" },
            { key: "c3", label: "Подготовленные", role: "prepared" },
            { key: "c4", label: "Ячейки 1", role: "slot1" },
            { key: "c5", label: "Ячейки 2", role: "slot2" },
            { key: "c6", label: "Ячейки 3", role: "slot3" },
            { key: "c7", label: "Ячейки 4", role: "slot4" },
          ],
          (lvl) => {
            const r = ek[lvl];
            return r
              ? { c2: r.cant, c3: r.prep, c4: r.s[0], c5: r.s[1], c6: r.s[2], c7: r.s[3] }
              : { c2: "", c3: "", c4: "", c5: "", c6: "", c7: "" };
          }
        );
        if (typeof data.spellcasting_ability !== "string" || !data.spellcasting_ability) {
          data.spellcasting_ability = "Интеллект";
        }
        writeSub(12937, data);
      }
    }
    // Мастер боевых искусств (12889): пул костей на короткий отдых целиком
    // (по книге так и есть), грань и число манёвров — показателями.
    {
      const data = readSub(12889);
      if (data && data.progression == null) {
        data.progression = prog(
          [
            { key: "c1", label: "Ур.", role: "level" },
            { key: "c2", label: "Кости превосходства", role: "resource", recharge: "short" },
            { key: "c3", label: "Кость превосходства", role: "stat" },
            { key: "c4", label: "Манёвры", role: "stat" },
          ],
          (lvl) => {
            if (lvl < 3) return { c2: "—", c3: "—", c4: "—" };
            return {
              c2: lvl < 7 ? "4" : lvl < 15 ? "5" : "6",
              c3: lvl < 10 ? "к8" : lvl < 18 ? "к10" : "к12",
              c4: lvl < 7 ? "3" : lvl < 10 ? "5" : lvl < 15 ? "7" : "9",
            };
          }
        );
        writeSub(12889, data);
      }
    }
    // Пси-воин (12959): число и грань костей по таблице книги.
    {
      const data = readSub(12959);
      if (data && data.progression == null) {
        data.progression = prog(
          [
            { key: "c1", label: "Ур.", role: "level" },
            { key: "c2", label: "Кости псионической энергии", role: "resource", recharge: "short" },
            { key: "c3", label: "Кость псионической энергии", role: "stat" },
          ],
          (lvl) => {
            if (lvl < 3) return { c2: "—", c3: "—" };
            return {
              c2: lvl < 5 ? "4" : lvl < 9 ? "6" : lvl < 11 ? "8" : lvl < 13 ? "8" : lvl < 17 ? "10" : "12",
              c3: lvl < 5 ? "к6" : lvl < 11 ? "к8" : lvl < 17 ? "к10" : "к12",
            };
          }
        );
        writeSub(12959, data);
      }
    }
    setSubCostIfMissing(12059, { kind: "resource", resourceLabel: "Кости превосходства" });
    setSubCostIfMissing(11925, { kind: "resource", resourceLabel: "Кости псионической энергии" });
    setAppSettingFlag(database, "fighter_subclass_v1");
  }

  // Недостающие подклассы Воина (аудит, 2026-09-07, заход 3): Баннерет и
  // Чародейный стрелок — с полными текстами умений, прогрессиями и ценами.
  // Плюс каталог боевых приёмов (20) и чародейных выстрелов (8) записями
  // механик:Selectable-списка «выбери N» в приложении пока нет, поэтому
  // приёмы лежат справочником (читаются, упоминаются ссылками), а счётчики
  // известных (БМ: 3→5→7→9, стрелок: 2→3→4→5→6) — показателями в прогрессиях.
  // Одноразовая (флаг); вставки — только при отсутствии (идемпотентно).
  if (!appSettingFlag(database, "fighter_new_subclasses_v1")) {
    const fighterRow = database
      .prepare("SELECT system_id AS sysId, section_id AS sectionId FROM compendium_entries WHERE id = 12191")
      .get() as { sysId: number; sectionId: number } | undefined;
    const mechGroupRow = database
      .prepare(
        "SELECT id, section_id AS sectionId FROM compendium_entries WHERE parent_id IS NULL AND name = ?"
      )
      .get("Мастерство оружия") as { id: number; sectionId: number } | undefined;
    if (fighterRow && mechGroupRow) {
      const { sysId, sectionId: classSection } = fighterRow;
      const mechSection = mechGroupRow.sectionId;
      const findChild = (parentId: number | null, kind: string, name: string): number | null => {
        const sql =
          parentId == null
            ? "SELECT id FROM compendium_entries WHERE parent_id IS NULL AND section_id = ? AND kind = ? AND name = ?"
            : "SELECT id FROM compendium_entries WHERE parent_id = ? AND kind = ? AND name = ?";
        const args = parentId == null ? [mechSection, kind, name] : [parentId, kind, name];
        const row = database.prepare(sql).get(...args) as { id: number } | undefined;
        return row ? row.id : null;
      };
      const nextPos = (parentId: number | null): number => {
        const sql =
          parentId == null
            ? "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE parent_id IS NULL AND section_id = ?"
            : "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE parent_id = ?";
        const arg = parentId == null ? mechSection : parentId;
        return (database.prepare(sql).get(arg) as { p: number }).p;
      };
      const insertEntry = (
        section: number,
        parentId: number | null,
        kind: string,
        name: string,
        original: string,
        level: number | null,
        data: Record<string, unknown>,
        description: string
      ): number => {
        const info = database
          .prepare(
            "INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, name_original, level, data, description, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(sysId, section, parentId, kind, name, original, level, JSON.stringify(data), description, nextPos(parentId));
        return Number(info.lastInsertRowid);
      };
      const featData = (extra?: Record<string, unknown>): Record<string, unknown> => ({
        checks: [],
        effects: [],
        ...extra,
      });
      const shotPool = { kind: "resource", resourceLabel: "Чародейные выстрелы" };
      const supPool = { kind: "resource", resourceLabel: "Кости превосходства" };

      // ——— Баннерет ———
      let banneret = findChild(12191, "subclass", "Баннерет");
      if (banneret == null) {
        banneret = insertEntry(
          classSection,
          12191,
          "subclass",
          "Баннерет",
          "Banneret",
          null,
          {},
          "Баннереты — образцы доблести и предводительства. В одиночку это умелые бойцы, но во главе союзников они превращают даже плоховооружённое ополчение в свирепый отряд."
        );
      }
      const banneretFeats: [number, string, string][] = [
        [3, "Посланник рыцарства",
          "Вы знаете, как подобает держаться благородному посланнику, и получаете следующие преимущества.\n\n**Понимание.** Вы можете накладывать заклинание «Понимание языков», но только как ритуал. Ваша заклинательная характеристика для него — Харизма.\n\n**Полиглот.** Вы изучаете один язык на ваш выбор. Когда вы заканчиваете продолжительный отдых, вы можете заменить его другим языком, который слышали, читали или видели в жестовом виде за последние 24 часа.\n\n**Поставленная речь.** Вы получаете владение одним из следующих навыков на ваш выбор: Выступление, Запугивание, Проницательность, Убеждение."],
        [3, "Групповое оздоровление",
          "Когда вы используете Второе дыхание для восстановления хитов, вы можете выбрать союзников в исходящей от вас 30-футовой эманации числом не больше вашего модификатора Харизмы (минимум один союзник). Каждый выбранный союзник восстанавливает хиты в количестве 1к4 + ваш уровень воина. Использовав это умение, вы не сможете использовать его снова, пока не закончите короткий или продолжительный отдых."],
        [7, "Групповая тактика",
          "Когда вы используете Групповое оздоровление, каждый выбранный им союзник совершает с преимуществом все броски к20 до начала вашего следующего хода."],
        [10, "Воодушевляющий всплеск",
          "Когда вы используете Всплеск действий, вы можете выбрать союзников в исходящей от вас 30-футовой эманации числом не больше вашего модификатора Харизмы (минимум один союзник). Каждый выбранный союзник может немедленно реакцией выполнить одно из следующего.\n\n**Атака.** Союзник совершает одну атаку оружием или безоружным ударом.\n\n**Перемещение.** Союзник перемещается на расстояние до половины своей скорости, не вызывая провоцированные атаки."],
        [15, "Устойчивость команды",
          "Когда видимый вами в пределах 60 футов от вас союзник проваливает спасбросок, вы можете реакцией потратить одно использование вашего Упорного: союзник немедленно перебрасывает проваленный спасбросок с бонусом, равным вашему уровню воина, и должен использовать новый результат."],
        [18, "Вдохновляющий командир",
          "Вы получаете следующие преимущества.\n\n**Усиленное воодушевление.** Область воздействия ваших умений Групповое оздоровление и Воодушевляющий всплеск увеличивается до 60-футовой эманации.\n\n**Непоколебимая храбрость.** Вы получаете иммунитет к состояниям испуганный и очарованный."],
      ];
      for (const [level, name, descr] of banneretFeats) {
        if (findChild(banneret, "feature", name) != null) continue;
        insertEntry(
          classSection, banneret, "feature", name, "", level,
          featData(name === "Устойчивость команды" ? { cost: { kind: "resource", resourceLabel: "Упорный" } } : undefined),
          descr
        );
      }

      // ——— Чародейный стрелок ———
      let archer = findChild(12191, "subclass", "Чародейный стрелок");
      if (archer == null) {
        archer = insertEntry(
          classSection,
          12191,
          "subclass",
          "Чародейный стрелок",
          "Arcane Archer",
          null,
          {},
          "Чародейные стрелки вплетают магию в свои выстрелы: их боеприпасы взрываются, сами находят цель, опутывают и изгоняют врага."
        );
      }
      const archerFeats: [number, string, Record<string, unknown> | undefined, string][] = [
        [3, "Знания чародейного стрелка", undefined,
          "Вы изучаете один заговор на ваш выбор: «Искусство друидов» или «Фокусы». Ваша заклинательная характеристика для него — Интеллект.\n\nВы получаете владение навыками Природа и Арканная магия. Если вы уже владеете одним из этих навыков, вместо него выберите владение другим навыком на ваш выбор."],
        [3, "Чародейный выстрел", { cost: shotPool },
          "Вы умеете наполнять боеприпасы магией. Вы знаете 2 варианта чародейного выстрела на ваш выбор (см. «Чародейные выстрелы»). Вы изучаете ещё по одному варианту, когда достигаете 7, 10, 15 и 18 уровней воина.\n\nОдин раз в свой ход, когда вы попадаете дальнобойной атакой оружием со свойством «Боеприпасы», вы можете применить к ней один известный вам вариант.\n\nЧисло использований — ваш модификатор Интеллекта (минимум 1). Вы восстанавливаете все потраченные использования, когда заканчиваете короткий или продолжительный отдых.\n\nКость выстрела — к6. Она становится к8 на 10 уровне воина, к10 на 15 и к12 на 18.\n\nЕсли вариант требует спасброска, его Сл равна 8 + ваш модификатор Интеллекта + ваш бонус мастерства."],
        [7, "Странствующая стрела", { casting_timing: "Бонусное действие" },
          "Когда вы промахиваетесь дальнобойной атакой оружием со свойством «Боеприпасы», вы можете бонусным действием перенаправить боеприпас в новую цель, которую видите в пределах 60 футов от прежней цели. Совершите бросок атаки по новой цели."],
        [7, "Магические боеприпасы", undefined,
          "Действием Магия вы можете зарядить один немагический боеприпас и выстрелить им в видимую поверхность, создав один из следующих эффектов.\n\n**Затемняющий.** Магическая тьма заполняет 15-футовую эманацию от боеприпаса на 1 минуту. Немагическое пламя внутри гаснет, а существа внутри получают −5 к проверкам Восприятия.\n\n**Открывающий.** Вспышка магии заполняет 15-футовую эманацию и открывает немагические замки; раздаётся щелчок, слышный в пределах 300 футов.\n\n**Лозовой.** Из боеприпаса вырастает лоза длиной 120 футов, по которой можно лазать; она исчезает через 10 минут.\n\nИспользовав это умение, вы не сможете использовать его снова, пока не закончите короткий или продолжительный отдых, если только вы не потратите использование вашего Второго дыхания (действие не требуется), чтобы восстановить его использование."],
        [10, "Заготовленный выстрел", undefined,
          "Когда вы совершаете бросок инициативы, вы восстанавливаете одно потраченное использование Чародейного выстрела."],
        [15, "Неукротимая телепортация", undefined,
          "Когда вы преуспеваете в спасброске благодаря вашему Упорному, вы можете телепортироваться на расстояние до 60 футов в видимое вами свободное пространство."],
        [18, "Мастерская стрельба", { casting_timing: "Реакция", casting_timing_other: "когда по вам промахиваются атакой" },
          "Когда по вам промахиваются атакой, вы можете реакцией переместиться на расстояние до половины вашей скорости, не вызывая провоцированные атаки, а затем совершить дальнобойную атаку."],
      ];
      for (const [level, name, extra, descr] of archerFeats) {
        if (findChild(archer, "feature", name) != null) continue;
        insertEntry(classSection, archer, "feature", name, "", level, featData(extra), descr);
      }
      // Прогрессия стрелка: грань кости и число известных вариантов. Пула
      // здесь нет намеренно: использования — мод Интеллекта, их даёт
      // формульный пул «Чародейные выстрелы» (dndResources).
      {
        const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(archer) as { data: string };
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.progression == null) {
          const columns = [
            { key: "c1", label: "Ур.", role: "level" },
            { key: "c2", label: "Кость выстрела", role: "stat" },
            { key: "c3", label: "Выстрелы", role: "stat" },
          ];
          const rows: Record<string, string>[] = [];
          for (let lvl = 1; lvl <= 20; lvl++) {
            rows.push({
              c1: String(lvl),
              c2: lvl < 3 ? "—" : lvl < 10 ? "к6" : lvl < 15 ? "к8" : lvl < 18 ? "к10" : "к12",
              c3: lvl < 3 ? "—" : lvl < 7 ? "2" : lvl < 10 ? "3" : lvl < 15 ? "4" : lvl < 18 ? "5" : "6",
            });
          }
          data.progression = { columns, rows };
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), archer);
        }
      }

      // ——— «Подкласс воина»: теперь их шесть ———
      {
        const row = database.prepare("SELECT data, description FROM compendium_entries WHERE id = 12517").get() as {
          data: string; description: string;
        };
        if (row && row.description.includes("Мастер боевых искусств, Чемпион, Мистический рыцарь и Пси-воин")) {
          const next = row.description.replace(
            "Подклассы Мастер боевых искусств, Чемпион, Мистический рыцарь и Пси-воин подробно описаны после умений этого класса.",
            "Подклассы Мастер боевых искусств, Чемпион, Мистический рыцарь, Пси-воин, Баннерет и Чародейный стрелок подробно описаны после умений этого класса."
          );
          database.prepare("UPDATE compendium_entries SET description = ? WHERE id = 12517").run(next);
        }
      }

      // ——— Каталог приёмов и выстрелов ———
      const maneuverGroup = findChild(null, "mechanic_group", "Боевые приёмы") ??
        insertEntry(mechSection, null, "mechanic_group", "Боевые приёмы", "", null, {},
          "Приёмы Мастера боя. Каждый требует траты кости превосходства (см. умение «Боевое превосходство»). Спасбросок против приёма: Сл 8 + бонус владения + модификатор Силы или Ловкости.");
      const shotGroup = findChild(null, "mechanic_group", "Чародейные выстрелы") ??
        insertEntry(mechSection, null, "mechanic_group", "Чародейные выстрелы", "", null, {},
          "Варианты Чародейного выстрела. Один раз в ход при попадании дальнобойной атакой с «Боеприпасами»; тратит использование (модификатор Интеллекта, минимум 1). Кость: к6, к8 на 10, к10 на 15, к12 на 18. Сл 8 + Интеллект + бонус владения.");
      const BONUS = { casting_timing: "Бонусное действие" };
      const REACTION = (other: string): Record<string, unknown> => ({ casting_timing: "Реакция", casting_timing_other: other });
      const maneuvers: [string, Record<string, unknown> | undefined, string][] = [
        ["Активное уклонение", BONUS, "Бонусным действием потратьте кость превосходства и совершите действие Отход. До начала вашего следующего хода ваш КЗ увеличивается на выпавшее число."],
        ["Атака с выпадом", BONUS, "Бонусным действием потратьте кость превосходства и совершите действие Рывок. Если перед рукопашной атакой в этом ходу вы переместились по прямой не менее чем на 5 футов, добавьте кость к её урону."],
        ["Атака с манёвром", undefined, "Когда вы попадаете атакой, потратьте кость превосходства: добавьте её к урону, и один видимый вами союзник может реакцией переместиться на расстояние до половины своей скорости, не вызывая провоцированные атаки от цели этой атаки."],
        ["Атака с угрозой", undefined, "Когда вы попадаете атакой, потратьте кость превосходства: добавьте её к урону, и цель совершает спасбросок Мудрости. При провале она испугана до конца вашего следующего хода."],
        ["Атака с финтом", BONUS, "Бонусным действием потратьте кость превосходства против цели в пределах 5 футов от вас: ваша следующая атака по ней в этом ходу совершается с преимуществом, добавьте кость к её урону."],
        ["Засада", undefined, "Когда вы совершаете проверку Скрытности или бросок инициативы, потратьте кость превосходства и добавьте её к результату."],
        ["Командирский напор", undefined, "Когда вы совершаете проверку Харизмы (Выступление, Запугивание или Убеждение), потратьте кость превосходства и добавьте её к результату."],
        ["Обезоруживающая атака", undefined, "Когда вы попадаете атакой, потратьте кость превосходства: добавьте её к урону, и цель совершает спасбросок Силы. При провале она роняет один удерживаемый предмет."],
        ["Опрокидывающая атака", undefined, "Когда вы попадаете атакой оружием или безоружным ударом, потратьте кость превосходства: добавьте её к урону, и цель размера Большой или меньше совершает спасбросок Силы. При провале она опрокинута."],
        ["Ответный удар", REACTION("когда по вам промахиваются рукопашной атакой"), "Когда по вам промахиваются рукопашной атакой, вы можете реакцией потратить кость превосходства и совершить рукопашную атаку, добавив кость к её урону."],
        ["Отвлекающий удар", undefined, "Когда вы попадаете атакой, потратьте кость превосходства: добавьте её к урону. Следующая атака по этой цели не от вас до начала вашего следующего хода совершается с преимуществом."],
        ["Парирование", REACTION("когда вы получаете урон от рукопашной атаки"), "Когда вы получаете урон от рукопашной атаки, вы можете реакцией потратить кость превосходства и уменьшить урон на выпавшее число + ваш модификатор Силы или Ловкости."],
        ["Подмена", undefined, "В свой ход рядом с согласным существом потратьте кость превосходства и поменяйтесь с ним местами (вам это стоит 5 футов перемещения). Вы или оно получаете бонус к КЗ, равный выпавшему числу, до начала вашего следующего хода."],
        ["Провоцирующая атака", undefined, "Когда вы попадаете атакой, потратьте кость превосходства: добавьте её к урону, и цель совершает спасбросок Мудрости. При провале у неё помеха на атаки не по вам до конца вашего следующего хода."],
        ["Рассекающая атака", undefined, "Когда вы попадаете рукопашной атакой, потратьте кость превосходства: вторая цель в пределах 5 футов от первой и в пределах вашей досягаемости получает урон, равный выпавшему числу, если исходный бросок атаки попал бы и по ней."],
        ["Сплочение", BONUS, "Бонусным действием потратьте кость превосходства: один видимый вами союзник в пределах 30 футов от вас получает временные хиты, равные выпавшему числу + половина вашего уровня воина (округлить вниз)."],
        ["Тактическая оценка", undefined, "Когда вы совершаете проверку Интеллекта (История или Анализ) либо проверку Мудрости (Проницательность), потратьте кость превосходства и добавьте её к результату."],
        ["Толкающая атака", undefined, "Когда вы попадаете атакой оружием или безоружным ударом, потратьте кость превосходства: добавьте её к урону, и цель размера Большой или меньше совершает спасбросок Силы. При провале она оттолкнута от вас на 15 футов по прямой."],
        ["Точная атака", undefined, "Когда вы промахиваетесь атакой, потратьте кость превосходства и добавьте её к броску атаки."],
        ["Удар командующего", undefined, "Действием Атака откажитесь от одной из ваших атак: один видимый вами союзник может реакцией совершить атаку оружием или безоружным ударом, добавив вашу кость превосходства к её урону."],
      ];
      for (const [name, extra, descr] of maneuvers) {
        if (findChild(maneuverGroup, "mechanic_item", name) != null) continue;
        insertEntry(mechSection, maneuverGroup, "mechanic_item", name, "", null, featData({ cost: supPool, ...extra }), descr);
      }
      const shots: [string, string][] = [
        ["Взрывной", "Когда вы попадаете чародейным выстрелом, цель и каждое существо в пределах 10 футов от неё получают урон силовым полем, равный двум броскам вашей кости выстрела."],
        ["Изгоняющий", "Когда вы попадаете чародейным выстрелом, добавьте кость выстрела психической энергией к урону, и цель совершает спасбросок Харизмы. При провале она изгнана до конца своего следующего хода: у неё скорость 0 и состояние недееспособный, затем она возвращается в оставленное место (или ближайшее свободное)."],
        ["Ищущий", "Вместо броска атаки чародейным выстрелом выберите видимую цель: она совершает спасбросок Ловкости. При провале она получает обычный урон вашего оружия и дополнительно урон силовым полем, равный двум броскам вашей кости выстрела."],
        ["Ослабляющий", "Когда вы попадаете чародейным выстрелом, добавьте два броска кости выстрела некротической энергией к урону, и цель совершает спасбросок Телосложения. При провале она отравлена до конца своего следующего хода, а когда она попадает атакой, из урона вычитается один бросок вашей кости выстрела."],
        ["Пронзающий", "Вместо броска атаки выпустите боеприпас линией 30 на 1 фут от вас. Каждое существо в линии совершает спасбросок Ловкости. При провале оно получает обычный урон вашего оружия и дополнительно колющий урон, равный двум броскам вашей кости выстрела."],
        ["Тьмяной", "Когда вы попадаете чародейным выстрелом, добавьте кость выстрела психической энергией к урону, и цель совершает спасбросок Мудрости. При провале она ослеплена до конца своего следующего хода."],
        ["Удерживающий", "Когда вы попадаете чародейным выстрелом, добавьте кость выстрела рубящим к урону, и цель совершает спасбросок Силы. При провале она опутана на 1 минуту или пока вы не используете этот вариант снова. Цель или существо в её досягаемости может действием совершить проверку Силы (Атлетика) против вашей Сл выстрела и окончить состояние при успехе."],
        ["Чарующий", "Когда вы попадаете чародейным выстрелом, добавьте два броска кости выстрела психической энергией к урону, и цель совершает спасбросок Мудрости. При провале она очарована вами или одним вашим союзником в пределах 30 футов от неё (на ваш выбор) до начала вашего следующего хода. Состояние оканчивается досрочно, если очаровавший атакует цель, наносит ей урон или заставляет совершать спасбросок."],
      ];
      for (const [name, descr] of shots) {
        if (findChild(shotGroup, "mechanic_item", name) != null) continue;
        insertEntry(mechSection, shotGroup, "mechanic_item", name, "", null, featData({ cost: shotPool }), descr);
      }
    }
    setAppSettingFlag(database, "fighter_new_subclasses_v1");
  }

  // Выборы черт боевого стиля (тикет 03): определения на умениях
  // «Боевой стиль» (11921) и «Дополнительный боевой стиль» (12194).
  // Один ключ на оба — пики копятся массивом (у Чемпиона 7+ их два).
  // Только при отсутствии: правка Мастера главнее посева.
  if (!appSettingFlag(database, "fighter_feat_choice_v1")) {
    for (const id of [11921, 12194]) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.choices == null) {
          data.choices = [{ key: "fighting_style", kind: "feat", category: "Боевой Стиль", count: 1 }];
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_feat_choice_v1");
  }

  // Выборы заклинаний подклассов (тикет 04): Мистический рыцарь (число из
  // прогрессии — заговоры/подготовленные растут с уровнем) и Чародейный
  // стрелок (1 заговор из двух названных — имена стабильнее id при
  // реимпорте). outsideLimit: false — выборы идут в лимиты листа.
  // Только при отсутствии: правка Мастера главнее посева.
  if (!appSettingFlag(database, "fighter_spell_choice_v1")) {
    const wizRow = database
      .prepare("SELECT id FROM compendium_entries WHERE name_original = 'Wizard' AND kind = 'class'")
      .get() as { id: number } | undefined;
    const seeds: { id: number; choices: unknown[] }[] = [
      {
        id: 12937,
        choices:
          wizRow == null
            ? []
            : [
                { count: 2, countFrom: "cantrips", level: 0, classIds: [wizRow.id], outsideLimit: false },
                { count: 3, countFrom: "prepared", level: null, classIds: [wizRow.id], outsideLimit: false },
              ],
      },
      {
        id: 12959,
        choices: [
          { count: 1, level: 0, classIds: [], names: ["Искусство друидов", "Фокусы"], outsideLimit: false },
        ],
      },
    ];
    for (const { id, choices } of seeds) {
      if (choices.length === 0) continue;
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.spell_choices == null) {
          data.spell_choices = choices;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_spell_choice_v1");
  }

  // Исправление тикета 04 (аудит 09): заговор стрелка был посеян на
  // Пси-воина (12959) вместо Чародейного стрелка (15874) — id перепутан.
  // Переносим только точное наше значение; ручные правки не трогаем.
  if (!appSettingFlag(database, "fighter_spell_choice_v2")) {    const want = [{ count: 1, level: 0, classIds: [], names: ["Искусство друидов", "Фокусы"], outsideLimit: false }];
    for (const [id, op] of [[12959, "clear"], [15874, "set"]] as const) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (op === "clear") {
          if (JSON.stringify(data.spell_choices) === JSON.stringify(want)) {
            delete data.spell_choices;
            database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
          }
        } else if (data.spell_choices == null) {
          data.spell_choices = want;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_spell_choice_v2");
  }

  // Выборы приёмов/выстрелов (тикет 05): лесенки дефов с minLevel на одном
  // умении, общий key копит пики. БМ «Боевое превосходство» (12059):
  // 3 +2@7 +2@10 +2@15; стрелок «Чародейный выстрел» (15876):
  // 2 +1@7 +1@10 +1@15 +1@18. Только при отсутствии.
  if (!appSettingFlag(database, "fighter_maneuver_choice_v1")) {
    const seeds: { id: number; choices: unknown[] }[] = [
      {
        id: 12059,
        choices: [
          { key: "maneuvers", kind: "entry", group: "Боевые приёмы", count: 3 },
          { key: "maneuvers", kind: "entry", group: "Боевые приёмы", count: 2, minLevel: 7 },
          { key: "maneuvers", kind: "entry", group: "Боевые приёмы", count: 2, minLevel: 10 },
          { key: "maneuvers", kind: "entry", group: "Боевые приёмы", count: 2, minLevel: 15 },
        ],
      },
      {
        id: 15876,
        choices: [
          { key: "arcane_shots", kind: "entry", group: "Чародейные выстрелы", count: 2 },
          { key: "arcane_shots", kind: "entry", group: "Чародейные выстрелы", count: 1, minLevel: 7 },
          { key: "arcane_shots", kind: "entry", group: "Чародейные выстрелы", count: 1, minLevel: 10 },
          { key: "arcane_shots", kind: "entry", group: "Чародейные выстрелы", count: 1, minLevel: 15 },
          { key: "arcane_shots", kind: "entry", group: "Чародейные выстрелы", count: 1, minLevel: 18 },
        ],
      },
    ];
    for (const { id, choices } of seeds) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.choices == null) {
          data.choices = choices;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_maneuver_choice_v1");
  }

  // Аудит 09, A5: имя умения стрелка — как в эталоне («Знания чародейных
  // стрелков»). Только при точном совпадении.
  if (!appSettingFlag(database, "fighter_archer_lore_rename_v1")) {
    const row = database.prepare("SELECT name FROM compendium_entries WHERE id = 15875").get() as
      | { name: string }
      | undefined;
    if (row && row.name === "Знания чародейного стрелка") {
      database.prepare("UPDATE compendium_entries SET name = ? WHERE id = 15875").run("Знания чародейных стрелков");
    }
    setAppSettingFlag(database, "fighter_archer_lore_rename_v1");
  }

  // Аудит 09, A1: приём «Засада» (15889) дублирует имя действия «Засада»
  // (12491) — поиск и mention-ссылки показывают две записи. Переименовываем
  // приём в «Засада (приём)», только при точном совпадении.
  if (!appSettingFlag(database, "fighter_maneuver_rename_v1")) {
    const row = database.prepare("SELECT name FROM compendium_entries WHERE id = 15889").get() as
      | { name: string }
      | undefined;
    if (row && row.name === "Засада") {
      database.prepare("UPDATE compendium_entries SET name = ? WHERE id = 15889").run("Засада (приём)");
    }
    setAppSettingFlag(database, "fighter_maneuver_rename_v1");
  }

  // Выбор освоенного оружия (тикет 06): лесенка дефов на умении
  // «Оружейные приёмы» (12192): 3 +1@4 +1@10 +1@16 — вровень с колонкой
  // таблицы (таблица остаётся для показа, дефы — для пика).
  // Только при отсутствии.
  if (!appSettingFlag(database, "fighter_weapon_choice_v1")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12192").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (data.choices == null) {
          data.choices = [
            { key: "weapon_mastery", kind: "weapon", count: 3 },
            { key: "weapon_mastery", kind: "weapon", count: 1, minLevel: 4 },
            { key: "weapon_mastery", kind: "weapon", count: 1, minLevel: 10 },
            { key: "weapon_mastery", kind: "weapon", count: 1, minLevel: 16 },
          ];
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12192").run(JSON.stringify(data));
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_weapon_choice_v1");
  }

  // Выборы навыков/инструментов подклассов (тикет 07): Ученик войны
  // (12889) — навык из списка Воина (копируем с записи класса, чтобы не
  // разъехаться) + ремесленный инструмент; Посланник рыцарства (15867) —
  // навык из четырёх названных. Язык Баннерета и замена дубля стрелка —
  // текстом (см. тикет), данных не требуют. Попольно, при отсутствии.
  if (!appSettingFlag(database, "fighter_skill_choice_v1")) {
    const classRow = database.prepare("SELECT data FROM compendium_entries WHERE id = 12191").get() as
      | { data: string }
      | undefined;
    let fighterSkills: string[] = [];
    try {
      const classData = JSON.parse(classRow?.data || "{}") as Record<string, unknown>;
      if (Array.isArray(classData.skill_choice_options)) {
        fighterSkills = (classData.skill_choice_options as unknown[]).filter(
          (s): s is string => typeof s === "string" && !!s.trim()
        );
      }
    } catch {
      // Битый JSON класса — выборы не сеем, флаг всё равно ставим ниже.
    }
    const seeds: { id: number; patch: Record<string, unknown> }[] = [
      {
        id: 12889,
        patch: {
          skill_choice_count: 1,
          skill_choice_options: fighterSkills,
          tool_choice: { count: 1, group: "Ремесленные инструменты" },
        },
      },
      {
        id: 15867,
        patch: {
          skill_choice_count: 1,
          skill_choice_options: ["Выступление", "Запугивание", "Проницательность", "Убеждение"],
        },
      },
    ];
    for (const { id, patch } of seeds) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) continue;
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        let changed = false;
        for (const [k, v] of Object.entries(patch)) {
          if (data[k] == null && v != null && (!Array.isArray(v) || v.length > 0)) {
            data[k] = v;
            changed = true;
          }
        }
        if (changed) {
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_skill_choice_v1");
  }

  // Колдун, ячейки договора (.scratch/warlock/issues/01): колонки «Кол-во
  // ячеек»/«Уровень ячеек» жили ролями resource/stat — код договора
  // (pactSlotsAtLevel, computeSpellSlots) их не видел, блок «Договор магии»
  // не рисовался, а короткий отдых сбрасывал пустой pactSlotsUsed вместо
  // ячеек. Чинится данными: роли pact_slots/pact_level; строки не трогаем,
  // чужое (уже pact_*) не трогаем. Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_pact_slots_v1")) {
    const rows = database
      .prepare(
        `SELECT id, data FROM compendium_entries
          WHERE kind = 'class' AND parent_id IS NULL AND name_original = 'Warlock'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const progression = (data.progression ?? null) as {
        columns?: { key: string; label: string; role: string }[];
      } | null;
      if (!progression || !Array.isArray(progression.columns)) continue;
      let touched = false;
      for (const col of progression.columns) {
        if (col == null || typeof col !== "object") continue;
        const label = (col.label ?? "").trim();
        if (col.role === "resource" && /^(кол-?во|количество)\s+ячеек/i.test(label)) {
          col.role = "pact_slots";
          touched = true;
        } else if (col.role === "stat" && /^уровень\s+ячеек/i.test(label)) {
          col.role = "pact_level";
          touched = true;
        }
      }
      if (!touched) continue;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Ячейки договора колдуна → pact-роли: записей: ${fixed}`);
    setAppSettingFlag(database, "warlock_pact_slots_v1");
  }

  // Колдун, тикет 05 (.scratch/warlock/issues/05): «Магическая хитрость»
  // (12212) и «Связь с покровителем» (12525) жили чистым текстом — в «Бой»
  // не попадали, трека 1/долгий отдых не было. Чинится данными: обоим —
  // свой пул uses/1/long_rest (лист читает cost живьём по entryId, замены
  // ячеек правилом остаются текстом — восстанавливает игрок, как лечение
  // Второго дыхания у Воина); Связи — тайминг «Иное/1 минута» (как у
  // заклинания) и грант самого заклинания на запись класса с grantLevel 9
  // (выдача класса читается recomputeGrantedSpells, вне лимита по
  // умолчанию). Только недостающее, правки Мастера не перебиваем.
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_cunning_contact_v1")) {
    const getData = (id: number): Record<string, unknown> | null => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.data || "{}") as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const saveData = (id: number, data: Record<string, unknown>): void => {
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const ownPool = { kind: "uses", amount: 1, per: "long_rest", ownResource: true };
    let fixed = 0;
    for (const id of [12212, 12525]) {
      const data = getData(id);
      if (!data) continue;
      let touched = false;
      if (data.cost == null) {
        data.cost = { ...ownPool };
        touched = true;
      }
      // У Хитрости (12212) тайминг уже стоит; Связи (12525) без времени
      // накладывания в «Действия» не попасть.
      if (data.casting_timing == null) {
        data.casting_timing = "Иное";
        data.casting_timing_other = "1 минута";
        touched = true;
      }
      if (!touched) continue;
      saveData(id, data);
      fixed++;
    }
    // Заклинание для гранта — поиском по оригиналу (имена стабильнее id),
    // запасной — известный id.
    const contact = database
      .prepare(
        `SELECT id FROM compendium_entries
          WHERE kind = 'spell' AND name_original = 'Contact Other Plane' LIMIT 1`
      )
      .get() as { id: number } | undefined;
    const contactId = contact?.id ?? 14428;
    const warlocks = database
      .prepare(
        `SELECT id, data FROM compendium_entries
          WHERE kind = 'class' AND parent_id IS NULL AND name_original = 'Warlock'`
      )
      .all() as { id: number; data: string }[];
    for (const row of warlocks) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (data.granted_spells != null) continue;
      data.granted_spells = [
        {
          id: contactId,
          name: "Связь с иным планом",
          grantLevel: 9,
          original: "Contact Other Plane",
          // Явно: оба читателя (лист и визард) по-разному умолчают
          // outsideLimit, а заклинание патрона/класса всегда вне лимита.
          outsideLimit: true,
        },
      ];
      saveData(row.id, data);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Хитрость и Связь колдуна (пулы+грант): записей: ${fixed}`);
    setAppSettingFlag(database, "warlock_cunning_contact_v1");
  }

  // Колдун, тикет 04 (.scratch/warlock/issues/04): списки патронов жили
  // одной строкой текста в описании («Заклинания архифеи» 11942 и др.) —
  // не добавлялись сами и вбитые руками считались в лимит подготовленных.
  // Чинится данными: всем четырём подклассам — granted_spells с grantLevel
  // 3/5/7/9 (круги 1-2/3/4/5 — вровень с кругом договора, сверено) и явным
  // outsideLimit (оба читателя умолчают по-разному). Id резолвятся по
  // русскому имени на момент посева (все 43 сошлись 1:1, круги проверены),
  // оригинал — из записи для запасного сведения по имени; ненайденное
  // заклинание пропускаем, а не сеем мёртвый id. Только при отсутствии
  // (правка Мастера главнее). Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_patron_spells_v1")) {
    // [id подкласса, id записи-списка]: список нужен только человеку —
    // грант вешаем на подкласс (recomputeGrantedSpells читает классы,
    // подклассы и виды, но не умения).
    const patrons: { subclassId: number; spells: { name: string; grantLevel: number }[] }[] = [
      {
        subclassId: 12699,
        spells: [
          { name: "Умиротворение", grantLevel: 3 },
          { name: "Огонь фей", grantLevel: 3 },
          { name: "Туманный шаг", grantLevel: 3 },
          { name: "Воображаемая сила", grantLevel: 3 },
          { name: "Усыпление", grantLevel: 3 },
          { name: "Мерцание", grantLevel: 5 },
          { name: "Рост растений", grantLevel: 5 },
          { name: "Подчинение зверя", grantLevel: 7 },
          { name: "Высшая невидимость", grantLevel: 7 },
          { name: "Подчинение личности", grantLevel: 9 },
          { name: "Притворство", grantLevel: 9 },
        ],
      },
      {
        subclassId: 12736,
        spells: [
          { name: "Подмога", grantLevel: 3 },
          { name: "Лечение ран", grantLevel: 3 },
          { name: "Направляющий снаряд", grantLevel: 3 },
          { name: "Малое восстановление", grantLevel: 3 },
          { name: "Свет", grantLevel: 3 },
          { name: "Священное пламя", grantLevel: 3 },
          { name: "Дневной свет", grantLevel: 5 },
          { name: "Низшее воскрешение", grantLevel: 5 },
          { name: "Страж веры", grantLevel: 7 },
          { name: "Стена огня", grantLevel: 7 },
          { name: "Высшее восстановление", grantLevel: 9 },
          { name: "Призыв духа небожителя", grantLevel: 9 },
        ],
      },
      {
        subclassId: 12772,
        spells: [
          { name: "Огненные ладони", grantLevel: 3 },
          { name: "Приказ", grantLevel: 3 },
          { name: "Палящий луч", grantLevel: 3 },
          { name: "Внушение", grantLevel: 3 },
          { name: "Огненный шар", grantLevel: 5 },
          { name: "Зловонное облако", grantLevel: 5 },
          { name: "Огненный щит", grantLevel: 7 },
          { name: "Стена огня", grantLevel: 7 },
          { name: "Обет", grantLevel: 9 },
          { name: "Нашествие насекомых", grantLevel: 9 },
        ],
      },
      {
        subclassId: 12806,
        spells: [
          { name: "Обнаружение мыслей", grantLevel: 3 },
          { name: "Диссонирующий шёпот", grantLevel: 3 },
          { name: "Воображаемая сила", grantLevel: 3 },
          { name: "Жуткий смех Таши", grantLevel: 3 },
          { name: "Подсматривание", grantLevel: 5 },
          { name: "Голод Хадара", grantLevel: 5 },
          { name: "Смятение", grantLevel: 7 },
          { name: "Призыв духа аберрации", grantLevel: 7 },
          { name: "Изменение памяти", grantLevel: 9 },
          { name: "Телекинез", grantLevel: 9 },
        ],
      },
    ];
    const findSpell = database.prepare(
      `SELECT id, name_original FROM compendium_entries WHERE kind = 'spell' AND name = ? LIMIT 1`
    );
    let fixed = 0;
    for (const patron of patrons) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(patron.subclassId) as
        | { data: string }
        | undefined;
      if (!row) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (data.granted_spells != null) continue;
      const grants: Record<string, unknown>[] = [];
      for (const s of patron.spells) {
        const hit = findSpell.get(s.name) as { id: number; name_original: string } | undefined;
        if (!hit) {
          console.log(`[db] Заклинания патрона: не найдено «${s.name}» (подкласс ${patron.subclassId})`);
          continue;
        }
        grants.push({
          id: hit.id,
          name: s.name,
          grantLevel: s.grantLevel,
          original: (hit.name_original ?? "").trim(),
          outsideLimit: true,
        });
      }
      if (grants.length === 0) continue;
      data.granted_spells = grants;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), patron.subclassId);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Заклинания патронов колдуна: подклассов: ${fixed}`);
    setAppSettingFlag(database, "warlock_patron_spells_v1");
  }

  // Колдун, тикет 04, догонка: гранты патронов в живой базе появились раньше
  // миграции (заведены руками — ключей outsideLimit в них нет). Лист и так
  // считает их вне лимита (умолчание parseGrantedSpellDefs), а визард —
  // нет (dndGrants умолчает в false). Дописываем недостающий ключ явно,
  // остальное не трогаем. Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_patron_outside_limit_v1")) {
    let fixed = 0;
    for (const subclassId of [12699, 12736, 12772, 12806]) {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(subclassId) as
        | { data: string }
        | undefined;
      if (!row) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const grants = (data.granted_spells ?? null) as Record<string, unknown>[] | null;
      if (!Array.isArray(grants)) continue;
      let touched = false;
      for (const g of grants) {
        if (g != null && typeof g === "object" && !("outsideLimit" in g)) {
          g.outsideLimit = true;
          touched = true;
        }
      }
      if (!touched) continue;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), subclassId);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Заклинания патронов колдуна (outsideLimit): записей: ${fixed}`);
    setAppSettingFlag(database, "warlock_patron_outside_limit_v1");
  }

  // Колдун, тикет 02 (.scratch/warlock/issues/02): каталог Таинственных
  // воззваний — 28 шт. по PHB 2024, имена/требования/тексты с dnd.su
  // (https://next.dnd.su/class/warlock/invocations). Группа механик +
  // записи mechanic_item: level = требуемый уровень колдуна (null — без
  // требования), timing — у сотворяемого без ячейки (попадает в Действия),
  // пул 1/долгий отдых — у Дара глубин и Дара защитников; урон, пассивки
  // и траты ячеек (кара) — текстом, игрок применяет вручную. На умение
  // «Таинственные воззвания» — лесенка choices по колонке c4
  // (1@1, +2@2, +2@5, +1@7, +1@9, +1@12, +1@15, +1@18 = 10).
  // Только недостающее (правка Мастера главнее). Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_invocations_v1")) {
    const warlock = database
      .prepare(
        `SELECT id, system_id AS sysId FROM compendium_entries
          WHERE kind = 'class' AND parent_id IS NULL AND name_original = 'Warlock' LIMIT 1`
      )
      .get() as { id: number; sysId: number } | undefined;
    const mechSection =
      ((
        database
          .prepare(`SELECT id FROM system_sections WHERE system_id = ? AND kind = 'mechanics' LIMIT 1`)
          .get(warlock?.sysId ?? -1) as { id: number } | undefined
      )?.id ?? null) as number | null;
    if (warlock && mechSection != null) {
      const findEntry = (parentId: number | null, kind: string, name: string): number | null => {
        const row = (
          parentId == null
            ? database
                .prepare(
                  "SELECT id FROM compendium_entries WHERE parent_id IS NULL AND section_id = ? AND kind = ? AND name = ?"
                )
                .get(mechSection, kind, name)
            : database
                .prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND kind = ? AND name = ?")
                .get(parentId, kind, name)
        ) as { id: number } | undefined;
        return row ? row.id : null;
      };
      const nextPos = (parentId: number | null): number =>
        (
          (parentId == null
            ? database
                .prepare(
                  "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE parent_id IS NULL AND section_id = ?"
                )
                .get(mechSection)
            : database
                .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE parent_id = ?")
                .get(parentId)) as { p: number }
        ).p;
      let invGroup = findEntry(null, "mechanic_group", "Таинственные воззвания");
      if (invGroup == null) {
        invGroup = Number(
          database
            .prepare(
              "INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, name_original, level, data, description, position) VALUES (?, ?, NULL, 'mechanic_group', 'Таинственные воззвания', 'Eldritch Invocations', NULL, '{}', ?, ?)"
            )
            .run(
              warlock.sysId,
              mechSection,
              "Частицы запретных знаний колдуна: берутся выбором (см. умение «Таинственные воззвания»). Требования — в описании каждого.",
              nextPos(null)
            ).lastInsertRowid
        );
      }
      const invocations: {
        name: string;
        original: string;
        level: number | null;
        timing: string | null;
        cost: string | null;
        type: string;
        desc: string;
      }[] = [
        { name: "Мистическое копьё", original: "Eldritch Spear", level: 2, timing: null, cost: null, type: "Заговор", desc: "Требования: уровень Колдуна 2 или выше, заговор Колдуна, наносящий урон\n\nВыберите один известный вам наносящий урон заговор Колдуна; дистанция этого заговора должна быть не менее 10 футов. Когда вы сотворяете этот заговор, его дистанция увеличивается на число, равное вашему уровню Колдуна, умноженному на 30.\n\nПовторяемость. Вы можете выбирать это воззвание более одного раза. Каждый раз вы должны выбирать новый заговор, удовлетворяющий требованиям." },
        { name: "Мучительный взрыв", original: "Agonizing Blast", level: 2, timing: null, cost: null, type: "Заговор", desc: "Требования: уровень Колдуна 2 или выше, заговор Колдуна, наносящий урон\n\nВыберите один известный вам наносящий урон заговор Колдуна. Вы можете добавлять ваш модификатор Харизмы к броскам урона этого заговора.\n\nПовторяемость. Вы можете выбирать это воззвание более одного раза. Каждый раз вы должны выбирать новый заговор, удовлетворяющий требованиям." },
        { name: "Отталкивающий заряд", original: "Repelling Blast", level: 2, timing: null, cost: null, type: "Заговор", desc: "Требования: уровень Колдуна 2 или выше, заговор Колдуна, наносящий урон броском атаки\n\nВыберите один известный вам наносящий урон заговор Колдуна; этот заговор должен наносить урон броском атаки. Когда вы попадаете этим заговором по существу Большого размера или меньше, вы можете оттолкнуть это существо на расстояние вплоть до 10 футов прямо от вас.\n\nПовторяемость. Вы можете выбирать это воззвание более одного раза. Каждый раз вы должны выбирать новый заговор, удовлетворяющий требованиям." },
        { name: "Доспех теней", original: "Armor of Shadows", level: null, timing: "Действие", cost: null, type: "Заклинание", desc: "Вы можете сотворять заклинание Доспех мага на себя без траты ячеек заклинаний." },
        { name: "Потусторонний прыжок", original: "Otherworldly Leap", level: 2, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 2 или выше\n\nВы можете сотворять заклинание Прыжок на себя без траты ячеек заклинаний." },
        { name: "Мощь Исчадия", original: "Fiendish Vigor", level: 2, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 2 или выше\n\nВы можете сотворять заклинание Псевдожизнь на себя без траты ячеек заклинаний. Когда вы сотворяете это заклинание таким образом, вы не бросаете кости для определения Временных хитов, а автоматически получаете максимальные значения костей." },
        { name: "Восходящий шаг", original: "Ascendant Step", level: 5, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 5 или выше\n\nВы можете сотворять заклинание Левитация на себя без траты ячеек заклинаний." },
        { name: "Маска многих лиц", original: "Mask of Many Faces", level: 2, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 2 или выше\n\nВы можете сотворять заклинание Маскировка без траты ячеек заклинаний." },
        { name: "Мастер бесчисленных обликов", original: "Master of Myriad Forms", level: 5, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 5 или выше\n\nВы можете сотворять заклинание Смена обличия без траты ячеек заклинаний." },
        { name: "Туманные видения", original: "Misty Visions", level: 2, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 2 или выше\n\nВы можете сотворять заклинание Безмолвный образ без траты ячеек заклинаний." },
        { name: "Один среди теней", original: "One with Shadows", level: 5, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 5 или выше\n\nПока вы находитесь в области Тусклого света или Темноты, вы можете сотворять заклинание Невидимость на себя без траты ячеек заклинаний." },
        { name: "Видения дальних земель", original: "Visions of Distant Realms", level: 9, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 9 или выше\n\nВы можете сотворять заклинание Магический глаз без траты ячеек заклинаний." },
        { name: "Могильный шёпот", original: "Whispers of the Grave", level: 7, timing: "Действие", cost: null, type: "Заклинание", desc: "Требования: уровень Колдуна 7 или выше\n\nВы можете сотворять заклинание Разговор с мёртвыми без траты ячеек заклинаний." },
        { name: "Договор клинка", original: "Pact of the Blade", level: null, timing: "Бонусное действие", cost: null, type: "Договор клинка", desc: "Бонусным действием вы можете призвать в вашу руку оружие договора – Простое или Воинское Рукопашное оружие на ваш выбор, с которым вы создаёте связь — или создать связь с магическим оружием, которого вы касаетесь; вы не можете создать связь с магическим оружием, если на него настроено другое существо или если другой Колдун создал с ним такую связь. Пока связь не прервётся, вы обладаете владением этим оружием и можете использовать его как Заклинательную фокусировку.Когда вы атакуете оружием, с которым создали такую связь, вы можете использовать для бросков атаки и урона ваш модификатор Харизмы вместо Силы или Ловкости; кроме того, наносимый вами этим оружием урон может быть не обычным типом урона оружия, а Некротическим, Психическим или уроном Излучением. Ваша связь с оружием заканчивается, если вы используете вышеописанное Бонусное действие снова, если оружие находится по меньшей мере 1 минуту дальше, чем в 5 футах от вас, или если вы умираете. Призванное оружие исчезает, когда ваша связь заканчивается." },
        { name: "Жаждущий клинок", original: "Thirsting Blade", level: 5, timing: null, cost: null, type: "Договор клинка", desc: "Требования: уровень Колдуна 5 или выше, воззвание «Договор клинка»\n\nВы получаете умение Дополнительная атака, но только для вашего оружия договора. Когда в ваш ход вы используете действие Атака с оружием договора, вы можете совершить не одну, а две атаки." },
        { name: "Мистическая кара", original: "Eldritch Smite", level: 5, timing: null, cost: null, type: "Договор клинка", desc: "Требования: уровень Колдуна 5 или выше, воззвание «Договор клинка»\n\nОдин раз в ход, когда вы попадаете по существу вашим оружием договора, вы можете потратить одну ячейку Магии договора, чтобы нанести 1к8 дополнительного Силового урона + ещё 1к8 дополнительного Силового урона за каждый уровень ячейки, и вы можете причинить цели состояние Опрокинутый, если она Огромного размера или меньше." },
        { name: "Пожирающий клинок", original: "Devouring Blade", level: 12, timing: null, cost: null, type: "Договор клинка", desc: "Требования: уровень Колдуна 12 или выше, воззвание «Жаждущий клинок»\n\nВаше воззвание «Жаждущий клинок» дарует вам две дополнительные атаки, а не одну." },
        { name: "Пьющий жизни", original: "Lifedrinker", level: 9, timing: null, cost: null, type: "Договор клинка", desc: "Требования: уровень Колдуна 9 или выше, воззвание «Договор клинка»\n\nОдин раз в ход, когда вы попадаете по существу вашим оружием договора, вы можете нанести этому существу 1к6 дополнительного урона Излучением или Некротического или Психического урона (на ваш выбор), и вы можете потратить одну вашу Кость хитов, бросить её и восстановить количество Хитов, равное результату броска + ваш модификатор Телосложения (минимум 1 Хит)." },
        { name: "Договор гримуара", original: "Pact of the Tome", level: null, timing: null, cost: null, type: "Договор гримуара", desc: "Сплетая вместе нити теней, вы призываете в вашу руку книгу, появляющуюся в конце Короткого или Долгого отдыха. Эта Книга теней (вы определяете её внешний вид) содержит таинственную магию, доступную только вам и дарующую вам описанные ниже преимущества. Книга исчезает, если вы умираете или призываете с помощью этого воззвания другую книгу.Заговоры и Ритуалы. Когда книга появляется, выберите три заговора, и выберите два заклинания 1-го уровня, у которых есть метка Ритуал. Эти заклинания могут быть из списка заклинаний любого класса, но вы не можете выбирать уже подготовленные вами заклинания. Пока книга находится у вас, у вас подготовлены эти выбранные заклинания, и они считаются для вас заклинаниями Колдуна.Заклинательная фокусировка. Вы можете использовать эту книгу как Заклинательную фокусировку." },
        { name: "Дар защитников", original: "Gift of the Protectors", level: 9, timing: null, cost: "pool", type: "Договор гримуара", desc: "Требования: уровень Колдуна 9 или выше, воззвание «Договор гримуара»\n\nКогда вы призываете вашу Книгу теней, теперь в ней появляется новая страница. С вашего разрешения существо может действием написать своё имя на этой странице; страница может вместить имена в количестве, равном вашему модификатору Харизмы (минимум 1 имя).Когда Хиты существа, чьё имя записано на этой странице, опускаются до 0, но оно не убито мгновенно, магическим образом Хиты существа опускаются не до 0, а только до 1. Как только эта магия сработает, ни одно существо не сможет получить её преимущество, пока вы не завершите Долгий отдых.Действием Магия вы можете коснуться страницы и стереть с неё любое из написанных имён." },
        { name: "Договор цепи", original: "Pact of the Chain", level: null, timing: "Действие", cost: null, type: "Договор цепи", desc: "Вы выучиваете заклинание Обретение фамильяра, и вы можете сотворять его действием Магия без траты ячейки заклинаний.Когда вы сотворяете это заклинание, вы можете выбрать как одну из обычных форм фамильяров, так и одну из следующих: Бес, Квазит, Псевдодракон, Скелет, Слаад головастик, Спрайт, Сфинкс любознательности или Ядовитая змея.Кроме того, когда вы совершаете действие Атака, вы можете пожертвовать одной из ваших атак, чтобы позволить вашему фамильяру Реакцией совершить одну из его атак." },
        { name: "Облачение хозяина цепи", original: "Investment of the Chain Master", level: 5, timing: null, cost: null, type: "Договор цепи", desc: "Требования: уровень Колдуна 5 или выше, воззвание «Договор цепи»\n\nКогда вы сотворяете Обретение фамильяра, вы усиливаете призываемого фамильяра частичкой вашей мистической силы, что даёт ему следующие преимущества:Воздушный или водный. Фамильяр получает либо Скорость полёта 40 футов, либо Скорость плавания 40 футов (на ваш выбор).Быстрая атака. Бонусным действием вы можете приказать фамильяру совершить действие Атака.Некротический урон или урон Излучением. Когда фамильяр наносит Дробящий, Колющий или Рубящий урон, по вашему выбору тип урона может быть вместо этого Некротическим уроном или уроном Излучением.Ваша сложность спасброска. Если ваш фамильяр заставляет другое существо пройти спасбросок, при этом используется ваша Сл спасброска заклинаний.Сопротивление. Когда фамильяр получает урон, вы можете Реакцией даровать Сопротивление этому урону." },
        { name: "Взор двух умов", original: "Gaze of Two Minds", level: 5, timing: "Бонусное действие", cost: null, type: "Иное", desc: "Требования: уровень Колдуна 5 или выше\n\nВы можете Бонусным действием коснуться согласного существа и воспринимать окружение его чувствами до конца вашего следующего хода. Пока существо находится на том же плане существования, что и вы, вы можете Бонусным действием поддержать эту связь, продлив её до конца вашего следующего хода. Если вы не поддерживаете её таким образом, связь прерывается.Пока вы воспринимаете чувствами другого существа, вы получаете преимущества любых особых чувств этого существа, и, пока вы оба находитесь в пределах 60 футов друг от друга, вы можете сотворять заклинания, как будто вы находитесь в пространстве этого существа (вы по-прежнему можете сотворять заклинания из вашего пространства)." },
        { name: "Дар глубин", original: "Gift of the Depths", level: 5, timing: "Действие", cost: "pool", type: "Иное", desc: "Требования: уровень Колдуна 5 или выше\n\nВы можете дышать под водой, и вы получаете Скорость плавания, равную вашей Скорости.Вы также можете сотворить заклинание Подводное дыхание один раз без траты ячейки заклинаний, и вы восстанавливаете способность сделать это после завершения Долгого отдыха." },
        { name: "Уроки древних", original: "Lessons of the First Ones", level: 2, timing: null, cost: null, type: "Иное", desc: "Требования: уровень Колдуна 2 или выше\n\nВы получили знания от древней сущности мультивселенной, что позволяет вам получить одну Черту происхождения.\n\nПовторяемость. Вы можете выбирать это воззвание более одного раза. Каждый раз вы должны выбирать новую Черту происхождения." },
        { name: "Ведьмачий взор", original: "Witch Sight", level: 15, timing: null, cost: null, type: "Иное", desc: "Требования: уровень Колдуна 15 или выше\n\nВы получаете Истинное зрение дальностью 30 футов." },
        { name: "Дьявольское зрение", original: "Devil’s Sight", level: 2, timing: null, cost: null, type: "Иное", desc: "Требования: уровень Колдуна 2 или выше\n\nВы можете нормально видеть в Тусклом свете и Темноте (как магической, так и не магической) в пределах 120 футов от вас." },
        { name: "Мистический разум", original: "Eldritch Mind", level: null, timing: null, cost: null, type: "Иное", desc: "Вы совершаете с Преимуществом спасброски Телосложения для поддержания Концентрации." },
      ];
      let made = 0;
      for (const it of invocations) {
        if (findEntry(invGroup, "mechanic_item", it.name) != null) continue;
        const data: Record<string, unknown> = { checks: [], effects: [], invocation_type: it.type };
        if (it.timing) data.casting_timing = it.timing;
        if (it.cost === "pool") data.cost = { kind: "uses", amount: 1, per: "long_rest", ownResource: true };
        database
          .prepare(
            "INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, name_original, level, data, description, position) VALUES (?, ?, ?, 'mechanic_item', ?, ?, ?, ?, ?, ?)"
          )
          .run(warlock.sysId, mechSection, invGroup, it.name, it.original, it.level, JSON.stringify(data), it.desc, nextPos(invGroup));
        made++;
      }
      if (made > 0) console.log(`[db] Воззвания колдуна: записей: ${made}`);
      const featRow = database
        .prepare(
          "SELECT id, data FROM compendium_entries WHERE parent_id = ? AND kind = 'feature' AND name = 'Таинственные воззвания' LIMIT 1"
        )
        .get(warlock.id) as { id: number; data: string } | undefined;
      if (featRow) {
        try {
          const featData = JSON.parse(featRow.data || "{}") as Record<string, unknown>;
          if (featData.choices == null) {
            const ladder: [number, number][] = [
              [1, 1],
              [2, 2],
              [5, 2],
              [7, 1],
              [9, 1],
              [12, 1],
              [15, 1],
              [18, 1],
            ];
            featData.choices = ladder.map(([minLevel, count]) => ({
              key: "invocations",
              kind: "entry",
              group: "Таинственные воззвания",
              count,
              minLevel,
            }));
            database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(featData), featRow.id);
          }
        } catch {
          // Битый JSON записи — не наша авария, пропускаем.
        }
      }
    }
    setAppSettingFlag(database, "warlock_invocations_v1");
  }

  // Колдун, тикет 02, догонка: одна запись («Туманные видения») успела
  // посеяться без timing до правки опечатки id (nisty-visions) — пропуск
  // «только недостающее» её больше не чинит. Сверяем структурные поля всех
  // 28 воззваний с эталоном и правим только расхождения; имена и описания
  // (правка Мастера) не трогаем. Одноразовая (флаг).
  if (!appSettingFlag(database, "warlock_invocations_fix_v1")) {
    const spec: { name: string; level: number | null; timing: string | null; pool: boolean; type: string }[] = [
      { name: "Мистическое копьё", level: 2, timing: null, pool: false, type: "Заговор" },
      { name: "Мучительный взрыв", level: 2, timing: null, pool: false, type: "Заговор" },
      { name: "Отталкивающий заряд", level: 2, timing: null, pool: false, type: "Заговор" },
      { name: "Доспех теней", level: null, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Потусторонний прыжок", level: 2, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Мощь Исчадия", level: 2, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Восходящий шаг", level: 5, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Маска многих лиц", level: 2, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Мастер бесчисленных обликов", level: 5, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Туманные видения", level: 2, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Один среди теней", level: 5, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Видения дальних земель", level: 9, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Могильный шёпот", level: 7, timing: "Действие", pool: false, type: "Заклинание" },
      { name: "Договор клинка", level: null, timing: "Бонусное действие", pool: false, type: "Договор клинка" },
      { name: "Жаждущий клинок", level: 5, timing: null, pool: false, type: "Договор клинка" },
      { name: "Мистическая кара", level: 5, timing: null, pool: false, type: "Договор клинка" },
      { name: "Пожирающий клинок", level: 12, timing: null, pool: false, type: "Договор клинка" },
      { name: "Пьющий жизни", level: 9, timing: null, pool: false, type: "Договор клинка" },
      { name: "Договор гримуара", level: null, timing: null, pool: false, type: "Договор гримуара" },
      { name: "Дар защитников", level: 9, timing: null, pool: true, type: "Договор гримуара" },
      { name: "Договор цепи", level: null, timing: "Действие", pool: false, type: "Договор цепи" },
      { name: "Облачение хозяина цепи", level: 5, timing: null, pool: false, type: "Договор цепи" },
      { name: "Взор двух умов", level: 5, timing: "Бонусное действие", pool: false, type: "Иное" },
      { name: "Дар глубин", level: 5, timing: "Действие", pool: true, type: "Иное" },
      { name: "Уроки древних", level: 2, timing: null, pool: false, type: "Иное" },
      { name: "Ведьмачий взор", level: 15, timing: null, pool: false, type: "Иное" },
      { name: "Дьявольское зрение", level: 2, timing: null, pool: false, type: "Иное" },
      { name: "Мистический разум", level: null, timing: null, pool: false, type: "Иное" },
    ];
    const group = database
      .prepare("SELECT id FROM compendium_entries WHERE kind = 'mechanic_group' AND name = 'Таинственные воззвания' LIMIT 1")
      .get() as { id: number } | undefined;
    let fixed = 0;
    if (group) {
      for (const s of spec) {
        const row = database
          .prepare("SELECT id, level, data FROM compendium_entries WHERE parent_id = ? AND kind = 'mechanic_item' AND name = ?")
          .get(group.id, s.name) as { id: number; level: number | null; data: string } | undefined;
        if (!row) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data || "{}");
        } catch {
          continue;
        }
        let touched = false;
        const wantCost = s.pool ? { kind: "uses", amount: 1, per: "long_rest", ownResource: true } : undefined;
        const sameCost =
          (wantCost == null && data.cost == null) ||
          (wantCost != null && JSON.stringify(data.cost) === JSON.stringify(wantCost));
        if (!sameCost) {
          if (wantCost) data.cost = wantCost;
          else delete data.cost;
          touched = true;
        }
        const wantTiming = s.timing ?? undefined;
        if ((data.casting_timing as string | undefined) !== wantTiming) {
          if (wantTiming) data.casting_timing = wantTiming;
          else delete data.casting_timing;
          touched = true;
        }
        if ((data.invocation_type as string | undefined) !== s.type) {
          data.invocation_type = s.type;
          touched = true;
        }
        if ((row.level ?? null) !== s.level) {
          database.prepare("UPDATE compendium_entries SET level = ? WHERE id = ?").run(s.level, row.id);
          touched = true;
        }
        if (!touched) continue;
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), row.id);
        fixed++;
      }
    }
    if (fixed > 0) console.log(`[db] Воззвания колдуна (структура): записей: ${fixed}`);
    setAppSettingFlag(database, "warlock_invocations_fix_v1");
  }

  // Монах (аудит класса, .scratch/monk/issues/01): Очки духа по PHB 2024
  // возвращаются на коротком И длинном отдыхе, а колонка жила без recharge —
  // код считал отсутствие длинным отдыхом, и короткий отдых очки не вернул.
  // Чинится данными: колонке «Очки духа» — короткий отдых (длинный чинит и
  // короткие тоже). Только недостающее поле, во всех системах; ручной выбор
  // Мастера не перебиваем. Одноразовая (флаг).
  if (!appSettingFlag(database, "monk_focus_short_v1")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const progression = (data.progression ?? null) as {
        columns?: { key: string; label: string; role: string; recharge?: string }[];
      } | null;
      if (!progression || !Array.isArray(progression.columns)) continue;
      let touched = false;
      for (const col of progression.columns) {
        if (col?.role === "resource" && (col.label ?? "").trim() === "Очки духа" && !col.recharge) {
          col.recharge = "short";
          touched = true;
        }
      }
      if (!touched) continue;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Очки духа монаха — короткий отдых: записей: ${fixed}`);
    setAppSettingFlag(database, "monk_focus_short_v1");
  }

  // Монах, приёмы за очки духа (.scratch/monk/issues/02): все фичи класса жили
  // чистым текстом (checks=[], effects=[], cost отсутствует) — в «Бой» попадали
  // только две реакции, а Шквал и Ошеломляющий не имели ни цены, ни бросков.
  // Чинится данными, код трогать не надо: лист перечитывает timing/checks/
  // effects/cost из записей живьём (resolveFeature), правки подхватываются
  // существующими персонажами без их миграций. Только недостающее, ручные
  // правки Мастера не перебиваем. Одноразовая (флаг).
  //
  // Границы проведены сознательно:
  // - «Дух монаха» становится строкой «Бонусное действие, −1 дух»: это Шквал
  //   (единственный приём, который всегда стоит очко). Бесплатные Рывок/Отход
  //   через Поступь/Оборону игрок жмёт без траты — на его совести, как
  //   «не тратится при провале» у Тактического разума воина.
  // - «Отражение атак» цены не получает: базовое уменьшение урона бесплатно,
  //   очко стоит только перенаправление. Цена на строке сделала бы бесплатную
  //   реакцию платной — хуже, чем ручная трата.
  if (!appSettingFlag(database, "monk_costs_v1")) {
    const monkRows = database
      .prepare(
        `SELECT e.id, e.system_id
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; system_id: number }[];
    const readData = (id: number): Record<string, unknown> | null => {
      const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as
        | { data: string }
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.data || "{}") as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const writeData = (id: number, data: Record<string, unknown>) => {
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    };
    const findFeatureId = (parentId: number, name: string): number | null => {
      const row = database
        .prepare(
          "SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ? LIMIT 1"
        )
        .get(parentId, name) as { id: number } | undefined;
      return row?.id ?? null;
    };
    let fixed = 0;
    for (const monk of monkRows) {
      // Состояние «Ошеломлённый» — ссылкой {id, name}: id механики свой в каждой
      // базе, ищем в своей системе. Нет — эффект станет текстовым (special).
      const stun = database
        .prepare(
          "SELECT id, name FROM compendium_entries WHERE system_id = ? AND kind = 'mechanic_item' AND name = 'Ошеломлённый' LIMIT 1"
        )
        .get(monk.system_id) as { id: number; name: string } | undefined;
      // 1. Дух монаха: строка Шквала в «Бою».
      {
        const id = findFeatureId(monk.id, "Дух монаха");
        const data = id != null ? readData(id) : null;
        if (id != null && data) {
          let touched = false;
          if (data.casting_timing == null) {
            data.casting_timing = "Бонусное действие";
            touched = true;
          }
          if (data.cost == null) {
            data.cost = { kind: "resource", resourceLabel: "Очки духа" };
            touched = true;
          }
          if (touched) {
            writeData(id, data);
            fixed++;
          }
        }
      }
      // 2. Ошеломляющий удар: сейв Телосложения + состояние при провале + цена.
      {
        const id = findFeatureId(monk.id, "Ошеломляющий удар");
        const data = id != null ? readData(id) : null;
        if (id != null && data) {
          let touched = false;
          if (data.casting_timing == null) {
            data.casting_timing = "Иное";
            touched = true;
          }
          if (data.casting_timing_other == null) {
            data.casting_timing_other =
              "один раз за ход, при попадании безоружным ударом или монашеским оружием";
            touched = true;
          }
          if (!Array.isArray(data.checks) || data.checks.length === 0) {
            data.checks = [{ id: "save1", type: "save", saveAbility: "Телосложение" }];
            touched = true;
          }
          if (!Array.isArray(data.effects) || data.effects.length === 0) {
            data.effects = [
              stun
                ? {
                    id: "i1",
                    type: "condition",
                    when: "save_fail",
                    checkId: "save1",
                    condition: { id: stun.id, name: stun.name },
                    text: "до начала вашего следующего хода; при успехе — скорость цели уменьшается вдвое до начала вашего следующего хода, следующая атака по ней с преимуществом",
                  }
                : {
                    id: "i1",
                    type: "special",
                    when: "save_fail",
                    checkId: "save1",
                    text: "провал — ошеломлён до начала вашего следующего хода; успех — скорость уменьшается вдвое, следующая атака с преимуществом",
                  },
            ];
            touched = true;
          }
          if (data.cost == null) {
            data.cost = { kind: "resource", resourceLabel: "Очки духа" };
            touched = true;
          }
          if (touched) {
            writeData(id, data);
            fixed++;
          }
        }
      }
      // 3. Отражение атак: численное уменьшение урона в строку «Боя».
      {
        const id = findFeatureId(monk.id, "Отражение атак");
        const data = id != null ? readData(id) : null;
        if (id != null && data) {
          if (!Array.isArray(data.effects) || data.effects.length === 0) {
            data.effects = [
              {
                id: "i1",
                type: "defense",
                when: "always",
                text: "уменьшить дробящий/колющий/режущий урон на 1к10 + мод. Лов + уровень монаха (с 13 уровня — любой тип); за 1 очко духа — перенаправить при снижении до 0",
              },
            ];
            writeData(id, data);
            fixed++;
          }
        }
      }
    }
    if (fixed > 0) console.log(`[db] Приёмы монаха (цена/броски): записей: ${fixed}`);
    setAppSettingFlag(database, "monk_costs_v1");
  }

  // Требования мультикласса (PHB 2024, гл. 2; у 2014 те же): чтобы взять уровень
  // в новом классе, нужны 13+ в его ключевых характеристиках. Данными, а не
  // кодом: лист показывает их подсказкой у второго и следующих классов, гейта
  // нет (домашние правила сплошь и рядом). Только недостающее поле.
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "class_multiclass_prereq_v1")) {
    const prereq: Record<string, string> = {
      "Варвар": "Сила 13",
      "Бард": "Харизма 13",
      "Воин": "Сила 13 или Ловкость 13",
      "Волшебник": "Интеллект 13",
      "Друид": "Мудрость 13",
      "Жрец": "Мудрость 13",
      "Колдун": "Харизма 13",
      "Монах": "Ловкость 13 и Мудрость 13",
      "Паладин": "Сила 13 и Харизма 13",
      "Плут": "Ловкость 13",
      "Следопыт": "Ловкость 13 и Мудрость 13",
      "Чародей": "Харизма 13",
      "Артефактор": "Интеллект 13",
    };
    const rows = database
      .prepare(
        `SELECT e.id, e.name, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL`
      )
      .all() as { id: number; name: string; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      const want = prereq[row.name];
      if (!want) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (data.multiclass_prereq != null) continue;
      data.multiclass_prereq = want;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Требования мультикласса: записей: ${fixed}`);
    setAppSettingFlag(database, "class_multiclass_prereq_v1");
  }
  // - Мастер Тени: «Теневые обманки» — заговор Малая иллюзия known (рядом с
  //   Тьмой, которая уже в грантах). Механика выдачи та же: recomputeGrantedSpells
  //   читает granted_spells класса и подкласса с фильтром по уровню.
  // - Мастер Стихий: «Манипуляция стихией» — заговор Элементализм known.
  // - Мастер Милосердия: «Орудия милосердия» — навыки Медицина/Проницательность
  //   и Набор травника (skills + tool_profs читает grantsFromEntry; применение
  //   на выбор подкласса — в pickSubclass, снятие — через revokeGrants).
  // Монах, зазоры аудита 2024, ч.1 (.scratch/monk/audit-2024.md): выдачи подкласса,
  // которые есть в книге, но не лежат в данных. Только недостающее, ручные
  // правки Мастера не перебиваем. Одноразовая (флаг).
  if (!appSettingFlag(database, "monk_subclass_grants_v1")) {
    const findSpell = (systemId: number, original: string): { id: number; name: string } | null => {
      const row = database
        .prepare(
          "SELECT id, name FROM compendium_entries WHERE system_id = ? AND kind = 'spell' AND name_original = ? LIMIT 1"
        )
        .get(systemId, original) as { id: number; name: string } | undefined;
      return row ?? null;
    };
    const findTool = (systemId: number, original: string): { id: number; name: string } | null => {
      const row = database
        .prepare(
          "SELECT id, name FROM compendium_entries WHERE system_id = ? AND kind = 'equipment' AND name_original = ? LIMIT 1"
        )
        .get(systemId, original) as { id: number; name: string } | undefined;
      return row ?? null;
    };
    const monks = database
      .prepare(
        `SELECT e.id, e.system_id
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; system_id: number }[];
    let fixed = 0;
    for (const monk of monks) {
      const subId = (name: string): number | null => {
        const row = database
          .prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ? LIMIT 1")
          .get(monk.id, name) as { id: number } | undefined;
        return row?.id ?? null;
      };
      const grantCantrip = (subName: string, spellOriginal: string) => {
        const sid = subId(subName);
        if (sid == null) return;
        const spell = findSpell(monk.system_id, spellOriginal);
        if (!spell) return;
        const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(sid) as
          | { data: string }
          | undefined;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row?.data || "{}");
        } catch {
          return;
        }
        const grants = Array.isArray(data.granted_spells) ? [...(data.granted_spells as unknown[])] : [];
        const has = grants.some((g) => {
          const r = g as Record<string, unknown>;
          return r.id === spell.id || r.original === spellOriginal;
        });
        if (has) return;
        grants.push({ id: spell.id, name: spell.name, grantLevel: 3, original: spellOriginal });
        data.granted_spells = grants;
        database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), sid);
        fixed++;
      };
      grantCantrip("Мастер Тени", "Minor Illusion");
      grantCantrip("Мастер Стихий", "Elementalism");
      // Орудия милосердия.
      const mercyId = subId("Мастер Милосердия");
      if (mercyId != null) {
        const row = database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(mercyId) as
          | { data: string }
          | undefined;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row?.data || "{}");
        } catch {
          data = {};
        }
        let touched = false;
        if (!Array.isArray(data.skills)) {
          data.skills = ["Медицина", "Проницательность"];
          touched = true;
        }
        if (!Array.isArray(data.tool_profs)) {
          const kit = findTool(monk.system_id, "Herbalism Kit");
          if (kit) {
            data.tool_profs = [{ id: kit.id, name: kit.name }];
            touched = true;
          }
        }
        if (touched) {
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), mercyId);
          fixed++;
        }
      }
    }
    if (fixed > 0) console.log(`[db] Выдачи подклассов монаха: записей: ${fixed}`);
    setAppSettingFlag(database, "monk_subclass_grants_v1");
  }
  // Монах, выбор валюты за Тьму (.scratch/monk/audit-2024.md): «Искусства тени»
  // позволяют сотворить Тьму за 1 очко сосредоточения, но в листе заклинание
  // шло только строкой заклинания — а SpendAction для заклинаний умеет тратить
  // ТОЛЬКО ячейки. Итог: в мультиклассе с кастером предлагалась только ячейка
  // (по книге — только очко), а у чистого монаха строка говорила «ячеек нет».
  // Чинится данными: признаку — время Действие + цена 1 очко (кнопка фокуса в
  // «Бою» у всех), дарованное заклинание остаётся строкой (текст + permissive
  // ячейка в мультиклассе). В мультиклассе получается выбор: фокус на строке
  // умения, ячейка на строке заклинания. Только недостающее. Одноразовая.
  if (!appSettingFlag(database, "monk_shadow_arts_cost_v1")) {
    const monks = database
      .prepare(
        `SELECT e.id
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number }[];
    let fixed = 0;
    for (const monk of monks) {
      const shadow = database
        .prepare("SELECT id FROM compendium_entries WHERE parent_id = ? AND name = 'Мастер Тени' LIMIT 1")
        .get(monk.id) as { id: number } | undefined;
      if (!shadow) continue;
      const feat = database
        .prepare("SELECT id, data FROM compendium_entries WHERE parent_id = ? AND name = 'Искусства тени' LIMIT 1")
        .get(shadow.id) as { id: number; data: string } | undefined;
      if (!feat) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(feat.data || "{}");
      } catch {
        continue;
      }
      let touched = false;
      if (data.casting_timing == null) {
        data.casting_timing = "Действие";
        touched = true;
      }
      if (data.cost == null) {
        data.cost = { kind: "resource", resourceLabel: "Очки духа" };
        touched = true;
      }
      if (!touched) continue;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), feat.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Искусства тени (цена — очко): записей: ${fixed}`);
    setAppSettingFlag(database, "monk_shadow_arts_cost_v1");
  }
  // Монах, СЛ Ошеломляющего удара (.scratch/monk/audit-2024.md, код-аудит):
  // СЛ сейва считалась от заклинательной характеристики, которой у чистого
  // монаха нет — показывало 8 + 0 + БМ вместо 8 + Муд + БМ. Чинится данными:
  // бросок получает dcAbility "wis" (механизм в checksLabel). Только
  // недостающее поле. Одноразовая (флаг).
  if (!appSettingFlag(database, "monk_stunning_dc_v1")) {
    const monks = database
      .prepare(
        `SELECT e.id
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number }[];
    let fixed = 0;
    for (const monk of monks) {
      const feat = database
        .prepare("SELECT id, data FROM compendium_entries WHERE parent_id = ? AND name = 'Ошеломляющий удар' LIMIT 1")
        .get(monk.id) as { id: number; data: string } | undefined;
      if (!feat) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(feat.data || "{}");
      } catch {
        continue;
      }
      const checks = Array.isArray(data.checks) ? (data.checks as Record<string, unknown>[]) : null;
      const save = checks?.find((c) => c.type === "save");
      if (!save || save.dcAbility != null) continue;
      save.dcAbility = "wis";
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), feat.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] СЛ Ошеломляющего (Муд): записей: ${fixed}`);
    setAppSettingFlag(database, "monk_stunning_dc_v1");
  }
  // Оракул Воина: пул цитат на оборот карты персонажа. Дописываем только
  // недостающие (сверка по точному тексту); правки Мастера не трогаем.
  // Одноразовая (флаг).
  if (!appSettingFlag(database, "fighter_oracle_quotes_v1")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12191").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        const have = Array.isArray(data.oracle_quotes)
          ? (data.oracle_quotes as unknown[]).filter((q): q is string => typeof q === "string")
          : [];
        const want = [
          "«Смерть — это лишь шаг к новой победе!»",
          "«Я не ищу славы ради славы. Я сражаюсь, чтобы защитить слабых».",
          "«В этом бою я докажу, что мой род достоин величия».",
          "«Не важно, сколько врагов перед тобой — важно, сколько мужества в одном человеке».",
          "«Я не боюсь боли. Я боюсь того, что будет после».",
          "«За мной — не просто союзники, а те, кто не может постоять за себя».",
          "«Щит и удар — вот что держит мир в равновесии».",
          "«Доспех хранит не только от пуль, но и от сомнений».",
          "«В этом мире слишком много зла. Я должен стоять на его пути».",
          "«Я не боюсь смерти. Но я не могу позволить злу победить».",
          "«Моя честь — это мой щит. И я не позволю её запятнать».",
          "«Один удар за другим — так рождается победа».",
          "Рыцарь Пурпурного Дракона: «Я поклялся защищать корону. И я буду совершать в бою самые смелые поступки, чтобы вести за собой остальных».",
          "Самурай: «У врагов, вставших передо мной, два варианта: сдаться или умереть в бою».",
          "Мистический Лучник: «Я вплету магию в каждый выстрел. Враг не переживёт этого».",
          "«Пацан сказал — пацан ударил. Два раза. На пятом уровне — три.»",
          "«Не важно, какой у тебя меч. Важно, кто встанет за твоей спиной.»",
          "«Щит не для того, чтобы прятаться. Щит для того, чтобы подойти ближе.»",
          "«Настоящий воин врагов не считает. Он считает, сколько друзей вернётся домой.»",
          "«Доспех можно пробить. Слово пацана — нет.»",
          "«Кто с мечом к нам придёт — тот от меча и ляжет. Дважды. Это дополнительная атака.»",
          "«Короткий отдых — это когда пацаны присели. Длинный — когда уже победили.»",
          "«Я не ношу тяжёлый доспех потому, что боюсь. Я ношу его потому, что лёгкий мне мал.»",
          "«Мне не нужно второе дыхание. Это врагам нужно, чтобы я его не тратил.»",
          "«Я не бью дважды. Я бью один раз — просто у меня есть ещё три атаки.»",
          "«Говорят, у страха глаза велики. У моего замаха размах шире.»",
          "«Провоцированные атаки меня не провоцируют.»",
          "«Мой бонус владения — это не цифра в листе. Это предупреждение.»",
          "«Я не отступаю. Я тактически сокращаю дистанцию до таверны.»",
          "«Волк не носит доспех. Но если бы носил — только тяжёлый.»",
          "«Волк слабее дракона. Но дракон не спускается в подземелье с партией.»",
          "«Овцы сбиваются в стадо. Волк жмёт Второе дыхание и идёт один.»",
          "«Волка не зовут в герои. Волк сам приходит, когда зовут на подмогу.»",
          "«Волк не проваливает спасброски. Волк перебрасывает их с бонусом, равным уровню.»",
          "«У волка нет подкласса. У волка есть клыки и бонусное действие.»",
          "«Стая сильна волком. А волк силён тем, что его не надо лечить.»",
          "«У меня не просто удары. У меня приёмы. У тебя — синяки.»",
          "«Моя кость превосходства — к8. Твоя участь — тоже на восемь.»",
          "«Один приём на атаку. Мне хватает.»",
          "«Я знаю твои слабости. Ты свои — нет. Это и называется познать врага.»",
          "«Крит на 19? Это не удача. Это я.»",
          "«18, 19, 20 — это не броски. Это мой рабочий диапазон.»",
          "«Меня не надо вдохновлять. Я сам себе героическое вдохновение — каждый ход.»",
          "«Другие кидают спасброски от смерти. Я их кидаю с преимуществом.»",
          "«Ты не можешь меня обезоружить. Оружие привязано. Я — нет.»",
          "«Сначала заговор, потом атака. Это называется боевая магия, а не очередь.»",
          "«Щит — это заклинание. Доспех — это заклинание. А я — заклинание с мечом.»",
          "«Мои ячейки маленькие. Зато их четыре. На первом круге.»",
          "«Мой разум острее твоего меча. Проверено: к10 против твоей головы.»",
          "«Я не уклоняюсь. Я телекинетически не согласен с твоей атакой.»",
          "«Защитное поле? Это я просто не захотел, чтобы ты попал.»",
          "«Передвинуть тебя силой мысли — тоже ход. Магическим действием.»",
          "«За мной идут не потому, что я силён. А потому, что я лечу на 1к4 плюс уровень.»",
          "«Мой всплеск действий — это когда вся партия бьёт вместе со мной.»",
          "«Союзник рядом со мной спасброски не проваливает. У меня на это Упорный.»",
          "«Моя стрела сама находит цель. Ищущий выстрел, слышал?»",
          "«Один выстрел — восемь вариантов. Выбирай, от чего увернуться.»",
          "«Лук без магии — просто палка с верёвкой. У меня — не просто.»",
          "«Моя кость выстрела уже к12. Твой доспех — всё ещё нет.»",
          "«Второе дыхание? У меня их четыре. Все восстанавливаются на длинном.»",
          "«Одно действие — хорошо. А два — это всплеск. А на семнадцатом — два всплеска.»",
          "«Я не провалил проверку. Я просто ещё не добавил к10.»",
          "«Перебросить спас с бонусом, равным уровню? Легко. У меня таких три.»",
          "«Первый раз промахнулся — изучаю. Второй раз не промахиваюсь.»",
          "«Три вида оружия освоено. Остальные — в процессе.»",
          "«Толкнуть, изнурить, замедлить — выбирай. Это всё я.»",
          "«Девятнадцатый уровень. Дальше только легенда.»",
          "«Можно избежать драки. Но тогда зачем ты столько качался?»",
          "«Я не агрессивный. Я просто заранее согласен на инициативу.»",
          "«Умный отступает от боя. Воин отступает за зельем.»",
          "«Не каждый конфликт решается мечом. Иногда нужен топор.»",
          "«Врагов много не бывает. Бывает мало атак за ход.»",
          "«У каждого есть план, пока воин не кинул инициативу.»",
          "«Настоящий хищник не ждёт удобного момента. Он ждёт, пока мастер закончит описание комнаты.»",
          "«Удача любит подготовленных. Крит любит Champion.»",
          "«Мне не нужен особый приём. Мне нужна двадцатка.»",
          "«Когда у тебя 1 HP — это не мало. Это достаточно.»",
          "«Мой боевой стиль — не умирать.»",
          "«Если броня даёт -2 к скрытности, значит, мне незачем скрываться.»",
          "«Я не танк. Я просто стою впереди.»",
          "«Крит — это когда мастер понял, что зря дал тебе оружие.»",
          "«Неважно, насколько силён враг. Важно, сколько у тебя Action Surge.»",
          "«Первое правило воина: не умереть. Второе правило: если умер — сделать вид, что это была тактика.»",
          "«Маги изучают древние фолианты. Я изучаю расстояние до ближайшего врага.»",
          "«Жизнь коротка. Хиты конечны. Action Surge один раз за короткий отдых. Думай.»",
          "«Не бойся противников. Бойся момента, когда мастер достаёт d20.»",
          "«Настоящий воин знает: иногда лучший способ пережить бой — закончить его раньше.»",
        ];
        const next = [...have, ...want.filter((q) => !have.includes(q))];
        if (next.length !== have.length) {
          data.oracle_quotes = next;
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12191").run(JSON.stringify(data));
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_oracle_quotes_v1");
  }

  // Чистка пула Воина: убираем 52 авторские цитаты (мемные и по
  // подклассам/способностям) — в части фактические расхождения с правилами,
  // будут сбивать с толку. Удаляем только точное совпадение; цитаты
  // пользователя и правки Мастера не трогаем. Одноразовая (флаг).
  if (!appSettingFlag(database, "fighter_oracle_quotes_cleanup_v1")) {
    const row = database.prepare("SELECT data FROM compendium_entries WHERE id = 12191").get() as
      | { data: string }
      | undefined;
    if (row) {
      try {
        const data = JSON.parse(row.data || "{}") as Record<string, unknown>;
        if (Array.isArray(data.oracle_quotes)) {
          const drop = new Set([
            "«Пацан сказал — пацан ударил. Два раза. На пятом уровне — три.»",
            "«Не важно, какой у тебя меч. Важно, кто встанет за твоей спиной.»",
            "«Щит не для того, чтобы прятаться. Щит для того, чтобы подойти ближе.»",
            "«Настоящий воин врагов не считает. Он считает, сколько друзей вернётся домой.»",
            "«Доспех можно пробить. Слово пацана — нет.»",
            "«Кто с мечом к нам придёт — тот от меча и ляжет. Дважды. Это дополнительная атака.»",
            "«Короткий отдых — это когда пацаны присели. Длинный — когда уже победили.»",
            "«Я не ношу тяжёлый доспех потому, что боюсь. Я ношу его потому, что лёгкий мне мал.»",
            "«Мне не нужно второе дыхание. Это врагам нужно, чтобы я его не тратил.»",
            "«Я не бью дважды. Я бью один раз — просто у меня есть ещё три атаки.»",
            "«Говорят, у страха глаза велики. У моего замаха размах шире.»",
            "«Провоцированные атаки меня не провоцируют.»",
            "«Мой бонус владения — это не цифра в листе. Это предупреждение.»",
            "«Я не отступаю. Я тактически сокращаю дистанцию до таверны.»",
            "«Волк не носит доспех. Но если бы носил — только тяжёлый.»",
            "«Волк слабее дракона. Но дракон не спускается в подземелье с партией.»",
            "«Овцы сбиваются в стадо. Волк жмёт Второе дыхание и идёт один.»",
            "«Волка не зовут в герои. Волк сам приходит, когда зовут на подмогу.»",
            "«Волк не проваливает спасброски. Волк перебрасывает их с бонусом, равным уровню.»",
            "«У волка нет подкласса. У волка есть клыки и бонусное действие.»",
            "«Стая сильна волком. А волк силён тем, что его не надо лечить.»",
            "«У меня не просто удары. У меня приёмы. У тебя — синяки.»",
            "«Моя кость превосходства — к8. Твоя участь — тоже на восемь.»",
            "«Один приём на атаку. Мне хватает.»",
            "«Я знаю твои слабости. Ты свои — нет. Это и называется познать врага.»",
            "«Крит на 19? Это не удача. Это я.»",
            "«18, 19, 20 — это не броски. Это мой рабочий диапазон.»",
            "«Меня не надо вдохновлять. Я сам себе героическое вдохновение — каждый ход.»",
            "«Другие кидают спасброски от смерти. Я их кидаю с преимуществом.»",
            "«Ты не можешь меня обезоружить. Оружие привязано. Я — нет.»",
            "«Сначала заговор, потом атака. Это называется боевая магия, а не очередь.»",
            "«Щит — это заклинание. Доспех — это заклинание. А я — заклинание с мечом.»",
            "«Мои ячейки маленькие. Зато их четыре. На первом круге.»",
            "«Мой разум острее твоего меча. Проверено: к10 против твоей головы.»",
            "«Я не уклоняюсь. Я телекинетически не согласен с твоей атакой.»",
            "«Защитное поле? Это я просто не захотел, чтобы ты попал.»",
            "«Передвинуть тебя силой мысли — тоже ход. Магическим действием.»",
            "«За мной идут не потому, что я силён. А потому, что я лечу на 1к4 плюс уровень.»",
            "«Мой всплеск действий — это когда вся партия бьёт вместе со мной.»",
            "«Союзник рядом со мной спасброски не проваливает. У меня на это Упорный.»",
            "«Моя стрела сама находит цель. Ищущий выстрел, слышал?»",
            "«Один выстрел — восемь вариантов. Выбирай, от чего увернуться.»",
            "«Лук без магии — просто палка с верёвкой. У меня — не просто.»",
            "«Моя кость выстрела уже к12. Твой доспех — всё ещё нет.»",
            "«Второе дыхание? У меня их четыре. Все восстанавливаются на длинном.»",
            "«Одно действие — хорошо. А два — это всплеск. А на семнадцатом — два всплеска.»",
            "«Я не провалил проверку. Я просто ещё не добавил к10.»",
            "«Перебросить спас с бонусом, равным уровню? Легко. У меня таких три.»",
            "«Первый раз промахнулся — изучаю. Второй раз не промахиваюсь.»",
            "«Три вида оружия освоено. Остальные — в процессе.»",
            "«Толкнуть, изнурить, замедлить — выбирай. Это всё я.»",
            "«Девятнадцатый уровень. Дальше только легенда.»",
          ]);
          const have = (data.oracle_quotes as unknown[]).filter((q): q is string => typeof q === "string");
          const next = have.filter((q) => !drop.has(q));
          if (next.length !== have.length) {
            data.oracle_quotes = next;
            database.prepare("UPDATE compendium_entries SET data = ? WHERE id = 12191").run(JSON.stringify(data));
          }
        }
      } catch {
        // Битый JSON записи — не наша авария, пропускаем.
      }
    }
    setAppSettingFlag(database, "fighter_oracle_quotes_cleanup_v1");
  }
  // Оракул класса (.scratch/class-oracle): сид пула цитат Монаха. Только если
  // поля нет вовсе; правки Мастера не перебиваем. Одноразовая (флаг).
  if (!appSettingFlag(database, "monk_oracle_quotes_v1")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      if (data.oracle_quotes != null) continue;
      data.oracle_quotes = [
        "Истинная сила проявляется в смирении.",
        "Путь не в том, чтобы не падать, а в том, чтобы подниматься после каждого падения.",
        "Концентрация рождает ясность, а ясность — победу.",
        "Не бойся противника, бойся врага внутри.",
        "Настоящий мастер побеждает не силой, а умением заставить противника увидеть свою ошибку.",
      ];
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Оракул монаха: записей: ${fixed}`);
    setAppSettingFlag(database, "monk_oracle_quotes_v1");
  }

  // Оракул монаха, пачка 2: даосско-конфуцианские цитаты пользователя (22 шт).
  // Только добавление недостающих: сверка по нормализованной строке (без
  // кавычек/регистра/крайних пробелов) — правки и порядок Мастера не трогаем,
  // дубли не плодим. Одноразовая (флаг).
  if (!appSettingFlag(database, "monk_oracle_quotes_v2")) {
    const QUOTES = [
      "Мир — это наши поступки. Следуй зову судьбы, и не будет сомнений.",
      "Кто думает, что постиг всё, тот ничего не знает.",
      "Побеждающий других силён, но побеждающий себя самого — могуществен.",
      "Кто знает границы своей деятельности, не приблизится к опасностям, тот будет жить долго.",
      "Преодоление трудного начинается с лёгкого, осуществление великого начинается с малого.",
      "Познание других — это разум; познание себя — это истинная мудрость.",
      "Единственное, что человек делает всегда искренне, так это — заблуждается.",
      "Если ты задаёшь вопрос, значит, ты уже знаешь половину ответа.",
      "Не обращай внимания на то, как к тебе относятся люди — обращай внимание на то, как ты относишься к ним.",
      "Мудрость правителя следует оценивать не по тем великим свершениям, которыми ему довелось руководить, а по тем губительным ошибкам, которых ему удалось не допустить.",
      "Помогая ленивым людям, ты помогаешь им сесть на свою шею.",
      "Иди против ветра… и пусть тебе плюют в спину!",
      "Лишь то, что ничего не удерживает, ничего не теряет.",
      "Дао смывает всё как поток, и по этой причине никто не может достичь полного удовлетворения.",
      "Вот почему мудрый не спешит следовать велениям своего «Я», и тело само выбирает дорогу, забывает о себе и потому сам остаётся живым.",
      "Лучше всего — быть как вода. Вода с лёгкостью дарит благо всей тьме существ и не борется.",
      "Если любить всё, что есть в этом мире, как самого себя, можно жить беспечно, доверившись миру.",
      "Когда тяга всё понимать иссякает, пропадают омрачённость и тоска.",
      "Лучший путь пролегает там, где нет отпечатков колёс.",
      "Высшая благодать — это беззаботность, она случается просто так, без причин. Дурная благодать — быть озабоченным делами, и на то всегда есть причины.",
      "Я хорошо отношусь к тому, что добросердечен, к тому, у кого недоброе сердце, я тоже хорошо отношусь, в этом и есть истинное добросердечие.",
      "Люди, когда рождаются, податливы и нежны, а когда становятся несгибаемо-твёрдыми, они умирают.",
    ];
    const norm = (s: string) => s.trim().replace(/^«+|»+$/g, "").trim().toLowerCase();
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const pool = Array.isArray(data.oracle_quotes)
        ? (data.oracle_quotes as unknown[]).filter((q): q is string => typeof q === "string")
        : [];
      const seen = new Set(pool.map(norm));
      let touched = false;
      for (const q of QUOTES) {
        if (seen.has(norm(q))) continue;
        pool.push(q);
        seen.add(norm(q));
        touched = true;
      }
      if (!touched) continue;
      data.oracle_quotes = pool;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Оракул монаха, пачка 2: записей: ${fixed}`);
    setAppSettingFlag(database, "monk_oracle_quotes_v2");
  }
  // Оракул следопыта: цитаты пользователя (53 шт). Тот же приём, что у монаха:
  // только добавление недостающих (сверка по нормализованной строке),
  // правки и порядок Мастера не трогаем. Одноразовая (флаг).
  if (!appSettingFlag(database, "ranger_oracle_quotes_v1")) {
    const QUOTES = [
      "Я не заблудился. Я просто проверяю альтернативный маршрут.",
      "Следопыт не ищет дорогу. Он знает, куда ты пойдёшь.",
      "Если я молчу — это не значит, что меня нет. Это значит, что ты меня ещё не заметил.",
      "В лесу нет плохой погоды. Есть плохая экипировка.",
      "Настоящий следопыт приходит первым. Даже если квест ещё не начался.",
      "Ты можешь спрятаться. Но ты уже оставил след.",
      "Я не преследую врага. Я просто двигаюсь в ту же сторону, только быстрее.",
      "Самый опасный враг — тот, чей след ты потерял.",
      "Мне не нужно знать, где ты. Мне достаточно знать, где ты был.",
      "Если я достал лук — разговор окончен. Если я его ещё не достал — разговор уже был ошибкой.",
      "Я не злопамятный. Я просто помечаю цели.",
      "Некоторым людям нужен список дел. Мне нужен Hunter’s Mark.",
      "Я не выбрал тебя целью. Ты сам оставил след.",
      "Метка — это не приговор. Это просто очень подробное уведомление.",
      "Если над тобой появилась метка — беги. Если следопыт улыбается — уже поздно.",
      "Настоящая охота начинается не с выстрела. Она начинается с Hunter’s Mark.",
      "Ты можешь убежать от меня. От метки — сложнее.",
      "Волк знает тропу. Следопыт знает, кто по ней прошёл.",
      "Стая идёт по следу. Следопыт идёт впереди стаи.",
      "Волк слышит шаги. Следопыт слышит намерения.",
      "Хищник не бросается на добычу. Он ждёт, когда добыча сама устанет убегать.",
      "В лесу выживает не самый сильный. А тот, кто первым услышал ветку.",
      "Меня не видно не потому, что темно. Темно потому, что меня не видно.",
      "Некоторые боятся темноты. Я в ней работаю.",
      "Если ты видишь меня — значит, я позволил тебе меня увидеть.",
      "Ночь не скрывает меня. Ночь работает на меня.",
      "Я не исчезаю в темноте. Я становлюсь её частью.",
      "Первый удар решает многое. Поэтому я стараюсь, чтобы он был моим.",
      "Ты думал, что мы встретились случайно. Я думал, что ты никогда меня не заметишь.",
      "Настоящий следопыт никогда не один. Просто второй обычно на четырёх лапах.",
      "Он не питомец. Он мой напарник.",
      "Ты можешь победить меня. Но сначала тебе придётся объяснить это моему зверю.",
      "У тебя есть союзники. У меня есть тот, кто никогда не задаёт лишних вопросов.",
      "Верность не требует высокой Харизмы.",
      "Мы не говорим перед боем. Мы оба знаем, что делать.",
      "Некоторые приводят на битву друзей. Я привожу хищника.",
      "Один враг — цель. Два врага — выбор. Три врага — хороший день.",
      "Я не охочусь на монстров. Я сокращаю их популяцию.",
      "Большая добыча требует большого лука.",
      "Следопыт не спрашивает, насколько силён монстр. Он спрашивает, где у него уязвимое место.",
      "Ты называешь это чудовищем. Я называю это добычей.",
      "Если карта говорит, что здесь дороги нет — значит, будет интересно.",
      "Я не заблудился. Это карта устарела.",
      "Выживальщик — это когда ты взял с собой всё, кроме того, что реально понадобится.",
      "Следопыт должен уметь всё. Поэтому я ничего не умею идеально.",
      "Маг знает сто заклинаний. Я знаю, где он будет через пять минут.",
      "У воина есть броня. У мага есть заклинания. У меня есть дистанция.",
      "Если враг далеко — стреляю. Если близко — отхожу. Если догнал — это уже моя ошибка.",
      "Природа не жестока. Она просто не делает скидок.",
      "Лучшая ловушка — та, о которой враг узнаёт после срабатывания.",
      "Следы говорят громче людей.",
      "Я не избегаю цивилизации. Просто цивилизация оставляет слишком много следов.",
      "Можно не знать, куда идёшь. Главное — знать, откуда пришёл.",
    ];
    const norm = (s: string) => s.trim().replace(/^«+|»+$/g, "").trim().toLowerCase();
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Следопыт'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const pool = Array.isArray(data.oracle_quotes)
        ? (data.oracle_quotes as unknown[]).filter((q): q is string => typeof q === "string")
        : [];
      const seen = new Set(pool.map(norm));
      let touched = false;
      for (const q of QUOTES) {
        if (seen.has(norm(q))) continue;
        pool.push(q);
        seen.add(norm(q));
        touched = true;
      }
      if (!touched) continue;
      data.oracle_quotes = pool;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Оракул следопыта: записей: ${fixed}`);
    setAppSettingFlag(database, "ranger_oracle_quotes_v1");
  }
  // Монах, опечатка (.scratch/monk/issues/04): в строке 1 уровня таблицы
  // развития «Боевые искуства» вместо «искусства». Только известная плохая
  // форма, остальное не трогаем. Одноразовая (флаг). Риск: реимпорт главы из
  // исходного файла вернёт опечатку — источник файла неизвестен, при повторе
  // править там.
  if (!appSettingFlag(database, "monk_typo_v1")) {
    const rows = database
      .prepare(
        `SELECT e.id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind = 'class' AND e.parent_id IS NULL AND e.name = 'Монах'`
      )
      .all() as { id: number; data: string }[];
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
    let fixed = 0;
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data || "{}");
      } catch {
        continue;
      }
      const progression = (data.progression ?? null) as {
        rows?: Record<string, string>[];
      } | null;
      if (!progression || !Array.isArray(progression.rows)) continue;
      let touched = false;
      for (const r of progression.rows) {
        for (const key of Object.keys(r)) {
          if (typeof r[key] === "string" && r[key].includes("Боевые искуства")) {
            r[key] = r[key].replace("Боевые искуства", "Боевые искусства");
            touched = true;
          }
        }
      }
      if (!touched) continue;
      update.run(JSON.stringify(data), row.id);
      fixed++;
    }
    if (fixed > 0) console.log(`[db] Опечатка монаха («искуства»): записей: ${fixed}`);
    setAppSettingFlag(database, "monk_typo_v1");
  }

  // Монах, сверка с редакцией 2024 (.scratch/monk/audit-2024.md): точечные
  // расхождения текста с источником 5e24. Только известные плохие формы,
  // ручные правки Мастера не перебиваем (замена — строго по подстроке).
  // Одноразовая (флаг).
  // 1. «halved» в эффекте Ошеломляющего удара — огрызок английского из первой
  //    версии миграции monk_costs_v1: флаг одноразовый, прод-база успела
  //    забрать плохую строку до правки исходника.
  // 2. «Плащ теней»: время — Бонусное действие, а не Действие (источник 5e24:
  //    «то Бонусным действием вы можете потратить 3 Очка...»).
  // 3. «Орудия милосердия»: навык — Проницательность, а не Внимательность
  //    (терминология 2024).
  // 4. Мультикласс: при взятии даётся и кость хитов, и умения 1 уровня.
  if (!appSettingFlag(database, "monk_text_repairs_v1")) {
    const readRow = (id: number): { description: string; data: string } | null => {
      const row = database
        .prepare("SELECT description, data FROM compendium_entries WHERE id = ?")
        .get(id) as { description: string; data: string } | undefined;
      return row ?? null;
    };
    const findByName = (parentId: number | null, name: string): number | null => {
      const row = database
        .prepare(
          parentId == null
            ? "SELECT id FROM compendium_entries WHERE parent_id IS NULL AND name = ? LIMIT 1"
            : "SELECT id FROM compendium_entries WHERE parent_id = ? AND name = ? LIMIT 1"
        )
        .get(...(parentId == null ? [name] : [parentId, name])) as { id: number } | undefined;
      return row?.id ?? null;
    };
    let fixed = 0;
    const monkId = findByName(null, "Монах");
    // 1. halved → русская фраза (эффекты + запасной special-вариант).
    if (monkId != null) {
      const id = findByName(monkId, "Ошеломляющий удар");
      const row = id != null ? readRow(id) : null;
      if (id != null && row) {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data || "{}");
        } catch {
          data = {};
        }
        let touched = false;
        if (Array.isArray(data.effects)) {
          for (const e of data.effects) {
            const eff = e as Record<string, unknown>;
            if (typeof eff.text === "string" && eff.text.includes("halved")) {
              eff.text = eff.text
                .replace("скорость цели halved", "скорость цели уменьшается вдвое")
                .replace("скорость halved", "скорость уменьшается вдвое");
              touched = true;
            }
          }
        }
        if (touched) {
          database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
          fixed++;
        }
      }
    }
    // 2. Плащ теней: время накладывания.
    {
      const shadowId = monkId != null ? findByName(monkId, "Мастер Тени") : null;
      // Имя умения уникально в пределах класса — ищем среди потомков подкласса,
      // а не найдём — среди всех потомков Монаха.
      let cloakId: number | null = null;
      if (shadowId != null) cloakId = findByName(shadowId, "Плащ теней");
      if (cloakId == null && monkId != null) {
        const row = database
          .prepare(
            `SELECT e.id FROM compendium_entries e
               JOIN compendium_entries p ON p.id = e.parent_id
              WHERE p.parent_id = ? AND e.name = 'Плащ теней' LIMIT 1`
          )
          .get(monkId) as { id: number } | undefined;
        cloakId = row?.id ?? null;
      }
      const row = cloakId != null ? readRow(cloakId) : null;
      if (cloakId != null && row) {
        let touched = false;
        let description = row.description;
        if (description.includes("Действием магия, находясь полностью в тускло освещённой местности или тьме,")) {
          description = description.replace(
            "Действием магия, находясь полностью в тускло освещённой местности или тьме,",
            "Бонусным действием, находясь полностью в тускло освещённой местности или тьме,"
          );
          touched = true;
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data || "{}");
        } catch {
          data = {};
        }
        if (data.casting_timing === "Действие") {
          data.casting_timing = "Бонусное действие";
          touched = true;
        }
        if (touched) {
          database
            .prepare("UPDATE compendium_entries SET description = ?, data = ? WHERE id = ?")
            .run(description, JSON.stringify(data), cloakId);
          fixed++;
        }
      }
    }
    // 3. Орудия милосердия: название навыка.
    if (monkId != null) {
      const mercyId = findByName(monkId, "Мастер Милосердия");
      const id = mercyId != null ? findByName(mercyId, "Орудия милосердия") : null;
      const row = id != null ? readRow(id) : null;
      if (id != null && row && row.description.includes("навыками Внимательность и Медицина")) {
        const description = row.description.replace(
          "навыками Внимательность и Медицина",
          "навыками Медицина и Проницательность"
        );
        database.prepare("UPDATE compendium_entries SET description = ? WHERE id = ?").run(description, id);
        fixed++;
      }
    }
    // 4. Мультикласс: умения 1 уровня тоже даются.
    if (monkId != null) {
      const row = readRow(monkId);
      if (row && row.description.includes("**Мультикласс.** Получите: кость хитов.")) {
        const description = row.description.replace(
          "**Мультикласс.** Получите: кость хитов.",
          "**Мультикласс.** Получите кость хитов и умения монаха 1-го уровня."
        );
        database.prepare("UPDATE compendium_entries SET description = ? WHERE id = ?").run(description, monkId);
        fixed++;
      }
    }
    if (fixed > 0) console.log(`[db] Текст монаха (сверка 2024): записей: ${fixed}`);
    setAppSettingFlag(database, "monk_text_repairs_v1");
  }

  // Права администратора — единственное, что закрыто отдельно от роли: смена
  // роли у чужих учёток. Сама роль при этом остаётся 'gm', то есть обычный
  // мастерский доступ у такого аккаунта тоже есть.
  if (!columnExists(database, "users", "is_admin")) {
    database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "users", "token_version")) {
    database.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  }

  // Учётка `admin` с паролем `admin` заводилась при КАЖДОМ старте, пока её не
  // было в базе. Сервер при этом слушает все интерфейсы (доступ с телефона в
  // том же вайфае — намеренная возможность, см. isPrivateLanHost в index.ts),
  // поэтому любой в той же сети входил полным мастером: секреты, финансы, всё.
  // Заведение убрано (services/auth.ts), права переехали к первому мастеру —
  // здесь то же самое делается для установок, которые уже существуют.
  //
  // Учётка удаляется ТОЛЬКО если её пароль всё ещё `admin`: тогда это не
  // аккаунт, а ключ под ковриком. Пароль сменили — значит им пользуются как
  // настоящей учёткой, и трогать её нельзя.
  if (!appSettingFlag(database, "admin_account_retired")) {
    const firstGm = database
      .prepare(
        "SELECT id FROM users WHERE role = 'gm' AND username != 'admin' ORDER BY id LIMIT 1"
      )
      .get() as { id: number } | undefined;
    if (firstGm) {
      database.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(firstGm.id);
    }
    const seeded = database
      .prepare("SELECT id, password_hash FROM users WHERE username = 'admin' AND player_id IS NULL")
      .get() as { id: number; password_hash: string } | undefined;
    if (seeded && firstGm) {
      let stillDefault = false;
      try {
        stillDefault = bcrypt.compareSync("admin", seeded.password_hash);
      } catch (err) {
        console.error("Не удалось проверить пароль учётки admin:", err);
      }
      if (stillDefault) {
        database.prepare("DELETE FROM users WHERE id = ?").run(seeded.id);
        console.log("[auth] Учётка admin с паролем по умолчанию удалена.");
      } else {
        console.log("[auth] Учётка admin оставлена: её пароль менялся.");
      }
    }
    setAppSettingFlag(database, "admin_account_retired");
  }

  // Initiative tracker rows for the "Пульт сессии" cockpit — see
  // schema.sql for field notes. `id` (autoincrement) doubles as the
  // insertion-order tiebreak for sorting, so no separate position column.
  if (!tableExists(database, "initiative_entries")) {
    database.exec(`CREATE TABLE initiative_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      entity_type TEXT,
      entity_id INTEGER,
      name TEXT NOT NULL,
      dex_modifier INTEGER NOT NULL DEFAULT 0,
      initiative INTEGER,
      max_hp INTEGER,
      current_hp INTEGER,
      dead INTEGER NOT NULL DEFAULT 0,
      conditions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_initiative_entries_session ON initiative_entries(session_id)`);
  }
  if (!columnExists(database, "initiative_entries", "max_hp")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN max_hp INTEGER");
  }
  if (!columnExists(database, "initiative_entries", "current_hp")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN current_hp INTEGER");
  }
  if (!columnExists(database, "initiative_entries", "temp_hp")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN temp_hp INTEGER");
  }
  if (!columnExists(database, "initiative_entries", "dead")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN dead INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "initiative_entries", "conditions")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]'");
  }

  // Turn-order state for the initiative tracker's Старт/Следующий/Предыдущий
  // controls, plus the "battle playlist" picked in session prep — both live
  // on sessions since a session has at most one active combat at a time.
  if (!columnExists(database, "sessions", "combat_active")) {
    database.exec("ALTER TABLE sessions ADD COLUMN combat_active INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "sessions", "combat_turn_entry_id")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN combat_turn_entry_id INTEGER REFERENCES initiative_entries(id) ON DELETE SET NULL"
    );
  }
  // Номер раунда боя. 0 — боя нет; «Старт» ставит 1, круг по очереди
  // прибавляет единицу. Живёт рядом с combat_active по той же причине:
  // активный бой у сессии один.
  if (!columnExists(database, "sessions", "combat_round")) {
    database.exec("ALTER TABLE sessions ADD COLUMN combat_round INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists(database, "sessions", "battle_playlist_id")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN battle_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL"
    );
  }

  // "Also present in this setting" tags for the global Ресурсы library —
  // separate from the resource's/playlist's single "home" scope
  // (resources.setting_id / playlists.setting_id), which stays untouched.
  // Not folded into generic_links: that table's NODE_TABLES (links.ts)
  // backs the graph/label-resolution system and doesn't know about
  // "playlist" as a node type — no need to teach it that for a simple tag.
  if (!tableExists(database, "resource_setting_links")) {
    database.exec(`CREATE TABLE resource_setting_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL, -- 'resource' | 'playlist'
      owner_id INTEGER NOT NULL,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_type, owner_id, setting_id)
    )`);
    database.exec(
      `CREATE INDEX idx_resource_setting_links_owner ON resource_setting_links(owner_type, owner_id)`
    );
  }

  // Optional shortened display name for map-pin labels — only the four
  // entity types placeable as location-map pins need it.
  for (const table of ["setting_beings", "characters", "setting_locations", "artifacts"]) {
    if (!columnExists(database, table, "short_name")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN short_name TEXT`);
    }
  }

  // Short standalone summary shown under Досье → Описание and reused as the
  // blurb in the new expandable entity-row preview cards — separate from the
  // multi-entry История/Поведение/Текущая ситуация chapters below it.
  if (!columnExists(database, "setting_beings", "description")) {
    database.exec("ALTER TABLE setting_beings ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  // SQLite's built-in LIKE/LOWER only case-fold ASCII a-z — a search for
  // "москва" silently misses "Москва". Register a JS-backed lower() that IS
  // Unicode-aware (String.prototype.toLowerCase already handles Cyrillic
  // correctly) so search.ts can match case-insensitively on any script.
  database.function("lower_u", { deterministic: true }, (text: unknown) =>
    typeof text === "string" ? text.toLowerCase() : text
  );

  // Ties a materialized module to the GitHub catalog entry it was installed
  // from (manifest.json's "id" + "version"), so the catalog view can tell
  // "not installed" apart from "installed but a newer version is available"
  // without re-fetching/re-diffing the actual module content.
  if (!columnExists(database, "modules", "remote_id")) {
    database.exec("ALTER TABLE modules ADD COLUMN remote_id TEXT");
  }
  if (!columnExists(database, "modules", "remote_version")) {
    database.exec("ALTER TABLE modules ADD COLUMN remote_version TEXT");
  }

  // Marks a system/setting as having originated from an import (manual file
  // or GitHub catalog install) instead of local creation — drives the
  // "импортировано" badge in SystemsListPage/SettingsListPage, replacing the
  // old approach of baking "(импорт)" into the name itself.
  if (!columnExists(database, "systems", "imported_at")) {
    database.exec("ALTER TABLE systems ADD COLUMN imported_at TEXT");
  }
  if (!columnExists(database, "settings", "imported_at")) {
    database.exec("ALTER TABLE settings ADD COLUMN imported_at TEXT");
  }
  // Optional portrait shown next to a D&D creature's statblock (sb-head
  // area) — separate from the owning being/character's own avatar, since a
  // statblock's art is meant for the printed-card look, not the profile pic.
  if (!columnExists(database, "statblocks", "avatar_image_path")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN avatar_image_path TEXT");
  }

  // Optional D&D-style item classification for an artifact — mirrors the
  // item_type/rarity/attunement fields of a compendium magic_item, but lives
  // directly on the artifact row (independent of any system's compendium,
  // since a setting's artifacts aren't tied to one ruleset).
  if (!columnExists(database, "artifacts", "item_type")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN item_type TEXT");
  }
  // Род предмета: magic_item | equipment. От него зависит список типов, а у
  // снаряжения нет редкости и настройки. У записей, заведённых до разделения,
  // остаётся NULL — тип у них показывается по объединённому списку.
  if (!columnExists(database, "artifacts", "item_class")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN item_class TEXT");
  }
  if (!columnExists(database, "artifacts", "rarity")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN rarity TEXT");
  }
  if (!columnExists(database, "artifacts", "requires_attunement")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN requires_attunement INTEGER NOT NULL DEFAULT 0");
  }

  // Где предмет лежит и у кого он на руках — ссылками на сущности, а не
  // текстом. Старая текстовая колонка owner остаётся: в ней уже лежат записи
  // вида «у кого-то из городской стражи», которым не соответствует ни одна
  // сущность, и терять их нельзя. Владелец полиморфный (личность или
  // сообщество), поэтому пара колонок owner_type/owner_id, а не внешний ключ.
  if (!columnExists(database, "artifacts", "location_id")) {
    database.exec(
      "ALTER TABLE artifacts ADD COLUMN location_id INTEGER REFERENCES setting_locations(id) ON DELETE SET NULL"
    );
  }
  if (!columnExists(database, "artifacts", "owner_type")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN owner_type TEXT"); // being | community
  }
  if (!columnExists(database, "artifacts", "owner_id")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN owner_id INTEGER");
  }
  // Картинка предмета: file_path — это вложение (скан страницы, арт в полный
  // размер), а для списков и карточек нужен свой уменьшенный аватар, как у
  // остальных сущностей.
  if (!columnExists(database, "artifacts", "avatar_image_path")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN avatar_image_path TEXT");
  }
  // Короткая сводка — то же, что description у локаций, существ и сообществ.
  // Раньше у предмета были только «Сила», «История» и «Заметки», и краткому
  // описанию из визарда некуда было лечь.
  if (!columnExists(database, "artifacts", "description")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN description TEXT DEFAULT ''");
  }
  // Секрет предмета — тайна мастера, скрытая от игроков (аналог setting_beings.secret).
  if (!columnExists(database, "artifacts", "secret")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN secret TEXT NOT NULL DEFAULT ''");
  }
  // Теги предметов — свободная классификация (аналог setting_beings.tags).
  if (!columnExists(database, "artifacts", "tags")) {
    database.exec("ALTER TABLE artifacts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }

  // Событие сеттинга дорастает до самостоятельной сущности со своим профилем:
  // краткое описание остаётся в description (оно показывается в хронике),
  // развёрнутый текст и последствия — отдельные поля. Участники и локации
  // события не заводят своих таблиц: тип setting_event уже участвует в общем
  // графе связей (entity_links), туда они и ложатся.
  if (!columnExists(database, "setting_calendar_events", "full_description")) {
    database.exec("ALTER TABLE setting_calendar_events ADD COLUMN full_description TEXT DEFAULT ''");
  }
  if (!columnExists(database, "setting_calendar_events", "consequences")) {
    database.exec("ALTER TABLE setting_calendar_events ADD COLUMN consequences TEXT DEFAULT ''");
  }
  // Те же два поля у событий кампании. В schema.sql они появились 2026-08-14
  // сразу в обеих таблицах, а ALTER написали только для сеттинга — у базы,
  // заведённой раньше, профиль события кампании падал «no such column».
  for (const column of ["full_description", "consequences"]) {
    if (tableExists(database, "campaign_calendar_events") && !columnExists(database, "campaign_calendar_events", column)) {
      database.exec(`ALTER TABLE campaign_calendar_events ADD COLUMN ${column} TEXT DEFAULT ''`);
    }
  }

  // Persisted, user-editable state for the session cheatsheet generator
  // (locations/npcs/loot lines with per-line notes, freeform Заметки/Улики
  // text) — JSON blob, regenerated by merging fresh prep data on top without
  // discarding existing edits. See CheatSheetsSection.tsx.
  if (!columnExists(database, "sessions", "cheatsheet_data")) {
    database.exec("ALTER TABLE sessions ADD COLUMN cheatsheet_data TEXT");
  }

  // Short freeform articles under an artifact's Досье — same pattern as
  // location_chapters.
  if (!tableExists(database, "artifact_chapters")) {
    database.exec(`CREATE TABLE artifact_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // A бестиарий entry in a setting can reference monster templates in the
  // compendiums of *several* systems at once (the same "гоблины" run under
  // D&D and under a PbtA system), so this is many-to-many rather than the
  // single setting_beings.base_monster_id column, which stays as the
  // "cloned from this template" marker for named personalities.
  if (!tableExists(database, "being_compendium_links")) {
    database.exec(`CREATE TABLE being_compendium_links (
      being_id INTEGER NOT NULL REFERENCES setting_beings(id) ON DELETE CASCADE,
      compendium_entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (being_id, compendium_entry_id)
    )`);
  }

  // То же для предметов: «Кольцо защиты разума» в сокровищнице приключения и
  // «Кольцо защиты разума [Ring of Mind Shielding]» в компендиуме системы —
  // один и тот же предмет, описанный с двух сторон. Связь многие-ко-многим по
  // той же причине, что и у существ: сеттинг с системой не связан напрямую,
  // и один город водится сразу под две.
  if (!tableExists(database, "artifact_compendium_links")) {
    database.exec(`CREATE TABLE artifact_compendium_links (
      artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      compendium_entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (artifact_id, compendium_entry_id)
    )`);
  }

  // "Приключения" — prepared story content owned by a setting: arcs (an
  // adventure, an arc, a chapter of an imported book; nested via parent_id)
  // holding scenes. See schema.sql for the copy-on-write campaign layer.
  if (!tableExists(database, "story_arcs")) {
    database.exec(`CREATE TABLE story_arcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'adventure',
      description TEXT NOT NULL DEFAULT '',
      hook TEXT NOT NULL DEFAULT '',
      recommended_level TEXT NOT NULL DEFAULT '',
      player_count TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      thumbnail_image_path TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
    database.exec("CREATE INDEX idx_story_arcs_setting ON story_arcs(setting_id)");
  }

  if (!tableExists(database, "story_scenes")) {
    database.exec(`CREATE TABLE story_scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      source_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      library_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      in_library INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'scene',
      summary TEXT NOT NULL DEFAULT '',
      read_aloud TEXT NOT NULL DEFAULT '',
      whats_happening TEXT NOT NULL DEFAULT '',
      entry_condition TEXT NOT NULL DEFAULT '',
      outcomes TEXT NOT NULL DEFAULT '',
      hidden_from_players INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
    database.exec("CREATE INDEX idx_story_scenes_arc ON story_scenes(arc_id)");
    database.exec("CREATE INDEX idx_story_scenes_campaign ON story_scenes(campaign_id, source_scene_id)");
  }

  if (!tableExists(database, "story_scene_checks")) {
    database.exec(`CREATE TABLE story_scene_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
      what TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      on_success TEXT NOT NULL DEFAULT '',
      on_failure TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec("CREATE INDEX idx_story_scene_checks_scene ON story_scene_checks(scene_id)");
  }

  if (!tableExists(database, "story_scene_rewards")) {
    database.exec(`CREATE TABLE story_scene_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      what TEXT NOT NULL DEFAULT '',
      where_found TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      artifact_id INTEGER REFERENCES artifacts(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec("CREATE INDEX idx_story_scene_rewards_scene ON story_scene_rewards(scene_id)");
    database.exec("CREATE INDEX idx_story_scene_rewards_arc ON story_scene_rewards(arc_id)");
  }

  if (!tableExists(database, "story_scene_transitions")) {
    database.exec(`CREATE TABLE story_scene_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
      to_scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(from_scene_id, to_scene_id, label)
    )`);
    database.exec("CREATE INDEX idx_story_scene_transitions_from ON story_scene_transitions(from_scene_id)");
  }

  // Arcs gained a profile page of their own: an explicit adventure/chapter
  // distinction, the Обзор fields, and the flag marking each setting's
  // auto-created "Сцены вне приключений" bucket.
  for (const [col, ddl] of [
    ["kind", "ALTER TABLE story_arcs ADD COLUMN kind TEXT NOT NULL DEFAULT 'adventure'"],
    ["hook", "ALTER TABLE story_arcs ADD COLUMN hook TEXT NOT NULL DEFAULT ''"],
    ["recommended_level", "ALTER TABLE story_arcs ADD COLUMN recommended_level TEXT NOT NULL DEFAULT ''"],
    ["player_count", "ALTER TABLE story_arcs ADD COLUMN player_count TEXT NOT NULL DEFAULT ''"],
    ["duration", "ALTER TABLE story_arcs ADD COLUMN duration TEXT NOT NULL DEFAULT ''"],
    ["source", "ALTER TABLE story_arcs ADD COLUMN source TEXT NOT NULL DEFAULT ''"],
    ["tags", "ALTER TABLE story_arcs ADD COLUMN tags TEXT NOT NULL DEFAULT ''"],
    ["thumbnail_image_path", "ALTER TABLE story_arcs ADD COLUMN thumbnail_image_path TEXT"],
    ["is_default", "ALTER TABLE story_arcs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0"],
    ["is_favorite", "ALTER TABLE story_arcs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (tableExists(database, "story_arcs") && !columnExists(database, "story_arcs", col)) {
      database.exec(ddl);
    }
  }

  // Rewards can also hang off the adventure itself, not just a scene, so the
  // profile's Награды tab has somewhere to put "выдаётся за всё приключение".
  // scene_id therefore has to become nullable, which SQLite only allows via a
  // table rebuild — cheap here, and guarded so it runs at most once.
  if (
    tableExists(database, "story_scene_rewards") &&
    columnIsNotNull(database, "story_scene_rewards", "scene_id")
  ) {
    database.exec("ALTER TABLE story_scene_rewards RENAME TO story_scene_rewards_old");
    database.exec(`CREATE TABLE story_scene_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      what TEXT NOT NULL DEFAULT '',
      where_found TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      artifact_id INTEGER REFERENCES artifacts(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0
    )`);
    // The older shape may or may not already carry arc_id (an interim
    // migration added it as a plain column), so copy only the columns both
    // shapes are guaranteed to have.
    database.exec(
      `INSERT INTO story_scene_rewards (id, scene_id, what, where_found, notes, artifact_id, position)
       SELECT id, scene_id, what, where_found, notes, artifact_id, position FROM story_scene_rewards_old`
    );
    database.exec("DROP TABLE story_scene_rewards_old");
    database.exec("CREATE INDEX IF NOT EXISTS idx_story_scene_rewards_scene ON story_scene_rewards(scene_id)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_story_scene_rewards_arc ON story_scene_rewards(arc_id)");
  }

  if (!tableExists(database, "story_milestones")) {
    database.exec(`CREATE TABLE story_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES story_scenes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec("CREATE INDEX idx_story_milestones_arc ON story_milestones(arc_id)");
  }

  if (!tableExists(database, "campaign_milestone_state")) {
    database.exec(`CREATE TABLE campaign_milestone_state (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      milestone_id INTEGER NOT NULL REFERENCES story_milestones(id) ON DELETE CASCADE,
      achieved INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (campaign_id, milestone_id)
    )`);
  }

  if (!tableExists(database, "story_secrets")) {
    database.exec(`CREATE TABLE story_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'secret',
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec("CREATE INDEX idx_story_secrets_arc ON story_secrets(arc_id)");
  }

  if (!tableExists(database, "campaign_secret_state")) {
    database.exec(`CREATE TABLE campaign_secret_state (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      secret_id INTEGER NOT NULL REFERENCES story_secrets(id) ON DELETE CASCADE,
      revealed INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (campaign_id, secret_id)
    )`);
  }

  if (!tableExists(database, "campaign_scene_state")) {
    database.exec(`CREATE TABLE campaign_scene_state (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (campaign_id, scene_id)
    )`);
  }

  // Copy-on-write добрался и до самих приключений: раньше кампания могла
  // завести свою версию сцены, а тексты приключения были общими на весь
  // сеттинг, и правка в одной кампании меняла их всем остальным.
  for (const [col, ddl] of [
    [
      "campaign_id",
      "ALTER TABLE story_arcs ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE",
    ],
    [
      "source_arc_id",
      "ALTER TABLE story_arcs ADD COLUMN source_arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE",
    ],
  ] as const) {
    if (tableExists(database, "story_arcs") && !columnExists(database, "story_arcs", col)) {
      database.exec(ddl);
    }
  }
  if (tableExists(database, "story_arcs")) {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_story_arcs_campaign ON story_arcs(campaign_id, source_arc_id)"
    );
  }

  // Какие приключения сеттинга входят в кампанию. До этой таблицы кампания
  // показывала все приключения своего сеттинга — с тремя импортированными
  // книгами разделы кампании превращались в свалку из чужих глав.
  if (!tableExists(database, "campaign_adventures")) {
    database.exec(`CREATE TABLE campaign_adventures (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (campaign_id, arc_id)
    )`);
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_campaign_adventures_arc ON campaign_adventures(arc_id)");

  // Разовый перенос: существующие кампании продолжают видеть ровно то, что
  // видели раньше — все приключения своего сеттинга; лишнее мастер отвяжет
  // руками. «Сцены вне приключений» (is_default) не привязываются: они у
  // кампании есть всегда. Отметка о переносе нужна отдельно от «таблица
  // только что создана»: саму таблицу заводит schema.sql, и по её появлению
  // судить нельзя — а повторный перенос вернул бы всё отвязанное обратно.
  const backfillKey = "campaign_adventures_backfilled";
  const backfilled = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(backfillKey) as { value: string } | undefined;
  if (!backfilled && tableExists(database, "story_arcs")) {
    database.exec(`INSERT OR IGNORE INTO campaign_adventures (campaign_id, arc_id, position)
      SELECT c.id, a.id, a.position
      FROM campaigns c
      JOIN story_arcs a ON a.setting_id = c.setting_id
      WHERE a.parent_id IS NULL AND a.is_default = 0 AND a.archived_at IS NULL
        AND a.campaign_id IS NULL`);
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(backfillKey);
  }

  // Разовый перенос исходов проверки: два текстовых поля превращаются в две
  // строки story_check_outcomes. Тексты не теряются — они уезжают в
  // `consequence`, а `label` получает имя разъёма. Сами колонки
  // on_success/on_failure НЕ удаляются: снос требует пересборки таблицы, и
  // пока перенос не обкатан, дешевле оставить их лежать (см. также мёртвые
  // story_scenes.canvas_x/canvas_y).
  //
  // Исходы заводятся у каждой проверки, даже когда оба текста пусты: у ноды
  // проверки должны быть разъёмы, а пустой исход — это «здесь ещё не
  // решено», а не отсутствие ветки. Отметка о переносе отдельная, потому что
  // таблицу создаёт schema.sql, и по её появлению судить нельзя: повторный
  // перенос вернул бы удалённые Мастером исходы обратно.
  const outcomesKey = "story_check_outcomes_backfilled";
  const outcomesDone = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(outcomesKey) as { value: string } | undefined;
  if (
    !outcomesDone &&
    tableExists(database, "story_scene_checks") &&
    tableExists(database, "story_check_outcomes") &&
    columnExists(database, "story_scene_checks", "on_success")
  ) {
    database.exec(`INSERT INTO story_check_outcomes (check_id, label, consequence, position)
      SELECT id, 'Успех', COALESCE(on_success, ''), 0 FROM story_scene_checks`);
    database.exec(`INSERT INTO story_check_outcomes (check_id, label, consequence, position)
      SELECT id, 'Провал', COALESCE(on_failure, ''), 1 FROM story_scene_checks`);
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(outcomesKey);
  }

  // Время на оси: точность даты, конец периода, статус и заметка «чем
  // отменилось» — обеим таблицам событий одинаково.
  //
  // Простым ALTER TABLE: колонки только добавляются, ничего не снимается, и
  // пересборка не нужна.
  for (const table of ["setting_calendar_events", "campaign_calendar_events"]) {
    if (!tableExists(database, table)) continue;
    for (const [column, ddl] of [
      // Существующее становится точным до дня: другой честной догадки нет.
      // Событие, дату которого поставили наугад, выглядит сейчас ровно так же,
      // как назначенное, и различить их задним числом нечем.
      ["date_precision", "TEXT NOT NULL DEFAULT 'day'"],
      ["inworld_year_end", "INTEGER"],
      ["inworld_month_end", "INTEGER"],
      ["inworld_day_end", "INTEGER"],
      ["status", "TEXT NOT NULL DEFAULT 'happened'"],
      ["cancel_note", "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!columnExists(database, table, column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      }
    }
  }

  // Статус у перенесённых событий вычисляется по «сейчас» в мире, а не
  // ставится всем одинаково: событие 1200 года в мире, где сейчас 1496-й,
  // предстоящим быть не может, а затмение через год — случившимся.
  //
  // «Сейчас» — закреплённая дата сеттинга (у событий кампании — её
  // собственная). Где её не задали, всё остаётся «случилось»: прошлое
  // вероятнее, и ошибка в эту сторону тише.
  //
  // Разово, по ключу: Мастер может поменять статус руками, и повторный проход
  // затёр бы его правку.
  const eventStatusKey = "calendar_event_status_backfilled";
  const eventStatusDone = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(eventStatusKey) as { value: string } | undefined;
  if (
    !eventStatusDone &&
    tableExists(database, "setting_calendar_events") &&
    columnExists(database, "setting_calendar_events", "status")
  ) {
    database.exec(`
      UPDATE setting_calendar_events SET status = 'upcoming'
      WHERE id IN (
        SELECT e.id FROM setting_calendar_events e
        JOIN settings s ON s.id = e.setting_id
        WHERE s.pinned_calendar_year IS NOT NULL
          AND (e.inworld_year > s.pinned_calendar_year
               OR (e.inworld_year = s.pinned_calendar_year
                   AND e.inworld_month > IFNULL(s.pinned_calendar_month, 0)))
      )`);
    database.exec(`
      UPDATE campaign_calendar_events SET status = 'upcoming'
      WHERE id IN (
        SELECT e.id FROM campaign_calendar_events e
        JOIN campaigns c ON c.id = e.campaign_id
        WHERE c.pinned_calendar_year IS NOT NULL
          AND (e.inworld_year > c.pinned_calendar_year
               OR (e.inworld_year = c.pinned_calendar_year
                   AND e.inworld_month > IFNULL(c.pinned_calendar_month, 0)))
      )`);
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(eventStatusKey);
  }

  // Полка заготовок: story_scenes пересобирается один раз.
  //
  // Что меняется. setting_id теряет NOT NULL и становится меткой — у
  // заготовки сеттинг говорит «где написана», а не «кому принадлежит».
  // Появляются in_library (лежит на полке) и library_scene_id (эта строка —
  // вставка такой заготовки). Уходят canvas_x/canvas_y: раскладка с первого
  // этапа живёт в canvas_nodes, а координаты на строке сцены означали бы, что
  // сдвиг ноды мышкой внутри кампании порождает копию сцены.
  //
  // Почему пересборкой. SQLite снимает NOT NULL и выбрасывает колонки только
  // так — ALTER TABLE этого не умеет. Признак «уже сделано» — сам факт, что
  // setting_id ещё NOT NULL; отдельного ключа в app_settings не нужно, в
  // отличие от переноса исходов, где повторный проход вернул бы удалённое.
  //
  // Проверки и сессии в эту пересборку намеренно не берутся
  // (on_success/on_failure, rescheduled_*): импортёр приключений только что
  // переучен на исходы и на живых данных ещё не проезжал, и складывать
  // непроверенный импорт с непроверенной миграцией в одну корзину незачем.
  if (tableExists(database, "story_scenes") && columnIsNotNull(database, "story_scenes", "setting_id")) {
    // uid переносится вручную и явно. Колонку добавляет отдельная миграция
    // НИЖЕ по файлу, поэтому пересобранная без неё таблица уехала бы к ней
    // пустой — и та честно раздала бы всем сценам новые ключи. А uid — это
    // опознание сцены между устройствами: сменить его значит превратить
    // обновление опубликованного сеттинга в россыпь дублей.
    const hasUid = columnExists(database, "story_scenes", "uid");
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("DROP TABLE IF EXISTS story_scenes_new");
    database.exec(`CREATE TABLE story_scenes_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${hasUid ? "uid TEXT," : ""}
      setting_id INTEGER REFERENCES settings(id) ON DELETE CASCADE,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      source_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      library_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      in_library INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'scene',
      summary TEXT NOT NULL DEFAULT '',
      read_aloud TEXT NOT NULL DEFAULT '',
      whats_happening TEXT NOT NULL DEFAULT '',
      entry_condition TEXT NOT NULL DEFAULT '',
      outcomes TEXT NOT NULL DEFAULT '',
      hidden_from_players INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    )`);
    const carried =
      "id, setting_id, arc_id, campaign_id, source_scene_id, name, kind, summary, read_aloud," +
      " whats_happening, entry_condition, outcomes, hidden_from_players, position, created_at, archived_at" +
      (hasUid ? ", uid" : "");
    database.exec(`INSERT INTO story_scenes_new (${carried}) SELECT ${carried} FROM story_scenes`);
    database.exec("DROP TABLE story_scenes");
    database.exec("ALTER TABLE story_scenes_new RENAME TO story_scenes");
    database.exec("PRAGMA foreign_keys = ON");
  }
  if (tableExists(database, "story_scenes")) {
    database.exec("CREATE INDEX IF NOT EXISTS idx_story_scenes_arc ON story_scenes(arc_id)");
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_story_scenes_campaign ON story_scenes(campaign_id, source_scene_id)"
    );
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_story_scenes_library ON story_scenes(library_scene_id)"
    );
  }

  // Вехи и тайны получают необязательные arc_id/campaign_id: кампания может
  // завести свою веху или тайну — свободную или доложенную в чужое
  // импортированное приключение. NOT NULL с arc_id снимается только полной
  // пересборкой таблицы; создаём новую и переименовываем, как у characters
  // выше, чтобы внешние ключи состояния не поехали.
  for (const [table, ddl, columns] of [
    [
      "story_milestones",
      `CREATE TABLE story_milestones_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        scene_id INTEGER REFERENCES story_scenes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      )`,
      "id, arc_id, scene_id, title, description, position",
    ],
    [
      "story_secrets",
      `CREATE TABLE story_secrets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'secret',
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      )`,
      "id, arc_id, kind, title, content, position",
    ],
  ] as const) {
    if (!tableExists(database, table)) continue;
    if (columnIsNotNull(database, table, "arc_id")) {
      database.exec("PRAGMA foreign_keys = OFF");
      database.exec(`DROP TABLE IF EXISTS ${table}_new`);
      database.exec(ddl);
      database.exec(
        `INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`
      );
      database.exec(`DROP TABLE ${table}`);
      database.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      database.exec("PRAGMA foreign_keys = ON");
    } else if (!columnExists(database, table, "campaign_id")) {
      database.exec(
        `ALTER TABLE ${table} ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE`
      );
    }
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_arc ON ${table}(arc_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_campaign ON ${table}(campaign_id)`);
  }

  // Собственные тайны кампании жили в campaign_entries категории secrets —
  // другой сущностью, без вида (тайна/улика/нить) и без привязки к
  // приключению, хотя на экране должны стоять рядом с тайнами приключений.
  // Переносим их в story_secrets; старые строки не удаляем, а помечаем
  // перенесёнными, чтобы миграция оставалась обратимой.
  if (tableExists(database, "campaign_entries") && tableExists(database, "story_secrets")) {
    const legacy = database
      .prepare(
        "SELECT id, campaign_id, title, content, status FROM campaign_entries WHERE category = 'secrets' ORDER BY id"
      )
      .all() as { id: number; campaign_id: number; title: string; content: string; status: string }[];
    if (legacy.length > 0) {
      const nextPos = database.prepare(
        "SELECT IFNULL(MAX(position), -1) + 1 as p FROM story_secrets WHERE campaign_id = ? AND arc_id IS NULL"
      );
      const insert = database.prepare(
        "INSERT INTO story_secrets (campaign_id, kind, title, content, position) VALUES (?, 'secret', ?, ?, ?)"
      );
      const markRevealed = database.prepare(
        `INSERT OR IGNORE INTO campaign_secret_state (campaign_id, secret_id, revealed, note)
         VALUES (?, ?, 1, '')`
      );
      const move = database.transaction(() => {
        for (const row of legacy) {
          const pos = (nextPos.get(row.campaign_id) as { p: number }).p;
          const info = insert.run(row.campaign_id, row.title ?? "", row.content ?? "", pos);
          if (row.status === "done") markRevealed.run(row.campaign_id, Number(info.lastInsertRowid));
        }
        database.exec("UPDATE campaign_entries SET category = 'secrets_moved' WHERE category = 'secrets'");
      });
      move();
    }
  }

  // История импортов книг приключений. key_map_json нужен не только для
  // истории: по нему второй файл той же книги видит ключи первого, а откат
  // знает, какие строки создал именно этот батч.
  if (!tableExists(database, "import_batches")) {
    database.exec(`CREATE TABLE import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ru',
      setting_key TEXT NOT NULL DEFAULT '',
      source_title TEXT NOT NULL DEFAULT '',
      source_part TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      counts_json TEXT NOT NULL DEFAULT '{}',
      key_map_json TEXT NOT NULL DEFAULT '{}',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_setting INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "import_records")) {
    database.exec(`CREATE TABLE import_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      payload TEXT NOT NULL DEFAULT ''
    )`);
    database.exec("CREATE INDEX idx_import_records_batch ON import_records(batch_id)");
  }
  // Импорт умеет не только создавать строки, но и дописывать синонимы в чужие
  // (склейка с существующей сущностью). Чтобы откат вернул и это, в payload
  // лежит прежнее значение поля.
  if (tableExists(database, "import_records") && !columnExists(database, "import_records", "payload")) {
    database.exec("ALTER TABLE import_records ADD COLUMN payload TEXT NOT NULL DEFAULT ''");
  }

  // Импорт книги правил (system-import/1) — отдельные таблицы, а не те же, что
  // у приключений: у приключения цель — сеттинг (setting_id NOT NULL), у книги
  // правил — система, и главное, приключение заливается один раз, а книга
  // правил дозаливается и правится. Поэтому связь «ключ файла → запись
  // компендиума» живёт отдельно от истории батчей: она должна пережить и откат
  // одного импорта, и удаление истории, иначе повторный импорт той же главы
  // заведёт вторые копии вместо правки первых.
  if (!tableExists(database, "system_import_keys")) {
    database.exec(`CREATE TABLE system_import_keys (
      system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
      PRIMARY KEY (system_id, key)
    )`);
    database.exec("CREATE INDEX idx_system_import_keys_entry ON system_import_keys(entry_id)");
  }
  if (!tableExists(database, "system_import_batches")) {
    database.exec(`CREATE TABLE system_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ru',
      system_key TEXT NOT NULL DEFAULT '',
      source_title TEXT NOT NULL DEFAULT '',
      source_part TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      counts_json TEXT NOT NULL DEFAULT '{}',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  // Что именно сделал батч: создал запись или переписал существующую. Во
  // втором случае payload хранит её прежнее содержимое целиком — только так
  // откат правки возвращает то, что было, а не удаляет чужую запись.
  if (!tableExists(database, "system_import_records")) {
    database.exec(`CREATE TABLE system_import_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES system_import_batches(id) ON DELETE CASCADE,
      entry_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT ''
    )`);
    database.exec("CREATE INDEX idx_system_import_records_batch ON system_import_records(batch_id)");
  }

  // Глобальный ключ у всего, на что можно сослаться из текста.
  //
  // Числовой id верен только внутри одного файла базы: при переносе сеттинга
  // на другое устройство он достаётся другой сущности, и ссылка в тексте
  // молча начинает указывать не туда. uid переживает перенос, и по нему
  // импорт восстанавливает ссылки, а не гадает.
  //
  // Список должен совпадать с MENTIONABLE в services/mentions.ts — там он
  // источник истины для типов, здесь для таблиц.
  const UID_TABLES = [
    "campaigns",
    "settings",
    "players",
    "characters",
    "setting_locations",
    "setting_beings",
    "setting_communities",
    "artifacts",
    "resources",
    "mastering_notes",
    "story_arcs",
    "story_scenes",
    "sessions",
    "compendium_entries",
    "setting_calendar_events",
  ];
  for (const table of UID_TABLES) {
    if (!tableExists(database, table)) continue;
    if (!columnExists(database, table, "uid")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN uid TEXT`);
    }
    // UNIQUE, но не NOT NULL: строка могла появиться из ветки, которая про uid
    // не знает, и такую подхватит uidOf() лениво. Частичный индекс не считает
    // NULL за дубликат сам по себе, но так намерение видно явно.
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_uid ON ${table}(uid) WHERE uid IS NOT NULL`
    );
    const missing = database.prepare(`SELECT id FROM ${table} WHERE uid IS NULL`).all() as {
      id: number;
    }[];
    if (missing.length) {
      const set = database.prepare(`UPDATE ${table} SET uid = ? WHERE id = ?`);
      const fill = database.transaction(() => {
        for (const row of missing) set.run(randomUUID(), row.id);
      });
      fill();
    }
  }

  // Короткий код модуля: «wdh» вместо «Вотердип».
  //
  // Он пишется третьим полем в каждую ссылку внутри текста, а текст Мастер
  // правит в сыром textarea и видит токен целиком. Разница между
  // `[[being@8f3c1a2e|wdh|Мирт]]` и тем же с полным именем — это разница между
  // читаемым абзацем и кашей, и платится она при каждой правке.
  //
  // Необязателен: пустой код означает «подставлять имя», как было раньше.
  // Поэтому засыпать существующие строки нечем и не нужно — Мастер проставит
  // коды тогда, когда захочет, и ничего не сломается, пока он этого не сделал.
  for (const table of ["settings", "systems"]) {
    if (!tableExists(database, table)) continue;
    if (!columnExists(database, table, "code")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN code TEXT`);
    }
  }

  // Разовый перевод ссылок в текстах с локального id на глобальный ключ.
  //
  // Было `[[being:412|Мирт]]`, стало `[[being@8f3c1a2e|wdh|Мирт]]`. Смысл — в
  // том, что число 412 верно ровно внутри этого файла базы: любой путь
  // переноса данных обязан отдельно переписывать все id в текстах, и путь,
  // который об этом забудет, молча переклеит ссылки на чужие сущности.
  //
  // Написана здесь целиком, а не через services/mentions.ts, намеренно: тот
  // модуль ходит в базу через прокси `db`, который во время openDatabase ещё
  // указывает на прежнее подключение. Разовому проходу дешевле знать грамматику
  // самому, чем городить исключение в общем коде.
  //
  // Перед проходом снимается копия файла базы: правка необратима и идёт по
  // всем текстовым колонкам сразу. VACUUM INTO даёт согласованный снимок
  // синхронно, в отличие от асинхронного database.backup().
  const tokensKey = "mentions_uid_tokens";
  const tokensDone = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(tokensKey) as { value: string } | undefined;
  if (!tokensDone && migrateMentionTokens(database, dbDir)) {
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(tokensKey);
  }
  // Остатки legacy от systemApply/crossLinks до фикса — добиваем фоном, не блокируем старт (3.3).
  if (appSettingFlag(database, tokensKey)) {
    setTimeout(() => {
      try { fixResidualLegacyMentions(database); } catch (e) { console.error("Добивка legacy-меншенов фоном не удалась:", e); }
    }, 2500);
  }

  // Пульт звука: роль аудиоресурса и его вид на кнопке.
  //
  // Аудио в базе опознаётся по category = 'audio', а не по type: треки
  // заводятся как type='link' с категорией (см. AddTracksModal на клиенте),
  // и отдельного типа 'audio' у ресурсов никогда не было.
  //
  // Роль одна на файл: звук лежит ровно в одном канале. Всё существующее
  // аудио получает «background» — оно и так собрано в плейлисты, а редкий
  // шум дождя, попавший туда по ошибке, переставляется одним полем. Пустая
  // роль вместо этого означала бы кучу «не разобрано», сваленную на голову
  // в момент обновления.
  for (const [column, def] of [
    ["audio_role", "TEXT"], // background | ambient | weather | stinger
    ["audio_icon", "TEXT"], // имя встроенного глифа
    ["audio_icon_image_path", "TEXT"], // своя картинка, если глифа мало
    // Стингер из постоянного состава пульта: он виден при любом наборе.
    // «Бой» и «Провал» — словарь Мастера, а не свойство таверны.
    ["audio_pinned", "INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (!columnExists(database, "resources", column)) {
      database.exec(`ALTER TABLE resources ADD COLUMN ${column} ${def}`);
    }
  }
  database.exec(
    "UPDATE resources SET audio_role = 'background' WHERE category = 'audio' AND audio_role IS NULL"
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_resources_audio_role ON resources(audio_role) WHERE audio_role IS NOT NULL"
  );

  // uid у набора — по той же причине, что у сущностей выше: обмен наборами
  // между Мастерами (см. later.md) обязан узнавать уже импортированный набор,
  // иначе повторный импорт будет плодить дубли.
  if (tableExists(database, "sound_sets")) {
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_sound_sets_uid ON sound_sets(uid) WHERE uid IS NOT NULL"
    );
    const missingSetUids = database
      .prepare("SELECT id FROM sound_sets WHERE uid IS NULL")
      .all() as { id: number }[];
    if (missingSetUids.length) {
      const set = database.prepare("UPDATE sound_sets SET uid = ? WHERE id = ?");
      const fill = database.transaction(() => {
        for (const row of missingSetUids) set.run(randomUUID(), row.id);
      });
      fill();
    }
  }

  // Наборы получили собственный список треков Бэкграунда и свою боевую тему,
  // а плейлисты сеттинга и сессии перестали существовать: набор из одних
  // треков — это и есть плейлист, только включается одной кнопкой вместе с
  // эмбиентом. Плейлист остался в модели ровно под одну роль — боевую тему,
  // которая переиспользуется по всей кампании и потому имеет смысл отдельно.
  if (!columnExists(database, "sound_sets", "battle_playlist_id")) {
    database.exec(
      "ALTER TABLE sound_sets ADD COLUMN battle_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL"
    );
  }

  // Разовая чистка: владелец решил не переносить ни один из старых плейлистов
  // (все шесть были пробными или уже неактуальными), поэтому переезда состава
  // здесь нет — только роспуск списков. Сами звуки не трогаются: удаляются
  // playlists и playlist_items, а ресурсы остаются в библиотеке.
  //
  // Признак «уже сделано» — колонка scope: у боевых тем она 'battle', и
  // старые строки со scope 'session'/'setting' после чистки не появляются.
  if (tableExists(database, "playlists")) {
    const legacy = database
      .prepare("SELECT COUNT(*) AS c FROM playlists WHERE scope IN ('session', 'setting')")
      .get() as { c: number };
    if (legacy.c > 0) {
      const purge = database.transaction(() => {
        database.exec(
          `DELETE FROM playlist_items WHERE playlist_id IN
             (SELECT id FROM playlists WHERE scope IN ('session', 'setting'))`
        );
        database.exec(
          `UPDATE sessions SET battle_playlist_id = NULL WHERE battle_playlist_id IN
             (SELECT id FROM playlists WHERE scope IN ('session', 'setting'))`
        );
        database.exec("DELETE FROM resource_setting_links WHERE owner_type = 'playlist'");
        database.exec("DELETE FROM playlists WHERE scope IN ('session', 'setting')");
      });
      purge();
    }
  }

  // Плейлист набора заменён его собственным списком треков. Колонку убираем,
  // а не оставляем пустой: оставленная, она стала бы вторым источником
  // истины про Бэкграунд, который однажды разойдётся с первым.
  if (columnExists(database, "sound_sets", "background_playlist_id")) {
    database.exec("ALTER TABLE sound_sets DROP COLUMN background_playlist_id");
  }

  // Разрез «Имя [Original]» стоит и здесь, на своём прежнем месте: записи,
  // заведённые шагами выше, могли прийти со скобкой в имени. Шаг идемпотентен.
  splitBracketNames(database);

  // Своё изображение записи компендиума. Раньше портрет записи брался из её
  // статблока — тогда у записи без статблока картинки не могло быть вовсе, а
  // замена портрета в статблоке молча меняла морду на плитке бестиария.
  // Колонка своя, и при её появлении уже загруженное переносится один раз:
  // берётся первый статблок записи с картинкой (полный вперёд краткого) и
  // файл КОПИРУЕТСЯ в папку раздела — ссылкой на чужой файл нельзя, замена
  // портрета статблока удаляет старый файл и оставила бы битую картинку.
  // Копия почти ничего не стоит: storeDeduped/hard link кладёт те же байты.
  if (!columnExists(database, "compendium_entries", "avatar_image_path")) {
    database.exec("ALTER TABLE compendium_entries ADD COLUMN avatar_image_path TEXT");
    const rows = database
      .prepare(
        `SELECT ce.id, ce.kind, sy.folder_path AS system_folder_path,
                (SELECT sb.avatar_image_path FROM statblocks sb
                  WHERE sb.owner_type = 'compendium_entry' AND sb.owner_id = ce.id
                    AND sb.avatar_image_path IS NOT NULL AND sb.avatar_image_path != ''
                  ORDER BY CASE sb.kind WHEN 'full' THEN 0 ELSE 1 END, sb.id
                  LIMIT 1) AS source_path
           FROM compendium_entries ce JOIN systems sy ON sy.id = ce.system_id`
      )
      .all() as {
      id: number;
      kind: string;
      system_folder_path: string | null;
      source_path: string | null;
    }[];
    const setAvatar = database.prepare(
      "UPDATE compendium_entries SET avatar_image_path = ? WHERE id = ?"
    );
    for (const row of rows) {
      if (!row.source_path || !row.system_folder_path) continue;
      const absSource = vaultAbs(row.source_path);
      if (!fs.existsSync(absSource)) continue;
      try {
        const folder = entryImageFolder(row.system_folder_path, row.kind);
        const ext = path.extname(absSource) || ".jpg";
        const target = path.join(folder, `entry-${row.id}-avatar${ext}`);
        const absTarget = vaultAbs(target);
        if (!fs.existsSync(absTarget)) {
          try {
            fs.linkSync(absSource, absTarget);
          } catch {
            fs.copyFileSync(absSource, absTarget);
          }
        }
        setAvatar.run(target, row.id);
      } catch (err) {
        console.error(`Не удалось перенести портрет записи ${row.id}:`, err);
      }
    }
  }

  // История и Поведение существа бестиария — зеркало being_chapters без
  // campaign_id и visible_to_players: шаблон системы к кампании не привязан и
  // игроку не синхронизируется.
  if (!tableExists(database, "compendium_entry_chapters")) {
    database.exec(`CREATE TABLE compendium_entry_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(
      "CREATE INDEX idx_compendium_entry_chapters_entry ON compendium_entry_chapters(entry_id)"
    );
  }

  // Размер, тип и класс опасности у импортированных существ знает только
  // статблок, а фильтры раздела бестиария читают data. Раньше здесь стоял
  // проход по всему бестиарию при каждом старте — он убран: массовая правка
  // справочника делается по кнопке «Привести справочник в порядок» и
  // показывает отчёт, а молчаливую правку пятисот записей на старте владелец
  // не заказывал и не видел. Открытая карточка существа по-прежнему
  // дозаполняет себя сама — см. backfillEntrySummary.

  // Тайна помнит, в какой сессии её раскрыли. У раскрытых раньше колонка
  // остаётся пустой — так и показываем: «раскрыто раньше».
  if (!columnExists(database, "campaign_secret_state", "revealed_session_id")) {
    database.exec(
      "ALTER TABLE campaign_secret_state ADD COLUMN revealed_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL"
    );
  }
  if (!columnExists(database, "campaign_secret_state", "pinned")) {
    database.exec("ALTER TABLE campaign_secret_state ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }

  // Приключение внутри приключения — след эксперимента, а не замысел: четыре
  // пустые строки под «Атакой склада» с kind='adventure' при родителе. В новом
  // дереве они выглядели бы поломкой приложения. Удалять чужое без просьбы не
  // станем, правки вида достаточно.
  database.exec(
    `UPDATE story_arcs SET kind = 'chapter'
     WHERE kind = 'adventure' AND parent_id IS NOT NULL`
  );

  // Заготовка сессии стала списком сцен, а таблица отметок приключений ушла.
  // Живого содержимого в ней не было: она прожила один день.
  if (tableExists(database, "session_adventures")) {
    database.exec("DROP TABLE session_adventures");
  }

  migrateChapterBoards(database);

  // Разъёмы состава сцены названы как панели пульта — одно имя на весь путь.
  // Всё, что лежало в «участниках», уезжает в «Препятствия»: именно туда оно
  // и попадало на пульте по прежнему правилу, так что для Мастера ничего не
  // меняется. Разложить часть по «Сюжетным персонажам» он теперь может сам.
  const castRenameKey = "scene_cast_sections_renamed";
  const castRenamed = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(castRenameKey) as { value: string } | undefined;
  if (!castRenamed) {
    for (const [from, to] of [
      ["scene_participants", "scene_obstacles"],
      ["scene_items", "scene_loot"],
    ]) {
      database
        .prepare("UPDATE generic_links SET section = ? WHERE from_type = 'scene' AND section = ?")
        .run(to, from);
    }
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1')").run(castRenameKey);
  }

  // Строки трекера инициативы, у которых нет хитов: действие логова, действие
  // окружения и своё событие Мастера. Умолчание 'creature' — всё, что уже
  // лежит в трекере, это бойцы.
  if (!columnExists(database, "initiative_entries", "kind")) {
    database.exec("ALTER TABLE initiative_entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'creature'");
  }
  // Старые секции сцены → новые: scene_participants → scene_plot_characters, scene_items → scene_loot
  // Полотно уже пишет новыми именами, а профиль сцены читал старыми — из-за этого существа и предметы, воткнутые на полотне, не показывались в профиле.
  const castMigrateDone = database.prepare("SELECT value FROM app_settings WHERE key = ?").get("cast_sections_migrated") as { value: string } | undefined;
  if (!castMigrateDone) {
    database.exec("UPDATE generic_links SET section = 'scene_plot_characters' WHERE from_type = 'scene' AND section = 'scene_participants'");
    database.exec("UPDATE generic_links SET section = 'scene_loot' WHERE from_type = 'scene' AND section = 'scene_items'");
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('cast_sections_migrated', '1')").run();
  }

  // «Справочник» стал базовым разделом системы — системам, заведённым раньше,
  // он добавляется один раз (см. defaultSections.ts).
  backfillDefaultMechanicsSections(database);
  backfillDefaultVehicleSections(database);
  migrateBastionsToOwnSection(database);

  // Навыки D&D 5.5: оригинальные имена, характеристики и алиасы переводов —
  // один раз и только по пустым полям (см. dndSkillNames.ts).
  migrateDndSkillNames(database);
  migrateDndGrantedSpells(database);
  migrateDndOriginGrants(database);
  migrateDndSpeedStructure(database);
  migrateDndSheetRefs(database);
  migrateDndStartingSets(database);
  migrateDndReplicaSchemes(database);
  // Роли колонок реплик правились внутри сидинга и не достались живым базам
  // (см. dndReplicaSchemes.ts) — догоняем отдельным ключом.
  migrateDndReplicaColumnRoles(database);
  // Боевые спутники Артефактора: кидаемые строки и чертежи тел (Фаза A —
  // только данные, движок уже есть). См. dndArtificerCompanions.ts.
  migrateDndArtificerCompanionActions(database);
  migrateDndArtificerMasterworker(database);
  migrateDndArtificerPoolRows(database);
  migrateDndArtificerTouchups(database);
  migrateDndArtificerLevelDice(database);
  migrateDndArtificerReanimator(database);
  migrateDndArtificerOracle(database);
  // Тиры схем по книге 2/6/10/14 вместо эвристики редкости (аудит 2026-09-07).
  migrateDndReplicaTiers(database);
  migrateDndReplicaGenerics(database);
  // Догоняющее добавление именных схем (без флага): заведённые позже
  // предметы подтягиваются сами.
  ensureNamedReplicaSchemes(database);

  if (tableExists(database, "canvas_frames") && !columnExists(database, "canvas_frames", "color")) {
    database.exec("ALTER TABLE canvas_frames ADD COLUMN color TEXT NOT NULL DEFAULT '#2C3E50'");
  }
  // Свёртка переехала с главы на свободную рамку (блок G6.3). Умолчание 0, а
  // не 1: рамки, уже нарисованные Мастером, не должны схлопнуться от одного
  // обновления — он рисовал их вокруг того, что хотел видеть.
  if (tableExists(database, "canvas_frames") && !columnExists(database, "canvas_frames", "collapsed")) {
    database.exec("ALTER TABLE canvas_frames ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0");
  }
  // Главы стали узлами и отказались от глав-рамок: `canvas_groups` больше не
  // читается и не пишется (см. маршруты canvas). Legacy-таблица выпиливается
  // целиком; ALTER-миграции на её колонки (color/collapsed) удалены вместе с ней.
  database.exec("DROP TABLE IF EXISTS canvas_groups");
  // Родитель для нод, у которых своей главы нет: сущности, стикера, картинки,
  // пина. У сцены и проверки родитель выводится из данных (arc_id сцены), и
  // сюда не пишется. Геометрия решает один раз — в момент броска на рамку;
  // дальше это данные, а не перекрытие прямоугольников.
  //
  // Ключ строкой (`frame:<id>`), а не числом: рамка одна, но строка позволяет
  // не путаться с числовыми id других таблиц.
  if (tableExists(database, "canvas_nodes") && columnExists(database, "canvas_nodes", "parent_node_id")) {
    // Колонка прожила меньше часа и всегда была пустой — заменяется целиком.
    database.exec("ALTER TABLE canvas_nodes DROP COLUMN parent_node_id");
  }
  if (tableExists(database, "canvas_nodes") && !columnExists(database, "canvas_nodes", "parent_key")) {
    database.exec("ALTER TABLE canvas_nodes ADD COLUMN parent_key TEXT");
  }
  // Владелец свободной доски и её архивация (блок D1). Обе колонки пустые для
  // всех существующих досок: заведённые до этого остаются ничьими и активными,
  // то есть открываются ровно как раньше. Владение сделано колонками, а не
  // новым scope_type: см. комментарий в schema.sql.
  if (tableExists(database, "canvas_boards") && !columnExists(database, "canvas_boards", "owner_type")) {
    database.exec("ALTER TABLE canvas_boards ADD COLUMN owner_type TEXT");
    database.exec("ALTER TABLE canvas_boards ADD COLUMN owner_id INTEGER");
  }
  if (tableExists(database, "canvas_boards") && !columnExists(database, "canvas_boards", "archived_at")) {
    database.exec("ALTER TABLE canvas_boards ADD COLUMN archived_at TEXT");
  }
  // Имя доски и порядок нод по глубине появились в schema.sql 2026-08-24 без
  // ALTER для уже заведённых таблиц: у базы, где холст был раньше, чтение и
  // запись доски падали «no such column».
  if (tableExists(database, "canvas_boards") && !columnExists(database, "canvas_boards", "name")) {
    database.exec("ALTER TABLE canvas_boards ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (tableExists(database, "canvas_nodes") && !columnExists(database, "canvas_nodes", "z_index")) {
    database.exec("ALTER TABLE canvas_nodes ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0");
  }
  // Индекс — отдельно и без условия на колонку: он нужен и свежей базе (где
  // колонки пришли из schema.sql, и ветка выше не сработала), и старой.
  if (tableExists(database, "canvas_boards") && columnExists(database, "canvas_boards", "owner_type")) {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_canvas_boards_owner ON canvas_boards(owner_type, owner_id)"
    );
  }

  // Свой набор связей у кампании (блок D4). Таблица пересобирается целиком:
  // уникальность была ограничением таблицы `UNIQUE(from, to, label)`, а
  // изменить ограничение ALTER'ом SQLite не умеет — и без изменения кампания
  // не смогла бы завести копию той же связи. Новая уникальность считает
  // NULL-владельца нулём (IFNULL), иначе две одинаковые связи сеттинга
  // прошли бы как разные.
  if (
    tableExists(database, "story_arc_transitions") &&
    !columnExists(database, "story_arc_transitions", "campaign_id")
  ) {
    database.exec(`
      CREATE TABLE story_arc_transitions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
        to_arc_id INTEGER NOT NULL REFERENCES story_arcs(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE
      );
      INSERT INTO story_arc_transitions_new (id, from_arc_id, to_arc_id, label, position, campaign_id)
        SELECT id, from_arc_id, to_arc_id, label, position, NULL FROM story_arc_transitions;
      DROP TABLE story_arc_transitions;
      ALTER TABLE story_arc_transitions_new RENAME TO story_arc_transitions;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_arc_transitions_unique
        ON story_arc_transitions(from_arc_id, to_arc_id, label, IFNULL(campaign_id, 0));
      CREATE INDEX IF NOT EXISTS idx_arc_transitions_campaign
        ON story_arc_transitions(campaign_id);
    `);
  }

  // Индексы связей — отдельно и без условия на пересборку выше: они нужны и
  // свежей базе (где колонка пришла из schema.sql, и ветка выше не сработала),
  // и старой. В самом schema.sql их держать нельзя: он выполняется до миграций.
  if (
    tableExists(database, "story_arc_transitions") &&
    columnExists(database, "story_arc_transitions", "campaign_id")
  ) {
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_arc_transitions_unique
         ON story_arc_transitions(from_arc_id, to_arc_id, label, IFNULL(campaign_id, 0));
       CREATE INDEX IF NOT EXISTS idx_arc_transitions_campaign
         ON story_arc_transitions(campaign_id);`
    );
  }

  // Ведёт ли кампания свои связи (блок D4). Отдельный флаг, а не «есть ли
  // строки с её campaign_id»: Мастер может стереть в кампании все связи до
  // единой, и без флага это было бы неотличимо от «своих связей нет», то есть
  // связи сеттинга вернулись бы сами.
  if (tableExists(database, "campaigns") && !columnExists(database, "campaigns", "own_arc_transitions")) {
    database.exec("ALTER TABLE campaigns ADD COLUMN own_arc_transitions INTEGER NOT NULL DEFAULT 0");
  }

  // Когда приключение правили в последний раз (блок D4). Нужно ровно для
  // одного: сказать Мастеру, что оригинал в сеттинге изменился ПОСЛЕ того, как
  // кампания сняла с него свою копию (у копии для этого есть `created_at`).
  // Существующим строкам проставляется их `created_at` — честнее, чем `now`:
  // когда их правили на самом деле, база не помнит.
  if (tableExists(database, "story_arcs") && !columnExists(database, "story_arcs", "updated_at")) {
    database.exec("ALTER TABLE story_arcs ADD COLUMN updated_at TEXT");
    database.exec("UPDATE story_arcs SET updated_at = created_at WHERE updated_at IS NULL");
  }
  if (!tableExists(database, "canvas_pins")) {
    database.exec(`CREATE TABLE canvas_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Пин',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      size TEXT NOT NULL DEFAULT 'M',
      color TEXT NOT NULL DEFAULT '#2C3E50',
      shape TEXT NOT NULL DEFAULT 'circle',
      z_index INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_canvas_pins_board ON canvas_pins(board_id)`);
  }
  if (!tableExists(database, "canvas_threads")) {
    database.exec(`CREATE TABLE canvas_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
      from_pin_id INTEGER NOT NULL REFERENCES canvas_pins(id) ON DELETE CASCADE,
      to_pin_id INTEGER NOT NULL REFERENCES canvas_pins(id) ON DELETE CASCADE,
      width REAL NOT NULL DEFAULT 2,
      color TEXT NOT NULL DEFAULT '#2C3E50',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(board_id, from_pin_id, to_pin_id)
    )`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_canvas_threads_board ON canvas_threads(board_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_canvas_threads_pins ON canvas_threads(from_pin_id, to_pin_id)`);
  }

  // Карточка существа (шаг 4 ревизии): мастерская обвязка вокруг статблока —
  // роль в бою, тактика и секрет. Лежит колонками в ОБЕИХ таблицах, а не в
  // свободном `data` записи компендиума: одно и то же поле, лежащее JSON'ом в
  // одном месте и колонкой в другом, нельзя ни искать одним запросом, ни
  // наследовать одним кодом (личность берёт роль/тактику/прозу вида по
  // base_monster_id, пока своё пусто). Проза — уже существующая description.
  for (const table of ["compendium_entries", "setting_beings"]) {
    if (!columnExists(database, table, "combat_roles")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN combat_roles TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!columnExists(database, table, "tactics")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN tactics TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!columnExists(database, table, "secret")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN secret TEXT NOT NULL DEFAULT ''`);
    }
  }

  // Избранное бестиария (шаг 5 ревизии): личная полка Мастера, а не свойство
  // записи. Своя у каждого аккаунта с ролью gm — общий на всех список молча
  // расходился бы между двумя мастерами одной базы, и никто бы не понял,
  // почему звезда то есть, то нет. Ссылка на запись, а не на существо
  // сеттинга: звёздочка стоит в разделе системы.
  if (!tableExists(database, "compendium_favourites")) {
    database.exec(`CREATE TABLE compendium_favourites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_id INTEGER NOT NULL REFERENCES compendium_entries(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, entry_id)
    )`);
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_compendium_favourites_entry ON compendium_favourites(entry_id)`
    );
  }

  // Архив — индексы под `archived_at IS NOT NULL` (GET /archive делает
  // 13× SELECT по этому предикату). schema.sql уже заводит их для свежих БД,
  // здесь — для живых баз, заведённых до появления индексов.
  for (const [table] of [
    ["systems"], ["settings"], ["campaigns"], ["players"], ["characters"],
    ["sessions"], ["resources"], ["mastering_notes"], ["setting_locations"],
    ["setting_beings"], ["setting_communities"], ["artifacts"],
    ["story_arcs"], ["story_scenes"], ["canvas_boards"],
  ] as const) {
    if (!tableExists(database, table) || !columnExists(database, table, "archived_at")) continue;
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_archived ON ${table}(archived_at) WHERE archived_at IS NOT NULL`);
  }

  // Жанры сеттинга — JSON-массив объектов { genre, subgenre? }.
  if (!columnExists(database, "settings", "genres")) {
    database.exec(`ALTER TABLE settings ADD COLUMN genres TEXT`);
  }

  // ─── Группы игроков ────────────────────────────────────────────────────────
  if (!tableExists(database, "player_groups")) {
    database.exec(`CREATE TABLE player_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!tableExists(database, "player_group_members")) {
    database.exec(`CREATE TABLE player_group_members (
      group_id INTEGER NOT NULL REFERENCES player_groups(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, player_id)
    )`);
  }

  if (!tableExists(database, "setting_calendar_timelines")) {
    database.exec(`CREATE TABLE setting_calendar_timelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  if (!columnExists(database, "setting_calendar_eras", "timeline_id")) {
    database.exec("ALTER TABLE setting_calendar_eras ADD COLUMN timeline_id INTEGER REFERENCES setting_calendar_timelines(id) ON DELETE SET NULL");
  }

  if (!columnExists(database, "important_dates", "description")) {
    database.exec("ALTER TABLE important_dates ADD COLUMN description TEXT DEFAULT ''");
  }
  if (!columnExists(database, "important_dates", "date_type")) {
    database.exec("ALTER TABLE important_dates ADD COLUMN date_type TEXT DEFAULT ''");
  }
  if (!columnExists(database, "important_dates", "color")) {
    database.exec("ALTER TABLE important_dates ADD COLUMN color TEXT DEFAULT ''");
  }
  if (!columnExists(database, "important_dates", "custom_rule")) {
    database.exec("ALTER TABLE important_dates ADD COLUMN custom_rule TEXT DEFAULT ''");
  }

  // Дневник персонажа (2026-09-02). «Исследование мира» перестаёт быть общим
  // блокнотом партии: запись принадлежит персонажу, а не игроку, и видит её
  // только автор. Переезд делается тремя шагами в одном условии, потому что
  // все три обязаны случиться вместе:
  //   1) колонка character_id (ON DELETE SET NULL — удаление персонажа не
  //      уносит написанное; персонажей в этом приложении и так не удаляют, а
  //      архивируют);
  //   2) `extra_field` («Место обитания» / «Обитатели») сливается в текст —
  //      отдельного поля у заметки больше нет. Сама колонка остаётся в базе
  //      до отдельной чистки: перестроение таблицы ради одного мёртвого
  //      столбца на живой базе владельца не стоит риска;
  //   3) привязка к персонажу — только там, где она однозначна: у автора
  //      ровно один активный персонаж в этой кампании. Спорные остаются с
  //      NULL, и владелец выбирает сам в интерфейсе — приписать чужое знание
  //      чужому персонажу молча нельзя.
  if (
    tableExists(database, "world_exploration_entries") &&
    !columnExists(database, "world_exploration_entries", "character_id")
  ) {
    database.exec(
      "ALTER TABLE world_exploration_entries ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL"
    );
    database.exec(`
      UPDATE world_exploration_entries
         SET description = TRIM(CASE WHEN TRIM(description) = '' THEN extra_field
                                     ELSE description || char(10) || extra_field END),
             extra_field = ''
       WHERE TRIM(COALESCE(extra_field, '')) <> ''
    `);
    database.exec(`
      UPDATE world_exploration_entries AS e
         SET character_id = (SELECT ch.id FROM characters ch
                              WHERE ch.player_id = e.player_id
                                AND ch.campaign_id = e.campaign_id
                                AND ch.archived_at IS NULL)
       WHERE (SELECT COUNT(*) FROM characters ch
               WHERE ch.player_id = e.player_id
                 AND ch.campaign_id = e.campaign_id
                 AND ch.archived_at IS NULL) = 1
    `);
  }
  // Вне условия выше: на новой базе колонка приходит из schema.sql, миграция
  // не срабатывает, а индекс всё равно нужен.
  if (columnExists(database, "world_exploration_entries", "character_id")) {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_world_exploration_entries_character ON world_exploration_entries(character_id)"
    );
  }

  // Which setting entities are explicitly included in a campaign's "Для
  // игроков" panel.  Without a row here the entity is invisible to all
  // players regardless of player_visibility_grants.
  if (!tableExists(database, "campaign_setting_entities")) {
    database.exec(`CREATE TABLE campaign_setting_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('setting_location','setting_being','setting_community','setting_calendar_event')),
      entity_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, entity_type, entity_id)
    )`);
    database.exec(`CREATE INDEX idx_cse_campaign ON campaign_setting_entities(campaign_id)`);
    database.exec(`CREATE INDEX idx_cse_entity ON campaign_setting_entities(entity_type, entity_id)`);
  }

  // Прощённый долг. Долг сам по себе не хранится — он считается как
  // «ожидалось − оплачено» (см. unpaidSessionsForPlayer). Но прощение из чисел
  // не выводится: это решение Мастера, и без записи оно не пережило бы
  // перерисовку — вычисление вернуло бы долг обратно. Поэтому хранится ровно
  // то, чего в числах нет, а долг становится «ожидалось − оплачено − прощено».
  // В «заработано» прощённое не идёт: сводка обязана показывать полученное.
  if (!columnExists(database, "session_attendance", "amount_forgiven")) {
    database.exec(
      "ALTER TABLE session_attendance ADD COLUMN amount_forgiven REAL NOT NULL DEFAULT 0"
    );
  }

  // Членство по ростеру против членства по персонажу.
  //
  // Раньше участником кампании считался тот, у кого в ней есть живой персонаж;
  // теперь — тот, кто числится в ростере (см. myCampaignIds в routes/player.ts).
  // У игроков Мастера ростер заполнен, а вот сам Мастер в чужих кампаниях, где
  // он игрок, в ростер не попал: строки завести было неоткуда. Из-за этого его
  // собственная посещаемость и оплата в чужих играх не имели куда записаться —
  // session_attendance хранит строку на члена ростера.
  //
  // Починка идёт по прежнему правилу («есть персонаж — значит участник»), то
  // есть возвращает данные к тому, что и так подразумевалось, а не выдумывает
  // членство. INSERT OR IGNORE делает её идемпотентной, а прав она никому не
  // добавляет: доступ игрока считается по users.player_id, и у записи без
  // привязанной учётки он никакой.
  {
    const key = "roster_backfilled_from_characters";
    if (!appSettingFlag(database, key)) {
      database.exec(`
        INSERT OR IGNORE INTO campaign_roster (campaign_id, player_id)
        SELECT DISTINCT ch.campaign_id, ch.player_id
          FROM characters ch
          JOIN campaigns c ON c.id = ch.campaign_id
         WHERE ch.campaign_id IS NOT NULL
           AND ch.archived_at IS NULL
           AND c.archived_at IS NULL
      `);
      setAppSettingFlag(database, key);
    }
  }

  // Карты (раздел «Карты»): тайловые поля гексы/квадраты + генератор по
  // сиду. Клетки — компактным JSON-blob'ом на строке карты (60×44 = 2640
  // клеток, пер-клеточные строки здесь не нужны): {v:1, cells:{"x,y":code},
  // roads:["x,y"]}. По умолчанию клетка — равнина без дороги и в blob не
  // пишется. Вариант отрисовки клетки считается от хэша (x,y,seed) и не
  // хранится. `parent_map_id` + `portal_to_map_id` в клетке — задел под
  // иерархию-порталы, в UI не показываются (см. MainWorks/Maps).
  if (!tableExists(database, "maps")) {
    database.exec(`CREATE TABLE maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grid TEXT NOT NULL CHECK (grid IN ('square','hex')),
      scale TEXT NOT NULL CHECK (scale IN ('planet','continent','country','region','settlement','locality')),
      width INTEGER NOT NULL DEFAULT 40,
      height INTEGER NOT NULL DEFAULT 30,
      cell_lore TEXT NOT NULL DEFAULT '',
      seed INTEGER NOT NULL DEFAULT 0,
      sea INTEGER NOT NULL DEFAULT 55,
      mountains INTEGER NOT NULL DEFAULT 12,
      forest INTEGER NOT NULL DEFAULT 30,
      cells TEXT NOT NULL DEFAULT '{"v":1,"cells":{},"roads":[]}',
      thumbnail TEXT,
      player_visible INTEGER NOT NULL DEFAULT 0,
      parent_map_id INTEGER REFERENCES maps(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_maps_updated ON maps(updated_at)`);
  }

  // Привязки карты многие-ко-многим (одна карта — к нескольким
  // сеттингам/кампаниям/локациям). Схема сейчас, UI — следующим шагом.
  if (!tableExists(database, "map_bindings")) {
    database.exec(`CREATE TABLE map_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('setting','campaign','location')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(map_id, target_type, target_id)
    )`);
    database.exec(`CREATE INDEX idx_map_bindings_map ON map_bindings(map_id)`);
    database.exec(`CREATE INDEX idx_map_bindings_target ON map_bindings(target_type, target_id)`);
  }

  // Версия статблока. Быстрые правки уходят патчем изменённых полей, и одна
  // правка больше не затирает другую сама по себе; версия — страховка для
  // полного сохранения из формы: с ней PUT со снимком целиком видит, что
  // статблок успели изменить в другом окне, и отвечает 409 вместо тихой
  // перезаписи. Значение проставляется руками в каждом UPDATE: триггеров в
  // этой базе нет ни у одной таблицы, и заводить их ради одной колонки
  // значит спрятать запись туда, где её никто не ищет.
  if (!columnExists(database, "statblocks", "updated_at")) {
    database.exec("ALTER TABLE statblocks ADD COLUMN updated_at TEXT");
    database.exec(
      "UPDATE statblocks SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE updated_at IS NULL"
    );
  }

  // Представление сцены (показ игрокам на второй экран): фон + слои,
  // входной транзишен + титр, общий фейд слоёв. Колонки наследуются
  // заготовкой (см. INHERITED_SCENE_FIELDS в story/library.ts) и копируются
  // вместе со сценой (cloneSceneForCampaign, copySceneChildren) — иначе у
  // копии кампании был бы чужой кадр.
  for (const [col, ddl] of [
    ["presentation_background_path", "ALTER TABLE story_scenes ADD COLUMN presentation_background_path TEXT"],
    ["presentation_transition", "ALTER TABLE story_scenes ADD COLUMN presentation_transition TEXT NOT NULL DEFAULT 'cut'"],
    ["presentation_transition_ms", "ALTER TABLE story_scenes ADD COLUMN presentation_transition_ms INTEGER NOT NULL DEFAULT 600"],
    ["presentation_title", "ALTER TABLE story_scenes ADD COLUMN presentation_title TEXT NOT NULL DEFAULT ''"],
    ["presentation_title_secs", "ALTER TABLE story_scenes ADD COLUMN presentation_title_secs INTEGER NOT NULL DEFAULT 3"],
    ["presentation_fade_ms", "ALTER TABLE story_scenes ADD COLUMN presentation_fade_ms INTEGER NOT NULL DEFAULT 600"],
  ] as const) {
    if (tableExists(database, "story_scenes") && !columnExists(database, "story_scenes", col)) {
      database.exec(ddl);
    }
  }

  // Слои представления сцены. Байты картинки общие с оригиналом через
  // дедуп vault (тот же image_path у копии) — DELETE строки слоя файл с диска
  // не удаляет, иначе копия кампании потеряла бы свой слой.
  if (!tableExists(database, "scene_presentation_layers")) {
    database.exec(`CREATE TABLE scene_presentation_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id INTEGER NOT NULL REFERENCES story_scenes(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      has_button INTEGER NOT NULL DEFAULT 1,
      visible_on_enter INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      x_pct REAL NOT NULL DEFAULT 0,
      y_pct REAL NOT NULL DEFAULT 0,
      w_pct REAL NOT NULL DEFAULT 100,
      h_pct REAL NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_scene_presentation_layers_scene ON scene_presentation_layers(scene_id)`);
  }

  // Заглавное представление кампании — та же структура, что у сцены, но
  // владелец кампания (наследования заготовок здесь нет — заглавное одно).
  for (const [col, ddl] of [
    ["cover_background_path", "ALTER TABLE campaigns ADD COLUMN cover_background_path TEXT"],
    ["cover_transition", "ALTER TABLE campaigns ADD COLUMN cover_transition TEXT NOT NULL DEFAULT 'cut'"],
    ["cover_transition_ms", "ALTER TABLE campaigns ADD COLUMN cover_transition_ms INTEGER NOT NULL DEFAULT 600"],
    ["cover_title", "ALTER TABLE campaigns ADD COLUMN cover_title TEXT NOT NULL DEFAULT ''"],
    ["cover_title_secs", "ALTER TABLE campaigns ADD COLUMN cover_title_secs INTEGER NOT NULL DEFAULT 3"],
    ["cover_fade_ms", "ALTER TABLE campaigns ADD COLUMN cover_fade_ms INTEGER NOT NULL DEFAULT 600"],
  ] as const) {
    if (tableExists(database, "campaigns") && !columnExists(database, "campaigns", col)) {
      database.exec(ddl);
    }
  }
  if (!tableExists(database, "campaign_presentation_layers")) {
    database.exec(`CREATE TABLE campaign_presentation_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      has_button INTEGER NOT NULL DEFAULT 1,
      visible_on_enter INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      x_pct REAL NOT NULL DEFAULT 0,
      y_pct REAL NOT NULL DEFAULT 0,
      w_pct REAL NOT NULL DEFAULT 100,
      h_pct REAL NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.exec(`CREATE INDEX idx_campaign_presentation_layers_campaign ON campaign_presentation_layers(campaign_id)`);
  }

  // Состояние экрана показа — серверный источник правды, чтобы окно игроков
  // переживало перезагрузку. Пишет только пульт; окно и превью читают и
  // подхватывают изменения по BroadcastChannel-пингу клиента.
  if (!tableExists(database, "session_show_state")) {
    database.exec(`CREATE TABLE session_show_state (
      session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'black',
      scene_id INTEGER REFERENCES story_scenes(id) ON DELETE SET NULL,
      visible_layer_ids TEXT NOT NULL DEFAULT '[]',
      shown INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // Рераут холста больше не помнит выход в своей строке: с 2026-08-30 выходы
  // живут в canvas_route_outputs, и `to_key` убрали из schema.sql, но не из
  // кода и не из старых баз. Итог — поломка в обе стороны: на новой базе
  // создание рераута падало «no column named to_key», а на старой, где колонка
  // осталась `NOT NULL` без умолчания, импорт приключения с рераутами падал
  // «NOT NULL constraint failed». В колонке только пустые строки (её никто не
  // заполнял), так что она уходит без потери данных. Шаг стоит в конце: новые
  // шаги дописываются вниз, см. migrateOldDatabases.test.ts.
  if (columnExists(database, "canvas_routes", "to_key")) {
    database.exec("ALTER TABLE canvas_routes DROP COLUMN to_key");
  }

  // Выходы между местами (решения 2026-09-11, §4). schema.sql заводит таблицу
  // и на старой базе (CREATE TABLE IF NOT EXISTS), шаг — страховка порядка,
  // как у location_content. Индексы живут в schema.sql и повторяются ниже.
  if (!tableExists(database, "location_exits")) {
    database.exec(`CREATE TABLE location_exits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      to_location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      how TEXT NOT NULL DEFAULT '',
      travel_time TEXT NOT NULL DEFAULT '',
      one_way INTEGER NOT NULL DEFAULT 0,
      secret INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  // Ручная отметка «Мы здесь» кампании (решения 2026-09-11, §3). Как и
  // выходы: schema.sql заводит таблицу сам, шаг — страховка порядка.
  if (!tableExists(database, "campaign_party_place")) {
    database.exec(`CREATE TABLE campaign_party_place (
      campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES setting_locations(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      set_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    )`);
  }

  // Все индексы schema.sql — ещё раз, после всех ADD COLUMN и перестроек (см.
  // execSchema). Неудача здесь — настоящая ошибка схемы, её не глотаем.
  for (const sql of schemaIndexes) database.exec(sql);

  compactIfBloated(database);
}

/**
 * Холст переезжает с главы на приключение.
 *
 * До появления глав в интерфейсе Мастер раскладывал сцены на холстах ГЛАВ —
 * у «Главы 1. Друг в беде» 14 нод, у «Эпизода 1. Призыв к действию» 11. Теперь
 * приключение показывает сцены всех своих глав, и им нужна одна система
 * координат.
 *
 * Каждая глава получает свою полосу по вертикали: иначе три раскладки,
 * начинавшиеся от нуля, легли бы одна на другую. Полоса — честное умолчание,
 * дальше Мастер двигает как хочет, и это уже его раскладка. Заодно заводится
 * рамка главы по границам её нод.
 *
 * Складывать чужие системы координат «на лету», не мигрируя, отвергнуто: это
 * та же работа, только при каждом открытии и без возможности подвинуть.
 */
function migrateChapterBoards(database: Database.Database): void {
  const key = "canvas_boards_moved_to_adventures";
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (done) return;

  const boards = database
    .prepare(
      `SELECT b.id AS board_id, b.scope_id AS arc_id, a.parent_id
       FROM canvas_boards b
       JOIN story_arcs a ON a.id = b.scope_id
       WHERE b.scope_type = 'arc' AND a.parent_id IS NOT NULL`
    )
    .all() as { board_id: number; arc_id: number; parent_id: number }[];

  const LANE = 520;      // высота полосы главы

  const run = database.transaction(() => {
    for (const b of boards) {
      // Холст приключения: свой или заводится сейчас.
      let target = database
        .prepare("SELECT id FROM canvas_boards WHERE scope_type = 'arc' AND scope_id = ?")
        .get(b.parent_id) as { id: number } | undefined;
      if (!target) {
        const info = database
          .prepare("INSERT INTO canvas_boards (scope_type, scope_id) VALUES ('arc', ?)")
          .run(b.parent_id);
        target = { id: Number(info.lastInsertRowid) };
      }

      const nodes = database
        .prepare("SELECT id, x, y FROM canvas_nodes WHERE board_id = ?")
        .all(b.board_id) as { id: number; x: number; y: number }[];

      // Номер полосы — по порядку главы среди сестёр, чтобы раскладка
      // повторяла порядок приключения, а не порядок миграции.
      const lane = (database
        .prepare(
          `SELECT COUNT(*) n FROM story_arcs
           WHERE parent_id = ? AND (position, id) < (SELECT position, id FROM story_arcs WHERE id = ?)`
        )
        .get(b.parent_id, b.arc_id) as { n: number }).n;
      const shift = lane * LANE;

      if (nodes.length > 0) {
        const move = database.prepare(
          `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y)
           SELECT ?, node_type, node_id, x, y + ? FROM canvas_nodes WHERE id = ?
           ON CONFLICT(board_id, node_type, node_id) DO NOTHING`
        );
        for (const n of nodes) move.run(target.id, shift, n.id);
      }

      database.prepare("DELETE FROM canvas_boards WHERE id = ?").run(b.board_id);
    }
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1')").run(key);
  });
  run();
}

/**
 * Сколько места в файле базы занято пустотой.
 *
 * SQLite не отдаёт место операционной системе сам: удалённые строки
 * оставляют свободные страницы, которые переиспользуются под новые данные, но
 * файл при этом не худеет никогда. У базы, из которой много удаляли —
 * переставляли систему, чистили архив, откатывали импорты, — пустоты
 * набирается кратно больше самих данных.
 */
export function databaseFill(database: Database.Database): {
  pages: number;
  freePages: number;
  freeRatio: number;
  bytes: number;
} {
  const pages = (database.pragma("page_count", { simple: true }) as number) || 0;
  const freePages = (database.pragma("freelist_count", { simple: true }) as number) || 0;
  const pageSize = (database.pragma("page_size", { simple: true }) as number) || 4096;
  return {
    pages,
    freePages,
    freeRatio: pages ? freePages / pages : 0,
    bytes: pages * pageSize,
  };
}

/** Доля пустоты, начиная с которой файл стоит перестроить. */
const VACUUM_THRESHOLD = 0.5;

/**
 * Перестраивает файл, если пустоты в нём больше половины.
 *
 * Старт — единственный момент, когда база гарантированно никем не занята:
 * `VACUUM` требует эксклюзивного доступа и не работает внутри транзакции.
 * Порог нужен, чтобы это случалось редко: перестройка переписывает файл
 * целиком, и делать её после каждого удаления было бы расточительно.
 */
export function compactIfBloated(database: Database.Database, force = false): boolean {
  const before = databaseFill(database);
  if (!force && before.freeRatio < VACUUM_THRESHOLD) return false;
  try {
    database.exec("VACUUM");
    return true;
  } catch (e) {
    // Не повод не пускать пользователя в приложение: раздутый файл работает,
    // просто занимает лишнее место.
    console.error("VACUUM failed:", e);
    return false;
  }
}

/** Каталог рабочей базы: заданный через DB_DIR (Electron, тесты) или дефолтный. */
export function defaultDbDir(): string {
  return process.env.DB_DIR || path.join(__dirname, "..", "..", "data");
}

let current: Database.Database | null = null;

/**
 * Открывает рабочую базу — единственная точка, после которой `db` оживает.
 *
 * Раньше открытие стояло на верхнем уровне модуля, и база открывалась и
 * мигрировала от одного лишь `import`. Любой скрипт, который упоминал `db` в
 * коде — даже чтобы не трогать её, а посмотреть на копию, — необратимо
 * переписывал РАБОЧУЮ базу владельца; в `runPendingMigrations.ts` это было
 * записано предупреждением капслоком вместо починки. Теперь базу открывает
 * тот, кто её попросил, а забывший получает ошибку, а не чужой файл.
 *
 * Повторный вызов — не ошибка и не переоткрытие: смена базы делается
 * `switchToDatabase`.
 */
export function initDatabase(dbDir?: string): Database.Database {
  if (!current) current = openDatabase(dbDir ?? defaultDbDir());
  return current;
}

function activeDatabase(): Database.Database {
  if (!current) {
    throw new Error(
      "База не открыта: вызовите initDatabase(dbDir) до первого обращения к db " +
        "(сервер — в src/index.ts, скрипты и тесты — у себя в начале)."
    );
  }
  return current;
}

// Every route file does `import { db } from "../db/db"` and calls
// `db.prepare(...)` directly. A Proxy lets us swap the underlying connection
// (see switchToDatabase) without touching any of those call sites.
export const db = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const active = activeDatabase();
    const value = Reflect.get(active, prop, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
});

export function switchToDatabase(dbDir: string): void {
  const next = openDatabase(dbDir);
  const old = current;
  current = next;
  old?.close();
}
