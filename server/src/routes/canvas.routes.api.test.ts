// Рерауты холста на СВЕЖЕЙ базе: создание, чтение, вход, выход, удаление.
//
// Повод — 2026-09-11: с 2026-08-30 выходы рераута живут в
// canvas_route_outputs, и колонку `canvas_routes.to_key` убрали из schema.sql,
// но код продолжал её писать и читать. У владельца колонка осталась от
// прежней модели, поэтому у него всё работало, а на новой установке (и в
// сборке dist:empty) создание рераута падало «table canvas_routes has no column
// named to_key». База владельца такой дефект не покажет никогда, поэтому
// держит только тест на пустой базе — её заводит src/test/setupTempDb.ts.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { canvasRouter } from "./canvas";

let app: express.Express;
let boardId = 0;
let sceneId = 0;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/canvas", canvasRouter);

  const settingId = Number(
    db.prepare("INSERT INTO settings (name, folder_path) VALUES ('S', 'Settings/S')").run().lastInsertRowid
  );
  const arcId = Number(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'A')").run(settingId).lastInsertRowid);
  sceneId = Number(
    db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Сцена')").run(settingId, arcId)
      .lastInsertRowid
  );
  boardId = Number(
    db.prepare("INSERT INTO canvas_boards (scope_type, scope_id) VALUES ('arc', ?)").run(arcId).lastInsertRowid
  );
});

describe("рерауты холста на свежей базе", () => {
  let routeId = 0;

  it("пустой рераут создаётся, и строка не несёт отменённого to_key", async () => {
    const res = await request(app).post("/api/canvas/routes").send({ board_id: boardId, x: 10, y: 20 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ from_key: "", kind: "transition", role: "" });
    expect(res.body).not.toHaveProperty("to_key");
    routeId = res.body.id;
  });

  it("доска отдаёт рерауты", async () => {
    const res = await request(app).get(`/api/canvas/routes?board_id=${boardId}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: number }) => r.id)).toContain(routeId);
  });

  it("вход и выход подводятся", async () => {
    const put = await request(app)
      .put(`/api/canvas/routes/${routeId}`)
      .send({ from_key: `scene:${sceneId}`, kind: "transition", role: "" });
    expect(put.status).toBe(200);
    expect(put.body.from_key).toBe(`scene:${sceneId}`);

    const out = await request(app).post(`/api/canvas/routes/${routeId}/outputs`).send({ to_key: `scene:${sceneId}`, role: "" });
    expect(out.status).toBe(201);
    const rows = db.prepare("SELECT to_key FROM canvas_route_outputs WHERE route_id = ?").all(routeId);
    expect(rows).toEqual([{ to_key: `scene:${sceneId}` }]);
  });

  it("рераут удаляется вместе с выходами", async () => {
    const res = await request(app).delete(`/api/canvas/routes/${routeId}`);
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM canvas_routes WHERE id = ?").get(routeId)).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM canvas_route_outputs WHERE route_id = ?").get(routeId)).toEqual({ n: 0 });
  });
});
