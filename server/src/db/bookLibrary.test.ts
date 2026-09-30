import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateBookLibrary } from "./bookLibrary";

function fixture() {
 const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY);
 CREATE TABLE mastering_sections (id INTEGER PRIMARY KEY,name TEXT,category TEXT,position INTEGER);
 CREATE TABLE mastering_notes (id INTEGER PRIMARY KEY,uid TEXT,category TEXT,section_id INTEGER,title TEXT,content TEXT,archived_at TEXT);
 CREATE TABLE resources (id INTEGER PRIMARY KEY,uid TEXT,type TEXT,category TEXT,file_path TEXT,archived_at TEXT);
 INSERT INTO mastering_sections VALUES (3,'Курс','prep',0);
 INSERT INTO mastering_notes VALUES (7,'article-uid','prep',3,'Урок','Не менять',NULL);
 INSERT INTO resources VALUES (7,'resource-uid','link','pdf','book.pdf',NULL);
 INSERT INTO resources VALUES (8,'private-uid','pdf_notes','markdown',NULL,NULL);`);
 return db;
}
describe('book library migration',()=>{
 it('keeps identity, sources and shelf mapping, distinguishes equal numeric IDs and excludes personal derivative documents',()=>{
  const db=fixture(); try {
   const articles=db.prepare('SELECT * FROM mastering_notes').all(); const resources=db.prepare('SELECT * FROM resources').all();
   migrateBookLibrary(db); migrateBookLibrary(db);
   expect(db.prepare('SELECT * FROM mastering_notes').all()).toEqual(articles); expect(db.prepare('SELECT * FROM resources').all()).toEqual(resources);
   expect(db.prepare('SELECT key FROM library_books ORDER BY id').all()).toEqual([{key:'mastering:article-uid'},{key:'resource:resource-uid'}]);
   expect(db.prepare('SELECT count(*) n FROM library_departments').get()).toEqual({n:4});
   expect(db.prepare('SELECT legacy_section_id,name FROM library_shelves').get()).toEqual({legacy_section_id:3,name:'Курс'});
   db.exec('DELETE FROM library_shelves'); db.exec('DELETE FROM library_departments'); migrateBookLibrary(db);
   expect(db.prepare('SELECT count(*) n FROM library_departments').get()).toEqual({n:0});
   expect(db.prepare('SELECT count(*) n FROM mastering_notes').get()).toEqual({n:1}); expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {db.close();}
 });
 it('registers new sources and cleans placements on source deletion while retaining archived sources',()=>{
  const db=fixture(); try {
   migrateBookLibrary(db);
   db.exec("INSERT INTO mastering_notes (id,category,title) VALUES (9,'prep','Новый'); INSERT INTO resources (id,type,category,file_path) VALUES (10,'markdown','markdown','new.md');");
   expect(db.prepare('SELECT count(*) n FROM library_books').get()).toEqual({n:4});
   expect((db.prepare('SELECT uid FROM mastering_notes WHERE id=9').get() as {uid:string}).uid).toMatch(/^[0-9a-f-]{36}$/);
   db.exec("UPDATE mastering_notes SET archived_at='now' WHERE id=9"); expect(db.prepare("SELECT count(*) n FROM library_books WHERE source_id=9").get()).toEqual({n:1});
   db.exec('DELETE FROM mastering_notes WHERE id=9; DELETE FROM resources WHERE id=10'); expect(db.prepare('SELECT count(*) n FROM library_books').get()).toEqual({n:2});
  } finally {db.close();}
 });
});
