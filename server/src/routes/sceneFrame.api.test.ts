// Рамка и ход сцены-узла (гриллинг профилей 2026-10-02, Q12): сохраняются
// правкой сцены и уходят в её копию для кампании вместе с остальными текстами.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { storyRouter } from "./story";

let app: express.Express;
let sceneId = 0;
let campaignId = 0;

beforeAll(() => {
  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Вотердип')").run().lastInsertRowid);
  const arcId = Number(
    db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Ограбление дракона')").run(settingId).lastInsertRowid
  );
  sceneId = Number(
    db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Тролль из колодца')")
      .run(settingId, arcId).lastInsertRowid
  );
  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Золото Вотердипа')").run().lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/story", storyRouter);
});

describe("рамка сцены", () => {
  it("сохраняется правкой сцены", async () => {
    const put = await request(app).put(`/api/story/scenes/${sceneId}`).send({
      frame_where: "Зияющий портал",
      frame_why_now: "лебёдка заскрипела",
      pressure: "тролль ломится к стойке",
      cut_when: "тролль упал",
    });
    expect(put.status).toBe(200);
    const row = db.prepare("SELECT frame_where, frame_why_now, pressure, cut_when, twists FROM story_scenes WHERE id = ?").get(sceneId);
    expect(row).toEqual({
      frame_where: "Зияющий портал",
      frame_why_now: "лебёдка заскрипела",
      pressure: "тролль ломится к стойке",
      cut_when: "тролль упал",
      twists: "",
    });
  });

  it("уходит в копию сцены для кампании", async () => {
    const put = await request(app)
      .put(`/api/story/scenes/${sceneId}`)
      .send({ campaign_id: campaignId, twists: "Дурнан бросает ключ" });
    expect(put.status).toBe(200);
    const copy = db
      .prepare("SELECT frame_where, pressure, twists FROM story_scenes WHERE campaign_id = ? AND source_scene_id = ?")
      .get(campaignId, sceneId);
    expect(copy).toEqual({ frame_where: "Зияющий портал", pressure: "тролль ломится к стойке", twists: "Дурнан бросает ключ" });
    // Оригинал правка кампании не задевает.
    const original = db.prepare("SELECT twists FROM story_scenes WHERE id = ?").get(sceneId);
    expect(original).toEqual({ twists: "" });
  });
});
