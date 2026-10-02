import {Router} from "express";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "../db/db";
import {requireAuth,type AuthedRequest} from "../services/auth";
import {validateWorkbookTemplate,validateWorkbookAnswers,workbookMarkdown,parseWorkbookMarkdown,suggestWorkbookMapping,convertAnswer,FORMER_LABELS,WORKBOOK_NOTES,workbookProgress,type WorkbookTemplate,type WorkbookAnswers,type WorkbookField} from "@soyman/shared";
export const workbooksRouter=Router();workbooksRouter.use(requireAuth("gm"));
type Instance={id:number;uid:string;author_user_id:number;template_id:number;title:string;answers_json:string;revision:number;project_type:string|null;project_id:number|null;archived_at:string|null;[key:string]:unknown};
function definition(id:number){const row=db.prepare('SELECT definition_json FROM workbook_templates WHERE id=?').get(id) as {definition_json:string}|undefined;return row?JSON.parse(row.definition_json) as WorkbookTemplate:null;}
/** Шаблон из Markdown курса: ключ — из комментария, иначе от шаблона с тем же названием; версия — следующая, если текст изменился. */
function fromMarkdown(markdown:unknown){
 if(typeof markdown!=="string"||markdown.length>1_000_000)throw new Error("Файл шаблона должен быть текстом до 1 МБ");
 const {template,explicit}=parseWorkbookMarkdown(markdown);
 if(!explicit.key){const same=db.prepare('SELECT template_key FROM workbook_templates WHERE title=? ORDER BY id DESC LIMIT 1').get(template.title) as {template_key:string}|undefined;if(same)template.key=same.template_key;}
 if(!explicit.version){const latest=db.prepare('SELECT version,definition_json FROM workbook_templates WHERE template_key=? ORDER BY version DESC LIMIT 1').get(template.key) as {version:number;definition_json:string}|undefined;
  if(latest){const prev=JSON.parse(latest.definition_json) as WorkbookTemplate;template.version=JSON.stringify({...prev,version:0})===JSON.stringify({...template,version:0})?latest.version:latest.version+1;}}
 return template;
}
function templateImport(raw:unknown){const input=raw&&typeof raw==="object"&&"markdown" in raw?fromMarkdown((raw as {markdown:unknown}).markdown):raw;validateWorkbookTemplate(input);const existing=db.prepare('SELECT id,definition_json FROM workbook_templates WHERE template_key=? AND version=?').get(input.key,input.version) as {id:number;definition_json:string}|undefined;
 if(existing){if(JSON.stringify(JSON.parse(existing.definition_json))!==JSON.stringify(input))throw new Error("Эта версия уже существует с другим содержимым. Увеличьте номер версии.");return existing.id;}
 return Number(db.prepare('INSERT INTO workbook_templates(template_key,version,title,definition_json) VALUES(?,?,?,?)').run(input.key,input.version,input.title,JSON.stringify(input)).lastInsertRowid);}
function instance(req:AuthedRequest){return db.prepare('SELECT * FROM workbook_instances WHERE id=? AND author_user_id=?').get(req.params.id,req.user!.id) as Instance|undefined;}
function present(row:Instance){const {answers_json,...fields}=row;return {...fields,answers:JSON.parse(answers_json),template:definition(row.template_id)};}
const projectSchema=z.object({project_type:z.enum(['campaign','setting','adventure']).nullable().optional(),project_id:z.number().int().positive().nullable().optional()});
const projectTables:Record<string,string>={campaign:'campaigns',setting:'settings',adventure:'story_arcs'};
function validProject(type:string|null|undefined,id:number|null|undefined){if(!type&&!id)return true;if(!type||!id)return false;const table={campaign:'campaigns',setting:'settings',adventure:'story_arcs'}[type];return !!table&&!!db.prepare(`SELECT id FROM ${table} WHERE id=? AND archived_at IS NULL`).get(id);}
workbooksRouter.get('/projects/:type',(req,res)=>{const table={campaign:'campaigns',setting:'settings',adventure:'story_arcs'}[req.params.type];if(!table)return res.status(400).json({error:'Неизвестный вид проекта'});res.json(db.prepare(`SELECT id,name FROM ${table} WHERE archived_at IS NULL ORDER BY name`).all());});
function insertInstance(author:number,templateId:number,title:string,answers:WorkbookAnswers={},uid=randomUUID(),projectType:string|null=null,projectId:number|null=null){
 return db.transaction(()=>{const id=Number(db.prepare('INSERT INTO workbook_instances(uid,author_user_id,template_id,title,answers_json,project_type,project_id) VALUES(?,?,?,?,?,?,?)').run(uid,author,templateId,title,JSON.stringify(answers),projectType,projectId).lastInsertRowid);
 db.prepare("INSERT INTO library_books(key,source_type,source_id) VALUES(?,'workbook',?)").run(`workbook:${uid}`,id);return id;})();}
workbooksRouter.get('/templates',(_req,res)=>res.json(db.prepare('SELECT id,template_key,version,title,archived_at FROM workbook_templates ORDER BY title,version DESC').all()));
workbooksRouter.get('/templates/:id',(req,res)=>{const t=definition(Number(req.params.id));return t?res.json(t):res.status(404).json({error:'Шаблон не найден'});});
workbooksRouter.post('/templates',(req,res)=>{try{const id=templateImport(req.body);res.status(201).json({id,template:definition(id)});}catch(e){res.status(400).json({error:(e as Error).message});}});
workbooksRouter.put('/templates/:id/archive',(req,res)=>{db.prepare('UPDATE workbook_templates SET archived_at=? WHERE id=?').run(req.body.archived?new Date().toISOString():null,req.params.id);res.json({ok:true});});
workbooksRouter.get('/instances',(req:AuthedRequest,res)=>{
 let rows=db.prepare('SELECT * FROM workbook_instances WHERE author_user_id=? ORDER BY updated_at DESC,id DESC').all(req.user!.id) as Instance[];
 rows=rows.filter(row=>req.query.archived==='1'?!!row.archived_at:!row.archived_at);
 if(req.query.template)rows=rows.filter(row=>definition(row.template_id)?.key===req.query.template);
 if(req.query.project_type)rows=rows.filter(row=>row.project_type===req.query.project_type&&row.project_id===Number(req.query.project_id));
 res.json(rows.map(row=>{const {answers_json,...summary}=row,t=definition(row.template_id);return {...summary,template_title:t?.title,template_version:t?.version,sheets:t?.sheets.length??0,progress:t?workbookProgress(t,JSON.parse(answers_json)):{total:0,filled:0}};}));
});
workbooksRouter.post('/instances',(req:AuthedRequest,res)=>{
 const parsed=projectSchema.extend({template_id:z.number().int().positive(),title:z.string().trim().min(1).max(500)}).safeParse(req.body);
 if(!parsed.success||!validProject(parsed.data.project_type,parsed.data.project_id))return res.status(400).json({error:'Проверьте шаблон, название и проект'});
 const p=parsed.data;if(!definition(p.template_id))return res.status(404).json({error:'Шаблон не найден'});
 const id=insertInstance(req.user!.id,p.template_id,p.title,{},undefined,p.project_type??null,p.project_id??null);req.params.id=String(id);res.status(201).json(present(instance(req)!));
});
workbooksRouter.get('/instances/:id',(req:AuthedRequest,res)=>{const row=instance(req);return row?res.json(present(row)):res.status(404).json({error:'Тетрадь не найдена'});});
// «Записи к листу»: заметки автора в книгах, которые он связал с листами этой тетради. Ссылка, а не копия.
workbooksRouter.get('/instances/:id/notes',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});
 const user=req.user!.id;
 res.json(db.prepare(`SELECT a.id,s.sheet_key,b.id book_id,m.title book_title,a.quote,a.body,a.created_at created_at FROM workbook_book_selection s JOIN library_books b ON b.id=s.book_id AND b.source_type='mastering' JOIN mastering_notes m ON m.id=b.source_id JOIN mastering_annotations a ON a.book_id=m.id AND a.author_user_id=s.author_user_id WHERE s.instance_id=? AND s.author_user_id=?
 UNION ALL SELECT a.id,s.sheet_key,b.id,r.name,a.quote,a.body,a.created_at FROM workbook_book_selection s JOIN library_books b ON b.id=s.book_id AND b.source_type='resource' JOIN resources r ON r.id=b.source_id JOIN library_annotations a ON a.resource_id=r.id AND a.author_user_id=s.author_user_id WHERE s.instance_id=? AND s.author_user_id=? ORDER BY created_at`).all(row.id,user,row.id,user));
});
workbooksRouter.put('/instances/:id',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});
 const p=projectSchema.extend({revision:z.number().int().positive(),title:z.string().trim().min(1).max(500).optional(),answers:z.unknown().optional(),archived:z.boolean().optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Некорректные ответы'});if(p.data.revision!==row.revision)return res.status(409).json({error:'Тетрадь изменена в другом окне. Ваш ввод сохранён в окне; выберите способ объединения.',current:present(row)});
 if(row.archived_at&&p.data.answers!==undefined)return res.status(400).json({error:'Сначала восстановите тетрадь из архива'});
 const d=p.data,projectType=Object.hasOwn(d,'project_type')?d.project_type:row.project_type,projectId=Object.hasOwn(d,'project_id')?d.project_id:row.project_id;
 if((Object.hasOwn(d,'project_type')||Object.hasOwn(d,'project_id'))&&!validProject(projectType,projectId))return res.status(400).json({error:'Проект не найден'});
 const answers=d.answers??JSON.parse(row.answers_json);try{validateWorkbookAnswers(definition(row.template_id)!,answers);}catch(e){return res.status(400).json({error:(e as Error).message});}
 const updated=db.prepare('UPDATE workbook_instances SET answers_json=?,title=?,project_type=?,project_id=?,archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(answers),d.title??row.title,projectType??null,projectId??null,d.archived===undefined?row.archived_at:d.archived?new Date().toISOString():null,new Date().toISOString(),row.id,d.revision);
 if(!updated.changes)return res.status(409).json({error:'Тетрадь изменилась, перечитайте её'});res.json(present(instance(req)!));
});
// «Старые заметки» кампании → записи листа (спека campaign-paper, Q32/Q36).
// Одной транзакцией: записи встают в лист, заметки кампании удаляются. Без
// entry_ids — все заметки Мастера этой кампании.
workbooksRouter.post('/instances/:id/campaign-notes',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});
 if(row.archived_at)return res.status(400).json({error:'Сначала восстановите тетрадь из архива'});
 const p=z.object({campaign_id:z.number().int().positive(),sheet_key:z.string().min(1),entry_ids:z.array(z.number().int().positive()).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Нужны кампания и лист'});
 const t=definition(row.template_id);if(!t?.sheets.some(s=>s.key===p.data.sheet_key))return res.status(400).json({error:'В тетради нет такого листа'});
 const ids=p.data.entry_ids;
 const entries=db.prepare(`SELECT id,title,content,created_at FROM campaign_entries WHERE campaign_id=? AND category='gm_notes'${ids?` AND id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY created_at,id`).all(p.data.campaign_id,...(ids??[])) as {id:number;title:string|null;content:string|null;created_at:string}[];
 if(!entries.length)return res.status(400).json({error:'Переносить нечего'});
 const answers=JSON.parse(row.answers_json) as WorkbookAnswers;
 const notes={...((answers[WORKBOOK_NOTES]??{}) as Record<string,unknown>)};
 const list=Array.isArray(notes[p.data.sheet_key])?[...(notes[p.data.sheet_key] as unknown[])]:[];
 for(const e of entries){const body=[e.title?.trim(),e.content?.trim()].filter(Boolean).join('\n\n');if(body)list.push({id:randomUUID(),body,at:new Date(e.created_at.replace(' ','T')+'Z').toISOString()});}
 notes[p.data.sheet_key]=list;const next={...answers,[WORKBOOK_NOTES]:notes};
 db.transaction(()=>{
  db.prepare('UPDATE workbook_instances SET answers_json=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(next),new Date().toISOString(),row.id);
  const del=db.prepare('DELETE FROM campaign_entries WHERE id=?');for(const e of entries)del.run(e.id);
 })();
 res.json({moved:entries.length,instance:present(instance(req)!)});
});
workbooksRouter.post('/instances/:id/upgrade',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});
 const p=z.object({revision:z.number().int().positive(),template_id:z.number().int().positive(),mapping:z.record(z.string(),z.string()).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Некорректное сопоставление'});if(p.data.revision!==row.revision)return res.status(409).json({error:'Тетрадь изменилась в другом окне'});
 const old=definition(row.template_id)!,next=definition(p.data.template_id);if(!next||old.key!==next.key)return res.status(400).json({error:'Выберите другую версию этого шаблона'});
 const answers=JSON.parse(row.answers_json) as WorkbookAnswers,mapping=p.data.mapping??suggestWorkbookMapping(old,next,answers);
 const fields=new Map<string,WorkbookField>(next.sheets.flatMap(s=>s.fields.map(f=>[`${s.key}/${f.key}`,f] as const)));
 // Перенос, а не копия: ответ переезжает в новую графу; без пары остаётся на месте «прежней графой» со своей подписью.
 const moved=new Set<string>(),labels={...(answers[FORMER_LABELS]??{})} as Record<string,unknown>;
 for(const [from,to] of Object.entries(mapping)){const [s,f]=from.split('/'),[ns,nf]=to.split('/'),field=fields.get(to);if(!field||dangerousPath(s)||dangerousPath(f))return res.status(400).json({error:'Неизвестное поле сопоставления'});if(answers[s]?.[f]===undefined)continue;
  const value=convertAnswer(field,answers[s][f]);if(value===undefined)return res.status(400).json({error:`Ответ не подходит графе «${field.label}»`});
  answers[ns]??={};if(answers[ns][nf]!==undefined&&from!==to&&!moved.has(to))return res.status(400).json({error:'В новом поле уже есть ответ'});answers[ns][nf]=value;moved.add(to);if(from!==to&&!moved.has(from))delete answers[s][f];}
 for(const sheet of old.sheets)for(const field of sheet.fields){const path=`${sheet.key}/${field.key}`;{const v=answers[sheet.key]?.[field.key];if(v!=null&&v!==""&&(!Array.isArray(v)||v.length)&&!fields.has(path))labels[path]=`${sheet.title} · ${field.label}`;}}
 if(Object.keys(labels).length)answers[FORMER_LABELS]=labels;
 const sheetMap=new Map<string,string>();for(const sheet of old.sheets){const to=next.sheets.find(s=>s.key===sheet.key)??next.sheets.find(s=>s.title===sheet.title);if(to)sheetMap.set(sheet.key,to.key);}
 // Свои записи листа едут вместе с листом; лист исчез — на первый лист.
 const notes=answers[WORKBOOK_NOTES] as Record<string,unknown[]>|undefined;if(notes){const out:Record<string,unknown[]>={};for(const [k,list] of Object.entries(notes)){if(!Array.isArray(list))continue;const to=sheetMap.get(k)??(next.sheets.some(s=>s.key===k)?k:next.sheets[0].key);out[to]=[...(out[to]??[]),...list];}answers[WORKBOOK_NOTES]=out;}
 try{validateWorkbookAnswers(next,answers);}catch(e){return res.status(400).json({error:(e as Error).message});}
 db.transaction(()=>{db.prepare('UPDATE workbook_instances SET template_id=?,answers_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(p.data.template_id,JSON.stringify(answers),new Date().toISOString(),row.id,row.revision);
  // Книги, открывавшие лист старой версии, открывают тот же лист новой.
  for(const sel of db.prepare('SELECT book_id,sheet_key FROM workbook_book_selection WHERE instance_id=? AND sheet_key IS NOT NULL').all(row.id) as {book_id:number;sheet_key:string}[])db.prepare('UPDATE workbook_book_selection SET sheet_key=? WHERE book_id=? AND author_user_id=? AND template_key=?').run(sheetMap.get(sel.sheet_key)??null,sel.book_id,req.user!.id,next.key);})();
 res.json(present(instance(req)!));
});
function dangerousPath(k:string){return !/^[a-z][a-z0-9_-]{0,79}$/.test(k)||['constructor','prototype','__proto__'].includes(k);}
workbooksRouter.get('/instances/:id/export',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});const template=definition(row.template_id)!;
 if(req.query.format==='markdown')return res.type('text/markdown; charset=utf-8').send(workbookMarkdown(template,row.title,JSON.parse(row.answers_json)));
 const links=db.prepare('SELECT b.key,s.sheet_key FROM workbook_book_selection s JOIN library_books b ON b.id=s.book_id WHERE s.instance_id=? AND s.author_user_id=?').all(row.id,req.user!.id);
 const project=row.project_type&&row.project_id&&projectTables[row.project_type]?db.prepare(`SELECT uid FROM ${projectTables[row.project_type]} WHERE id=?`).get(row.project_id) as {uid:string}|undefined:undefined;
 res.json({format:'soyman-workbook-instance',schemaVersion:1,template,instance:{uid:row.uid,title:row.title,answers:JSON.parse(row.answers_json),project:project?{type:row.project_type,uid:project.uid}:null},links});
});
workbooksRouter.post('/import',(req:AuthedRequest,res)=>{
 try{const bundle=req.body;validateWorkbookTemplate(bundle.template);validateWorkbookAnswers(bundle.template,bundle.instance?.answers);
 if(bundle.format!=='soyman-workbook-instance'||bundle.schemaVersion!==1||!z.string().uuid().safeParse(bundle.instance?.uid).success||typeof bundle.instance?.title!=='string'||!bundle.instance.title.trim()||bundle.instance.title.length>500||!Array.isArray(bundle.links??[])||(bundle.links??[]).length>500)throw new Error('Некорректный файл тетради');
 if(db.prepare('SELECT id FROM workbook_instances WHERE uid=?').get(bundle.instance.uid))return res.status(409).json({error:'Этот экземпляр уже существует. Импорт не перезаписывает ответы.'});
 const project=bundle.instance.project,projectType=project&&typeof project.type==='string'&&Object.hasOwn(projectTables,project.type)?project.type:null;
 const projectRow=projectType&&typeof project.uid==='string'?db.prepare(`SELECT id FROM ${projectTables[projectType]} WHERE uid=? AND archived_at IS NULL`).get(project.uid) as {id:number}|undefined:undefined;
 const id=db.transaction(()=>{const templateId=templateImport(bundle.template),id=insertInstance(req.user!.id,templateId,bundle.instance.title,bundle.instance.answers,bundle.instance.uid,projectRow?projectType:null,projectRow?.id??null);
 for(const link of bundle.links??[]){const book=db.prepare("SELECT b.id FROM library_books b LEFT JOIN workbook_instances w ON b.source_type='workbook' AND w.id=b.source_id WHERE b.key=? AND (w.id IS NULL OR w.author_user_id=?)").get(link.key,req.user!.id) as {id:number}|undefined;if(!book)continue;const sheet=bundle.template.sheets.some((s:{key:string})=>s.key===link.sheet_key)?link.sheet_key:null;db.prepare('INSERT OR IGNORE INTO workbook_book_links(book_id,template_key,sheet_key) VALUES(?,?,?)').run(book.id,bundle.template.key,sheet);db.prepare('INSERT OR REPLACE INTO workbook_book_selection(book_id,author_user_id,template_key,instance_id,sheet_key) VALUES(?,?,?,?,?)').run(book.id,req.user!.id,bundle.template.key,id,sheet);}return id;})();req.params.id=String(id);res.status(201).json(present(instance(req)!));
 }catch(e){res.status(400).json({error:(e as Error).message});}
});
workbooksRouter.get('/books/:bookId',(req:AuthedRequest,res)=>{res.json(db.prepare(`SELECT l.book_id,l.template_key,CASE WHEN s.book_id IS NOT NULL THEN s.sheet_key ELSE l.sheet_key END sheet_key,s.instance_id,w.title instance_title,w.archived_at instance_archived FROM workbook_book_links l LEFT JOIN workbook_book_selection s ON s.book_id=l.book_id AND s.template_key=l.template_key AND s.author_user_id=? LEFT JOIN workbook_instances w ON w.id=s.instance_id WHERE l.book_id=?`).all(req.user!.id,req.params.bookId));});
workbooksRouter.get('/shelves/:shelfId',(req:AuthedRequest,res)=>{res.json(db.prepare('SELECT l.instance_id,w.title instance_title FROM workbook_shelf_links l JOIN workbook_instances w ON w.id=l.instance_id AND w.archived_at IS NULL WHERE l.shelf_id=? AND l.author_user_id=?').get(req.params.shelfId,req.user!.id)??null);});
workbooksRouter.put('/shelves/:shelfId',(req:AuthedRequest,res)=>{
 const p=z.object({instance_id:z.number().int().positive().nullable()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Выберите тетрадь'});
 if(!db.prepare('SELECT 1 FROM library_shelves WHERE id=?').get(req.params.shelfId))return res.status(404).json({error:'Полка не найдена'});
 if(p.data.instance_id==null){db.prepare('DELETE FROM workbook_shelf_links WHERE shelf_id=? AND author_user_id=?').run(req.params.shelfId,req.user!.id);return res.json({ok:true});}
 if(!db.prepare('SELECT 1 FROM workbook_instances WHERE id=? AND author_user_id=? AND archived_at IS NULL').get(p.data.instance_id,req.user!.id))return res.status(400).json({error:'Выберите свою тетрадь'});
 db.prepare('INSERT INTO workbook_shelf_links(shelf_id,author_user_id,instance_id) VALUES(?,?,?) ON CONFLICT(shelf_id,author_user_id) DO UPDATE SET instance_id=excluded.instance_id').run(req.params.shelfId,req.user!.id,p.data.instance_id);res.json({ok:true});
});
workbooksRouter.put('/books/:bookId',(req:AuthedRequest,res)=>{
 const p=z.object({template_key:z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),sheet_key:z.string().nullable().default(null),instance_id:z.number().int().positive().nullable().default(null),remove:z.boolean().optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Выберите шаблон и лист'});const d=p.data;
 const book=db.prepare("SELECT b.id,w.author_user_id FROM library_books b LEFT JOIN workbook_instances w ON b.source_type='workbook' AND w.id=b.source_id WHERE b.id=?").get(req.params.bookId) as {id:number;author_user_id:number|null}|undefined;
 if(!book||book.author_user_id!=null&&book.author_user_id!==req.user!.id)return res.status(404).json({error:'Книга не найдена'});
 const t=db.prepare('SELECT id FROM workbook_templates WHERE template_key=? ORDER BY version DESC LIMIT 1').get(d.template_key) as {id:number}|undefined;
 let template=t?definition(t.id):null;
 if(d.instance_id){const w=db.prepare('SELECT * FROM workbook_instances WHERE id=? AND author_user_id=? AND archived_at IS NULL').get(d.instance_id,req.user!.id) as Instance|undefined;if(!w||definition(w.template_id)?.key!==d.template_key)return res.status(400).json({error:'Выберите свою тетрадь этого шаблона'});template=definition(w.template_id);}
 if(!template||!d.remove&&d.sheet_key!=null&&!template.sheets.some(s=>s.key===d.sheet_key))return res.status(400).json({error:'Лист не найден'});
 db.transaction(()=>{if(d.remove){db.prepare('DELETE FROM workbook_book_selection WHERE book_id=? AND author_user_id=? AND template_key=?').run(book.id,req.user!.id,d.template_key);return;}
 db.prepare('INSERT INTO workbook_book_links(book_id,template_key,sheet_key) VALUES(?,?,?) ON CONFLICT(book_id,template_key) DO UPDATE SET sheet_key=excluded.sheet_key').run(book.id,d.template_key,d.sheet_key);
 db.prepare('INSERT OR REPLACE INTO workbook_book_selection(book_id,author_user_id,template_key,instance_id,sheet_key) VALUES(?,?,?,?,?)').run(book.id,req.user!.id,d.template_key,d.instance_id,d.sheet_key);})();res.json({ok:true});
});
