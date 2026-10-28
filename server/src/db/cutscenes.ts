import type Database from "better-sqlite3";

/** Also declared in schema.sql; appended migration for installations predating cutscenes. */
export function migrateCutscenes(database: Database.Database): void {
  database.transaction(() => database.exec(`
    CREATE TABLE IF NOT EXISTS cutscenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT NOT NULL DEFAULT '',
      document TEXT NOT NULL,
      saved_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS campaign_cutscenes (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      cutscene_id INTEGER NOT NULL REFERENCES cutscenes(id) ON DELETE RESTRICT,
      PRIMARY KEY (campaign_id, cutscene_id)
    );
    CREATE TABLE IF NOT EXISTS session_cutscenes (
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      cutscene_id INTEGER NOT NULL REFERENCES cutscenes(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (session_id, cutscene_id),
      UNIQUE (session_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_cutscenes_original ON campaign_cutscenes(cutscene_id);
    CREATE INDEX IF NOT EXISTS idx_session_cutscenes_original ON session_cutscenes(cutscene_id);
    CREATE INDEX IF NOT EXISTS idx_cutscenes_updated ON cutscenes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_cutscenes_archived ON cutscenes(archived_at);
  `))();
}
