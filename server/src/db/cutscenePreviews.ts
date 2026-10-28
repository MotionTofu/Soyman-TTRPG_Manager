import type Database from "better-sqlite3";

/** Temporary ownership/return data, intentionally separate from immutable run history. */
export function migrateCutscenePreviews(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS cutscene_preview_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    cutscene_id INTEGER NOT NULL REFERENCES cutscenes(id) ON DELETE RESTRICT,
    state TEXT NOT NULL
  )`);
}
export function hasCutscenePreview(database: Database.Database): boolean {
  return !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cutscene_preview_state'").get()
    && !!database.prepare("SELECT 1 FROM cutscene_preview_state WHERE id=1").get();
}
