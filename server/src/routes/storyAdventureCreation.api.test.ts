import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { storyRouter } from "./story";

let app: express.Express;
let settingId: number;
let campaignId: number;
let otherCampaignId: number;
let foreignCampaignId: number;

beforeAll(() => {
  const insertId = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  settingId = insertId("INSERT INTO settings (name) VALUES ('Тестовый сеттинг')");
  const foreignSettingId = insertId("INSERT INTO settings (name) VALUES ('Другой тестовый сеттинг')");
  campaignId = insertId("INSERT INTO campaigns (name, setting_id) VALUES ('Тестовая кампания', ?)", settingId);
  otherCampaignId = insertId("INSERT INTO campaigns (name, setting_id) VALUES ('Другая тестовая кампания', ?)", settingId);
  foreignCampaignId = insertId("INSERT INTO campaigns (name, setting_id) VALUES ('Чужой сеттинг', ?)", foreignSettingId);
  const authorId = insertId("INSERT INTO users (username, password_hash, role) VALUES ('test-story-author', 'test', 'gm')");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { user: { id: authorId, role: "gm", playerId: null } });
    next();
  });
  app.use("/api/story", storyRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "test write failed" });
  });
});

describe("создание приключения сеттинга из кампании", () => {
  it("сохраняет всю форму в сеттинг, добавляет только в текущую кампанию и оставляет доступным для других", async () => {
    const fields = {
      name: "Тест: новое приключение", description: "Тестовый логлайн", hook: "Тестовая завязка",
      recommended_level: "3–5", player_count: "4", duration: "2 встречи", source: "Тест", tags: "тайна",
    };
    const created = await request(app).post("/api/story/arcs").send({
      setting_id: settingId, attach_campaign_id: campaignId, ...fields,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...fields, setting_id: settingId, campaign_id: null, source_arc_id: null });
    const arcId = created.body.id as number;
    const list = await request(app).get(`/api/story/arcs?setting_id=${settingId}`);
    expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: arcId, ...fields })]));
    const tree = await request(app).get(`/api/story/campaign-tree?campaign_id=${campaignId}`);
    expect(tree.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: arcId, chapters: [], scenes: [] })]));
    const otherTree = await request(app).get(`/api/story/campaign-tree?campaign_id=${otherCampaignId}`);
    expect(otherTree.body.some((a: { id: number }) => a.id === arcId)).toBe(false);
    const available = await request(app).get(`/api/story/campaign-adventures/available?campaign_id=${otherCampaignId}`);
    expect(available.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: arcId })]));
    expect(db.prepare("SELECT id FROM workbook_instances WHERE project_type = 'adventure' AND project_id = ?").get(arcId)).toBeDefined();
  });

  it("добавляет в конец списка и при повторной привязке не создаёт дубль", async () => {
    const created = await request(app).post("/api/story/arcs").send({
      setting_id: settingId, name: "Тест: следующее приключение", attach_campaign_id: campaignId,
    });
    expect(created.status).toBe(201);
    const attached = await request(app).post("/api/story/campaign-adventures").send({ campaign_id: campaignId, arc_id: created.body.id });
    expect(attached.status).toBe(201);
    const links = db.prepare("SELECT arc_id, position FROM campaign_adventures WHERE campaign_id = ? ORDER BY position").all(campaignId);
    expect(links).toEqual([
      expect.objectContaining({ position: 0 }),
      { arc_id: created.body.id, position: 1 },
    ]);
  });

  it("отклоняет чужой сеттинг, отсутствующую кампанию и смешение с локальным приключением", async () => {
    for (const extra of [
      { attach_campaign_id: foreignCampaignId },
      { attach_campaign_id: 999999 },
      { attach_campaign_id: campaignId, campaign_id: campaignId },
      { attach_campaign_id: campaignId, parent_id: 1 },
    ]) {
      const res = await request(app).post("/api/story/arcs").send({ setting_id: settingId, name: "Тест: отклонённое", ...extra });
      expect(res.status).toBe(400);
    }
    expect(db.prepare("SELECT id FROM story_arcs WHERE name = 'Тест: отклонённое'").get()).toBeUndefined();
  });

  it("при сбое привязки не оставляет приключение и его тетрадь", async () => {
    db.exec(`CREATE TEMP TRIGGER fail_campaign_adventure BEFORE INSERT ON campaign_adventures
             BEGIN SELECT RAISE(ABORT, 'test attachment failure'); END`);
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM workbook_instances").get() as { n: number }).n;
    const before = count();
    try {
      const res = await request(app).post("/api/story/arcs").send({
        setting_id: settingId, name: "Тест: откат создания", attach_campaign_id: campaignId,
      });
      expect(res.status).toBe(500);
      expect(db.prepare("SELECT id FROM story_arcs WHERE name = 'Тест: откат создания'").get()).toBeUndefined();
      expect(count()).toBe(before);
    } finally {
      db.exec("DROP TRIGGER fail_campaign_adventure");
    }
  });

  it("сохраняет прежние режимы создания в сеттинге и только в кампании", async () => {
    const shared = await request(app).post("/api/story/arcs").send({ setting_id: settingId, name: "Тест: общее" });
    const own = await request(app).post("/api/story/arcs").send({ setting_id: settingId, name: "Тест: своё", campaign_id: campaignId });
    expect(shared.status).toBe(201);
    expect(shared.body.campaign_id).toBeNull();
    expect(own.status).toBe(201);
    expect(own.body.campaign_id).toBe(campaignId);
    for (const arc of [shared.body, own.body]) {
      expect(db.prepare("SELECT arc_id FROM campaign_adventures WHERE arc_id = ?").get(arc.id)).toBeUndefined();
    }
  });
});
