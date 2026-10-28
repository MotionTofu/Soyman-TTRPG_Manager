import type Database from "better-sqlite3";

/** Independent immutable file versions; application holds, rather than hardlink counts, own lifetime. */
export function migrateCutsceneMedia(database: Database.Database): void {
  database.transaction(() => database.exec(`
    CREATE TABLE IF NOT EXISTS cutscene_media (
      id TEXT PRIMARY KEY,
      cutscene_id INTEGER NOT NULL REFERENCES cutscenes(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
      file_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      duration_seconds REAL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'ready')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cutscene_media_original ON cutscene_media(cutscene_id);
    CREATE TABLE IF NOT EXISTS cutscene_media_holds (
      holder_kind TEXT NOT NULL CHECK (holder_kind IN ('original', 'staging', 'snapshot', 'frame', 'music')),
      holder_key TEXT NOT NULL,
      media_id TEXT NOT NULL REFERENCES cutscene_media(id) ON DELETE RESTRICT,
      PRIMARY KEY (holder_kind, holder_key, media_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cutscene_media_holds_file ON cutscene_media_holds(media_id);
  `))();
}
