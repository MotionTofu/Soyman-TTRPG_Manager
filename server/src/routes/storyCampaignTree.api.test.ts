// Сессии сцены в дереве «Сюжета» кампании: настоящий роутер на временной базе.
// Живая база не затрагивается никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let campaignId = 0;
let sceneId = 0;
let heldId = 0;
let nextId = 0;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-campaign-tree-test-"));
  process.env.DB_DIR = tmpDir;
  const { storyRouter } = await import("./story");
  const { db } = await import("../db/db");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/story", storyRouter);

  const id = (sql: string, ...args: unknown[]) =>
    Number((db.prepare(sql).run(...args) as { lastInsertRowid: unknown }).lastInsertRowid);
  const settingId = id("INSERT INTO settings (name) VALUES ('S')");
  const arcId = id("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'A')", settingId);
  campaignId = id("INSERT INTO campaigns (name, setting_id) VALUES ('C', ?)", settingId);
  db.prepare("INSERT INTO campaign_adventures (campaign_id, arc_id) VALUES (?, ?)").run(campaignId, arcId);
  sceneId = id("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Сады')", settingId, arcId);

  heldId = id("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-01', 'held')", campaignId);
  nextId = id("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-30', 'planned')", campaignId);
  const cancelled = id("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-15', 'cancelled')", campaignId);
  // Сыграна в первой (запущена дважды — строка одна), запланирована на следующую;
  // план отменённой сессии не считается.
  db.prepare("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?), (?, ?)").run(heldId, sceneId, heldId, sceneId);
  db.prepare("INSERT INTO session_planned_scenes (session_id, scene_id) VALUES (?, ?), (?, ?), (?, ?)").run(
    heldId, sceneId, nextId, sceneId, cancelled, sceneId
  );
}, 120000);

describe("GET /story/campaign-tree — сессии сцены", () => {
  it("отдаёт сыгранную и запланированную сессию по дате", async () => {
    const res = await request(app).get(`/api/story/campaign-tree?campaign_id=${campaignId}`);
    expect(res.status).toBe(200);
    const scene = res.body.flatMap((a: { scenes: { id: number }[] }) => a.scenes).find((s: { id: number }) => s.id === sceneId);
    expect(scene.sessions).toEqual([
      { id: heldId, date: "2026-10-01", number: 1, played: true },
      { id: nextId, date: "2026-10-30", number: 2, played: false },
    ]);
  });
});
