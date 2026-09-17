// Сигнал «запись игрока изменилась» (группа «остальное», часть 2).
//
// Проверяется, кому ушёл сигнал: пропущенный получатель — старое имя в партии
// у товарища; лишний — игрок чужого стола, которого будят чужие правки.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { playerSignalMiddleware } from "./playerSignals";

let renamed = 0;
let rosterMate = 0;
let characterMate = 0;
let archivedTableMate = 0;
let stranger = 0;

let sent: { room: string; playerId: number }[] = [];

function makeApp(handler: express.RequestHandler): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", playerSignalMiddleware((room, payload) => sent.push({ room, playerId: payload.playerId })));
  app.use("/api", handler);
  return app;
}

const ok: express.RequestHandler = (_req, res) => {
  res.json({ ok: true });
};

beforeAll(() => {
  const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  renamed = insert("INSERT INTO players (name) VALUES ('Переименуемый')");
  rosterMate = insert("INSERT INTO players (name) VALUES ('Сосед по составу')");
  characterMate = insert("INSERT INTO players (name) VALUES ('Сосед по персонажу')");
  archivedTableMate = insert("INSERT INTO players (name) VALUES ('Сосед по архивному столу')");
  stranger = insert("INSERT INTO players (name) VALUES ('Чужой стол')");
  const table = insert("INSERT INTO campaigns (name) VALUES ('Общий стол')");
  const byCharacter = insert("INSERT INTO campaigns (name) VALUES ('Стол по персонажу')");
  const archived = insert("INSERT INTO campaigns (name, archived_at) VALUES ('Архивный стол', datetime('now'))");
  const other = insert("INSERT INTO campaigns (name) VALUES ('Чужой')");
  const roster = db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)");
  roster.run(table, renamed);
  roster.run(table, rosterMate);
  roster.run(archived, renamed);
  roster.run(archived, archivedTableMate);
  roster.run(other, stranger);
  const character = db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, ?)");
  character.run(renamed, byCharacter, "Свой");
  character.run(characterMate, byCharacter, "Чужой персонаж");
});

beforeEach(() => {
  sent = [];
});

const rooms = () => [...new Set(sent.map((s) => s.room))].sort();

describe("сигнал «запись игрока изменилась»", () => {
  it("правка полей доходит до самого игрока и игроков его живых кампаний — и только до них", async () => {
    await request(makeApp(ok)).put(`/api/players/${renamed}`).send({ name: "Новое имя" }).expect(200);
    expect(rooms()).toEqual([`player:${renamed}`, `player:${rosterMate}`, `player:${characterMate}`].sort());
    expect(sent.every((s) => s.playerId === renamed)).toBe(true);
    expect(sent.length).toBe(3);
  });

  it("архивирование и возврат — тем же получателям", async () => {
    await request(makeApp(ok)).delete(`/api/players/${renamed}`).expect(200);
    await request(makeApp(ok)).put(`/api/players/${renamed}/restore`).expect(200);
    expect(sent.length).toBe(6);
    expect(rooms()).not.toContain(`player:${archivedTableMate}`);
    expect(rooms()).not.toContain(`player:${stranger}`);
  });

  it("напоминание — только самому игроку", async () => {
    await request(makeApp(ok)).post(`/api/players/${renamed}/reminders`).send({ message: "x" });
    await request(makeApp(ok)).delete(`/api/players/${renamed}/reminders/5`);
    expect(sent).toEqual([
      { room: `player:${renamed}`, playerId: renamed },
      { room: `player:${renamed}`, playerId: renamed },
    ]);
  });

  it("обложка, создание, чтение и отказ сигнала не дают", async () => {
    const fail: express.RequestHandler = (_req, res) => {
      res.status(500).json({ error: "нет" });
    };
    await request(makeApp(ok)).post(`/api/players/${renamed}/thumbnail`).send({});
    await request(makeApp(ok)).post(`/api/players/${renamed}/avatar`).send({});
    await request(makeApp(ok)).post("/api/players").send({ name: "Новый" });
    await request(makeApp(ok)).get(`/api/players/${renamed}`);
    await request(makeApp(fail)).put(`/api/players/${renamed}`).send({ name: "x" });
    expect(sent).toEqual([]);
  });
});
