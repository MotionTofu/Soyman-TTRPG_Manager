import type Database from "better-sqlite3";

// Последний шаг migrateDatabase, после миграций ресурсов. Импорт модуля
// сам по себе не открывает и не меняет базу.
export const SOUND_FOLDERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sound_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('background', 'ambient', 'weather', 'stinger')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
);
CREATE TABLE IF NOT EXISTS sound_folder_items (
  resource_id INTEGER PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES sound_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sound_folders_role ON sound_folders(role);
CREATE INDEX IF NOT EXISTS idx_sound_folder_items_folder ON sound_folder_items(folder_id);
`;

export function migrateSoundFolders(database: Database.Database): void {
  database.exec(SOUND_FOLDERS_SCHEMA);
}

export function soundFoldersReady(database: Database.Database): boolean {
  const row = database.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('sound_folders', 'sound_folder_items')"
  ).get() as { n: number };
  return row.n === 2;
}

export function soundFolderIds(database: Database.Database): Map<number, number> {
  if (!soundFoldersReady(database)) return new Map();
  const rows = database.prepare(`
    SELECT i.resource_id, i.folder_id FROM sound_folder_items i
    JOIN sound_folders f ON f.id = i.folder_id
    JOIN resources r ON r.id = i.resource_id AND r.audio_role = f.role
  `).all() as { resource_id: number; folder_id: number }[];
  return new Map(rows.map((row) => [row.resource_id, row.folder_id]));
}
