import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { db } from "../db/db";
import { requireAuth, type AuthedRequest } from "../services/auth";
import { masteringSummary, validMasteringCover } from "../services/masteringSummary";
import { assertVaultPath } from "../services/filesystem";

export const bookLibraryRouter = Router();
bookLibraryRouter.use(requireAuth("gm"));
type CatalogRow = { id:number; key:string; source_type:'mastering'|'resource'|'workbook'; source_id:number; department_id:number|null; shelf_id:number|null; cover_image:string|null; article_cover:string|null; title:string; content:string|null; category:string; file_path:string|null; system_id:number|null; system_name:string|null; department_name:string|null; section_name:string|null; reading_minutes:number; note_count:number; bookmarked:number; last_opened:string|null; position_json:string|null; mode:string|null; [key:string]:unknown };

function catalog(author:number, id?:number,q='',includeUnplaced=false): CatalogRow[] {
 // Текст читается только для обновления кратких сведений после изменения статьи.
 for(const source of db.prepare('SELECT m.id,m.content,m.cover_image FROM mastering_notes m LEFT JOIN library_article_summary c ON c.source_id=m.id WHERE c.source_id IS NULL AND m.archived_at IS NULL').all() as {id:number;content:string;cover_image:string|null}[]){const summary=masteringSummary(source);db.prepare('INSERT OR REPLACE INTO library_article_summary(source_id,cover_image,reading_minutes) VALUES(?,?,?)').run(source.id,summary.cover_image,summary.reading_minutes);}
 const rows = db.prepare(`SELECT b.*,coalesce(m.title,r.name,w.title) title,c.cover_image article_cover,coalesce(c.reading_minutes,0) reading_minutes,
 coalesce(m.created_at,r.created_at,w.created_at) created_at,NULL archived_at,
 coalesce(m.category,'knowledge') category,r.category file_category,r.file_path,
 coalesce(m.system_id,r.system_id) system_id,sys.name system_name,d.name department_name,s.name section_name,
 coalesce(st.bookmarked,0) bookmarked,st.last_opened,st.position_json,st.mode,
 CASE WHEN b.source_type='mastering' THEN (SELECT count(*) FROM mastering_annotations n WHERE n.book_id=m.id AND n.author_user_id=@author)
 WHEN r.category='pdf' OR lower(r.file_path) LIKE '%.pdf' THEN (SELECT count(*) FROM pdf_notes n WHERE n.resource_id=r.id AND n.author_user_id=@author)
 ELSE (SELECT count(*) FROM library_annotations n WHERE n.resource_id=r.id AND n.author_user_id=@author) END note_count
 FROM library_books b
 LEFT JOIN mastering_notes m ON b.source_type='mastering' AND m.id=b.source_id
 LEFT JOIN resources r ON b.source_type='resource' AND r.id=b.source_id
 LEFT JOIN workbook_instances w ON b.source_type='workbook' AND w.id=b.source_id AND w.author_user_id=@author
 LEFT JOIN library_article_summary c ON c.source_id=m.id
 LEFT JOIN library_departments d ON d.id=b.department_id LEFT JOIN library_shelves s ON s.id=b.shelf_id
 LEFT JOIN systems sys ON sys.id=coalesce(m.system_id,r.system_id)
 LEFT JOIN library_reading_state st ON st.book_id=b.id AND st.author_user_id=@author
 WHERE ((m.id IS NOT NULL AND m.archived_at IS NULL) OR (r.id IS NOT NULL AND r.archived_at IS NULL AND r.type<>'pdf_notes'
 AND (r.category IN ('pdf','markdown') OR r.type='markdown' OR lower(r.file_path) LIKE '%.pdf' OR lower(r.file_path) LIKE '%.md')) OR (w.id IS NOT NULL AND w.archived_at IS NULL ${id===undefined&&!includeUnplaced?'AND (b.department_id IS NOT NULL OR b.shelf_id IS NOT NULL)':''}))
 ${id===undefined?'':'AND b.id=@id'} ${q?'AND (instr(lower_u(coalesce(m.title,r.name,w.title)),@q)>0 OR instr(lower_u(coalesce(m.content,\'\')),@q)>0)':''} ORDER BY b.id`).all({author,...(id===undefined?{}:{id}),...(q?{q}:{})}) as CatalogRow[];
 return rows;
}
function present(row:CatalogRow) {
 const {content,article_cover,...fields}=row;
 const format=row.source_type==='workbook'?'workbook':row.source_type==='resource' && (row.file_category==='pdf'||/\.pdf$/i.test(row.file_path??''))?'pdf':'markdown';
 const summary={cover_image:row.cover_image===null?article_cover??null:row.cover_image||null,reading_minutes:row.reading_minutes};
 return {...fields,...summary,uid:row.key.split(':')[1],format,section_id:row.shelf_id,bookmarked:!!row.bookmarked,position:JSON.parse(row.position_json??'{}')};
}
const nameSchema=z.object({name:z.string().trim().min(1).max(160),position:z.number().int().min(0).max(1_000_000).optional()});
bookLibraryRouter.get('/departments',(_req,res)=>res.json(db.prepare('SELECT * FROM library_departments ORDER BY position,id').all()));
bookLibraryRouter.post('/legacy-bookmarks',(req:AuthedRequest,res)=>{
 const parsed=z.object({source_ids:z.array(z.number().int().positive()).max(2000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Некорректные старые закладки'});
 const ids=new Set(parsed.data.source_ids),books=catalog(req.user!.id).filter(b=>b.source_type==='mastering'&&ids.has(b.source_id));
 db.transaction(()=>{for(const book of books)db.prepare('INSERT INTO library_reading_state(book_id,author_user_id,bookmarked) VALUES(?,?,1) ON CONFLICT(book_id,author_user_id) DO UPDATE SET bookmarked=1').run(book.id,req.user!.id);})();res.json({imported:books.map(b=>b.key)});
});
bookLibraryRouter.post('/departments',(req,res)=>{
 const parsed=nameSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Укажите название подраздела'});
 const position=parsed.data.position??(db.prepare('SELECT coalesce(max(position),-1)+1 n FROM library_departments').get() as {n:number}).n;
 const id=db.prepare('INSERT INTO library_departments (uid,name,position) VALUES (?,?,?)').run(randomUUID(),parsed.data.name,position).lastInsertRowid;
 res.status(201).json(db.prepare('SELECT * FROM library_departments WHERE id=?').get(id));
});
bookLibraryRouter.put('/departments/:id',(req,res)=>{
 const parsed=nameSchema.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Некорректный подраздел'});
 const exists=db.prepare('SELECT id FROM library_departments WHERE id=?').get(req.params.id);if(!exists)return res.status(404).json({error:'Подраздел не найден'});
 db.prepare('UPDATE library_departments SET name=coalesce(?,name),position=coalesce(?,position) WHERE id=?').run(parsed.data.name??null,parsed.data.position??null,req.params.id);
 res.json(db.prepare('SELECT * FROM library_departments WHERE id=?').get(req.params.id));
});
bookLibraryRouter.delete('/departments/:id',(req,res)=>{
 db.transaction(()=>{
  db.prepare('UPDATE library_books SET department_id=NULL,shelf_id=NULL WHERE department_id=? OR shelf_id IN (SELECT id FROM library_shelves WHERE department_id=?)').run(req.params.id,req.params.id);
  db.prepare('DELETE FROM library_shelves WHERE department_id=?').run(req.params.id);
  db.prepare('DELETE FROM library_departments WHERE id=?').run(req.params.id);
 })();res.json({ok:true});
});
const shelfSchema=nameSchema.extend({department_id:z.number().int().positive().nullable(),descending:z.boolean().optional()});
function validDepartment(id:number|null|undefined){return id==null||!!db.prepare('SELECT id FROM library_departments WHERE id=?').get(id);}
const articleSchema=z.object({title:z.string().trim().min(1).max(500),content:z.string().max(10*1024*1024).default(''),system_id:z.number().int().positive().nullable().optional(),department_id:z.number().int().positive().nullable(),shelf_id:z.number().int().positive().nullable(),cover_image:z.unknown().optional()});
bookLibraryRouter.post('/articles',(req:AuthedRequest,res)=>{
 const parsed=articleSchema.safeParse(req.body);
 if(!parsed.success||!validDepartment(parsed.data.department_id)||!validMasteringCover(parsed.data.cover_image??null))return res.status(400).json({error:'Проверьте название, подраздел и обложку'});
 const a=parsed.data,shelf=a.shelf_id==null?null:db.prepare('SELECT department_id FROM library_shelves WHERE id=?').get(a.shelf_id) as {department_id:number|null}|undefined;
 if(a.shelf_id!=null&&(!shelf||shelf.department_id!==a.department_id))return res.status(400).json({error:'Полка принадлежит другому подразделу'});
 if(a.system_id&&!db.prepare('SELECT id FROM systems WHERE id=?').get(a.system_id))return res.status(400).json({error:'Система не найдена'});
 const id=db.transaction(()=>{
  const source=db.prepare("INSERT INTO mastering_notes (uid,category,title,content,system_id,cover_image) VALUES (?,'prep',?,?,?,?)").run(randomUUID(),a.title,a.content,a.system_id??null,a.cover_image??null).lastInsertRowid;
  const book=db.prepare("SELECT id FROM library_books WHERE source_type='mastering' AND source_id=?").get(source) as {id:number};
  db.prepare('UPDATE library_books SET department_id=?,shelf_id=? WHERE id=?').run(a.department_id,a.shelf_id,book.id);return book.id;
 })();res.status(201).json(present(catalog(req.user!.id,id)[0]));
});
bookLibraryRouter.get('/shelves',(_req,res)=>res.json(db.prepare('SELECT s.*,d.name department_name FROM library_shelves s LEFT JOIN library_departments d ON d.id=s.department_id ORDER BY s.position,s.id').all()));
bookLibraryRouter.post('/shelves',(req,res)=>{
 const parsed=shelfSchema.safeParse(req.body);if(!parsed.success||!validDepartment(parsed.data.department_id))return res.status(400).json({error:'Выберите подраздел и название полки'});
 const value=parsed.data;const position=value.position??(db.prepare('SELECT coalesce(max(position),-1)+1 n FROM library_shelves WHERE department_id IS ?').get(value.department_id) as {n:number}).n;
 const id=db.prepare('INSERT INTO library_shelves (uid,name,department_id,position,descending) VALUES (?,?,?,?,?)').run(randomUUID(),value.name,value.department_id,position,Number(value.descending??false)).lastInsertRowid;
 res.status(201).json(db.prepare('SELECT * FROM library_shelves WHERE id=?').get(id));
});
bookLibraryRouter.put('/shelves/:id',(req,res)=>{
 const parsed=shelfSchema.partial().safeParse(req.body);if(!parsed.success||!validDepartment(parsed.data.department_id))return res.status(400).json({error:'Некорректная полка'});
 const shelf=db.prepare('SELECT * FROM library_shelves WHERE id=?').get(req.params.id) as {department_id:number|null}|undefined;
 if(!shelf)return res.status(404).json({error:'Полка не найдена'});
 const value=parsed.data;const department=Object.hasOwn(value,'department_id')?value.department_id!:shelf.department_id;
 db.transaction(()=>{
 db.prepare('UPDATE library_shelves SET name=coalesce(?,name),department_id=?,position=coalesce(?,position),descending=coalesce(?,descending) WHERE id=?').run(value.name??null,department,value.position??null,value.descending===undefined?null:Number(value.descending),req.params.id);
 db.prepare('UPDATE library_books SET department_id=? WHERE shelf_id=?').run(department,req.params.id);
 })();res.json(db.prepare('SELECT * FROM library_shelves WHERE id=?').get(req.params.id));
});
bookLibraryRouter.delete('/shelves/:id',(req,res)=>{db.prepare('DELETE FROM library_shelves WHERE id=?').run(req.params.id);res.json({ok:true});});

bookLibraryRouter.get('/books',(req:AuthedRequest,res)=>{
 const q=String(req.query.q??'').trim().toLocaleLowerCase('ru');
 let rows=catalog(req.user!.id,undefined,q,req.query.include_unplaced==='1');
 if(req.query.department!==undefined)rows=rows.filter(row=>req.query.department==='none'?row.department_id==null:row.department_id===Number(req.query.department));
 if(req.query.shelf!==undefined)rows=rows.filter(row=>req.query.shelf==='none'?row.shelf_id==null:row.shelf_id===Number(req.query.shelf));
 if(req.query.source_id!==undefined)rows=rows.filter(row=>row.source_id===Number(req.query.source_id)&&row.source_type===req.query.source_type);
 if(req.query.system!==undefined)rows=rows.filter(row=>req.query.system==='none'?row.system_id==null:row.system_id===Number(req.query.system));
 if(req.query.notes==='1')rows=rows.filter(row=>row.note_count>0);
 if(req.query.bookmarked==='1')rows=rows.filter(row=>!!row.bookmarked);
 if(req.query.recent==='1')rows=rows.filter(row=>!!row.last_opened).sort((a,b)=>(b.last_opened??'').localeCompare(a.last_opened??''));
 let books=rows.map(present);if(req.query.format)books=books.filter(book=>book.format===req.query.format);
 const total=books.length,offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));
 res.json({books:books.slice(offset,offset+limit),total,offset,limit});
});
bookLibraryRouter.get('/books/:id',(req:AuthedRequest,res)=>{
 const row=catalog(req.user!.id,Number(req.params.id))[0];if(!row)return res.status(404).json({error:'Книга не найдена'});res.json(present(row));
});
bookLibraryRouter.get('/books/:id/neighbors',(req:AuthedRequest,res)=>{
 const book=catalog(req.user!.id,Number(req.params.id))[0];if(!book)return res.status(404).json({error:'Книга не найдена'});
 const descending=book.shelf_id?(db.prepare('SELECT descending FROM library_shelves WHERE id=?').get(book.shelf_id) as {descending:number}).descending:0;
 const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
 const rows=catalog(req.user!.id).filter(r=>r.department_id===book.department_id&&r.shelf_id===book.shelf_id).sort((a,b)=>(descending?-1:1)*collator.compare(a.title,b.title)||a.id-b.id),i=rows.findIndex(r=>r.id===book.id);
 res.json({previous:i>0?present(rows[i-1]):null,next:i>=0&&i<rows.length-1?present(rows[i+1]):null});
});
const placement=z.object({department_id:z.number().int().positive().nullable().optional(),shelf_id:z.number().int().positive().nullable().optional(),cover_image:z.unknown().optional()});
bookLibraryRouter.put('/books/:id',(req:AuthedRequest,res)=>{
 const book=catalog(req.user!.id,Number(req.params.id))[0];if(!book)return res.status(404).json({error:'Книга не найдена'});
 const parsed=placement.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Некорректное размещение'});
 const data=parsed.data;if(Object.hasOwn(data,'cover_image')&&!validMasteringCover(data.cover_image))return res.status(400).json({error:'Нужна ссылка на обложку'});
 const shelfId=Object.hasOwn(data,'shelf_id')?data.shelf_id!:Object.hasOwn(data,'department_id')&&data.department_id!==book.department_id?null:book.shelf_id;
 const shelf=shelfId==null?null:db.prepare('SELECT department_id FROM library_shelves WHERE id=?').get(shelfId) as {department_id:number|null}|undefined;
 if(shelfId!=null&&!shelf)return res.status(400).json({error:'Полка не найдена'});
 const department=shelf?shelf.department_id:Object.hasOwn(data,'department_id')?data.department_id!:book.department_id;
 if(!validDepartment(department))return res.status(400).json({error:'Подраздел не найден'});
 if(shelf&&Object.hasOwn(data,'department_id')&&data.department_id!==department)return res.status(400).json({error:'Полка принадлежит другому подразделу'});
 db.prepare('UPDATE library_books SET department_id=?,shelf_id=?,cover_image=? WHERE id=?').run(department,shelfId,Object.hasOwn(data,'cover_image')?data.cover_image:book.cover_image,book.id);
 res.json(present(catalog(req.user!.id,book.id)[0]));
});
const stateSchema=z.object({bookmarked:z.boolean().optional(),opened:z.boolean().optional(),position:z.record(z.string(),z.unknown()).optional(),mode:z.enum(['reading','a4','source','hybrid']).optional()});
bookLibraryRouter.put('/books/:id/state',(req:AuthedRequest,res)=>{
 const book=catalog(req.user!.id,Number(req.params.id))[0];if(!book)return res.status(404).json({error:'Книга не найдена'});
 const parsed=stateSchema.safeParse(req.body);if(!parsed.success||JSON.stringify(parsed.data.position??{}).length>8000)return res.status(400).json({error:'Некорректная позиция чтения'});
 const state=parsed.data;
 db.prepare(`INSERT INTO library_reading_state (book_id,author_user_id,bookmarked,position_json,mode,last_opened) VALUES (?,?,?,?,?,?)
 ON CONFLICT(book_id,author_user_id) DO UPDATE SET bookmarked=excluded.bookmarked,position_json=excluded.position_json,mode=excluded.mode,last_opened=excluded.last_opened`)
 .run(book.id,req.user!.id,Number(state.bookmarked??!!book.bookmarked),JSON.stringify(state.position??JSON.parse(book.position_json??'{}')),state.mode??book.mode??'reading',state.opened?new Date().toISOString():book.last_opened);
 res.json(present(catalog(req.user!.id,book.id)[0]));
});

const annotationSchema=z.object({body:z.string().trim().min(1).max(20000),quote:z.string().max(10000).default(''),anchor:z.object({start:z.number().int().min(0).max(20000000),end:z.number().int().positive().max(20000000)}).refine(a=>a.end>a.start).nullable().default(null),context_before:z.string().max(200).default(''),context_after:z.string().max(200).default('')}).refine(v=>!!v.quote.trim()===!!v.anchor);
function markdownSource(req:AuthedRequest) {
 const book=catalog(req.user!.id,Number(req.params.id))[0];if(!book||book.source_type!=='resource'||present(book).format!=='markdown')return null;
 if(!book.file_path)return null;try{const content=fs.readFileSync(assertVaultPath(book.file_path),'utf8');return {book,hash:createHash('sha256').update(content).digest('hex')};}catch{return null;}
}
function annotationRow(row:Record<string,unknown>,hash:string){const {anchor_json,content_sha256,...fields}=row;return {...fields,anchor:anchor_json?JSON.parse(String(anchor_json)):null,needs_reattach:!!anchor_json&&content_sha256!==hash};}
bookLibraryRouter.get('/books/:id/annotations',(req:AuthedRequest,res)=>{
 const source=markdownSource(req);if(!source)return res.status(404).json({error:'Документ не найден'});
 const rows=db.prepare('SELECT * FROM library_annotations WHERE resource_id=? AND author_user_id=? ORDER BY created_at,id').all(source.book.source_id,req.user!.id) as Record<string,unknown>[];res.json(rows.map(row=>annotationRow(row,source.hash)));
});
bookLibraryRouter.post('/books/:id/annotations',(req:AuthedRequest,res)=>{
 const source=markdownSource(req);if(!source)return res.status(404).json({error:'Документ не найден'});
 const parsed=annotationSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Некорректная заметка'});
 const n=parsed.data,id=randomUUID(),now=new Date().toISOString();
 db.prepare('INSERT INTO library_annotations (id,resource_id,author_user_id,body,quote,anchor_json,context_before,context_after,content_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,source.book.source_id,req.user!.id,n.body,n.quote,n.anchor?JSON.stringify(n.anchor):null,n.context_before,n.context_after,source.hash,now,now);
 res.status(201).json(annotationRow(db.prepare('SELECT * FROM library_annotations WHERE id=?').get(id) as Record<string,unknown>,source.hash));
});
bookLibraryRouter.put('/books/:id/annotations/:noteId',(req:AuthedRequest,res)=>{
 const source=markdownSource(req);if(!source)return res.status(404).json({error:'Документ не найден'});
 const row=db.prepare('SELECT * FROM library_annotations WHERE id=? AND resource_id=? AND author_user_id=?').get(req.params.noteId,source.book.source_id,req.user!.id) as Record<string,unknown>|undefined;if(!row)return res.status(404).json({error:'Заметка не найдена'});
 const parsed=annotationSchema.safeParse({...row,anchor:row.anchor_json?JSON.parse(String(row.anchor_json)):null,...req.body});if(!parsed.success)return res.status(400).json({error:'Некорректная заметка'});
 const n=parsed.data;db.prepare('UPDATE library_annotations SET body=?,quote=?,anchor_json=?,context_before=?,context_after=?,content_sha256=?,updated_at=? WHERE id=?').run(n.body,n.quote,n.anchor?JSON.stringify(n.anchor):null,n.context_before,n.context_after,Object.hasOwn(req.body,'anchor')?source.hash:row.content_sha256,new Date().toISOString(),row.id);
 res.json(annotationRow(db.prepare('SELECT * FROM library_annotations WHERE id=?').get(row.id) as Record<string,unknown>,source.hash));
});
bookLibraryRouter.delete('/books/:id/annotations/:noteId',(req:AuthedRequest,res)=>{
 const source=markdownSource(req);if(!source)return res.status(404).json({error:'Документ не найден'});
 const removed=db.prepare('DELETE FROM library_annotations WHERE id=? AND resource_id=? AND author_user_id=?').run(req.params.noteId,source.book.source_id,req.user!.id);
 if(!removed.changes)return res.status(404).json({error:'Заметка не найдена'});res.json({ok:true});
});
