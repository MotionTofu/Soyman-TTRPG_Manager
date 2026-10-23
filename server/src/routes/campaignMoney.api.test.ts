// Деньги кампании (спека campaign-paper, Q33/Q37–Q39): заработок считает
// внесённое за любую существующую сессию и «Сверх сессий»; перенос денег
// отменённой сессии перед удалением.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { campaignsRouter } from "./campaigns";
import { sessionsRouter } from "./sessions";
import { campaignEarnings } from "../services/finance";

let app: express.Express;
let campaignId = 0;
let anya = 0;
let held = 0;
let cancelled = 0;

beforeAll(() => {
  campaignId = Number(db.prepare("INSERT INTO campaigns (name, payment_type) VALUES ('Платная', 'paid')").run().lastInsertRowid);
  anya = Number(db.prepare("INSERT INTO players (name) VALUES ('Аня-деньги')").run().lastInsertRowid);
  const session = db.prepare("INSERT INTO sessions (campaign_id, date, status, archived_at) VALUES (?, ?, ?, ?)");
  held = Number(session.run(campaignId, "2026-09-01", "held", null).lastInsertRowid);
  cancelled = Number(session.run(campaignId, "2026-09-25", "planned", "2026-09-25 12:00:00").lastInsertRowid);
  const pay = db.prepare("INSERT INTO session_attendance (session_id, player_id, attended, amount_paid) VALUES (?, ?, 1, ?)");
  pay.run(held, anya, 500);
  pay.run(cancelled, anya, 1500);
  app = express();
  app.use(express.json());
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/sessions", sessionsRouter);
});

describe("деньги кампании", () => {
  it("архивная сессия считается, пока существует; «Сверх сессий» — тоже", async () => {
    expect(campaignEarnings(campaignId).earned).toBe(2000);
    const res = await request(app)
      .post(`/api/campaigns/${campaignId}/extra-payments`)
      .send({ date: "2026-09-12", amount: 1200, player_id: anya, comment: "за распечатки карт" });
    expect(res.status).toBe(201);
    expect(campaignEarnings(campaignId)).toEqual({ earned: 3200, heldSessions: 1 });
    expect((await request(app).post(`/api/campaigns/${campaignId}/extra-payments`).send({ date: "2026-09-12", amount: 0 })).status).toBe(400);
  });

  it("перенос денег отменённой сессии в «Сверх сессий» не задваивает заработок", async () => {
    expect((await request(app).get(`/api/sessions/${cancelled}/paid`)).body.total).toBe(1500);
    const moved = await request(app).post(`/api/sessions/${cancelled}/paid-to-extra`);
    expect(moved.body.moved).toBe(1500);
    expect(campaignEarnings(campaignId).earned).toBe(3200);
    const list = (await request(app).get(`/api/campaigns/${campaignId}/extra-payments`)).body as { comment: string; date: string }[];
    expect(list.map((e) => e.comment)).toContain("из отменённой сессии от 25.09.2026");
    db.prepare("DELETE FROM sessions WHERE id = ?").run(cancelled);
    expect(campaignEarnings(campaignId).earned).toBe(3200);
  });

  it("«Оплатил» закрывает весь долг игрока полной ставкой, «Отменить» возвращает прежнее", async () => {
    const debtor = Number(db.prepare("INSERT INTO players (name) VALUES ('Боря-должник')").run().lastInsertRowid);
    const paid = Number(db.prepare("INSERT INTO campaigns (name, payment_type, session_rate, rate_split) VALUES ('Долги', 'paid', 600, 'per_person')").run().lastInsertRowid);
    db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(paid, debtor);
    const s = db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?, ?, 'held')");
    const a = Number(s.run(paid, "2026-09-01").lastInsertRowid);
    const b = Number(s.run(paid, "2026-09-08").lastInsertRowid);
    db.prepare("INSERT INTO session_attendance (session_id, player_id, attended, amount_paid, amount_forgiven) VALUES (?, ?, 1, ?, ?)").run(a, debtor, 200, 0);
    db.prepare("INSERT INTO session_attendance (session_id, player_id, attended, amount_paid, amount_forgiven) VALUES (?, ?, 1, ?, ?)").run(b, debtor, 0, 100);
    const debts = async () => (await request(app).get(`/api/campaigns/${paid}/debts`)).body as { owed: number }[];
    expect((await debts())[0].owed).toBe(900);

    const settled = await request(app).post(`/api/campaigns/${paid}/debts/${debtor}/settle`);
    expect(settled.status).toBe(200);
    expect(await debts()).toEqual([]);
    const amount = db.prepare("SELECT amount_paid FROM session_attendance WHERE session_id = ? AND player_id = ?");
    expect((amount.get(b, debtor) as { amount_paid: number }).amount_paid).toBe(500);

    const restored = await request(app).post(`/api/campaigns/${paid}/debts/${debtor}/restore`).send(settled.body);
    expect(restored.status).toBe(200);
    expect((await debts())[0].owed).toBe(900);
    expect((await request(app).post(`/api/campaigns/${paid}/debts/${debtor}/restore`).send({ before: "x" })).status).toBe(400);
  });
});
