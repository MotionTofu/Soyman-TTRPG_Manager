// Сигнал «компендиум системы изменился» (группа «системы», часть 2).
//
// Проверяется то, что глазами не увидеть: кому ушёл сигнал. Пропущенный
// получатель — лист игрока со старым уроном предмета; лишний — игрок чужой
// системы, которого будят правки, до него не относящиеся.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { systemSignalMiddleware } from "./systemSignals";

let systemId = 0;
let otherSystemId = 0;
let sectionId = 0;
let entryId = 0;
let rosterPlayer = 0;
let standalonePlayer = 0;
let archivedPlayer = 0;
let otherSystemPlayer = 0;

let sent: { room: string; systemId: number }[] = [];

function makeApp(handler: express.RequestHandler): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { id: 1, role: "gm" };
    next();
  });
  app.use("/api", systemSignalMiddleware((room, payload) => sent.push({ room, systemId: payload.systemId })));
  app.use("/api", handler);
  return app;
}

const ok: express.RequestHandler = (_req, res) => {
  res.json({ ok: true });
};

beforeAll(() => {
  const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  systemId = insert("INSERT INTO systems (name) VALUES ('Сигнальная система')");
  otherSystemId = insert("INSERT INTO systems (name) VALUES ('Чужая система')");
  sectionId = insert("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, 'Заклинания', 'spell')", systemId);
  entryId = insert(
    `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, level, data, description, position)
     VALUES (?, ?, NULL, 'spell', 'Огненный шар', 3, '{}', '', 0)`,
    systemId,
    sectionId
  );
  const campaign = insert("INSERT INTO campaigns (name, system_id) VALUES ('Стол на системе', ?)", systemId);
  const archived = insert("INSERT INTO campaigns (name, system_id, archived_at) VALUES ('Архивный стол', ?, datetime('now'))", systemId);
  const otherCampaign = insert("INSERT INTO campaigns (name, system_id) VALUES ('Чужой стол', ?)", otherSystemId);
  rosterPlayer = insert("INSERT INTO players (name) VALUES ('Из состава')");
  standalonePlayer = insert("INSERT INTO players (name) VALUES ('Лист заранее')");
  archivedPlayer = insert("INSERT INTO players (name) VALUES ('Из архива')");
  otherSystemPlayer = insert("INSERT INTO players (name) VALUES ('С чужой системы')");
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaign, rosterPlayer);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(archived, archivedPlayer);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(otherCampaign, otherSystemPlayer);
  db.prepare("INSERT INTO characters (player_id, campaign_id, system_id, character_name) VALUES (?, NULL, ?, 'Заготовка')").run(
    standalonePlayer,
    systemId
  );
});

beforeEach(() => {
  sent = [];
});

const rooms = () => sent.map((s) => s.room).sort();

describe("сигнал «компендиум системы изменился»", () => {
  it("правка записи доходит до игроков живых кампаний и владельцев листов без кампании — и только до них", async () => {
    await request(makeApp(ok)).put(`/api/systems/entries/${entryId}`).send({ name: "Огненный шар" }).expect(200);
    expect(rooms()).toEqual([`player:${rosterPlayer}`, `player:${standalonePlayer}`].sort());
    expect(sent.every((s) => s.systemId === systemId)).toBe(true);
  });

  it("удалённая запись находит свою систему: правило срабатывает до удаления", async () => {
    const doomed = Number(
      db
        .prepare(
          `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, level, data, description, position)
           VALUES (?, ?, NULL, 'spell', 'Удаляемое', 1, '{}', '', 1)`
        )
        .run(systemId, sectionId).lastInsertRowid
    );
    const remove: express.RequestHandler = (_req, res) => {
      db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(doomed);
      res.json({ ok: true });
    };
    await request(makeApp(remove)).delete(`/api/systems/entries/${doomed}`).expect(200);
    expect(sent.map((s) => s.systemId)).toContain(systemId);
  });

  it("новая запись, порядок и уборка — по номеру системы в пути", async () => {
    await request(makeApp(ok)).post(`/api/systems/${systemId}/entries`).send({});
    await request(makeApp(ok)).put(`/api/systems/${systemId}/entries/reorder`).send({ order: [] });
    await request(makeApp(ok)).post(`/api/systems/${systemId}/tidy`).send({});
    expect(sent.length).toBe(6);
    expect(new Set(sent.map((s) => s.systemId))).toEqual(new Set([systemId]));
  });

  it("избранное, отказ, чтение и правка самой системы сигнала не дают", async () => {
    const fail: express.RequestHandler = (_req, res) => {
      res.status(500).json({ error: "нет" });
    };
    await request(makeApp(ok)).put(`/api/systems/entries/${entryId}/favourite`).send({ favourite: true });
    await request(makeApp(fail)).put(`/api/systems/entries/${entryId}`).send({});
    await request(makeApp(ok)).get(`/api/systems/${systemId}/entries`);
    await request(makeApp(ok)).put(`/api/systems/${systemId}`).send({ description: "x" });
    expect(sent).toEqual([]);
  });
});
