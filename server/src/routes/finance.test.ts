import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { db } from "../db/db";
import { financeRouter } from "./finance";

it("сводка считает активные кампании мастера независимо от проведённых сессий", async () => {
  db.exec(`
    INSERT INTO campaigns (id, name, role, status, archived_at) VALUES
      (1, 'Без сессий', 'gm', 'active', NULL),
      (2, 'На паузе', 'gm', 'paused', NULL),
      (3, 'Завершена', 'gm', 'completed', NULL),
      (4, 'В роли игрока', 'player', 'active', NULL),
      (5, 'В архиве', 'gm', 'active', '2026-11-01');
    INSERT INTO sessions (campaign_id, date, status) VALUES
      (2, '2026-10-01', 'held'), (3, '2026-10-02', 'held'),
      (4, '2026-10-03', 'held'), (5, '2026-10-04', 'held');
  `);

  const app = express().use("/finance", financeRouter);
  const initial = await request(app).get("/finance/summary").expect(200);
  expect(initial.body).toMatchObject({ campaigns: 1, heldSessions: 2, playedSessions: 1 });

  db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = 1").run();
  const afterPause = await request(app).get("/finance/summary").expect(200);
  expect(afterPause.body).toMatchObject({ campaigns: 0, heldSessions: 2, playedSessions: 1 });
});
