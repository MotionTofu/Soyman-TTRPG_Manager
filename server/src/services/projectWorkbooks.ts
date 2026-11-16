import type Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import {ADVENTURE_WORKBOOK,CAMPAIGN_WORKBOOK,SETTING_WORKBOOK} from "@soyman/shared";
import {registerPracticalTemplate} from "../db/workbooks";
import {requireKind} from "../db/entityKinds";

export type WorkbookProject="setting"|"adventure"|"campaign";
// Таблицы проектов — из реестра видов, своей карты не держим (entityKindsNoCopies.test).
const PROJECT_KINDS:readonly WorkbookProject[]=["setting","adventure","campaign"];
const tables=Object.fromEntries(PROJECT_KINDS.map(k=>[k,requireKind(k).table])) as Record<WorkbookProject,string>;
/** Таблица проекта тетради по виду; чужой вид (в т.ч. «constructor») — undefined. */
export function projectTable(type:string|null|undefined):string|undefined{return type&&Object.hasOwn(tables,type)?tables[type as WorkbookProject]:undefined;}
const templates={setting:SETTING_WORKBOOK,adventure:ADVENTURE_WORKBOOK,campaign:CAMPAIGN_WORKBOOK};

function project(database:Database.Database,type:WorkbookProject,id:number) {
 const row=database.prepare(`SELECT * FROM ${tables[type]} WHERE id=? AND archived_at IS NULL`).get(id) as {id:number;name:string;setting_id?:number|null;is_default?:number}|undefined;
 if(!row||row.is_default)throw new Error("Проект не найден");
 return row;
}

function shelfWithoutSetting(database:Database.Database,role:"projects"|"campaigns") {
 const found=database.prepare('SELECT id FROM library_shelves WHERE setting_id IS NULL AND department_id IS NULL AND workbook_role=?').get(role) as {id:number}|undefined;
 if(found)return found.id;
 return Number(database.prepare('INSERT INTO library_shelves(uid,name,workbook_role,position) VALUES(?,?,?,?)')
  .run(randomUUID(),role==="campaigns"?"Тетради кампаний":"Тетради",role,role==="campaigns"?1:0).lastInsertRowid);
}

export function placeProjectWorkbooks(database:Database.Database,type:WorkbookProject,id:number) {
 const row=project(database,type,id),sid=type==="setting"?id:row.setting_id??null;
 // Полки сеттингов во вкладке «Тетради» собираются по связям проектов.
 if(sid!==null){
  database.prepare(`UPDATE library_books SET shelf_id=NULL,department_id=NULL WHERE source_type='workbook'
   AND shelf_id IN (SELECT id FROM library_shelves WHERE workbook_role IS NOT NULL)
   AND source_id IN (SELECT id FROM workbook_instances WHERE project_type=? AND project_id=?)`).run(type,id);
  return null;
 }
 if(!database.prepare('SELECT id FROM workbook_instances WHERE project_type=? AND project_id=? LIMIT 1').get(type,id))return null;
 const shelfId=shelfWithoutSetting(database,type==="campaign"?"campaigns":"projects");
 database.prepare(`UPDATE library_books SET shelf_id=?,department_id=NULL WHERE source_type='workbook' AND source_id IN
  (SELECT id FROM workbook_instances WHERE project_type=? AND project_id=?)`).run(shelfId,type,id);
 return shelfId;
}

/** Idempotent per author. Existing linked notebooks keep their version and answers. */
export function ensureProjectWorkbook(database:Database.Database,author:number,type:WorkbookProject,id:number) {
 return database.transaction(()=>{
  const row=project(database,type,id);
  const existing=database.prepare('SELECT id FROM workbook_instances WHERE author_user_id=? AND project_type=? AND project_id=? AND archived_at IS NULL ORDER BY id LIMIT 1').get(author,type,id) as {id:number}|undefined;
  let instanceId=existing?.id;
  if(!instanceId){
   const template=templates[type];
   // Архив скрывает шаблон из ручного выбора, но не ломает создание проекта.
   const templateId=registerPracticalTemplate(database,template);
   const uid=randomUUID();
   instanceId=Number(database.prepare('INSERT INTO workbook_instances(uid,author_user_id,template_id,title,project_type,project_id) VALUES(?,?,?,?,?,?)')
    .run(uid,author,templateId,`Тетрадь · ${row.name}`,type,id).lastInsertRowid);
   database.prepare("INSERT INTO library_books(key,source_type,source_id) VALUES(?,'workbook',?)").run(`workbook:${uid}`,instanceId);
  }
  placeProjectWorkbooks(database,type,id);
  return instanceId;
 })();
}
