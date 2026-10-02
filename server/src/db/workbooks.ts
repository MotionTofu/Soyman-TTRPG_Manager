import type Database from "better-sqlite3";
export function migrateWorkbooks(db:Database.Database){db.exec(`
 CREATE TABLE IF NOT EXISTS workbook_templates (
  id INTEGER PRIMARY KEY, template_key TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
  title TEXT NOT NULL, archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(template_key,version)
 );
 CREATE TABLE IF NOT EXISTS workbook_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,uid TEXT NOT NULL UNIQUE,author_user_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER NOT NULL REFERENCES workbook_templates(id),title TEXT NOT NULL,answers_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1, project_type TEXT,project_id INTEGER,archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
 );
 CREATE TABLE IF NOT EXISTS workbook_book_links (
  book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,template_key TEXT NOT NULL,sheet_key TEXT,
  PRIMARY KEY(book_id,template_key)
 );
 CREATE TABLE IF NOT EXISTS workbook_book_selection (
  book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,author_user_id INTEGER NOT NULL REFERENCES users(id),
  template_key TEXT NOT NULL,instance_id INTEGER REFERENCES workbook_instances(id) ON DELETE SET NULL,sheet_key TEXT,
  PRIMARY KEY(book_id,author_user_id,template_key)
 );
 CREATE TRIGGER IF NOT EXISTS library_delete_workbook AFTER DELETE ON workbook_instances
 BEGIN DELETE FROM library_books WHERE source_type='workbook' AND source_id=OLD.id; END;
 `);
 const columns=db.prepare('PRAGMA table_info(workbook_book_selection)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='sheet_key'))db.exec(`ALTER TABLE workbook_book_selection ADD COLUMN sheet_key TEXT;
 UPDATE workbook_book_selection SET sheet_key=(SELECT l.sheet_key FROM workbook_book_links l WHERE l.book_id=workbook_book_selection.book_id AND l.template_key=workbook_book_selection.template_key);`);
 // Тетрадь полки: открывается у края читалки у книг полки без своей связи. Личная, как выбор у книги.
 db.exec(`CREATE TABLE IF NOT EXISTS workbook_shelf_links (
  shelf_id INTEGER NOT NULL REFERENCES library_shelves(id) ON DELETE CASCADE,author_user_id INTEGER NOT NULL REFERENCES users(id),
  instance_id INTEGER NOT NULL REFERENCES workbook_instances(id) ON DELETE CASCADE,PRIMARY KEY(shelf_id,author_user_id)
 );`);
}
