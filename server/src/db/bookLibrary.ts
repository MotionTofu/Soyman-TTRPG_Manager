import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {migrateWorkbooks} from "./workbooks";

export const BOOK_LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS library_departments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 position INTEGER NOT NULL DEFAULT 0, legacy_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS library_shelves (
 id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 department_id INTEGER REFERENCES library_departments(id) ON DELETE SET NULL,
 legacy_section_id INTEGER UNIQUE REFERENCES mastering_sections(id) ON DELETE SET NULL,
 position INTEGER NOT NULL DEFAULT 0, descending INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS library_books (
 id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
 source_type TEXT NOT NULL CHECK(source_type IN ('mastering','resource','workbook')), source_id INTEGER NOT NULL,
 department_id INTEGER REFERENCES library_departments(id) ON DELETE SET NULL,
 shelf_id INTEGER REFERENCES library_shelves(id) ON DELETE SET NULL,
 cover_image TEXT, UNIQUE(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS library_reading_state (
 book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
 author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bookmarked INTEGER NOT NULL DEFAULT 0, position_json TEXT NOT NULL DEFAULT '{}',
 mode TEXT NOT NULL DEFAULT 'reading', last_opened TEXT,
 PRIMARY KEY(book_id,author_user_id)
);
CREATE TABLE IF NOT EXISTS library_annotations (
 id TEXT PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 quote TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, anchor_json TEXT,
 context_before TEXT NOT NULL DEFAULT '', context_after TEXT NOT NULL DEFAULT '', content_sha256 TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS library_books_shelf ON library_books(shelf_id);
CREATE TABLE IF NOT EXISTS library_article_summary (
 source_id INTEGER PRIMARY KEY REFERENCES mastering_notes(id) ON DELETE CASCADE,
 cover_image TEXT,reading_minutes INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS library_invalidate_article_summary AFTER UPDATE OF content,cover_image ON mastering_notes
BEGIN DELETE FROM library_article_summary WHERE source_id=NEW.id; END;
CREATE INDEX IF NOT EXISTS library_annotations_author ON library_annotations(resource_id,author_user_id);
CREATE TRIGGER IF NOT EXISTS library_delete_article AFTER DELETE ON mastering_notes
BEGIN DELETE FROM library_books WHERE source_type='mastering' AND source_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS library_delete_resource AFTER DELETE ON resources
BEGIN DELETE FROM library_books WHERE source_type='resource' AND source_id=OLD.id; END;
`;

const GENERATED_UID = "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))";
const SOURCE_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS library_add_article AFTER INSERT ON mastering_notes BEGIN
 UPDATE mastering_notes SET uid=coalesce(uid,${GENERATED_UID}) WHERE id=NEW.id;
 INSERT OR IGNORE INTO library_books (key,source_type,source_id,department_id,shelf_id)
 SELECT 'mastering:'||m.uid,'mastering',m.id,d.id,s.id FROM mastering_notes m
 LEFT JOIN library_departments d ON d.legacy_key=m.category
 LEFT JOIN library_shelves s ON s.legacy_section_id=m.section_id WHERE m.id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS library_add_resource AFTER INSERT ON resources
WHEN NEW.type <> 'pdf_notes' AND (NEW.category IN ('pdf','markdown') OR NEW.type='markdown' OR lower(NEW.file_path) LIKE '%.pdf' OR lower(NEW.file_path) LIKE '%.md') BEGIN
 UPDATE resources SET uid=coalesce(uid,${GENERATED_UID}) WHERE id=NEW.id;
 INSERT OR IGNORE INTO library_books (key,source_type,source_id,department_id)
 SELECT 'resource:'||uid,'resource',id,(SELECT id FROM library_departments WHERE legacy_key='resources') FROM resources WHERE id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS library_article_uid AFTER UPDATE OF uid ON mastering_notes BEGIN
 UPDATE library_books SET key='mastering:'||NEW.uid WHERE source_type='mastering' AND source_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS library_resource_uid AFTER UPDATE OF uid ON resources BEGIN
 UPDATE library_books SET key='resource:'||NEW.uid WHERE source_type='resource' AND source_id=NEW.id;
END;
`;

type Source = { id: number; uid: string | null; category?: string; section_id?: number | null };

/** Register newly created sources without reassigning books the user moved. */
export function registerLibrarySources(db: Database.Database): void {
  const departments = db.prepare("SELECT id, legacy_key FROM library_departments").all() as { id: number; legacy_key: string }[];
  const department = new Map(departments.map(row => [row.legacy_key, row.id]));
  const shelves = db.prepare("SELECT id, legacy_section_id FROM library_shelves").all() as { id: number; legacy_section_id: number }[];
  const shelf = new Map(shelves.map(row => [row.legacy_section_id, row.id]));
  const insert = db.prepare("INSERT OR IGNORE INTO library_books (key,source_type,source_id,department_id,shelf_id) VALUES (?,?,?,?,?)");
  for (const row of db.prepare("SELECT id,uid,category,section_id FROM mastering_notes").all() as Source[]) {
    const uid = row.uid || randomUUID();
    if (!row.uid) db.prepare("UPDATE mastering_notes SET uid=? WHERE id=?").run(uid,row.id);
    insert.run(`mastering:${uid}`, "mastering", row.id, department.get(row.category!) ?? null, shelf.get(row.section_id!) ?? null);
  }
  for (const row of db.prepare("SELECT id,uid FROM resources WHERE type <> 'pdf_notes' AND (category IN ('pdf','markdown') OR type='markdown' OR lower(file_path) LIKE '%.pdf' OR lower(file_path) LIKE '%.md')").all() as Source[]) {
    const uid = row.uid || randomUUID();
    if (!row.uid) db.prepare("UPDATE resources SET uid=? WHERE id=?").run(uid,row.id);
    insert.run(`resource:${uid}`, "resource", row.id, department.get("resources") ?? null, null);
  }
}

/** Additive, idempotent migration; accepts a copy instead of the app singleton. */
export function migrateBookLibrary(db: Database.Database): void {
  db.transaction(() => {
    db.exec(BOOK_LIBRARY_SCHEMA);
    migrateWorkbooks(db);
    if (!db.prepare("SELECT value FROM app_settings WHERE key='book_library_initialized'").get()) {
      const insert = db.prepare("INSERT INTO library_departments (uid,name,position,legacy_key) VALUES (?,?,?,?)");
      const categories = [["prep","Подготовка"],["live","Во время игры"],["knowledge","База знаний"],["resources","Из ресурсов"]];
      categories.forEach(([key,name],position) => insert.run(randomUUID(),name,position,key));
      const departments = db.prepare("SELECT id, legacy_key FROM library_departments").all() as { id: number; legacy_key: string }[];
      const department = new Map(departments.map(row => [row.legacy_key,row.id]));
      const insertShelf = db.prepare("INSERT INTO library_shelves (uid,name,department_id,legacy_section_id,position) VALUES (?,?,?,?,?)");
      for (const row of db.prepare("SELECT id,name,category,position FROM mastering_sections").all() as { id: number; name: string; category: string; position: number }[]) insertShelf.run(randomUUID(),row.name,department.get(row.category) ?? null,row.id,row.position);
      db.prepare("INSERT INTO app_settings (key,value) VALUES ('book_library_initialized','1')").run();
    }
    registerLibrarySources(db);
    db.exec(SOURCE_TRIGGERS);
  })();
}
