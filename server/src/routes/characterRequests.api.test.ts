import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import path from "path";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Персонаж = лист, шаг 2 (гриллинг 2026-09-27, Q11/Q12/Q16): игрок заводит
// персонажа только «без кампании», в кампанию попадает заявкой, которую
// принимает Мастер; архивирует только своего и только без кампании.
let server: typeof import("../index");
let gm: string;
let player: string;
let other: string;
let campaignId = 0;
let foreignCampaignId = 0;
let archivedCampaignId = 0;
let playerId = 0;

const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
const row = (id: number) =>
  db.prepare("SELECT campaign_id, requested_campaign_id, archived_at FROM characters WHERE id = ?").get(id) as {
    campaign_id: number | null;
    requested_campaign_id: number | null;
    archived_at: string | null;
  };

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;

  const gmUser = insert("INSERT INTO users (username, password_hash, role) VALUES ('req-gm', 'test-only', 'gm')");
  gm = signToken({ id: gmUser, username: "req-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
  playerId = insert("INSERT INTO players (name, folder_path) VALUES ('Игрок заявок', ?)", path.join("Players", "Игрок заявок"));
  const pu = insert("INSERT INTO users (username, password_hash, role, player_id) VALUES ('req-player', 'test-only', 'player', ?)", playerId);
  player = signToken({ id: pu, username: "req-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });
  const otherId = insert("INSERT INTO players (name, folder_path) VALUES ('Чужой', ?)", path.join("Players", "Чужой"));
  const ou = insert("INSERT INTO users (username, password_hash, role, player_id) VALUES ('req-other', 'test-only', 'player', ?)", otherId);
  other = signToken({ id: ou, username: "req-other", role: "player", playerId: otherId, isAdmin: false, tokenVersion: 0 });

  campaignId = insert("INSERT INTO campaigns (name) VALUES ('Стол заявок')");
  foreignCampaignId = insert("INSERT INTO campaigns (name) VALUES ('Чужой стол')");
  archivedCampaignId = insert("INSERT INTO campaigns (name, archived_at) VALUES ('Старый стол', datetime('now'))");
  insert("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)", campaignId, playerId);
  insert("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)", archivedCampaignId, playerId);
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((e) => (e ? reject(e) : resolve())));
});

const asPlayer = (token: string) => ({
  post: (url: string, body: object = {}) => request(server.app).post(url).auth(token, { type: "bearer" }).send(body),
  del: (url: string) => request(server.app).delete(url).auth(token, { type: "bearer" }),
});

describe("библиотека игрока: заявки в кампанию", () => {
  it("кампания при создании становится заявкой, а не привязкой", async () => {
    const r = await asPlayer(player).post("/api/player/characters", { character_name: "Новичок", campaign_id: campaignId });
    expect(r.status).toBe(201);
    expect(row(r.body.id)).toMatchObject({ campaign_id: null, requested_campaign_id: campaignId });
  });

  it("заявка — только в свою живую кампанию; принимает Мастер, не игрок", async () => {
    const id = (await asPlayer(player).post("/api/player/characters", { character_name: "Подающий" })).body.id as number;
    expect((await asPlayer(player).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: foreignCampaignId })).status).toBe(404);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: archivedCampaignId })).status).toBe(403);
    expect((await asPlayer(other).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: campaignId })).status).toBe(404);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: campaignId })).status).toBe(200);

    // Игрок не может принять свою заявку сам — маршруты кампаний ему закрыты.
    expect((await asPlayer(player).post(`/api/campaigns/${campaignId}/character-requests/${id}/accept`)).status).toBe(403);
    const list = await request(server.app).get(`/api/characters?requested_campaign_id=${campaignId}`).auth(gm, { type: "bearer" });
    expect(list.body.map((c: { id: number }) => c.id)).toContain(id);

    // Заявка в другую кампанию не принимается чужим столом.
    expect((await asPlayer(gm).post(`/api/campaigns/${foreignCampaignId}/character-requests/${id}/accept`)).status).toBe(404);
    expect((await asPlayer(gm).post(`/api/campaigns/${campaignId}/character-requests/${id}/accept`)).status).toBe(200);
    expect(row(id)).toMatchObject({ campaign_id: campaignId, requested_campaign_id: null });

    // В кампании — ни новой заявки, ни архива руками игрока.
    expect((await asPlayer(player).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: campaignId })).status).toBe(409);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/archive`)).status).toBe(403);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/leave-campaign`)).status).toBe(409);
  });

  it("отказ и отзыв снимают заявку", async () => {
    const id = (await asPlayer(player).post("/api/player/characters", { character_name: "Отказник", campaign_id: campaignId })).body.id as number;
    expect((await asPlayer(gm).post(`/api/campaigns/${campaignId}/character-requests/${id}/decline`)).status).toBe(200);
    expect(row(id).requested_campaign_id).toBeNull();
    await asPlayer(player).post(`/api/player/characters/${id}/campaign-request`, { campaign_id: campaignId });
    expect((await asPlayer(player).del(`/api/player/characters/${id}/campaign-request`)).status).toBe(200);
    expect(row(id)).toMatchObject({ campaign_id: null, requested_campaign_id: null });
  });

  it("архив своего персонажа без кампании и отмена; чужого — нет", async () => {
    const id = (await asPlayer(player).post("/api/player/characters", { character_name: "Архивный" })).body.id as number;
    expect((await asPlayer(other).post(`/api/player/characters/${id}/archive`)).status).toBe(404);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/archive`)).status).toBe(200);
    expect(row(id).archived_at).not.toBeNull();
    expect((await asPlayer(other).post(`/api/player/characters/${id}/unarchive`)).status).toBe(404);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/unarchive`)).status).toBe(200);
    expect(row(id).archived_at).toBeNull();
  });

  it("из архивной кампании игрок выводит персонажа сам", async () => {
    const id = insert("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Ветеран')", playerId, archivedCampaignId);
    expect((await asPlayer(player).post(`/api/player/characters/${id}/leave-campaign`)).status).toBe(200);
    expect(row(id).campaign_id).toBeNull();
  });
});
