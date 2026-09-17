// Сигнал «данные кампании изменились» (группа «кампании», часть 3).
//
// Проверяется то, что нельзя увидеть глазами: кому ушёл сигнал. Лишний
// получатель — это игрок чужой кампании, узнающий, что там что-то меняется;
// пропущенный — экран игрока, который так и не увидел выданное.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { campaignSignalMiddleware } from "./campaignSignals";

let settingId = 0;
let campaignId = 0;
let otherCampaignId = 0;
let archivedCampaignId = 0;
let rosterPlayer = 0;
let characterPlayer = 0;
let strangerPlayer = 0;
let sectionId = 0;
let locationId = 0;

let sent: { room: string; campaignId: number }[] = [];
let role: "gm" | "player" = "gm";

function makeApp(handler: express.RequestHandler): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { id: 1, role, playerId: role === "player" ? rosterPlayer : undefined };
    next();
  });
  app.use("/api", campaignSignalMiddleware((room, payload) => sent.push({ room, campaignId: payload.campaignId })));
  app.use("/api", handler);
  return app;
}

const ok: express.RequestHandler = (_req, res) => {
  res.json({ ok: true });
};

beforeAll(() => {
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Сигнальный мир')").run().lastInsertRowid);
  campaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Стол А', ?)").run(settingId).lastInsertRowid);
  otherCampaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Стол Б', ?)").run(settingId).lastInsertRowid);
  archivedCampaignId = Number(
    db.prepare("INSERT INTO campaigns (name, setting_id, archived_at) VALUES ('Стол В', ?, datetime('now'))").run(settingId).lastInsertRowid
  );
  rosterPlayer = Number(db.prepare("INSERT INTO players (name) VALUES ('Из состава')").run().lastInsertRowid);
  characterPlayer = Number(db.prepare("INSERT INTO players (name) VALUES ('С персонажем')").run().lastInsertRowid);
  strangerPlayer = Number(db.prepare("INSERT INTO players (name) VALUES ('Чужой')").run().lastInsertRowid);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, rosterPlayer);
  db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Герой')").run(characterPlayer, campaignId);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(otherCampaignId, strangerPlayer);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(archivedCampaignId, strangerPlayer);
  sectionId = Number(
    db.prepare("INSERT INTO campaign_player_sections (campaign_id, name, kind) VALUES (?, 'Записки', 'articles')").run(campaignId).lastInsertRowid
  );
  locationId = Number(db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Порт')").run(settingId).lastInsertRowid);
});

beforeEach(() => {
  sent = [];
  role = "gm";
});

const rooms = () => sent.map((s) => s.room).sort();

describe("сигнал «данные кампании изменились»", () => {
  it("выдача Мастера доходит до игроков кампании — и только до них", async () => {
    await request(makeApp(ok)).post("/api/visibility-grants").send({ campaign_id: campaignId }).expect(200);
    expect(rooms()).toEqual([`player:${characterPlayer}`, `player:${rosterPlayer}`].sort());
    expect(sent.every((s) => s.campaignId === campaignId)).toBe(true);
  });

  it("правка Мастера не шлётся Мастеру, правка игрока — шлётся", async () => {
    await request(makeApp(ok)).post("/api/visibility-grants").send({ campaign_id: campaignId });
    expect(rooms()).not.toContain("gm");
    sent = [];
    role = "player";
    await request(makeApp(ok)).post(`/api/player/campaigns/${campaignId}/world-entries`).send({});
    expect(rooms()).toContain("gm");
  });

  it("удалённая строка находит свою кампанию: правило срабатывает до удаления", async () => {
    const articleId = Number(
      db.prepare("INSERT INTO campaign_player_articles (section_id, title, content) VALUES (?, 'Письмо', '')").run(sectionId).lastInsertRowid
    );
    const remove: express.RequestHandler = (_req, res) => {
      db.prepare("DELETE FROM campaign_player_articles WHERE id = ?").run(articleId);
      res.json({ ok: true });
    };
    await request(makeApp(remove)).delete(`/api/campaign-player-sections/articles/${articleId}`).expect(200);
    expect(sent.map((s) => s.campaignId)).toContain(campaignId);
  });

  it("отказ и чтение сигнала не дают", async () => {
    const fail: express.RequestHandler = (_req, res) => {
      res.status(500).json({ error: "нет" });
    };
    await request(makeApp(fail)).post("/api/visibility-grants").send({ campaign_id: campaignId });
    await request(makeApp(ok)).get(`/api/campaigns/${campaignId}`);
    expect(sent).toEqual([]);
  });

  it("правка сущности сеттинга доходит до всех живых кампаний сеттинга, но не до архивных", async () => {
    await request(makeApp(ok)).put(`/api/setting-locations/${locationId}`).send({ player_text: "слух" });
    const campaigns = new Set(sent.map((s) => s.campaignId));
    expect(campaigns).toEqual(new Set([campaignId, otherCampaignId]));
    expect(campaigns.has(archivedCampaignId)).toBe(false);
  });

  it("запись вне кампании сигнала не даёт", async () => {
    await request(makeApp(ok)).put("/api/app-settings/theme").send({});
    await request(makeApp(ok)).post("/api/players").send({ name: "x" });
    expect(sent).toEqual([]);
  });
});
