// «Выдача» кампании (спека campaign-paper, Q30/Q35/Q40): сводка открытого и
// артефакты как новая цель выдачи.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { visibilityGrantsRouter } from "./visibilityGrants";
import { getSettingPlayerContent } from "../services/playerContent";

let app: express.Express;
let campaignId = 0;
let anya = 0;
let boris = 0;
let stone = 0;
let port = 0;

beforeAll(() => {
  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Выдачный')").run().lastInsertRowid);
  campaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Выдача', ?)").run(settingId).lastInsertRowid);
  const player = db.prepare("INSERT INTO players (name) VALUES (?)");
  anya = Number(player.run("Аня-выдача").lastInsertRowid);
  boris = Number(player.run("Борис-выдача").lastInsertRowid);
  const roster = db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)");
  roster.run(campaignId, anya);
  roster.run(campaignId, boris);
  stone = Number(
    db.prepare("INSERT INTO artifacts (setting_id, name, description, notes) VALUES (?, 'Камень Голорра', 'Тёплый', 'тайна Мастера')").run(settingId)
      .lastInsertRowid
  );
  port = Number(db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Порт Вилла')").run(settingId).lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/visibility-grants", visibilityGrantsRouter);
});

describe("выдача: сводка и артефакты", () => {
  it("артефакт открывается игроку без мастерских полей", async () => {
    const res = await request(app)
      .post("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: anya, target_type: "setting_artifact", target_id: stone });
    expect(res.status).toBe(201);
    const content = getSettingPlayerContent(campaignId, anya);
    expect(content.artifacts).toEqual([
      expect.objectContaining({ id: stone, name: "Камень Голорра", description: "Тёплый", access_level: "open" }),
    ]);
    expect(content.artifacts[0]).not.toHaveProperty("notes");
    expect(getSettingPlayerContent(campaignId, boris).artifacts).toEqual([]);
  });

  it("сводка — только открытое, с игроками и признаком «всем»", async () => {
    await request(app)
      .post("/api/visibility-grants/batch")
      .send({ campaign_id: campaignId, player_ids: [anya, boris], targets: [{ target_type: "setting_location", target_id: port }], action: "grant" });
    const res = await request(app).get(`/api/visibility-grants/summary?campaign_id=${campaignId}`);
    expect(res.body.map((i: { name: string; all: boolean }) => [i.name, i.all])).toEqual([
      ["Камень Голорра", false],
      ["Порт Вилла", true],
    ]);
    expect(res.body[0].players.map((p: { name: string }) => p.name)).toEqual(["Аня-выдача"]);
  });
});
