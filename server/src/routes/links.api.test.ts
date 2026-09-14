// Два графа вместо одного (решения 2026-09-12): сервер разделяет сборку
//.world и adventures, каждый вид видит только свои рёбра и узлы.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { linksRouter } from "./links";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use("/api/links", linksRouter);
});

describe("GET /links/graph?view=", () => {
  let settingId: number;
  let beingId: number;
  let locationId: number;
  let communityId: number;
  let arcId: number;
  let sceneId: number;
  let campaignId: number;
  let sessionId: number;

  beforeAll(() => {
    // Минимальная структура для обоих графов.
    settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Тестовый сеттинг')").run().lastInsertRowid);
    beingId = Number(db.prepare("INSERT INTO setting_beings (name, setting_id) VALUES ('Зарр', ?)").run(settingId).lastInsertRowid);
    locationId = Number(db.prepare("INSERT INTO setting_locations (name, setting_id, role) VALUES ('Подземелье', ?, 'place')").run(settingId).lastInsertRowid);
    communityId = Number(db.prepare("INSERT INTO setting_communities (name, setting_id) VALUES ('Орден', ?)").run(settingId).lastInsertRowid);
    arcId = Number(db.prepare("INSERT INTO story_arcs (name, setting_id) VALUES ('Приключение', ?)").run(settingId).lastInsertRowid);
    sceneId = Number(db.prepare("INSERT INTO story_scenes (name, arc_id, setting_id) VALUES ('Сцена', ?, ?)").run(arcId, settingId).lastInsertRowid);
    campaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Кампания', ?)").run(settingId).lastInsertRowid);
    sessionId = Number(db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-01-01')").run(campaignId).lastInsertRowid);

    // Мир: обитание, участие, мнение.
    db.prepare("INSERT INTO being_locations (being_id, location_id) VALUES (?, ?)").run(beingId, locationId);
    db.prepare("INSERT INTO being_communities (being_id, community_id) VALUES (?, ?)").run(beingId, communityId);
    db.prepare("INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label) VALUES ('being', ?, 'location', ?, 'positive', 'обожает')").run(beingId, locationId);

    // Приключения: сцена → приключение, сессия → сцена (набрано и сыграно).
    db.prepare("INSERT INTO session_planned_scenes (session_id, scene_id) VALUES (?, ?)").run(sessionId, sceneId);
    db.prepare("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?)").run(sessionId, sceneId);

    // Упоминание из существа (мир) и из сцены (приключения).
    // Цель — другая сущность, не сама (самому себе меншен не строит ребро из-за from !== to).
    const beingId2 = Number(db.prepare("INSERT INTO setting_beings (name, setting_id) VALUES ('Грик', ?)").run(settingId).lastInsertRowid);
    db.prepare("INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('being', ?, 'being', ?, 'mention')").run(beingId, beingId2);
    db.prepare("INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, 'being', ?, 'mention')").run(sceneId, beingId2);
  });

  it("view=world: рёбра приключений (scene, link) отсутствуют", async () => {
    const res = await request(app).get(`/api/links/graph?view=world&setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.edges.map((e: { kind: string }) => e.kind));
    expect(kinds.has("scene")).toBe(false);
    expect(kinds.has("link")).toBe(false);
    // Мировые рёбра на месте.
    expect(kinds.has("habitat")).toBe(true);
    expect(kinds.has("membership")).toBe(true);
    expect(kinds.has("relation")).toBe(true);
  });

  it("view=adventures: рёбра мира (habitat, membership, nesting, relation) отсутствуют", async () => {
    const res = await request(app).get(`/api/links/graph?view=adventures&setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.edges.map((e: { kind: string }) => e.kind));
    expect(kinds.has("habitat")).toBe(false);
    expect(kinds.has("membership")).toBe(false);
    expect(kinds.has("nesting")).toBe(false);
    expect(kinds.has("relation")).toBe(false);
    // Приключенческие рёбра на месте.
    expect(kinds.has("scene")).toBe(true);
  });

  it("view=world: узлы приключений (adventure, scene) отсутствуют", async () => {
    const res = await request(app).get(`/api/links/graph?view=world&setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const types = new Set(res.body.nodes.map((n: { type: string }) => n.type));
    expect(types.has("adventure")).toBe(false);
    expect(types.has("scene")).toBe(false);
  });

  it("view=adventures: приключения и сцены на месте по setting_id", async () => {
    const res = await request(app).get(`/api/links/graph?view=adventures&setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const types = new Set(res.body.nodes.map((n: { type: string }) => n.type));
    expect(types.has("scene")).toBe(true);
    expect(types.has("adventure")).toBe(true);
  });

  it("view=adventures: сессии на месте по campaign_id", async () => {
    const res = await request(app).get(`/api/links/graph?view=adventures&campaign_id=${campaignId}`);
    expect(res.status).toBe(200);
    const types = new Set(res.body.nodes.map((n: { type: string }) => n.type));
    expect(types.has("session")).toBe(true);
  });

  it("view=adventures: сущности мира появляются как узлы если заняты в сценах", async () => {
    const res = await request(app).get(`/api/links/graph?view=adventures&setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const types = new Set(res.body.nodes.map((n: { type: string }) => n.type));
    // being появляется, т.к. сцена ссылается на него через generic_links.
    expect(types.has("being")).toBe(true);
  });

  it("view=world без параметра: ведёт себя как world (старая закладка /graph)", async () => {
    const res = await request(app).get(`/api/links/graph?setting_id=${settingId}`);
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.edges.map((e: { kind: string }) => e.kind));
    expect(kinds.has("scene")).toBe(false);
    expect(kinds.has("habitat")).toBe(true);
  });

  it("меншены распределяются по графу источника", async () => {
    const world = await request(app).get(`/api/links/graph?view=world&setting_id=${settingId}`);
    const adventures = await request(app).get(`/api/links/graph?view=adventures&setting_id=${settingId}`);
    // Меншен от существа (мир) — в графе мира.
    const worldMentions = world.body.edges.filter((e: { kind: string }) => e.kind === "mention");
    expect(worldMentions.length).toBeGreaterThanOrEqual(1);
    // Меншен от сцены (приключения) — в графе приключений.
    const adventureMentions = adventures.body.edges.filter((e: { kind: string }) => e.kind === "mention");
    expect(adventureMentions.length).toBeGreaterThanOrEqual(1);
  });

  it("кэш различает view", async () => {
    const world = await request(app).get(`/api/links/graph?view=world&setting_id=${settingId}`);
    const adventures = await request(app).get(`/api/links/graph?view=adventures&setting_id=${settingId}`);
    expect(world.body.edges.length).not.toBe(adventures.body.edges.length);
  });
});
