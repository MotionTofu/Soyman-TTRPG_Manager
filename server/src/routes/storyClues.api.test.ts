// Улики узлового дизайна: настоящий роутер на временной базе.
// Живая база не затрагивается никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let db: typeof import("../db/db").db;
let arcId = 0;
let campaignId = 0;
let aId = 0;
let bId = 0;
let secretId = 0;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-clues-test-"));
  process.env.DB_DIR = tmpDir;
  const { storyRouter } = await import("./story");
  db = (await import("../db/db")).db;

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/story", storyRouter);

  const id = (r: { lastInsertRowid: unknown }) => Number(r.lastInsertRowid);
  const settingId = id(db.prepare("INSERT INTO settings (name) VALUES ('S')").run());
  arcId = id(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Алхимик')").run(settingId));
  campaignId = id(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('К', ?)").run(settingId));
  const mk = (name: string) =>
    id(db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, ?)").run(settingId, arcId, name));
  aId = mk("Мастерская");
  bId = mk("Гильдия");
  secretId = id(
    db.prepare("INSERT INTO story_secrets (arc_id, kind, title) VALUES (?, 'secret', 'Инсценировка')").run(arcId)
  );
}, 120000);

describe("улики", () => {
  it("кладёт улику в узел и отдаёт её в списке приключения", async () => {
    const res = await request(app)
      .post(`/api/story/scenes/${aId}/clues`)
      .send({ text: "Фонарь с клеймом", how: "обыскать", target_type: "scene", target_id: bId });
    expect(res.status).toBe(201);
    const list = await request(app).get(`/api/story/arcs/${arcId}/clues`);
    expect(list.body.clues).toHaveLength(1);
    expect(list.body.clues[0]).toMatchObject({ node_id: aId, target_id: bId, target_missing: false, found: false });
  });

  it("не принимает несуществующую цель и улику в собственный узел", async () => {
    const bad = await request(app)
      .post(`/api/story/scenes/${aId}/clues`)
      .send({ text: "x", target_type: "scene", target_id: 99999 });
    expect(bad.status).toBe(400);
    const self = await request(app)
      .post(`/api/story/scenes/${aId}/clues`)
      .send({ text: "x", target_type: "scene", target_id: aId });
    expect(self.status).toBe(400);
    const kind = await request(app)
      .post(`/api/story/scenes/${aId}/clues`)
      .send({ text: "x", target_type: "being", target_id: 1 });
    expect(kind.status).toBe(400);
  });

  it("правка из кампании уходит в копию сцены, оригинал не трогается", async () => {
    const orig = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body.clues[0];
    const res = await request(app)
      .put(`/api/story/clues/${orig.id}`)
      .send({ campaign_id: campaignId, text: "Фонарь без клейма" });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(orig.id);
    expect(res.body.source_clue_id).toBe(orig.id);

    const plain = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body.clues;
    expect(plain.map((c: { text: string }) => c.text)).toEqual(["Фонарь с клеймом"]);
    const inCampaign = (await request(app).get(`/api/story/arcs/${arcId}/clues?campaign_id=${campaignId}`)).body.clues;
    expect(inCampaign.map((c: { text: string }) => c.text)).toEqual(["Фонарь без клейма"]);
    expect(inCampaign[0].node_id).toBe(aId);
  });

  it("«найдено» висит на исходной улике и видно через копию", async () => {
    const inCampaign = (await request(app).get(`/api/story/arcs/${arcId}/clues?campaign_id=${campaignId}`)).body
      .clues[0];
    const res = await request(app)
      .put(`/api/story/clues/${inCampaign.id}/state`)
      .send({ campaign_id: campaignId, found: true });
    expect(res.status).toBe(200);
    const after = (await request(app).get(`/api/story/arcs/${arcId}/clues?campaign_id=${campaignId}`)).body.clues[0];
    expect(after.found).toBe(true);
    expect(after.root_id).toBe(inCampaign.source_clue_id);
    // Вне кампании отметок нет.
    const plain = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body.clues[0];
    expect(plain.found).toBe(false);
  });

  it("лоток: улика без места, потом кладётся в узел", async () => {
    const created = await request(app).post(`/api/story/arcs/${arcId}/clues`).send({ text: "Пятна масла" });
    expect(created.status).toBe(201);
    let list = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body;
    expect(list.tray.map((c: { text: string }) => c.text)).toEqual(["Пятна масла"]);
    const placed = await request(app)
      .put(`/api/story/clues/${created.body.id}`)
      .send({ scene_id: bId, target_type: "secret", target_id: secretId });
    expect(placed.status).toBe(200);
    list = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body;
    expect(list.tray).toHaveLength(0);
    const onB = list.clues.find((c: { text: string }) => c.text === "Пятна масла");
    expect(onB).toMatchObject({ node_id: bId, target_type: "secret", target_title: "Инсценировка" });
  });

  it("цель в архиве — «ведёт в никуда», улика остаётся", async () => {
    db.prepare("UPDATE story_scenes SET archived_at = datetime('now') WHERE id = ?").run(bId);
    const list = (await request(app).get(`/api/story/arcs/${arcId}/clues`)).body;
    const toB = list.clues.find((c: { target_id: number }) => c.target_id === bId);
    expect(toB.target_missing).toBe(true);
    db.prepare("UPDATE story_scenes SET archived_at = NULL WHERE id = ?").run(bId);
  });

  it("удаление сцены уносит её улики", async () => {
    const tmp = Number(
      (
        db
          .prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES ((SELECT setting_id FROM story_arcs WHERE id = ?), ?, 'Временная')")
          .run(arcId, arcId) as { lastInsertRowid: unknown }
      ).lastInsertRowid
    );
    await request(app).post(`/api/story/scenes/${tmp}/clues`).send({ text: "уйдёт" });
    db.prepare("DELETE FROM story_scenes WHERE id = ?").run(tmp);
    const left = db.prepare("SELECT COUNT(*) AS n FROM story_clues WHERE text = 'уйдёт'").get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("поля узла", () => {
  it("сохраняет тип, роль, триггер и «о ком»; копия кампании их несёт", async () => {
    const res = await request(app).put(`/api/story/scenes/${bId}`).send({
      node_type: "organization",
      node_role: "proactive",
      node_trigger: "шум в гильдии",
      subject_type: "community",
      subject_id: 7,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ node_type: "organization", node_role: "proactive", subject_id: 7 });

    const copy = await request(app).put(`/api/story/scenes/${bId}`).send({ campaign_id: campaignId, summary: "своё" });
    expect(copy.body.source_scene_id).toBe(bId);
    expect(copy.body).toMatchObject({ node_type: "organization", node_role: "proactive", node_trigger: "шум в гильдии" });
  });

  it("не принимает неизвестные тип и роль и половину «о ком»", async () => {
    expect((await request(app).put(`/api/story/scenes/${aId}`).send({ node_role: "boss" })).status).toBe(400);
    expect((await request(app).put(`/api/story/scenes/${aId}`).send({ node_type: "dungeon" })).status).toBe(400);
    expect((await request(app).put(`/api/story/scenes/${aId}`).send({ subject_type: "being" })).status).toBe(400);
    expect((await request(app).put(`/api/story/scenes/${aId}`).send({ node_type: null })).status).toBe(200);
  });
});
