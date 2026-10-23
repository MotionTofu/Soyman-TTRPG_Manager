import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import path from "path";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Статус персонажа в истории кампании (гриллинг «Партия» 2026-10-23, Q19, Q28):
// новый — активный, Мастер меняет и получает прежний для «Отменить», игроку
// путь закрыт даже к своему персонажу.
let server: typeof import("../index");
let gm: string;
let player: string;
let characterId = 0;

const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const gmUser = insert("INSERT INTO users (username, password_hash, role) VALUES ('st-gm', 'test-only', 'gm')");
  gm = signToken({ id: gmUser, username: "st-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
  const playerId = insert("INSERT INTO players (name, folder_path) VALUES ('Игрок статусов', ?)", path.join("Players", "Игрок статусов"));
  const pu = insert("INSERT INTO users (username, password_hash, role, player_id) VALUES ('st-player', 'test-only', 'player', ?)", playerId);
  player = signToken({ id: pu, username: "st-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });
  const campaignId = insert("INSERT INTO campaigns (name) VALUES ('Стол статусов')");
  characterId = insert("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Лиэнн')", playerId, campaignId);
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((e) => (e ? reject(e) : resolve())));
});

const put = (token: string, status: unknown) =>
  request(server.app).put(`/api/characters/${characterId}/status`).auth(token, { type: "bearer" }).send({ status });

describe("статус персонажа", () => {
  it("новый персонаж — активный, Мастер меняет и видит прежний", async () => {
    const r = await put(gm, "dead");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "dead", previous: "active" });
    const one = await request(server.app).get(`/api/characters/${characterId}`).auth(gm, { type: "bearer" });
    expect(one.body.status).toBe("dead");
    expect(one.body.archived_at).toBeNull();
  });

  it("чужое значение — 400, статус не меняется", async () => {
    expect((await put(gm, "archived")).status).toBe(400);
    expect((db.prepare("SELECT status FROM characters WHERE id = ?").get(characterId) as { status: string }).status).toBe("dead");
  });

  it("игроку закрыто даже к своему персонажу", async () => {
    expect((await put(player, "active")).status).toBe(403);
  });
});
