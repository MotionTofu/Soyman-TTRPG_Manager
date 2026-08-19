import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { systemFolder } from "../services/filesystem";

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

function columnIsNotNull(database: Database.Database, table: string, column: string): boolean {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
  }[];
  return cols.some((c) => c.name === column && c.notnull === 1);
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
  if (process.env.SEED_DEFAULT_SYSTEMS !== "false") {
    const seedSystems = database.prepare("INSERT OR IGNORE INTO systems (name) VALUES (?)");
    for (const name of ["D&D 5.5", "Legend in the Mist", "City of Mist", "Daggerheart"]) {
      seedSystems.run(name);
    }
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

  // Marks the seeded admin/admin account (see services/auth.ts
  // bootstrapAdminAccount) — the only account allowed to change other
  // accounts' role, independent of its own role column (which stays 'gm' so
  // it also has normal GM access everywhere else).
  if (!columnExists(database, "users", "is_admin")) {
    database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
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
      setting_id INTEGER NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      source_scene_id INTEGER REFERENCES story_scenes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'scene',
      summary TEXT NOT NULL DEFAULT '',
      read_aloud TEXT NOT NULL DEFAULT '',
      whats_happening TEXT NOT NULL DEFAULT '',
      entry_condition TEXT NOT NULL DEFAULT '',
      outcomes TEXT NOT NULL DEFAULT '',
      hidden_from_players INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      canvas_x REAL,
      canvas_y REAL,
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

  compactIfBloated(database);
  return database;
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
