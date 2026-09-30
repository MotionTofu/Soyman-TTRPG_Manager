import {Router} from "express";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "../db/db";
import {requireAuth,type AuthedRequest} from "../services/auth";
import {validateWorkbookTemplate,validateWorkbookAnswers,workbookMarkdown,type WorkbookTemplate,type WorkbookAnswers} from "@soyman/shared";
import {seedWorkbookTemplates} from "../db/workbooks";
export const workbooksRouter=Router();workbooksRouter.use(requireAuth("gm"));
type Instance={id:number;uid:string;author_user_id:number;template_id:number;title:string;answers_json:string;revision:number;project_type:string|null;project_id:number|null;archived_at:string|null;[key:string]:unknown};
function definition(id:number){const row=db.prepare('SELECT definition_json FROM workbook_templates WHERE id=?').get(id) as {definition_json:string}|undefined;return row?JSON.parse(row.definition_json) as WorkbookTemplate:null;}
function templateImport(input:unknown){validateWorkbookTemplate(input);const existing=db.prepare('SELECT id,definition_json FROM workbook_templates WHERE template_key=? AND version=?').get(input.key,input.version) as {id:number;definition_json:string}|undefined;
 if(existing){if(JSON.stringify(JSON.parse(existing.definition_json))!==JSON.stringify(input))throw new Error("Эта версия уже существует с другим содержимым. Увеличьте номер версии.");return existing.id;}
 return Number(db.prepare('INSERT INTO workbook_templates(template_key,version,title,definition_json) VALUES(?,?,?,?)').run(input.key,input.version,input.title,JSON.stringify(input)).lastInsertRowid);}
export function seedWorkbooks(){seedWorkbookTemplates(db);}
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
 res.json(rows.map(row=>{const {answers_json,...summary}=row;return {...summary,template_title:definition(row.template_id)?.title,template_version:definition(row.template_id)?.version};}));
});
workbooksRouter.post('/instances',(req:AuthedRequest,res)=>{
 const parsed=projectSchema.extend({template_id:z.number().int().positive(),title:z.string().trim().min(1).max(500)}).safeParse(req.body);
 if(!parsed.success||!validProject(parsed.data.project_type,parsed.data.project_id))return res.status(400).json({error:'Проверьте шаблон, название и проект'});
 const p=parsed.data;if(!definition(p.template_id))return res.status(404).json({error:'Шаблон не найден'});
 const id=insertInstance(req.user!.id,p.template_id,p.title,{},undefined,p.project_type??null,p.project_id??null);req.params.id=String(id);res.status(201).json(present(instance(req)!));
});
workbooksRouter.get('/instances/:id',(req:AuthedRequest,res)=>{const row=instance(req);return row?res.json(present(row)):res.status(404).json({error:'Тетрадь не найдена'});});
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
workbooksRouter.post('/instances/:id/upgrade',(req:AuthedRequest,res)=>{
 const row=instance(req);if(!row)return res.status(404).json({error:'Тетрадь не найдена'});
 const p=z.object({revision:z.number().int().positive(),template_id:z.number().int().positive(),mapping:z.record(z.string(),z.string()).default({})}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Некорректное сопоставление'});if(p.data.revision!==row.revision)return res.status(409).json({error:'Тетрадь изменилась в другом окне'});
 const old=definition(row.template_id)!,next=definition(p.data.template_id);if(!next||old.key!==next.key)return res.status(400).json({error:'Выберите другую версию этого шаблона'});
 const answers=JSON.parse(row.answers_json) as WorkbookAnswers;
 const keys=new Set(next.sheets.flatMap(s=>s.fields.map(f=>`${s.key}/${f.key}`)));
 for(const [from,to] of Object.entries(p.data.mapping)){const [s,f]=from.split('/'),[ns,nf]=to.split('/');if(!keys.has(to)||dangerousPath(s)||dangerousPath(f))return res.status(400).json({error:'Неизвестное поле сопоставления'});if(answers[s]?.[f]!==undefined){answers[ns]??={};if(answers[ns][nf]!==undefined&&from!==to)return res.status(400).json({error:'В новом поле уже есть ответ'});answers[ns][nf]=answers[s][f];}}
 try{validateWorkbookAnswers(next,answers);}catch(e){return res.status(400).json({error:(e as Error).message});}
 db.prepare('UPDATE workbook_instances SET template_id=?,answers_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(p.data.template_id,JSON.stringify(answers),new Date().toISOString(),row.id,row.revision);res.json(present(instance(req)!));
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
