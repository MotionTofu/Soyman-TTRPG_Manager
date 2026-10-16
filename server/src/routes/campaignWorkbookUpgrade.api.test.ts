import express from "express";
import request from "supertest";
import {beforeAll,describe,expect,it} from "vitest";
import {db} from "../db/db";
import {attachUser,signToken} from "../services/auth";
import {workbooksRouter} from "./workbooks";
import {ensureProjectWorkbook} from "../services/projectWorkbooks";
import {registerPracticalTemplate} from "../db/workbooks";
import {CAMPAIGN_WORKBOOK,formerAnswers,type WorkbookAnswers,type WorkbookField,type WorkbookTemplate} from "@soyman/shared";
import v3 from "../test/campaign-design-v3.json";

const app=express();app.use(express.json());app.use(attachUser);app.use('/workbooks',workbooksRouter);
let gm:string,author:number;
beforeAll(()=>{
 author=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES('campaign-v4-gm','test','gm')").run().lastInsertRowid);
 gm=signToken({id:author,username:'campaign-v4-gm',role:'gm',playerId:null,isAdmin:false,tokenVersion:0});
});
const auth=(r:request.Test)=>r.auth(gm,{type:'bearer'});

/** Ответ на каждую графу v3, включая вложенные: строки различимы, чтобы найти каждую после обновления. */
function fill(fields:WorkbookField[],path:string):Record<string,unknown>{
 const out:Record<string,unknown>={};
 for(const f of fields){const p=`${path}/${f.key}`;
  if(f.type==="profile"||f.type==="summary"||f.type==="heading"||f.type==="note")continue;
  if(f.type==="choice")out[f.key]=f.options![0];
  else if(f.type==="checklist")out[f.key]=[f.options![0]];
  else if(f.type==="table"||f.type==="group")out[f.key]=[{_id:`row:${p}`,...fill([...(f.columns??[]),...(f.fields??[])],p)}];
  else if(f.type==="state")out[f.key]=`row:${path}/${f.source}`;
  else out[f.key]=`ответ ${p}`;
 }
 return out;
}

describe('тетрадь кампании v3 → v4',()=>{
 it('новая кампания получает v4, обновление v3 ничего не теряет и оставляет перенос планов',async()=>{
  const v3Id=registerPracticalTemplate(db,v3 as WorkbookTemplate),v4Id=registerPracticalTemplate(db,CAMPAIGN_WORKBOOK);
  expect(db.prepare('SELECT version FROM workbook_templates WHERE id IN (?,?) ORDER BY version').all(v3Id,v4Id)).toEqual([{version:3},{version:4}]);
  const sid=Number(db.prepare("INSERT INTO settings(name) VALUES('Мир обновления')").run().lastInsertRowid);
  const cid=Number(db.prepare("INSERT INTO campaigns(name,setting_id) VALUES('Кампания обновления',?)").run(sid).lastInsertRowid);
  const id=ensureProjectWorkbook(db,author,'campaign',cid);
  expect(db.prepare('SELECT template_id FROM workbook_instances WHERE id=?').get(id)).toEqual({template_id:v4Id});

  const old=v3 as WorkbookTemplate,answers:WorkbookAnswers=Object.fromEntries(old.sheets.map(s=>[s.key,fill(s.fields,s.key)]));
  db.prepare('UPDATE workbook_instances SET template_id=?,answers_json=?,revision=1 WHERE id=?').run(v3Id,JSON.stringify(answers),id);
  const res=await auth(request(app).post(`/workbooks/instances/${id}/upgrade`)).send({revision:1,template_id:v4Id});
  expect(res.status,res.body.error).toBe(200);
  const next=res.body.answers as WorkbookAnswers;
  const former=new Set(formerAnswers(CAMPAIGN_WORKBOOK,next).map(f=>f.path));
  const fields=new Map(CAMPAIGN_WORKBOOK.sheets.flatMap(s=>s.fields.map(f=>[`${s.key}/${f.key}`,f] as const)));
  // Каждый ответ v3 лежит в новой графе, где видны все его колонки, или в «Прежних графах».
  for(const sheet of old.sheets)for(const f of Object.keys(answers[sheet.key])){
   const value=JSON.stringify(answers[sheet.key][f]);
   const at=Object.entries(next).flatMap(([s,v])=>Object.entries(v as Record<string,unknown>).filter(([,x])=>JSON.stringify(x)===value).map(([k])=>`${s}/${k}`));
   expect(at,`${sheet.key}/${f}`).toHaveLength(1);
   const target=fields.get(at[0]);
   if(!target){expect(former.has(at[0]),at[0]).toBe(true);continue;}
   const row=(answers[sheet.key][f] as Record<string,unknown>[])[0];
   if(target.type==="table"||target.type==="group"){const keys=[...(target.columns??[]),...(target.fields??[])].map(c=>c.key);for(const k of Object.keys(row).filter(k=>k!=="_id"))expect(keys,`${at[0]}/${k}`).toContain(k);}
  }
  expect(next.activity.lines).toEqual(answers.activity.lines);

  const arc=Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES('Заготовка сил',?)").run(sid).lastInsertRowid);
  db.prepare('INSERT INTO campaign_adventures(campaign_id,arc_id,position) VALUES(?,?,0)').run(cid,arc);
  const source=ensureProjectWorkbook(db,author,'adventure',arc);
  db.prepare('UPDATE workbook_instances SET answers_json=? WHERE id=?').run(JSON.stringify({activity:{lines:[{_id:'plan',name:'Жентарим',states:[{_id:'s',name:'Ищут камень'}]}]}}),source);
  const imported=await auth(request(app).post(`/workbooks/instances/${id}/activity-import`)).send({revision:res.body.revision,source_id:source});
  expect(imported.status,imported.body.error).toBe(200);expect(imported.body.added).toBe(1);
  expect(imported.body.instance.answers.activity.lines.map((l:{name:string})=>l.name)).toEqual([answers.activity.lines[0].name,'Жентарим']);
 });
 it('не принимает два ответа в одну графу',async()=>{
  const cid=Number(db.prepare("INSERT INTO campaigns(name) VALUES('Двойное сопоставление')").run().lastInsertRowid);
  const id=ensureProjectWorkbook(db,author,'campaign',cid),v3Id=registerPracticalTemplate(db,v3 as WorkbookTemplate),v4Id=registerPracticalTemplate(db,CAMPAIGN_WORKBOOK);
  db.prepare('UPDATE workbook_instances SET template_id=?,answers_json=?,revision=1 WHERE id=?').run(v3Id,JSON.stringify({overview:{next:'Первый'},charter:{table:'Второй'}}),id);
  const res=await auth(request(app).post(`/workbooks/instances/${id}/upgrade`)).send({revision:1,template_id:v4Id,mapping:{'overview/next':'promise/dependency','charter/table':'promise/dependency'}});
  expect(res.status).toBe(400);
  expect(JSON.parse((db.prepare('SELECT answers_json FROM workbook_instances WHERE id=?').get(id) as {answers_json:string}).answers_json)).toEqual({overview:{next:'Первый'},charter:{table:'Второй'}});
 });
});
