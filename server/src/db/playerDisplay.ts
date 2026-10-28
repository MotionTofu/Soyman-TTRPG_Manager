import type Database from "better-sqlite3";

export function migratePlayerDisplay(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS player_display_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT,
    owner TEXT,
    transition TEXT,
    revision INTEGER NOT NULL DEFAULT 0
  )`);
  // Also permits resuming a partially implemented development stand.
  if (!(database.prepare("PRAGMA table_info(player_display_state)").all() as { name: string }[]).some(c => c.name === "transition")) {
    database.exec("ALTER TABLE player_display_state ADD COLUMN transition TEXT");
  }
}
