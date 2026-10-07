import express from "express";
import request from "supertest";
import {beforeAll,describe,expect,it} from "vitest";
import {db} from "../db/db";
import {attachUser,signToken} from "../services/auth";
import {workbooksRouter} from "./workbooks";
import {settingsRouter} from "./settings";
import {campaignsRouter} from "./campaigns";
import {storyRouter} from "./story";
import {bookLibraryRouter} from "./bookLibrary";
import {ensureProjectWorkbook,placeProjectWorkbooks} from "../services/projectWorkbooks";
import {migrateWorkbooks,registerPracticalTemplate} from "../db/workbooks";
import {ADVENTURE_WORKBOOK} from "@soyman/shared";

const app=express();app.use(express.json());app.use(attachUser);
app.use('/workbooks',workbooksRouter);app.use('/settings',settingsRouter);app.use('/campaigns',campaignsRouter);app.use('/story',storyRouter);app.use('/library',bookLibraryRouter);
let gm:string,other:string,author:number;
beforeAll(()=>{
 for(const username of ['project-notebooks-gm','project-notebooks-other']){
  const id=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,'test','gm')").run(username).lastInsertRowid);
  const token=signToken({id,username,role:'gm',playerId:null,isAdmin:false,tokenVersion:0});
  if(username.endsWith('-gm')){gm=token;author=id;}else other=token;
 }
});
const auth=(r:request.Test,token=gm)=>r.auth(token,{type:'bearer'});

describe('тетради проектов и полки',()=>{
 it('автоматически создаёт три тетради с личным автором и двумя полками сеттинга',async()=>{
  const setting=await auth(request(app).post('/settings')).send({name:'Мир тетрадей'});expect(setting.status).toBe(201);
  const sid=setting.body.id;
  const adventure=await auth(request(app).post('/story/arcs')).send({name:'Ваншот',setting_id:sid});expect(adventure.status).toBe(201);
  const campaign=await auth(request(app).post('/campaigns')).send({name:'Проведение',setting_id:sid,type:'oneshot'});expect(campaign.status).toBe(201);
  const rows=db.prepare('SELECT * FROM workbook_instances WHERE author_user_id=? ORDER BY id').all(author) as {id:number;project_type:string;project_id:number;revision:number;answers_json:string;template_id:number}[];
  expect(rows.map(r=>r.project_type)).toEqual(['setting','adventure','campaign']);
  expect(new Set(rows.map(r=>r.id)).size).toBe(3);
  const shelves=db.prepare('SELECT workbook_role FROM library_shelves WHERE setting_id=? ORDER BY position').all(sid);
  expect(shelves).toEqual([{workbook_role:'projects'},{workbook_role:'campaigns'}]);
  const books=await auth(request(app).get('/library/books')).query({setting:sid,include_unplaced:1});
  expect(books.body.books.filter((b:{source_type:string})=>b.source_type==='workbook')).toHaveLength(3);
  expect((await auth(request(app).get('/library/books'),other).query({setting:sid,include_unplaced:1})).body.books).toHaveLength(0);
  expect((await auth(request(app).get(`/workbooks/instances/${rows[0].id}`),other)).status).toBe(404);
  const again=await auth(request(app).post(`/workbooks/projects/adventure/${adventure.body.id}/notebook`)).send({});
  expect(again.body.id).toBe(rows[1].id);expect(again.body.revision).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM workbook_instances WHERE author_user_id=?').get(author)).toEqual({n:3});
 });
 it('переносит полку при смене сеттинга и оставляет ответы и идентификатор',()=>{
  const sid=Number(db.prepare("INSERT INTO settings(name) VALUES('Другой мир')").run().lastInsertRowid);
  const cid=Number(db.prepare("INSERT INTO campaigns(name) VALUES('Без сеттинга')").run().lastInsertRowid);
  const id=ensureProjectWorkbook(db,author,'campaign',cid);
  db.prepare('UPDATE workbook_instances SET answers_json=? WHERE id=?').run(JSON.stringify({recap:{events:'Событие'}}),id);
  db.prepare('UPDATE campaigns SET setting_id=? WHERE id=?').run(sid,cid);placeProjectWorkbooks(db,'campaign',cid);
  expect(db.prepare("SELECT s.setting_id,s.workbook_role FROM library_books b JOIN library_shelves s ON s.id=b.shelf_id WHERE b.source_type='workbook' AND b.source_id=?").get(id)).toEqual({setting_id:sid,workbook_role:'campaigns'});
  expect(ensureProjectWorkbook(db,author,'campaign',cid)).toBe(id);
  expect(db.prepare('SELECT answers_json FROM workbook_instances WHERE id=?').get(id)).toEqual({answers_json:'{"recap":{"events":"Событие"}}'});
 });
 it('регистрирует новые версии повторяемо и не меняет заполненную прежнюю тетрадь',async()=>{
  const old={format:'soyman-workbook',schemaVersion:1,key:'oneshot-design',version:1,title:'Курс',sheets:[{key:'lesson-01',title:'Занятие 1',fields:[{key:'answer',label:'Ответ',type:'text'}]}]};
  const t=await auth(request(app).post('/workbooks/templates')).send(old);expect(t.status).toBe(201);
  const a=await auth(request(app).post('/workbooks/instances')).send({template_id:t.body.id,title:'Заполненная тетрадь'});
  const saved=await auth(request(app).put(`/workbooks/instances/${a.body.id}`)).send({revision:1,answers:{'lesson-01':{answer:'Полезный материал'}}});expect(saved.status).toBe(200);
  migrateWorkbooks(db);migrateWorkbooks(db);
  expect((await auth(request(app).get(`/workbooks/instances/${a.body.id}`))).body).toMatchObject({template_id:t.body.id,revision:2,answers:{'lesson-01':{answer:'Полезный материал'}}});
  const next=db.prepare("SELECT id FROM workbook_templates WHERE template_key='oneshot-design' AND version=2").get() as {id:number};
  const upgraded=await auth(request(app).post(`/workbooks/instances/${a.body.id}/upgrade`)).send({revision:2,template_id:next.id,mapping:{}});
  expect(upgraded.status).toBe(200);expect(upgraded.body.answers['lesson-01'].answer).toBe('Полезный материал');
  expect(upgraded.body.answers._former['lesson-01/answer']).toContain('Ответ');
 });
 it('берёт планы только из личной тетради связанного приключения и не меняет заготовку',async()=>{
  const sid=Number(db.prepare("INSERT INTO settings(name) VALUES('Мир переноса')").run().lastInsertRowid);
  const arc=Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES('План сил',?)").run(sid).lastInsertRowid);
  const cid=Number(db.prepare("INSERT INTO campaigns(name,setting_id,type) VALUES('Новая игра',?,'oneshot')").run(sid).lastInsertRowid);
  db.prepare('INSERT INTO campaign_adventures(campaign_id,arc_id,position) VALUES(?,?,0)').run(cid,arc);
  const sourceId=ensureProjectWorkbook(db,author,'adventure',arc),targetId=ensureProjectWorkbook(db,author,'campaign',cid);
  const source={activity:{lines:[{_id:'source-line',name:'Беглецы',current:'end',actual:'Старый итог',states:[{_id:'start',name:'Ремонт',goal:'Починить карету'},{_id:'end',name:'Ушли'}]}]}};
  db.prepare('UPDATE workbook_instances SET answers_json=? WHERE id=?').run(JSON.stringify(source),sourceId);
  const sources=await auth(request(app).get(`/workbooks/instances/${targetId}/activity-sources`));expect(sources.body).toMatchObject([{id:sourceId,lines:1}]);
  expect((await auth(request(app).post(`/workbooks/instances/${targetId}/activity-import`),other).send({revision:1,source_id:sourceId})).status).toBe(404);
  const response=await auth(request(app).post(`/workbooks/instances/${targetId}/activity-import`)).send({revision:1,source_id:sourceId});expect(response.status).toBe(200);expect(response.body.added).toBe(1);
  const copy=response.body.instance.answers.activity.lines[0];expect(copy._id).not.toBe('source-line');expect(copy.current).toBe(copy.states[0]._id);expect(copy.actual).toBe('');
  expect(db.prepare('SELECT answers_json FROM workbook_instances WHERE id=?').get(sourceId)).toEqual({answers_json:JSON.stringify(source)});
  const repeat=await auth(request(app).post(`/workbooks/instances/${targetId}/activity-import`)).send({revision:2,source_id:sourceId});expect(repeat.body.added).toBe(0);expect(repeat.body.instance.answers.activity.lines).toHaveLength(1);
  expect((await auth(request(app).post(`/workbooks/instances/${targetId}/activity-import`)).send({revision:1,source_id:sourceId})).status).toBe(409);
  const unrelated=Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES('Другое приключение',?)").run(sid).lastInsertRowid);
  const unrelatedId=ensureProjectWorkbook(db,author,'adventure',unrelated);
  expect((await auth(request(app).post(`/workbooks/instances/${targetId}/activity-import`)).send({revision:2,source_id:unrelatedId})).status).toBe(400);
 });
 it('создаёт новую версию при изменении встроенного шаблона, сохраняя прежнюю',()=>{
  const before=db.prepare("SELECT id,definition_json FROM workbook_templates WHERE template_key='oneshot-design' AND version=2").get() as {id:number;definition_json:string};
  const changed={...ADVENTURE_WORKBOOK,description:'Уточнённая рабочая версия'};
  const id=registerPracticalTemplate(db,changed);expect(id).not.toBe(before.id);
  expect(db.prepare('SELECT version FROM workbook_templates WHERE id=?').get(id)).toEqual({version:3});
  expect(db.prepare('SELECT definition_json FROM workbook_templates WHERE id=?').get(before.id)).toEqual({definition_json:before.definition_json});
  expect(registerPracticalTemplate(db,changed)).toBe(id);
 });
});
