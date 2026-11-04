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

/** A shelf is addressed by setting + role, never by its displayed name. */
function shelf(database:Database.Database,settingId:number|null,role:"projects"|"campaigns") {
 let department:number|null=null;
 if(settingId){
  const setting=database.prepare('SELECT name FROM settings WHERE id=?').get(settingId) as {name:string}|undefined;
  if(!setting)throw new Error("Сеттинг не найден");
  const key=`workbook-setting:${settingId}`;
  database.prepare('INSERT OR IGNORE INTO library_departments(uid,name,legacy_key,position) VALUES(?,?,?,(SELECT coalesce(max(position),-1)+1 FROM library_departments))').run(randomUUID(),setting.name,key);
  const row=database.prepare('SELECT id FROM library_departments WHERE legacy_key=?').get(key) as {id:number};
  department=row.id;
  database.prepare('UPDATE library_departments SET name=? WHERE id=?').run(setting.name,department);
 }
 const found=database.prepare('SELECT id FROM library_shelves WHERE setting_id IS ? AND workbook_role=? AND (? IS NOT NULL OR department_id IS NULL)').get(settingId,role,settingId) as {id:number}|undefined;
 if(found)return found.id;
 return Number(database.prepare('INSERT INTO library_shelves(uid,name,department_id,setting_id,workbook_role,position) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),role==="campaigns"?"Тетради кампаний":"Тетради",department,settingId,role,role==="campaigns"?1:0).lastInsertRowid);
}

export function placeProjectWorkbooks(database:Database.Database,type:WorkbookProject,id:number) {
 const row=project(database,type,id),sid=type==="setting"?id:row.setting_id??null;
 if(type==="setting")database.prepare('UPDATE library_departments SET name=? WHERE legacy_key=?').run(row.name,`workbook-setting:${id}`);
 if(!database.prepare('SELECT id FROM workbook_instances WHERE project_type=? AND project_id=? LIMIT 1').get(type,id))return null;
 const shelfId=shelf(database,sid,type==="campaign"?"campaigns":"projects");
 const selected=database.prepare('SELECT department_id FROM library_shelves WHERE id=?').get(shelfId) as {department_id:number|null};
 database.prepare(`UPDATE library_books SET shelf_id=?,department_id=? WHERE source_type='workbook' AND source_id IN
  (SELECT id FROM workbook_instances WHERE project_type=? AND project_id=?)`).run(shelfId,selected.department_id,type,id);
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
