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

describe("роль и тактика на связи состава", () => {
  let linkId = 0;
  let lootId = 0;
  let scene2 = 0;

  beforeAll(() => {
    const settingId = (db.prepare("SELECT setting_id FROM story_scenes WHERE id = ?").get(sceneId) as { setting_id: number }).setting_id;
    const arcId = (db.prepare("SELECT arc_id FROM story_scenes WHERE id = ?").get(sceneId) as { arc_id: number }).arc_id;
    scene2 = Number(
      db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Подвал')").run(settingId, arcId).lastInsertRowid
    );
    const troll = Number(db.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Тролль')").run(settingId).lastInsertRowid);
    const link = db.prepare("INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, 'being', ?, ?)");
    linkId = Number(link.run(scene2, troll, "scene_obstacles").lastInsertRowid);
    lootId = Number(link.run(scene2, troll, "scene_loot").lastInsertRowid);
    db.prepare("INSERT INTO link_cast (link_id, qty) VALUES (?, '1к4')").run(linkId);
  });

  it("пишется и читается вместе со связью; чужие ключи отбрасываются", async () => {
    const put = await request(app)
      .put(`/api/story/cast/${linkId}/participation`)
      .send({ data: { role: "препятствие", tactic: "бьёт ближнего", mood: "x" } });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ role: "препятствие", tactic: "бьёт ближнего" });
  });

  it("у лута роли нет", async () => {
    const res = await request(app).put(`/api/story/cast/${lootId}/participation`).send({ data: { role: "x" } });
    expect(res.status).toBe(400);
  });

  it("едет в копию сцены для кампании вместе с количеством", async () => {
    await request(app).put(`/api/story/scenes/${scene2}`).send({ campaign_id: campaignId, pressure: "тесно" });
    const copy = db
      .prepare("SELECT id FROM story_scenes WHERE campaign_id = ? AND source_scene_id = ?")
      .get(campaignId, scene2) as { id: number };
    const row = db
      .prepare(
        `SELECT lc.qty, lp.data FROM generic_links l
         LEFT JOIN link_cast lc ON lc.link_id = l.id
         LEFT JOIN link_participation lp ON lp.link_id = l.id
         WHERE l.from_type = 'scene' AND l.from_id = ? AND l.section = 'scene_obstacles'`
      )
      .get(copy.id) as { qty: string; data: string };
    expect(row.qty).toBe("1к4");
    expect(JSON.parse(row.data)).toEqual({ role: "препятствие", tactic: "бьёт ближнего" });
  });

  it("уходит вместе со связью", () => {
    db.prepare("DELETE FROM generic_links WHERE id = ?").run(linkId);
    expect(db.prepare("SELECT 1 FROM link_participation WHERE link_id = ?").get(linkId)).toBeUndefined();
  });
});
