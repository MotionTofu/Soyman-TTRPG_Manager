import { beforeEach, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { campaignsRouter } from "./campaigns";
import { playersRouter } from "./players";
import { forPlayer } from "../services/reminderDue";

// Срок напоминания «к сессии №N» (гриллинг В4, 2026-11-04); изолированная база setupTempDb.ts.
const app = express();
app.use(express.json());
app.use("/api/campaigns", campaignsRouter);
app.use("/api/players", playersRouter);

let campaign: number, other: number, player: number, s1: number, s2: number, s3: number;
const session = (c: number, date: string, status = "planned") =>
  Number(db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?, ?, ?)").run(c, date, status).lastInsertRowid);
beforeEach(() => {
  campaign = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Срок')").run().lastInsertRowid);
  other = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Чужая')").run().lastInsertRowid);
  player = Number(db.prepare("INSERT INTO players (name) VALUES ('Вера')").run().lastInsertRowid);
  session(campaign, "2026-10-01", "held");
  s1 = session(campaign, "2026-11-08");
  s2 = session(campaign, "2026-11-22");
  s3 = session(campaign, "2026-12-06");
});
const list = async () => (await request(app).get(`/api/campaigns/${campaign}/reminders`)).body as { id: number; due: { session_id: number; number: number; date: string; expired: boolean } | null }[];
const add = (body: object) => request(app).post(`/api/campaigns/${campaign}/reminders`).send(body);

it("без срока по умолчанию; срок — номер и дата выбранной сессии", async () => {
  expect((await add({ message: "без срока" })).body.due).toBeNull();
  const r = await add({ message: "чарники", due_session_id: s1 });
  expect(r.status).toBe(201);
  expect(r.body.due).toEqual({ session_id: s1, number: 2, date: "2026-11-08", expired: false });
});

it("принимает только запланированную сессию этой кампании", async () => {
  const held = Number(db.prepare("SELECT id FROM sessions WHERE campaign_id = ? AND status = 'held'").get(campaign)!.id);
  expect((await add({ message: "x", due_session_id: held })).status).toBe(400);
  expect((await add({ message: "x", due_session_id: session(other, "2026-11-09") })).status).toBe(400);
  expect((await add({ message: "x", due_session_id: 999999 })).status).toBe(400);
});

it("истекает по отметке «проведена», а не по дате", async () => {
  await add({ message: "x", due_session_id: s1 });
  db.prepare("UPDATE sessions SET date = '2020-01-01' WHERE id = ?").run(s1);
  expect((await list())[0].due!.expired).toBe(false);
  db.prepare("UPDATE sessions SET status = 'held' WHERE id = ?").run(s1);
  expect((await list())[0].due!.expired).toBe(true);
});

it("сессия в архиве → следующая с тем же номером; вернули — снова к ней; следующей нет — без срока", async () => {
  await add({ message: "x", due_session_id: s2 });
  db.prepare("UPDATE sessions SET archived_at = datetime('now') WHERE id = ?").run(s2);
  expect((await list())[0].due).toEqual({ session_id: s3, number: 3, date: "2026-12-06", expired: false });
  db.prepare("UPDATE sessions SET archived_at = NULL WHERE id = ?").run(s2);
  expect((await list())[0].due!.session_id).toBe(s2);
  db.prepare("UPDATE sessions SET archived_at = datetime('now') WHERE id IN (?, ?)").run(s2, s3);
  expect((await list())[0].due).toBeNull();
});

it("игроку истёкшее не отдаётся, Мастеру — отдаётся", async () => {
  await add({ message: "истечёт", due_session_id: s1 });
  await add({ message: "висит" });
  db.prepare("UPDATE sessions SET status = 'held' WHERE id = ?").run(s1);
  const rows = db.prepare("SELECT * FROM gm_reminders WHERE target_type = 'campaign' AND target_id = ?").all(campaign) as { message: string; due_session_id: number | null }[];
  expect(forPlayer(rows).map((r) => r.message)).toEqual(["висит"]);
  expect((await list()).length).toBe(2);
});

it("личное напоминание игроку: срок из любой кампании, только запланированный", async () => {
  const r = await request(app).post(`/api/players/${player}/reminders`).send({ message: "миниатюра", due_session_id: s1 });
  expect(r.body.due.session_id).toBe(s1);
  const back = (await request(app).get(`/api/players/${player}/reminders`)).body;
  expect(back[0].due.number).toBe(2);
});
