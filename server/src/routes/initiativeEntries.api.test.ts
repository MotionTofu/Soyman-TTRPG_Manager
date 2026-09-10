// Сквозной тест очереди инициативы: настоящий роутер + временная база.
// DB_DIR выставляется ДО импорта db (побочный эффект — открытие базы),
// поэтому импорты динамические внутри beforeAll. Живая база не затрагивается.
//
// Повод — находка №3 аудита пульта (`260910_audit/pult-sessii.md`):
// `PUT /initiative-entries/:id` писал `initiative = COALESCE(?, initiative)`,
// клиент на пустое поле слал `null`, и сервер молча оставлял прежнее число —
// Мастер стирает инициативу, а она возвращается. В коде это уже починено
// (`CASE WHEN ?`), но ничем не удерживалось: `COALESCE` вокруг соблазнительно
// единообразен, и правка «привести к общему виду» вернула бы дефект.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let sessionId = 0;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "initiative-api-test-"));
  process.env.DB_DIR = tmpDir;
  const { initiativeEntriesRouter } = await import("./initiativeEntries");
  const { db } = await import("../db/db");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/initiative-entries", initiativeEntriesRouter);

  const settingId = Number(
    (
      db.prepare("INSERT INTO settings (name, folder_path) VALUES ('S', 'Settings/S')").run() as {
        lastInsertRowid: unknown;
      }
    ).lastInsertRowid
  );
  const campaignId = Number(
    (
      db
        .prepare("INSERT INTO campaigns (name, setting_id, folder_path) VALUES ('C', ?, 'Campaigns/C')")
        .run(settingId) as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
  sessionId = Number(
    (
      db
        .prepare("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-09-10', 'planned')")
        .run(campaignId) as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
}, 120_000);

/** Заводит бойца в очереди и возвращает его id. */
async function addEntry(body: Record<string, unknown> = {}): Promise<number> {
  const res = await request(app)
    .post("/api/initiative-entries")
    .send({ session_id: sessionId, name: "Гоблин", kind: "creature", ...body });
  expect(res.status).toBeLessThan(300);
  return res.body.id as number;
}

describe("число инициативы стирается", () => {
  it("null очищает число, а не оставляет прежнее", async () => {
    const id = await addEntry({ initiative: 17 });

    const set = await request(app).put(`/api/initiative-entries/${id}`).send({ initiative: 17 });
    expect(set.body.initiative).toBe(17);

    // Ровно находка №3: раньше здесь возвращалось 17.
    const cleared = await request(app).put(`/api/initiative-entries/${id}`).send({ initiative: null });
    expect(cleared.body.initiative).toBe(null);
  });

  it("ноль — это число, а не «пусто»", async () => {
    // Инициатива 0 законна (Ловкость −5 и неудачный бросок). Правка через
    // «ложное значит не трогать» съела бы её вместе с null.
    const id = await addEntry({ initiative: 12 });
    const res = await request(app).put(`/api/initiative-entries/${id}`).send({ initiative: 0 });
    expect(res.body.initiative).toBe(0);
  });

  it("правка одного поля не сбивает соседние", async () => {
    // Обратная опасность `CASE WHEN ?`: не передал поле — оно должно остаться,
    // а не обнулиться.
    const id = await addEntry({ initiative: 15, max_hp: 20, current_hp: 20 });
    await request(app).put(`/api/initiative-entries/${id}`).send({ current_hp: 7 });
    const row = (await request(app).get(`/api/initiative-entries?session_id=${sessionId}`)).body.find(
      (e: { id: number }) => e.id === id
    );
    expect(row.initiative).toBe(15);
    expect(row.max_hp).toBe(20);
    expect(row.current_hp).toBe(7);
  });

  it("хиты и состояния тоже очищаются, а не залипают", async () => {
    const id = await addEntry({ max_hp: 10, current_hp: 10 });
    await request(app).put(`/api/initiative-entries/${id}`).send({ conditions: ["Отравлен"] });
    const withCond = (await request(app).put(`/api/initiative-entries/${id}`).send({ dead: true })).body;
    expect(JSON.parse(withCond.conditions)).toEqual(["Отравлен"]);
    expect(withCond.dead).toBe(1);

    const cleared = (
      await request(app).put(`/api/initiative-entries/${id}`).send({ conditions: [], dead: false })
    ).body;
    expect(JSON.parse(cleared.conditions)).toEqual([]);
    expect(cleared.dead).toBe(0);
  });
});

describe("«Новый бой» гасит числа, не трогая бойцов", () => {
  it("числа гаснут, а хиты, состояния и отметки мёртвых остаются", async () => {
    const a = await addEntry({ initiative: 18, max_hp: 30, current_hp: 12 });
    const b = await addEntry({ initiative: 7, max_hp: 8, current_hp: 8 });
    await request(app).put(`/api/initiative-entries/${b}`).send({ conditions: ["Отравлен"], dead: true });

    const res = await request(app).post(`/api/initiative-entries/reset-rolls?session_id=${sessionId}`).send({});
    expect(res.body.ok).toBe(true);

    const rows = (await request(app).get(`/api/initiative-entries?session_id=${sessionId}`)).body as {
      id: number;
      initiative: number | null;
      current_hp: number | null;
      conditions: string | null;
      dead: number;
    }[];
    // Ни у одной строки сессии числа не осталось.
    expect(rows.every((r) => r.initiative === null)).toBe(true);

    const rowA = rows.find((r) => r.id === a)!;
    const rowB = rows.find((r) => r.id === b)!;
    expect(rowA.current_hp).toBe(12);
    expect(JSON.parse(rowB.conditions ?? "[]")).toEqual(["Отравлен"]);
    expect(rowB.dead).toBe(1);
    // Строки на месте — это не «Очистить».
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("без session_id отказывает", async () => {
    const res = await request(app).post("/api/initiative-entries/reset-rolls").send({});
    expect(res.status).toBe(400);
  });

  it("на пустой очереди не падает", async () => {
    const res = await request(app).post("/api/initiative-entries/reset-rolls?session_id=999999").send({});
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(0);
  });
});
