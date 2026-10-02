// Участие (гриллинг профилей 2026-10-02, Q16/Q19): участники приключения
// собираются из составов сцен плюс закулисные силы; ход событий и «почему
// здесь» персонажа хранятся по закрытому набору ключей.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { participationsRouter } from "./participations";

let app: express.Express;
let arcId = 0;
let chapterId = 0;
let xanathar = 0;
let lurker = 0;
let cult = 0;
let campaignId = 0;
let characterId = 0;

beforeAll(() => {
  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Вотердип')").run().lastInsertRowid);
  arcId = Number(
    db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Ограбление дракона')").run(settingId).lastInsertRowid
  );
  chapterId = Number(
    db.prepare("INSERT INTO story_arcs (setting_id, parent_id, name, kind) VALUES (?, ?, 'Глава 1', 'chapter')")
      .run(settingId, arcId).lastInsertRowid
  );
  const scene = Number(
    db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Тролль из колодца')")
      .run(settingId, chapterId).lastInsertRowid
  );
  const being = (name: string) =>
    Number(db.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, ?)").run(settingId, name).lastInsertRowid);
  xanathar = being("Ксанатар");
  lurker = being("Завсегдатай");
  cult = Number(
    db.prepare("INSERT INTO setting_communities (setting_id, name) VALUES (?, 'Культ Дракона')").run(settingId).lastInsertRowid
  );
  const link = db.prepare("INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, ?, ?, ?)");
  link.run(scene, "being", xanathar, "scene_plot_characters");
  // Лут и локации участниками не становятся.
  link.run(scene, "being", lurker, "scene_loot");

  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Золото Вотердипа')").run().lastInsertRowid);
  const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Аня')").run().lastInsertRowid);
  characterId = Number(
    db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Ренна')")
      .run(playerId, campaignId).lastInsertRowid
  );

  app = express();
  app.use(express.json());
  app.use("/api/participations", participationsRouter);
});

describe("участники приключения", () => {
  it("берутся из составов сцен его глав, кроме лута", async () => {
    const res = await request(app).get(`/api/participations/adventure/${arcId}`);
    expect(res.status).toBe(200);
    const names = res.body.participants.map((p: { name: string }) => p.name);
    expect(names).toEqual(["Ксанатар"]);
    expect(res.body.participants[0].scenes).toEqual([expect.objectContaining({ name: "Тролль из колодца" })]);
    expect(res.body.participants[0].manual).toBe(false);
  });

  it("хранят ход событий по словарю, чужие ключи отбрасываются", async () => {
    const put = await request(app)
      .put(`/api/participations/adventure/${arcId}/being/${xanathar}`)
      .send({ data: { goal: "Камень Голорра", if_deprived: "торгуется", hacked: "x" } });
    expect(put.status).toBe(200);
    const res = await request(app).get(`/api/participations/adventure/${arcId}`);
    expect(res.body.participants[0].data).toEqual({ goal: "Камень Голорра", if_deprived: "торгуется" });
  });

  it("закулисная сила добавляется руками и убирается целиком", async () => {
    await request(app).put(`/api/participations/adventure/${arcId}/community/${cult}`).send({ manual: true });
    let res = await request(app).get(`/api/participations/adventure/${arcId}`);
    expect(res.body.participants.map((p: { name: string; manual: boolean }) => [p.name, p.manual])).toEqual([
      ["Ксанатар", false],
      ["Культ Дракона", true],
    ]);
    await request(app).delete(`/api/participations/adventure/${arcId}/community/${cult}`);
    res = await request(app).get(`/api/participations/adventure/${arcId}`);
    expect(res.body.participants.map((p: { name: string }) => p.name)).toEqual(["Ксанатар"]);
  });

  it("участник из сцены при удалении теряет только ход событий", async () => {
    await request(app).delete(`/api/participations/adventure/${arcId}/being/${xanathar}`);
    const res = await request(app).get(`/api/participations/adventure/${arcId}`);
    expect(res.body.participants).toEqual([expect.objectContaining({ name: "Ксанатар", data: {} })]);
  });

  it("персонажа игрока участником приключения не делает", async () => {
    const res = await request(app).put(`/api/participations/adventure/${arcId}/character/${characterId}`).send({ manual: true });
    expect(res.status).toBe(400);
  });
});

describe("персонаж в кампании", () => {
  it("хранит почему здесь · ставку · почему сейчас", async () => {
    const put = await request(app)
      .put(`/api/participations/campaign/${campaignId}/character/${characterId}`)
      .send({ data: { why_here: "должна гильдии", stake: "брат", goal: "не отсюда" } });
    expect(put.status).toBe(200);
    const res = await request(app).get(`/api/participations/campaign/${campaignId}/character/${characterId}`);
    expect(res.body.data).toEqual({ why_here: "должна гильдии", stake: "брат" });
  });

  it("не пишет участие в чужой кампании", async () => {
    const res = await request(app)
      .put(`/api/participations/campaign/${campaignId + 999}/character/${characterId}`)
      .send({ data: { why_here: "x" } });
    expect(res.status).toBe(400);
  });
});

describe("«Участвует» у существа", () => {
  it("приключение с целью, под ним сцены из его глав", async () => {
    await request(app)
      .put(`/api/participations/adventure/${arcId}/being/${xanathar}`)
      .send({ data: { goal: "вернуть золото" } });
    const res = await request(app).get(`/api/participations/entity/being/${xanathar}`);
    expect(res.status).toBe(200);
    expect(res.body.adventures).toEqual([
      expect.objectContaining({
        id: arcId,
        name: "Ограбление дракона",
        goal: "вернуть золото",
        scenes: [expect.objectContaining({ name: "Тролль из колодца", section: "scene_plot_characters" })],
      }),
    ]);
  });

  it("лут участником не делает", async () => {
    const res = await request(app).get(`/api/participations/entity/being/${lurker}`);
    expect(res.body.adventures).toEqual([]);
  });

  it("закулисная сила видна без сцен", async () => {
    await request(app).put(`/api/participations/adventure/${arcId}/community/${cult}`).send({ manual: true });
    const res = await request(app).get(`/api/participations/entity/community/${cult}`);
    expect(res.body.adventures).toEqual([expect.objectContaining({ id: arcId, manual: true, scenes: [] })]);
  });
});
