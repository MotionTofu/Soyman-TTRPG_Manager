import express from "express";
import request from "supertest";
import {beforeAll,describe,expect,it} from "vitest";
import {db} from "../db/db";
import {attachUser,signToken} from "../services/auth";
import {workbooksRouter,seedWorkbooks} from "./workbooks";
import {bookLibraryRouter} from "./bookLibrary";
import {validateWorkbookTemplate,workbookMarkdown} from "@soyman/shared";
import {shippedWorkbooks} from "../workbooks/shipped";
const app=express();app.use(express.json({limit:'12mb'}));app.use(attachUser);app.use('/workbooks',workbooksRouter);app.use('/library',bookLibraryRouter);
let gm:string,other:string;
beforeAll(()=>{for(const [n,set] of [['workbook-gm',(t:string)=>gm=t],['workbook-other',(t:string)=>other=t]] as const){const id=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,'test','gm')").run(n).lastInsertRowid);set(signToken({id,username:n,role:'gm',playerId:null,isAdmin:false,tokenVersion:0}));}seedWorkbooks();});
const auth=(r:request.Test,token=gm)=>r.auth(token,{type:'bearer'});
const template={format:'soyman-workbook',schemaVersion:1,key:'travel-journal',version:1,title:'Журнал путешествия',sheets:[{key:'day',title:'День',fields:[{key:'destination',label:'Место',type:'text'},{key:'distance',label:'Путь',type:'number'},{key:'check',label:'Снаряжение',type:'checklist',options:['Вода','Верёвка']},{key:'events',label:'События',type:'table',columns:[{key:'event',label:'Что случилось',type:'text'}]}]}]};
async function create(){const t=(await auth(request(app).post('/workbooks/templates')).send(template)).body;expect(t.id).toBeTruthy();return (await auth(request(app).post('/workbooks/instances')).send({template_id:t.id,title:'Моя дорога'})).body;}
describe('универсальные тетради',()=>{
 it('проверяет оба полных курса и третий независимый формат',()=>{for(const t of shippedWorkbooks)expect(()=>validateWorkbookTemplate(t)).not.toThrow();const definitions=shippedWorkbooks as {sheets:{key:string}[]}[];expect(definitions[0].sheets.filter(s=>s.key.startsWith('lesson-'))).toHaveLength(12);expect(definitions[1].sheets.filter(s=>s.key.startsWith('lesson-'))).toHaveLength(20);expect(()=>validateWorkbookTemplate(template)).not.toThrow();expect(()=>validateWorkbookTemplate({...template,sheets:[...template.sheets,...template.sheets]})).toThrow();});
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
  const upgrade=await auth(request(app).post(`${path}/upgrade`)).send({revision:2,template_id:t.id,mapping:{'day/destination':'day/place'}});expect(upgrade.status).toBe(200);expect(upgrade.body.answers.day).toMatchObject({destination:'Лес',place:'Лес',distance:4});
  const bundle=(await auth(request(app).get(`${path}/export`))).body;expect(bundle.template.version).toBe(2);expect((await auth(request(app).post('/workbooks/import')).send(bundle)).status).toBe(409);bundle.instance.uid='abcdef01-1234-4234-a234-123456789012';const imported=await auth(request(app).post('/workbooks/import')).send(bundle);expect(imported.status).toBe(201);expect(imported.body.answers).toEqual(bundle.instance.answers);
  expect(workbookMarkdown(upgrade.body.template,'Дорога',upgrade.body.answers)).toContain('Сохранённые ответы прежних полей');
 });
 it('связывает несколько книг с одной тетрадью и сохраняет связи при архивации',async()=>{
  const a=await create();const books=[];for(const title of ['Правила пути','Атлас'])books.push((await auth(request(app).post('/library/articles')).send({title,department_id:null,shelf_id:null})).body);
  for(const b of books){expect((await auth(request(app).put(`/workbooks/books/${b.id}`)).send({template_key:template.key,instance_id:a.id,sheet_key:'day'})).status).toBe(200);expect((await auth(request(app).get(`/workbooks/books/${b.id}`))).body[0].instance_id).toBe(a.id);expect((await auth(request(app).get(`/workbooks/books/${b.id}`),other)).body[0].instance_id).toBeNull();}
  expect((await auth(request(app).put(`/workbooks/books/${books[0].id}`),other).send({template_key:template.key,instance_id:a.id})).status).toBe(400);
  await auth(request(app).put(`/workbooks/instances/${a.id}`)).send({revision:1,archived:true});expect((await auth(request(app).get('/workbooks/instances')).query({archived:1})).body.some((w:{id:number})=>w.id===a.id)).toBe(true);
  await auth(request(app).put(`/workbooks/instances/${a.id}`)).send({revision:2,archived:false});expect((await auth(request(app).get(`/workbooks/books/${books[0].id}`))).body[0].instance_id).toBe(a.id);
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
});
