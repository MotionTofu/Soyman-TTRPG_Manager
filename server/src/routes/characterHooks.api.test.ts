// Зацепки персонажа (гриллинг профилей 2026-10-02, Q16; словарь граф №22):
// главы раздела `hooks` — подготовка Мастера. Игрок своего персонажа видит
// и правит, но зацепок не видит и не заводит.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { apiRoleGate } from "../services/playerAccess";
import { charactersRouter } from "./characters";
import { playerRouter } from "./player";
import { attachUser, signToken } from "../services/auth";

let app: express.Express;
let characterId = 0;
let hookId = 0;
let playerId = 0;
let playerToken = "";

beforeAll(() => {
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Аня')").run().lastInsertRowid);
  characterId = Number(
    db.prepare("INSERT INTO characters (player_id, character_name) VALUES (?, 'Ренна')").run(playerId).lastInsertRowid
  );
  const chapter = db.prepare("INSERT INTO character_chapters (character_id, section, title, content) VALUES (?, ?, ?, '')");
  chapter.run(characterId, "backstory", "Детство в Доках");
  hookId = Number(chapter.run(characterId, "hooks", "Брат знает, где склад Ксанатара").lastInsertRowid);

  app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    const asPlayer = req.headers["x-test-role"] === "player";
    (req as unknown as Record<string, unknown>).user = asPlayer ? { role: "player", playerId } : { role: "gm", playerId: null };
    next();
  });
  app.use("/api", apiRoleGate as unknown as express.RequestHandler);
  app.use("/api/characters", charactersRouter);

  const userId = Number(
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('hooks-player', 'test-only', 'player', ?)").run(playerId).lastInsertRowid
  );
  playerToken = signToken({ id: userId, username: "hooks-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });
  app.use("/player", attachUser as unknown as express.RequestHandler, playerRouter);
});

const player = { "x-test-role": "player" };
const titles = (body: { chapters: { title: string }[] }) => body.chapters.map((c) => c.title);

describe("зацепки персонажа", () => {
  it("Мастер видит их среди глав", async () => {
    const res = await request(app).get(`/api/characters/${characterId}`);
    expect(titles(res.body)).toEqual(["Детство в Доках", "Брат знает, где склад Ксанатара"]);
  });

  it("игроку не отдаются", async () => {
    const res = await request(app).get(`/api/characters/${characterId}`).set(player);
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(["Детство в Доках"]);
  });

  it("игрок не правит и не заводит зацепки", async () => {
    const put = await request(app).put(`/api/characters/chapters/${hookId}`).set(player).send({ title: "x" });
    expect(put.status).toBe(403);
    const post = await request(app)
      .post(`/api/characters/${characterId}/chapters`)
      .set(player)
      .send({ section: "hooks", title: "x" });
    expect(post.status).toBe(403);
    const own = await request(app)
      .post(`/api/characters/${characterId}/chapters`)
      .set(player)
      .send({ section: "backstory", title: "Шрам" });
    expect(own.status).toBe(201);
  });

  it("правка главы через кабинет игрока не открывает и не меняет зацепку", async () => {
    const res = await request(app).put(`/player/characters/${characterId}/chapters/${hookId}`).auth(playerToken, { type: "bearer" }).send({});
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Ксанатара");
    await request(app).put(`/player/characters/${characterId}/chapters/${hookId}`).auth(playerToken, { type: "bearer" }).send({ content: "стёрто" });
    expect(db.prepare("SELECT content FROM character_chapters WHERE id = ?").get(hookId)).toEqual({ content: "" });
  });
});
