import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { entryImageFolder, systemFolder, vaultAbs } from "../services/filesystem";
import { backfillDefaultMechanicsSections, backfillDefaultVehicleSections, migrateBastionsToOwnSection } from "./defaultSections";
import { migrateDndSkillNames } from "./dndSkillNames";
import { migrateDndGrantedSpells } from "./dndGrantedSpells";
import { migrateDndOriginGrants } from "./dndOriginGrants";

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

/** Типы, на которые можно сослаться, и их таблицы. Совпадает с MENTIONABLE. */
const MENTION_TABLES: Record<string, string> = {
  campaign: "campaigns",
  setting: "settings",
  player: "players",
  character: "characters",
  location: "setting_locations",
  being: "setting_beings",
  community: "setting_communities",
  artifact: "artifacts",
  resource: "resources",
  mastering: "mastering_notes",
  adventure: "story_arcs",
  scene: "story_scenes",
  session: "sessions",
  compendium_entry: "compendium_entries",
  setting_event: "setting_calendar_events",
};

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

// Opens (creating if needed) the SQLite database at dbDir/app.db and brings
// it up to the current schema. Used both at startup and whenever the active
// storage profile changes, so it must be safe to run repeatedly and against
// any dbDir — no dependency on module-level state.
export function openDatabase(dbDir: string): Database.Database {
  fs.mkdirSync(dbDir, { recursive: true });
  const database = new Database(path.join(dbDir, "app.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  // 3.3 — integrity_check не блокирует старт: уходим в фон через 2с после открытия
  setTimeout(() => {
    try {
      const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
      if (row && row.integrity_check !== "ok") console.error(`[db] integrity_check: ${row.integrity_check}`);
    } catch {}
  }, 2000);

  // Migrate the old `player_characters` table (pre-characters-feature) into
  // `characters` before schema.sql creates the new table, so existing data survives.
  if (tableExists(database, "player_characters") && !tableExists(database, "characters")) {
    database.exec("ALTER TABLE player_characters RENAME TO characters");
  }

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  database.exec(schema);

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

  compactIfBloated(database);
  return database;
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

const initialDbDir = process.env.DB_DIR || path.join(__dirname, "..", "..", "data");
let current = openDatabase(initialDbDir);

// Every route file does `import { db } from "../db/db"` and calls
// `db.prepare(...)` directly. A Proxy lets us swap the underlying connection
// (see switchToDatabase) without touching any of those call sites.
export const db = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export function switchToDatabase(dbDir: string): void {
  const next = openDatabase(dbDir);
  const old = current;
  current = next;
  old.close();
}
