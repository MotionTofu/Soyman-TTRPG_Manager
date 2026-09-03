// Сквозной тест границы видимости карт: настоящий роутер + настоящий гейт
// ролей на временной базе. DB_DIR выставляется ДО импорта db (у него
// побочный эффект — открытие базы), поэтому импорты db/гейта/роутера —
// динамические внутри beforeAll. Живая база не затрагивается никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-api-test-"));
  process.env.DB_DIR = tmpDir;
  const { mapsRouter } = await import("./maps");
  const { apiRoleGate } = await import("../services/playerAccess");

  app = express();
  app.use(express.json());
  // Тестовый стенд вместо attachUser: роль едет заголовком.
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const role = (req.headers as Record<string, string>)["x-test-role"] === "player" ? "player" : "gm";
    (req as Record<string, unknown>)["user"] = role === "gm" ? { role, playerId: null } : { role, playerId: 42 };
    next();
  });
  app.use("/api", apiRoleGate as unknown as express.RequestHandler);
  app.use("/api/maps", mapsRouter);
}, 120000);

const gm = { "x-test-role": "gm" };
const player = { "x-test-role": "player" };

describe("maps API", () => {
  let hiddenId = 0;
  let visibleId = 0;

  it("мастер создаёт карту с дефолтами пресета", async () => {
    const res = await request(app).post("/api/maps").set(gm).send({ name: "Тест", grid: "hex", scale: "region" });
    expect(res.status).toBe(201);
    expect(res.body.width).toBe(60);
    expect(res.body.height).toBe(44);
    expect(res.body.cell_lore).toBe("2 км");
    expect(res.body.player_visible).toBe(0);
    hiddenId = res.body.id;
  });

  it("валидация: имя, сетка, границы", async () => {
    expect((await request(app).post("/api/maps").set(gm).send({ name: "", grid: "hex", scale: "planet" })).status).toBe(400);
    expect((await request(app).post("/api/maps").set(gm).send({ name: "x", grid: "tri", scale: "planet" })).status).toBe(400);
    expect(
      (await request(app).post("/api/maps").set(gm).send({ name: "x", grid: "hex", scale: "planet", width: 7 })).status
    ).toBe(400);
  });

  it("мастер правит клетки, игрокам запись запрещена", async () => {
    const cells = JSON.stringify({ v: 1, cells: { "0,0": "forest" }, roads: ["1,1"] });
    const ok = await request(app).put(`/api/maps/${hiddenId}`).set(gm).send({ cells });
    expect(ok.status).toBe(200);
    expect(ok.body.cells).toBe(cells);
    for (const m of ["post", "put", "delete"] as const) {
      const r =
        m === "post"
          ? await request(app).post("/api/maps").set(player).send({ name: "x", grid: "hex", scale: "planet" })
          : m === "put"
            ? await request(app).put(`/api/maps/${hiddenId}`).set(player).send({ name: "Взлом" })
            : await request(app).delete(`/api/maps/${hiddenId}`).set(player);
      expect(r.status).toBe(403);
    }
  });

  it("смена сетки без clearCells — 400, с флагом — сброс клеток", async () => {
    expect((await request(app).put(`/api/maps/${hiddenId}`).set(gm).send({ grid: "square" })).status).toBe(400);
    const res = await request(app).put(`/api/maps/${hiddenId}`).set(gm).send({ grid: "square", clearCells: true });
    expect(res.status).toBe(200);
    expect(res.body.grid).toBe("square");
    expect(JSON.parse(res.body.cells)).toEqual({ v: 1, cells: {}, roads: [] });
  });

  it("игрок видит только открытые карты", async () => {
    const created = await request(app).post("/api/maps").set(gm).send({ name: "Открытая", grid: "square", scale: "planet" });
    visibleId = created.body.id;
    await request(app).put(`/api/maps/${visibleId}`).set(gm).send({ player_visible: 1 });

    const list = await request(app).get("/api/maps").set(player);
    expect(list.status).toBe(200);
    const ids = (list.body as { id: number }[]).map((m) => m.id);
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(hiddenId);

    expect((await request(app).get(`/api/maps/${hiddenId}`).set(player)).status).toBe(404);
    expect((await request(app).get(`/api/maps/${visibleId}`).set(player)).status).toBe(200);
    // В списке игрокам клеток нет (мета), в одиночке — есть
    expect(list.body[0]).not.toHaveProperty("cells");
    // P0-2: миниатюр в списке нет — только точечный эндпоинт
    for (const row of list.body as Record<string, unknown>[]) expect(row).not.toHaveProperty("thumbnail");
  });

  it("превью грузится точечно с тем же гейтом видимости", async () => {
    const gmList = await request(app).get("/api/maps").set(gm);
    expect(gmList.status).toBe(200);
    for (const row of gmList.body as Record<string, unknown>[]) expect(row).not.toHaveProperty("thumbnail");

    const thumb = await request(app).put(`/api/maps/${visibleId}`).set(gm).send({ thumbnail: "data:image/png;base64,iVBORw0KGgo=" });
    expect(thumb.status).toBe(200);

    const one = await request(app).get(`/api/maps/${visibleId}/thumbnail`).set(gm);
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ id: visibleId, thumbnail: "data:image/png;base64,iVBORw0KGgo=" });

    expect((await request(app).get(`/api/maps/${visibleId}/thumbnail`).set(player)).status).toBe(200);
    expect((await request(app).get(`/api/maps/${hiddenId}/thumbnail`).set(player)).status).toBe(404);
    expect((await request(app).get("/api/maps/999999/thumbnail").set(gm)).status).toBe(404);
  });

  it("удаление: мастер удаляет, карта пропадает", async () => {
    expect((await request(app).delete(`/api/maps/${hiddenId}`).set(gm)).status).toBe(200);
    expect((await request(app).get(`/api/maps/${hiddenId}`).set(gm)).status).toBe(404);
  });

  it("привязки: мастер вяжет/читает/отвязывает, игрокам запись запрещена", async () => {
    const { db } = await import("../db/db");
    const setting = db.prepare("INSERT INTO settings (name) VALUES (?)").run("Сеттинг привязок");
    const campaign = db.prepare("INSERT INTO campaigns (name) VALUES (?)").run("Кампания привязок");
    const location = db
      .prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, ?)")
      .run(setting.lastInsertRowid, "Локация привязок");

    // Валидация
    expect((await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "planet", target_id: 1 })).status).toBe(400);
    expect((await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "setting", target_id: 999999 })).status).toBe(400);
    expect((await request(app).post("/api/maps/999999/bindings").set(gm).send({ target_type: "setting", target_id: 1 })).status).toBe(404);

    const s = await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "setting", target_id: setting.lastInsertRowid });
    expect(s.status).toBe(201);
    expect((await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "setting", target_id: setting.lastInsertRowid })).status).toBe(400);
    const c = await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "campaign", target_id: campaign.lastInsertRowid });
    expect(c.status).toBe(201);
    const l = await request(app).post(`/api/maps/${visibleId}/bindings`).set(gm).send({ target_type: "location", target_id: location.lastInsertRowid });
    expect(l.status).toBe(201);

    // Мастер видит имена, игрок к видимой — строки без имён
    const gmList = await request(app).get(`/api/maps/${visibleId}/bindings`).set(gm);
    expect(gmList.status).toBe(200);
    expect(gmList.body).toHaveLength(3);
    expect(gmList.body[0].target_name).toBe("Сеттинг привязок");
    const plList = await request(app).get(`/api/maps/${visibleId}/bindings`).set(player);
    expect(plList.status).toBe(200);
    expect(plList.body).toHaveLength(3);
    expect(plList.body[0]).not.toHaveProperty("target_name");

    // Игрок: скрытая карта — 404, запись — 403
    const hid = await request(app).post("/api/maps").set(gm).send({ name: "Скрытая для привязок", grid: "hex", scale: "planet" });
    expect((await request(app).get(`/api/maps/${hid.body.id}/bindings`).set(player)).status).toBe(404);
    expect((await request(app).post(`/api/maps/${visibleId}/bindings`).set(player).send({ target_type: "setting", target_id: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/maps/${visibleId}/bindings/${s.body.id}`).set(player)).status).toBe(403);

    // Отвязка и чужая карта
    expect((await request(app).delete(`/api/maps/${visibleId}/bindings/${s.body.id}`).set(gm)).status).toBe(200);
    expect((await request(app).delete(`/api/maps/${visibleId}/bindings/${s.body.id}`).set(gm)).status).toBe(404);
    expect((await request(app).delete(`/api/maps/${hid.body.id}/bindings/${c.body.id}`).set(gm)).status).toBe(404);
    expect((await request(app).get(`/api/maps/${visibleId}/bindings`).set(gm)).status).toBe(200);
    await request(app).delete(`/api/maps/${hid.body.id}`).set(gm);
  });

  it("ресайз без клеток триммит хранимое под новый размер (P1-6)", async () => {
    const created = await request(app).post("/api/maps").set(gm).send({ name: "Трим", grid: "square", scale: "planet" });
    const id = created.body.id as number;
    const cells = JSON.stringify({
      v: 3,
      cells: { "0,0": "forest", "23,17": "forest" },
      roads: ["0,0", "23,17"],
      labels: [{ x: 0, y: 0, text: "Дом" }, { x: 23, y: 17, text: "Край" }],
      rooms: [{ x: 20, y: 14, w: 4, h: 4, type: "empty", name: "" }],
      doors: [{ x: 23, y: 17, edge: "n", kind: "door", secret: false, pair: null }],
      traps: [{ x: 23, y: 17, kind: "pit" }],
      start: { x: 23, y: 17 },
      finish: { x: 0, y: 0 },
    });
    expect((await request(app).put(`/api/maps/${id}`).set(gm).send({ cells })).status).toBe(200);
    // Ужимка без cells: снаружи пропадает всё, внутри живёт, 200 вместо 400
    const res = await request(app).put(`/api/maps/${id}`).set(gm).send({ width: 10, height: 10 });
    expect(res.status).toBe(200);
    const got = JSON.parse(res.body.cells);
    expect(got.cells).toEqual({ "0,0": "forest" });
    expect(got.roads).toEqual(["0,0"]);
    expect(got.labels).toEqual([{ x: 0, y: 0, text: "Дом" }]);
    expect(got.rooms).toEqual([]);
    expect(got.doors).toEqual([]);
    expect(got.traps).toEqual([]);
    expect(got.start).toBe(null);
    expect(got.finish).toEqual({ x: 0, y: 0 });
    await request(app).delete(`/api/maps/${id}`).set(gm);
  });

  it("игрокам секретный слой не отдаётся (пакет A §6)", async () => {
    const cells = JSON.stringify({
      v: 3,
      cells: {},
      roads: [],
      labels: [],
      rooms: [],
      doors: [
        { x: 1, y: 1, edge: "n", kind: "secret", secret: false, pair: null },
        { x: 2, y: 1, edge: "n", kind: "trapped", secret: false, pair: null },
        { x: 3, y: 1, edge: "n", kind: "door", secret: true, pair: null },
        { x: 4, y: 1, edge: "n", kind: "door", secret: false, pair: null },
      ],
      traps: [{ x: 5, y: 5, kind: "pit" }],
      start: { x: 0, y: 0 },
      finish: null,
    });
    const put = await request(app).put(`/api/maps/${visibleId}`).set(gm).send({ cells });
    expect(put.status).toBe(200);

    const pl = await request(app).get(`/api/maps/${visibleId}`).set(player);
    expect(pl.status).toBe(200);
    const got = JSON.parse(pl.body.cells);
    expect(got.doors.map((d: { kind: string }) => d.kind).sort()).toEqual(["door", "door"]);
    expect(got.traps).toEqual([]);
    expect(got.start).toEqual({ x: 0, y: 0 });

    const gmGet = await request(app).get(`/api/maps/${visibleId}`).set(gm);
    expect(JSON.parse(gmGet.body.cells).doors).toHaveLength(4);

    const thumb = await request(app).get(`/api/maps/${visibleId}/thumbnail`).set(player);
    expect(thumb.status).toBe(200);
    expect(thumb.body.thumbnail).toBe(null);
  });
});
