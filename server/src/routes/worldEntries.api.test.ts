// Кабинет игрока, шаг 4: вкладки дневника — это папки записей.
//
// Серверная часть: folder_path/position в чтении и записи, переезд во
// вкладку наверх, ручной порядок. Проверяется запросом, а не экраном.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { playerRouter } from "./player";

let app: express.Express;
let campaignId = 0;
let playerId = 0;
let charId = 0;

function asPlayer(req: Record<string, unknown>, _res: unknown, next: () => void): void {
  req["user"] = { id: 7, role: "player", playerId, isAdmin: false, tokenVersion: 0 };
  next();
}

beforeAll(() => {
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Билл')").run().lastInsertRowid);
  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Общая тетрадь')").run().lastInsertRowid);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, playerId);
  charId = Number(
    db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Следопыт')").run(playerId, campaignId).lastInsertRowid
  );
  app = express();
  app.use(express.json());
  app.use("/api/player", asPlayer, playerRouter);
});

async function addEntry(description: string, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await request(app).post(`/api/player/campaigns/${campaignId}/world-entries`).send({
    character_id: charId,
    kind: "",
    name: "",
    description,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("папки дневника", () => {
  it("новая запись встаёт наверх; чтение отдаёт папку и позицию", async () => {
    const first = await addEntry("первая");
    const second = await addEntry("вторая");
    const res = await request(app).get(`/api/player/campaigns/${campaignId}/world-entries`);
    expect(res.status).toBe(200);
    const rows = res.body as { id: number; folder_path: string | null; position: number }[];
    expect(rows[0].id).toBe(second);
    expect(rows[1].id).toBe(first);
    expect(rows[0].folder_path).toBeNull();
    expect(typeof rows[0].position).toBe("number");
  });

  it("переезд во вкладку кладёт наверх вкладки и не трогает ленту", async () => {
    const a = await addEntry("про дракона");
    const b = await addEntry("про мост");
    const move = await request(app).put(`/api/player/world-entries/${a}`).send({ folder_path: "Загадки" });
    expect(move.status).toBe(200);
    expect(move.body.folder_path).toBe("Загадки");
    const move2 = await request(app).put(`/api/player/world-entries/${b}`).send({ folder_path: "Загадки" });
    expect(move2.status).toBe(200);
    const res = await request(app).get(`/api/player/campaigns/${campaignId}/world-entries`);
    const rows = res.body as { id: number; folder_path: string | null }[];
    const folder = rows.filter((r) => r.folder_path === "Загадки").map((r) => r.id);
    // Позже переехавшая — выше.
    expect(folder).toEqual([b, a]);
  });

  it("пустая папка схлопывается в NULL, длинная режется", async () => {
    const id = await addEntry("ничья");
    const blank = await request(app).put(`/api/player/world-entries/${id}`).send({ folder_path: "   " });
    expect(blank.status).toBe(200);
    expect(blank.body.folder_path).toBeNull();
    const long = await request(app).put(`/api/player/world-entries/${id}`).send({ folder_path: "я".repeat(200) });
    expect(long.status).toBe(200);
    expect((long.body.folder_path as string).length).toBe(80);
  });

  it("ручной порядок: вверх-вниз внутри вкладки", async () => {
    const x = await addEntry("икс", { folder_path: "Кто кому" });
    const y = await addEntry("игрек", { folder_path: "Кто кому" });
    const z = await addEntry("зет", { folder_path: "Кто кому" });
    // Сейчас сверху z (последняя). Опускаем её в конец.
    const res = await request(app).put("/api/player/world-entries/reorder").send({ ids: [x, y, z] });
    expect(res.status).toBe(200);
    const got = await request(app).get(`/api/player/campaigns/${campaignId}/world-entries`);
    const folder = (got.body as { id: number; folder_path: string | null }[])
      .filter((r) => r.folder_path === "Кто кому")
      .map((r) => r.id);
    expect(folder).toEqual([x, y, z]);
  });

  it("чужой порядок и мусор отвергаются", async () => {
    expect((await request(app).put("/api/player/world-entries/reorder").send({ ids: [] })).status).toBe(400);
    expect((await request(app).put("/api/player/world-entries/reorder").send({ ids: ["x"] })).status).toBe(400);
    expect((await request(app).put("/api/player/world-entries/reorder").send({ ids: [999999] })).status).toBe(404);
    expect((await request(app).put("/api/player/world-entries/999999").send({ folder_path: "X" })).status).toBe(404);
  });
});
