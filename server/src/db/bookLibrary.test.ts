import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateBookLibrary, migrateSettingWorkbookShelves } from "./bookLibrary";

function fixture() {
 const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE settings (id INTEGER PRIMARY KEY);
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
 it('removes generated setting departments and preserves books, workbook data and manually used shelves',()=>{
  const db=fixture(); try {
   migrateBookLibrary(db);
   db.exec(`
    INSERT INTO users VALUES (1);
    INSERT INTO settings VALUES (2);
    INSERT INTO library_departments (id,uid,name,legacy_key) VALUES
      (100,'generated','Мир','workbook-setting:2'), (101,'manual','Мир',NULL);
    INSERT INTO library_shelves (id,uid,name,department_id,setting_id,workbook_role) VALUES
      (100,'projects','Тетради',100,2,'projects'), (101,'campaigns','Тетради кампаний',100,2,'campaigns'),
      (102,'manual-shelf','Ручная полка',100,NULL,NULL), (103,'no-setting','Тетради',NULL,NULL,'projects');
    INSERT INTO workbook_instances (id,uid,author_user_id,template_id,title,answers_json,project_type,project_id)
      VALUES (1,'workbook',1,(SELECT min(id) FROM workbook_templates),'Заполненная тетрадь','{"note":"сохранить"}','setting',2);
    INSERT INTO library_books (id,key,source_type,source_id,department_id,shelf_id)
      VALUES (100,'workbook:workbook','workbook',1,100,100);
    UPDATE library_books SET department_id=100,shelf_id=101 WHERE key='resource:resource-uid';
    UPDATE library_books SET department_id=100,shelf_id=102 WHERE key='mastering:article-uid';
    INSERT INTO workbook_shelf_links (shelf_id,author_user_id,instance_id) VALUES (101,1,1);
    INSERT INTO library_reading_state (book_id,author_user_id,bookmarked) VALUES (100,1,1);
   `);
   migrateSettingWorkbookShelves(db);
   migrateSettingWorkbookShelves(db);
   expect(db.prepare('SELECT id FROM library_departments WHERE id>=100').all()).toEqual([{id:101}]);
   expect(db.prepare('SELECT id,department_id,setting_id,workbook_role FROM library_shelves WHERE id>=100 ORDER BY id').all()).toEqual([
    {id:101,department_id:null,setting_id:null,workbook_role:null},
    {id:102,department_id:null,setting_id:null,workbook_role:null},
    {id:103,department_id:null,setting_id:null,workbook_role:'projects'},
   ]);
   expect(db.prepare('SELECT key,department_id,shelf_id FROM library_books ORDER BY key').all()).toEqual([
    {key:'mastering:article-uid',department_id:null,shelf_id:102},
    {key:'resource:resource-uid',department_id:null,shelf_id:101},
    {key:'workbook:workbook',department_id:null,shelf_id:null},
   ]);
   expect(db.prepare('SELECT answers_json FROM workbook_instances WHERE id=1').get()).toEqual({answers_json:'{"note":"сохранить"}'});
   expect(db.prepare('SELECT instance_id FROM workbook_shelf_links WHERE shelf_id=101').get()).toEqual({instance_id:1});
   expect(db.prepare('SELECT bookmarked FROM library_reading_state WHERE book_id=100').get()).toEqual({bookmarked:1});
   expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {db.close();}
 });
});
