// Паспорт вечера и «Что изменилось» у сессии (спека campaign-paper, Q42/Q45).
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { sessionsRouter } from "./sessions";

let app: express.Express;
let sessionId = 0;

beforeAll(() => {
  const campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('С паспортом')").run().lastInsertRowid);
  sessionId = Number(db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-09')").run(campaignId).lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
});

describe("паспорт сессии", () => {
  it("пишет закрытые наборы ключей и отдаёт их разобранными", async () => {
    const res = await request(app)
      .put(`/api/sessions/${sessionId}/passport`)
      .send({ passport: { questions: "Кто сдал партию?", hack: "x" }, outcomes: { goal: "ключ добыт", cost: "" } });
    expect(res.body).toEqual({ passport: { questions: "Кто сдал партию?" }, outcomes: { goal: "ключ добыт" } });
    const got = await request(app).get(`/api/sessions/${sessionId}`);
    expect(got.body.passport).toEqual({ questions: "Кто сдал партию?" });
    expect(got.body.outcomes).toEqual({ goal: "ключ добыт" });
  });
});
