import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { sessionNotesRouter } from "./sessionNotes";

const app = express();
app.use(express.json());
app.use("/api/sessions", sessionNotesRouter);

describe("начало игры — таймер Пульта", () => {
  it("«Начать» ставит live_started_at, «Завершить» его не стирает", async () => {
    const campaign = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('[тест] Таймер')").run().lastInsertRowid);
    const session = Number(
      db.prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-31', 'planned')").run(campaign).lastInsertRowid
    );
    const started = await request(app).post(`/api/sessions/${session}/live`).send({ mode: "live", replace: true });
    expect(started.status).toBe(200);
    expect(started.body.live_started_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const ended = await request(app).post(`/api/sessions/${session}/live`).send({ mode: null });
    expect(ended.body.live_mode).toBeNull();
    expect(ended.body.live_started_at).toBe(started.body.live_started_at);
  });
});
