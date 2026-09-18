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

// F-51 (разбор Q60–Q64, 2026-09-18): вкладка живёт своей строкой и бывает
// пустой; переименование и удаление — одной операцией на сервере.
describe("вкладки дневника своими строками", () => {
  const base = () => `/api/player/campaigns/${campaignId}/journal-folders`;
  async function folders(): Promise<{ id: number; name: string }[]> {
    const res = await request(app).get(base());
    expect(res.status).toBe(200);
    return res.body as { id: number; name: string }[];
  }
  async function inFolder(name: string | null): Promise<number[]> {
    const got = await request(app).get(`/api/player/campaigns/${campaignId}/world-entries`);
    return (got.body as { id: number; folder_path: string | null }[])
      .filter((r) => (r.folder_path ?? null) === name)
      .map((r) => r.id);
  }

  it("пустая вкладка заводится и остаётся в списке без записей", async () => {
    const res = await request(app).post(base()).send({ name: "  Долги  " });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Долги");
    expect((await folders()).map((f) => f.name)).toContain("Долги");
    expect(await inFolder("Долги")).toEqual([]);
  });

  it("повтор имени отдаёт ту же вкладку, постоянные имена и пустое — отказ", async () => {
    const a = await request(app).post(base()).send({ name: "Долги" });
    const list = await folders();
    expect(list.filter((f) => f.name === "Долги")).toHaveLength(1);
    expect(a.body.id).toBe(list.find((f) => f.name === "Долги")!.id);
    expect((await request(app).post(base()).send({ name: "Мир" })).status).toBe(400);
    expect((await request(app).post(base()).send({ name: "от МАСТЕРА" })).status).toBe(400);
    expect((await request(app).post(base()).send({ name: "   " })).status).toBe(400);
    expect((await request(app).put(`/api/player/world-entries/${await addEntry("x")}`).send({ folder_path: "Лента" })).status).toBe(400);
  });

  it("запись во вкладку, которой нет, заводит её строку; порядок — по заведению", async () => {
    await addEntry("о подозреваемом", { folder_path: "Подозреваемые" });
    const names = (await folders()).map((f) => f.name);
    expect(names).toContain("Подозреваемые");
    expect(names.indexOf("Долги")).toBeLessThan(names.indexOf("Подозреваемые"));
  });

  it("переименование переносит записи одной операцией", async () => {
    const e = await addEntry("должен трактирщику", { folder_path: "Долги" });
    const id = (await folders()).find((f) => f.name === "Долги")!.id;
    const res = await request(app).put(`${base()}/${id}`).send({ name: "Кому должны" });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(false);
    expect(await inFolder("Кому должны")).toContain(e);
    expect(await inFolder("Долги")).toEqual([]);
    const names = (await folders()).map((f) => f.name);
    expect(names).toContain("Кому должны");
    expect(names).not.toContain("Долги");
  });

  it("переименование в имя другой вкладки сливает их", async () => {
    const list = await folders();
    const from = list.find((f) => f.name === "Кому должны")!;
    const before = await inFolder("Кому должны");
    const res = await request(app).put(`${base()}/${from.id}`).send({ name: "Подозреваемые" });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(true);
    const merged = await inFolder("Подозреваемые");
    for (const id of before) expect(merged).toContain(id);
    expect((await folders()).map((f) => f.name)).not.toContain("Кому должны");
  });

  it("удаление возвращает записи в Ленту, в том числе удалённые — и не воскресает", async () => {
    const live = await addEntry("живая", { folder_path: "Черновик" });
    const gone = await addEntry("удалённая", { folder_path: "Черновик" });
    expect((await request(app).delete(`/api/player/world-entries/${gone}`)).status).toBe(200);
    const id = (await folders()).find((f) => f.name === "Черновик")!.id;
    expect((await request(app).delete(`${base()}/${id}`)).status).toBe(200);
    expect((await folders()).map((f) => f.name)).not.toContain("Черновик");
    expect(await inFolder(null)).toContain(live);
    // Возврат удалённой записи не заводит убранную вкладку снова.
    expect((await request(app).post(`/api/player/world-entries/${gone}/restore`)).status).toBe(200);
    expect((await folders()).map((f) => f.name)).not.toContain("Черновик");
    expect(await inFolder(null)).toContain(gone);
  });

  it("чужая вкладка — 404, в кампании без записи — 403", async () => {
    const otherPlayer = Number(db.prepare("INSERT INTO players (name) VALUES ('Сосед')").run().lastInsertRowid);
    db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, otherPlayer);
    const foreign = Number(
      db.prepare("INSERT INTO player_journal_folders (campaign_id, player_id, name) VALUES (?, ?, 'Чужая')").run(campaignId, otherPlayer).lastInsertRowid
    );
    expect((await request(app).put(`${base()}/${foreign}`).send({ name: "Моя" })).status).toBe(404);
    expect((await request(app).delete(`${base()}/${foreign}`)).status).toBe(404);
    expect((await folders()).map((f) => f.name)).not.toContain("Чужая");
    db.prepare("UPDATE campaign_roster SET status = 'left' WHERE campaign_id = ? AND player_id = ?").run(campaignId, playerId);
    try {
      expect((await request(app).post(base()).send({ name: "Поздно" })).status).toBe(403);
    } finally {
      db.prepare("UPDATE campaign_roster SET status = 'active' WHERE campaign_id = ? AND player_id = ?").run(campaignId, playerId);
    }
  });
});

// F-54: старый мастерский «Исследование Мира» писал в folder_path путь на
// диске. Для дневника такая запись лежит в Ленте, а не во вкладке-пути.
describe("путь на диске — не вкладка", () => {
  it("запись со старым путём читается без вкладки, путь в базе цел", async () => {
    const disk = "Campaigns\\Эстария\\WorldExploration\\Существа\\Тролль";
    const id = Number(
      db
        .prepare("INSERT INTO world_exploration_entries (campaign_id, player_id, kind, name, description, folder_path) VALUES (?, ?, 'being', 'Тролль', '', ?)")
        .run(campaignId, playerId, disk).lastInsertRowid
    );
    const got = await request(app).get(`/api/player/campaigns/${campaignId}/world-entries`);
    const row = (got.body as { id: number; folder_path: string | null }[]).find((r) => r.id === id)!;
    expect(row.folder_path).toBeNull();
    // Правка текста не превращает путь во вкладку и не стирает его.
    const put = await request(app).put(`/api/player/world-entries/${id}`).send({ description: "под мостом" });
    expect(put.status).toBe(200);
    expect(put.body.folder_path).toBeNull();
    expect((db.prepare("SELECT folder_path FROM world_exploration_entries WHERE id = ?").get(id) as { folder_path: string }).folder_path).toBe(disk);
    const folders = await request(app).get(`/api/player/campaigns/${campaignId}/journal-folders`);
    expect((folders.body as { name: string }[]).some((f) => f.name.includes("WorldExploration"))).toBe(false);
  });
});
