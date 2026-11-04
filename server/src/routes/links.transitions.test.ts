import { beforeEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { db } from '../db/db';
import { linksRouter, graphCache } from './links';

// Регрессии охвата переходов; изолированная база setupTempDb.ts.
const app = express();
app.use('/api/links', linksRouter);
let setting: number, campaign: number, a: number, b: number, scene: number;
beforeEach(() => {
  graphCache.clear();
  setting = Number(db.prepare("INSERT INTO settings(name) VALUES ('QA граф')").run().lastInsertRowid);
  campaign = Number(db.prepare("INSERT INTO campaigns(name,setting_id) VALUES ('QA',?)").run(setting).lastInsertRowid);
  a = Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES ('A',?)").run(setting).lastInsertRowid);
  b = Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES ('B',?)").run(setting).lastInsertRowid);
  scene = Number(db.prepare("INSERT INTO story_scenes(name,setting_id,arc_id) VALUES ('A1',?,?)").run(setting,a).lastInsertRowid);
  db.prepare("INSERT INTO story_scenes(name,setting_id,arc_id) VALUES ('B1',?,?)").run(setting,b);
  db.prepare('INSERT INTO campaign_adventures(campaign_id,arc_id) VALUES (?,?),(?,?)').run(campaign,a,campaign,b);
  db.prepare("INSERT INTO story_arc_transitions(from_arc_id,to_arc_id,label) VALUES (?,?,'из сеттинга')").run(a,b);
});
async function graph(query: string) {
  const response = await request(app).get('/api/links/graph?view=adventures' + query);
  expect(response.status).toBe(200);
  return response.body;
}
const linksBetween = (data: {edges: {from:string;to:string;kind:string}[]}) =>
  data.edges.filter(e=>e.kind==='link' && e.from===`adventure:${a}` && e.to===`adventure:${b}`);

it('сохраняет наследованный переход в сеттинге, кампании и общем охвате', async () => {
  expect(linksBetween(await graph(`&setting_id=${setting}`))).toHaveLength(1);
  expect(linksBetween(await graph(`&campaign_id=${campaign}`))).toHaveLength(1);
  expect(linksBetween(await graph(''))).toHaveLength(1);
});

it('пустой собственный набор не наследует строки, даже если передан setting_id', async () => {
  db.prepare('UPDATE campaigns SET own_arc_transitions=1 WHERE id=?').run(campaign);
  // Собственный набор пуст — наследованный переход должен быть скрыт.
  expect(linksBetween(await graph(`&campaign_id=${campaign}`))).toHaveLength(0);
  expect(linksBetween(await graph(`&campaign_id=${campaign}&setting_id=${setting}`))).toHaveLength(0);
});

it('снимает гипотезу о возвращении отменённых/перенесённых сессий через набранные сцены', async () => {
  const next = Number(db.prepare("INSERT INTO sessions(campaign_id,date,status) VALUES (?,'2026-11-10','planned')").run(campaign).lastInsertRowid);
  const old = Number(db.prepare("INSERT INTO sessions(campaign_id,date,status,rescheduled_to_id) VALUES (?,'2026-11-05','planned',?)").run(campaign,next).lastInsertRowid);
  const cancelled = Number(db.prepare("INSERT INTO sessions(campaign_id,date,status) VALUES (?,'2026-11-01','cancelled')").run(campaign).lastInsertRowid);
  db.prepare('INSERT INTO session_planned_scenes(session_id,scene_id) VALUES (?,?),(?,?)').run(old,scene,cancelled,scene);
  const data = await graph(`&campaign_id=${campaign}`);
  const keys = new Set(data.nodes.map((n:{key:string})=>n.key));
  expect(keys.has(`session:${next}`)).toBe(true);
  expect(keys.has(`session:${old}`)).toBe(false);
  expect(keys.has(`session:${cancelled}`)).toBe(false);
});

it('собственный набор целиком заменяет наследованный, campaign_id важнее чужого setting_id', async () => {
  db.prepare('UPDATE campaigns SET own_arc_transitions=1 WHERE id=?').run(campaign);
  db.prepare("INSERT INTO story_arc_transitions(from_arc_id,to_arc_id,label,campaign_id) VALUES (?,?,'собственный',?)").run(b,a,campaign);
  const foreignSetting = Number(db.prepare("INSERT INTO settings(name) VALUES ('Чужой')").run().lastInsertRowid);
  const own = await graph(`&campaign_id=${campaign}&setting_id=${foreignSetting}`);
  expect(linksBetween(own)).toHaveLength(0);
  expect(own.edges).toContainEqual(expect.objectContaining({from:`adventure:${b}`,to:`adventure:${a}`,section:'собственный'}));
  for (const query of ['', `&setting_id=${setting}`]) {
    const inherited = await graph(query);
    expect(linksBetween(inherited)).toHaveLength(1);
    expect(inherited.edges).not.toContainEqual(expect.objectContaining({section:'собственный'}));
  }
});

it('при наследовании игнорирует оставшиеся собственные строки и отсекает рёбра вне области', async () => {
  db.prepare("INSERT INTO story_arc_transitions(from_arc_id,to_arc_id,label,campaign_id) VALUES (?,?,'старый собственный',?)").run(b,a,campaign);
  const outside = Number(db.prepare("INSERT INTO story_arcs(name,setting_id) VALUES ('Вне кампании',?)").run(setting).lastInsertRowid);
  db.prepare("INSERT INTO story_arc_transitions(from_arc_id,to_arc_id,label) VALUES (?,?,'наружу')").run(a,outside);
  const inherited = await graph(`&campaign_id=${campaign}`);
  expect(linksBetween(inherited)).toHaveLength(1);
  expect(inherited.edges).not.toContainEqual(expect.objectContaining({section:'старый собственный'}));
  expect(inherited.edges).not.toContainEqual(expect.objectContaining({to:`adventure:${outside}`}));
});
