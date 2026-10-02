import express from "express";
import request from "supertest";
import {beforeAll,describe,expect,it} from "vitest";
import {db} from "../db/db";
import {attachUser,signToken} from "../services/auth";
import {readFileSync} from "node:fs";
import {workbooksRouter} from "./workbooks";
import {bookLibraryRouter} from "./bookLibrary";
import {validateWorkbookTemplate,workbookMarkdown} from "@soyman/shared";
const app=express();app.use(express.json({limit:'12mb'}));app.use(attachUser);app.use('/workbooks',workbooksRouter);app.use('/library',bookLibraryRouter);
let gm:string,other:string;
beforeAll(()=>{for(const [n,set] of [['workbook-gm',(t:string)=>gm=t],['workbook-other',(t:string)=>other=t]] as const){const id=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,'test','gm')").run(n).lastInsertRowid);set(signToken({id,username:n,role:'gm',playerId:null,isAdmin:false,tokenVersion:0}));}});
const auth=(r:request.Test,token=gm)=>r.auth(token,{type:'bearer'});
const template={format:'soyman-workbook',schemaVersion:1,key:'travel-journal',version:1,title:'Журнал путешествия',sheets:[{key:'day',title:'День',fields:[{key:'destination',label:'Место',type:'text'},{key:'distance',label:'Путь',type:'number'},{key:'check',label:'Снаряжение',type:'checklist',options:['Вода','Верёвка']},{key:'events',label:'События',type:'table',columns:[{key:'event',label:'Что случилось',type:'text'}]}]}]};
async function create(){const t=(await auth(request(app).post('/workbooks/templates')).send(template)).body;expect(t.id).toBeTruthy();return (await auth(request(app).post('/workbooks/instances')).send({template_id:t.id,title:'Моя дорога'})).body;}
describe('универсальные тетради',()=>{
 it('проверяет независимый формат',()=>{expect(()=>validateWorkbookTemplate(template)).not.toThrow();expect(()=>validateWorkbookTemplate({...template,sheets:[...template.sheets,...template.sheets]})).toThrow();});
 it('загружает шаблон из Markdown: тот же текст — та же версия, изменённый — следующая',async()=>{
  const markdown=readFileSync(new URL('../../../client/public/workbook-example.md',import.meta.url),'utf8').split(/\r?\n/).slice(1).join('\n').replace('# Журнал путешествия','# Дорожный журнал');
  const first=await auth(request(app).post('/workbooks/templates')).send({markdown});expect(first.status).toBe(201);expect(first.body.template).toMatchObject({key:'dorozhnyy-zhurnal',version:1});
  expect((await auth(request(app).post('/workbooks/templates')).send({markdown})).body.id).toBe(first.body.id);
  const second=await auth(request(app).post('/workbooks/templates')).send({markdown:markdown.replace('**Проводник:**','**Проводник или карта:**')});expect(second.body.template).toMatchObject({key:'dorozhnyy-zhurnal',version:2});
  expect((await auth(request(app).post('/workbooks/templates')).send({markdown:'просто текст'})).status).toBe(400);
 });
 it('создаёт независимые экземпляры, защищает ответы автором и ревизией',async()=>{
  const a=await create(),b=await create();expect(a.uid).not.toBe(b.uid);const path=`/workbooks/instances/${a.id}`;
  const saved=await auth(request(app).put(path)).send({revision:a.revision,answers:{day:{destination:'Берёзовая роща',distance:3,check:['Вода'],events:[{_id:'row-1',event:'Дождь'}]}}});expect(saved.status).toBe(200);expect(saved.body.revision).toBe(2);
  expect((await auth(request(app).put(path)).send({revision:1,answers:{day:{destination:'Затёрто'}}})).status).toBe(409);expect((await auth(request(app).get(path),other)).status).toBe(404);
  expect((await auth(request(app).get(`/workbooks/instances/${b.id}`))).body.answers).toEqual({});expect((await auth(request(app).put(path)).send({revision:2,answers:{day:{distance:'Три'}}})).status).toBe(400);
 });
 it('обновляет версию только явно, сохраняет старые ответы и экспортирует с зависимостями',async()=>{
  const a=await create(),path=`/workbooks/instances/${a.id}`;await auth(request(app).put(path)).send({revision:1,answers:{day:{destination:'Лес',distance:4}}});
  const next={...template,version:2,sheets:[{key:'day',title:'День',fields:[{key:'place',label:'Новое место',type:'text'}]}]};const t=(await auth(request(app).post('/workbooks/templates')).send(next)).body;
  expect((await auth(request(app).get(path))).body.template.version).toBe(1);expect((await auth(request(app).post('/workbooks/templates')).send({...next,title:'Подмена'})).status).toBe(400);
  const upgrade=await auth(request(app).post(`${path}/upgrade`)).send({revision:2,template_id:t.id,mapping:{'day/destination':'day/place'}});expect(upgrade.status).toBe(200);expect(upgrade.body.answers.day).toEqual({place:'Лес',distance:4});expect(upgrade.body.answers._former).toEqual({'day/distance':'День · Путь'});
  const bundle=(await auth(request(app).get(`${path}/export`))).body;expect(bundle.template.version).toBe(2);expect((await auth(request(app).post('/workbooks/import')).send(bundle)).status).toBe(409);bundle.instance.uid='abcdef01-1234-4234-a234-123456789012';const imported=await auth(request(app).post('/workbooks/import')).send(bundle);expect(imported.status).toBe(201);expect(imported.body.answers).toEqual(bundle.instance.answers);
  expect(workbookMarkdown(upgrade.body.template,'Дорога',upgrade.body.answers)).toContain('Сохранённые ответы прежних полей');
 });
 it('связывает несколько книг с одной тетрадью и сохраняет связи при архивации',async()=>{
  const a=await create();const books=[];for(const title of ['Правила пути','Атлас'])books.push((await auth(request(app).post('/library/articles')).send({title,department_id:null,shelf_id:null})).body);
  for(const b of books){expect((await auth(request(app).put(`/workbooks/books/${b.id}`)).send({template_key:template.key,instance_id:a.id,sheet_key:'day'})).status).toBe(200);expect((await auth(request(app).get(`/workbooks/books/${b.id}`))).body[0].instance_id).toBe(a.id);expect((await auth(request(app).get(`/workbooks/books/${b.id}`),other)).body[0].instance_id).toBeNull();}
  expect((await auth(request(app).put(`/workbooks/books/${books[0].id}`),other).send({template_key:template.key,instance_id:a.id})).status).toBe(400);
  await auth(request(app).put(`/workbooks/instances/${a.id}`)).send({revision:1,archived:true});expect((await auth(request(app).get('/workbooks/instances')).query({archived:1})).body.some((w:{id:number})=>w.id===a.id)).toBe(true);
  await auth(request(app).put(`/workbooks/instances/${a.id}`)).send({revision:2,archived:false});expect((await auth(request(app).get(`/workbooks/books/${books[0].id}`))).body[0].instance_id).toBe(a.id);
  // Записи к листу — заметки автора в связанных книгах; чужие заметки и чужая тетрадь не видны.
  const source=(db.prepare('SELECT source_id FROM library_books WHERE id=?').get(books[0].id) as {source_id:number}).source_id;
  const author=(token:string)=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).id;
  const note=db.prepare("INSERT INTO mastering_annotations(id,book_id,author_user_id,quote,body,created_at,updated_at) VALUES(?,?,?,?,?,datetime('now'),datetime('now'))");
  note.run('wb-note-mine',source,author(gm),'Первый кадр','Начать с гаснущего света');note.run('wb-note-other',source,author(other),'','Чужая');
  const notes=(await auth(request(app).get(`/workbooks/instances/${a.id}/notes`))).body;
  expect(notes).toEqual([expect.objectContaining({id:'wb-note-mine',sheet_key:'day',book_id:books[0].id,book_title:'Правила пути',quote:'Первый кадр',body:'Начать с гаснущего света'})]);
  expect((await auth(request(app).get(`/workbooks/instances/${a.id}/notes`),other)).status).toBe(404);
 });
 it('привязывает свою тетрадь к полке лично и снимает привязку',async()=>{
  const a=await create(),shelf=Number(db.prepare("INSERT INTO library_shelves(uid,name) VALUES('wb-shelf','Курс')").run().lastInsertRowid),path=`/workbooks/shelves/${shelf}`;
  expect((await auth(request(app).put(path),other).send({instance_id:a.id})).status).toBe(400);
  expect((await auth(request(app).put(path)).send({instance_id:a.id})).status).toBe(200);
  expect((await auth(request(app).get(path))).body).toEqual({instance_id:a.id,instance_title:'Моя дорога'});expect((await auth(request(app).get(path),other)).body).toBeNull();
  expect((await auth(request(app).put(path)).send({instance_id:null})).status).toBe(200);expect((await auth(request(app).get(path))).body).toBeNull();
  expect((await auth(request(app).put('/workbooks/shelves/999999')).send({instance_id:a.id})).status).toBe(404);
 });
 it('сохраняет личный лист старой версии и экспортирует удалённые вложенные ответы',async()=>{
  const a=await create(),b=(await auth(request(app).post('/library/articles')).send({title:'Старый урок',department_id:null,shelf_id:null})).body;
  await auth(request(app).post('/workbooks/templates')).send({...template,version:3,sheets:[{key:'new-day',title:'Новый лист',fields:[]}]});
  expect((await auth(request(app).put(`/workbooks/books/${b.id}`)).send({template_key:template.key,instance_id:a.id,sheet_key:'day'})).status).toBe(200);
  const otherInstance=(await auth(request(app).post('/workbooks/instances'),other).send({template_id:a.template_id,title:'Другая дорога'})).body;
  await auth(request(app).put(`/workbooks/books/${b.id}`),other).send({template_key:template.key,instance_id:otherInstance.id,sheet_key:null});
  expect((await auth(request(app).get(`/workbooks/books/${b.id}`))).body[0].sheet_key).toBe('day');
  const text=workbookMarkdown(a.template,a.title,{day:{events:[{_id:'row',event:'Путь',removed:'Старое описание'}]}});
  expect(text).toContain('Старое описание');expect(text).toContain('Сохранённые ответы прежних полей');
 });
 it('переносит старые заметки кампании в записи листа и удаляет их у кампании',async()=>{
  const a=await create(),path=`/workbooks/instances/${a.id}`;
  const cid=Number(db.prepare("INSERT INTO campaigns(name) VALUES('С заметками')").run().lastInsertRowid);
  const note=db.prepare("INSERT INTO campaign_entries(campaign_id,category,title,content) VALUES(?,?,?,?)");
  const n1=Number(note.run(cid,'gm_notes','Идея','Мирт сдаёт партию').lastInsertRowid);note.run(cid,'gm_notes','','Падение — 1к6 за 3 м');note.run(cid,'notes','Игрок','не трогать');
  expect((await auth(request(app).post(`${path}/campaign-notes`)).send({campaign_id:cid,sheet_key:'nope'})).status).toBe(400);
  const one=await auth(request(app).post(`${path}/campaign-notes`)).send({campaign_id:cid,sheet_key:'day',entry_ids:[n1]});
  expect(one.status).toBe(200);expect(one.body.instance.answers._notes.day.map((n:{body:string})=>n.body)).toEqual(['Идея\n\nМирт сдаёт партию']);
  const rest=await auth(request(app).post(`${path}/campaign-notes`)).send({campaign_id:cid,sheet_key:'day'});
  expect(rest.body.moved).toBe(1);expect(rest.body.instance.answers._notes.day).toHaveLength(2);
  expect(db.prepare("SELECT category FROM campaign_entries WHERE campaign_id=?").all(cid)).toEqual([{category:'notes'}]);
  expect((await auth(request(app).post(`${path}/campaign-notes`),other).send({campaign_id:cid,sheet_key:'day'})).status).toBe(404);
 });
});
