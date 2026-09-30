import express from "express";
import request from "supertest";
import {beforeAll,describe,expect,it} from "vitest";
import {db} from "../db/db";
import {attachUser,requireAuth,signToken} from "../services/auth";
import {bookLibraryRouter} from "./bookLibrary";
import {resourcesRouter} from "./resources";
import {masteringRouter} from "./mastering";
const app=express();app.use(express.json({limit:'12mb'}));app.use(attachUser);app.use('/library',bookLibraryRouter);app.use('/resources',requireAuth('gm'),resourcesRouter);app.use('/mastering',masteringRouter);
let gm:string,other:string,player:string;
beforeAll(()=>{const token=(username:string,role:'gm'|'player')=>{const id=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,'test',?)").run(username,role).lastInsertRowid);return signToken({id,username,role,playerId:null,isAdmin:false,tokenVersion:0});};gm=token('catalog-reader','gm');other=token('catalog-other','gm');player=token('catalog-player','player');});
const auth=(r:request.Test,token=gm)=>r.auth(token,{type:'bearer'});
const create=(title='Статья',data={})=>auth(request(app).post('/library/articles')).send({title,content:'## Заголовок\n\nУНИКАЛЬНАЯ подсказка',department_id:null,shelf_id:null,...data});
describe('единый книжный каталог',()=>{
 it('различает источники, ищет русский текст и не передаёт содержимое книг',async()=>{
  const article=await create('Уникальная статья');expect(article.status).toBe(201);
  const document=await auth(request(app).post('/resources')).field('name','Файловая статья').field('scope','global').attach('file',Buffer.from('# Файл'),{filename:'book.md',contentType:'text/markdown'});expect(document.status).toBe(201);
  const listing=await auth(request(app).get('/library/books'));expect(listing.status).toBe(200);const found=listing.body.books.filter((b:{source_id:number;source_type:string})=>b.source_id===article.body.source_id||b.source_id===document.body.id);expect(new Set(found.map((b:{key:string})=>b.key)).size).toBe(found.length);expect(found.every((b:object)=>!Object.hasOwn(b,'content'))).toBe(true);
  const search=await auth(request(app).get('/library/books')).query({q:'уникальная подсказка',limit:1});expect(search.body.books[0].id).toBe(article.body.id);expect(search.body.total).toBeGreaterThan(0);
  await request(app).put(`/mastering/${article.body.source_id}`).send({content:'![Фото](https://example.com/cover.png)'});expect((await auth(request(app).get(`/library/books/${article.body.id}`))).body.cover_image).toBe('https://example.com/cover.png');
  expect((await request(app).get('/library/books')).status).toBe(401);expect((await auth(request(app).get('/library/books'),player)).status).toBe(403);
 });
 it('атомарно создаёт книгу, переносит целую полку и удаляет организацию без удаления материалов',async()=>{
  const d=(await auth(request(app).post('/library/departments')).send({name:'Хоумбрю'})).body;
  const s=(await auth(request(app).post('/library/shelves')).send({name:'Правила',department_id:d.id})).body;
  const a=(await create('Новые правила',{department_id:d.id,shelf_id:s.id})).body;
  const before=(db.prepare('SELECT count(*) n FROM mastering_notes').get() as {n:number}).n;
  expect((await create('Не создаётся',{department_id:null,shelf_id:s.id})).status).toBe(400);expect((db.prepare('SELECT count(*) n FROM mastering_notes').get() as {n:number}).n).toBe(before);
  const target=(await auth(request(app).post('/library/departments')).send({name:'Приключения'})).body;
  await auth(request(app).put(`/library/shelves/${s.id}`)).send({department_id:target.id,descending:true});expect((await auth(request(app).get(`/library/books/${a.id}`))).body.department_id).toBe(target.id);
  await auth(request(app).delete(`/library/departments/${target.id}`));expect((await auth(request(app).get(`/library/books/${a.id}`))).body).toMatchObject({department_id:null,shelf_id:null,title:'Новые правила'});expect(db.prepare('SELECT id FROM mastering_notes WHERE id=?').get(a.source_id)).toBeTruthy();
 });
 it('хранит закладки, позиции и заметки по автору, сохраняет при архивации',async()=>{
  const document=await auth(request(app).post('/resources')).field('name','Заметки к файлу').field('scope','global').attach('file',Buffer.from('А цитата Б'),{filename:'notes.md',contentType:'text/markdown'});
  const b=(await auth(request(app).get('/library/books')).query({source_type:'resource',source_id:document.body.id})).body.books[0];const path=`/library/books/${b.id}`;
  await auth(request(app).put(`${path}/state`)).send({bookmarked:true,position:{heading:'Глава',ratio:.3},opened:true});expect((await auth(request(app).get(path),other)).body).toMatchObject({bookmarked:false,position:{}});
  const n=await auth(request(app).post(`${path}/annotations`)).send({body:'Личная заметка',quote:'цитата',anchor:{start:2,end:8}});expect(n.status).toBe(201);expect((await auth(request(app).get(path))).body.note_count).toBe(1);expect((await auth(request(app).get(path),other)).body.note_count).toBe(0);
  expect((await auth(request(app).put(`${path}/annotations/${n.body.id}`),other).send({body:'Чужая'})).status).toBe(404);
  await auth(request(app).delete(`/resources/${document.body.id}`));expect((await auth(request(app).get(path))).status).toBe(404);expect(db.prepare('SELECT id FROM library_annotations WHERE id=?').get(n.body.id)).toBeTruthy();
  await auth(request(app).put(`/resources/${document.body.id}/restore`)).send({});expect((await auth(request(app).get(path))).body).toMatchObject({note_count:1,bookmarked:true});
 });
 it('принимает аудио, сохраняет совпадающие имена отдельно и не кладёт их в книги',async()=>{
  const upload=()=>auth(request(app).post('/resources')).field('name','Музыка').field('scope','global').field('category','audio').attach('file',Buffer.from('RIFF1234WAVEfmt '),{filename:'music.wav',contentType:'audio/wav'});
  const first=await upload(),second=await upload();expect(first.status).toBe(201);expect(second.status).toBe(201);expect(first.body.category).toBe('audio');expect(first.body.file_url).not.toBe(second.body.file_url);
  expect((await auth(request(app).get('/library/books')).query({source_type:'resource',source_id:first.body.id})).body.total).toBe(0);
 });
});
