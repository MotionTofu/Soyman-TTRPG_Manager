import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { canvasRouter } from "./canvas";

let app: express.Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api/canvas", canvasRouter);
});
async function freeBoard() {
  const response = await request(app).post("/api/canvas/free-boards").send({ name: "QA доска" });
  expect(response.status).toBe(201);
  return response.body.id as number;
}

describe("холст «Д»: новые объекты и сохранённый стиль", () => {
  it("стартовый набор использует черепа и нити темы 3,5 px", async () => {
    const board = await freeBoard();
    expect((await request(app).post(`/api/canvas/free-boards/${board}/preset`).send({ preset: "tavern" })).status).toBe(201);
    expect(db.prepare("SELECT shape FROM canvas_pins WHERE board_id=?").all(board)).toEqual(Array(3).fill({ shape: "skull" }));
    expect(db.prepare("SELECT width,color FROM canvas_threads WHERE board_id=?").all(board)).toEqual(Array(2).fill({ width: 3.5, color: "" }));
  });
  it("API даёт новые дефолты, а правка подписи сохраняет ручной стиль", async () => {
    const board = await freeBoard();
    const a = await request(app).post("/api/canvas/pins").send({ board_id: board });
    const b = await request(app).post("/api/canvas/pins").send({ board_id: board, shape: "square" });
    expect(a.body.shape).toBe("skull");
    expect(b.body.shape).toBe("square");
    const first = await request(app).post("/api/canvas/threads").send({ board_id: board, from_pin_id: a.body.id, to_pin_id: b.body.id });
    expect(first.body).toMatchObject({ width: 3.5, color: "" });
    await request(app).put(`/api/canvas/threads/${first.body.id}`).send({ width: 2, color: "#123456" });
    await request(app).put(`/api/canvas/threads/${first.body.id}`).send({ label: "  владеет  " });
    expect(db.prepare("SELECT label,width,color FROM canvas_threads WHERE id=?").get(first.body.id))
      .toEqual({ label: "владеет", width: 2, color: "#123456" });
    const other = await freeBoard();
    await request(app).post(`/api/canvas/free-boards/${other}/preset`).send({ preset: "chase" });
    expect(db.prepare("SELECT shape FROM canvas_pins WHERE id=?").get(b.body.id)).toEqual({ shape: "square" });
  });
});

describe("членство новых объектов в рамке", () => {
  it("стикер, картинка, загрузка, пин и набор сразу принадлежат самой маленькой раскрытой рамке", async () => {
    const board = await freeBoard();
    await request(app).post("/api/canvas/frames").send({ board_id: board, name: "Большая", x: 0, y: 0, w: 1000, h: 1000 });
    const frame = await request(app).post("/api/canvas/frames").send({ board_id: board, name: "Малая", x: 50, y: 50, w: 400, h: 400 });
    const body = { board_id: board, x: 100, y: 120 };
    const sticker = await request(app).post("/api/canvas/stickers").send({ ...body, text: "QA" });
    const image = await request(app).post("/api/canvas/images").send({ ...body, file_path: "QA.png" });
    const pin = await request(app).post("/api/canvas/pins").send(body);
    const upload = await request(app).post("/api/canvas/images/upload").field("board_id", String(board)).field("x", "100").field("y", "120")
      .attach("file", Buffer.from("QA image"), { filename: "qa.png", contentType: "image/png" });
    const source = Number(db.prepare("INSERT INTO canvas_bundles (name) VALUES ('QA набор')").run().lastInsertRowid);
    const bundle = await request(app).post(`/api/canvas/bundles/${source}/insert`).send(body);
    for (const [type, response] of [["sticker", sticker], ["image", image], ["pin", pin], ["image", upload], ["bundle", bundle]] as const) {
      expect(response.status).toBe(201);
      expect(db.prepare("SELECT x,y,parent_key FROM canvas_nodes WHERE board_id=? AND node_type=? AND node_id=?").get(board, type, response.body.id))
        .toEqual({ x: 100, y: 120, parent_key: `frame:${frame.body.id}` });
    }
  });
  it("свёрнутая и чужая рамки не прячут новый стикер", async () => {
    const board = await freeBoard(), other = await freeBoard();
    const frame = await request(app).post("/api/canvas/frames").send({ board_id: board, x: 0, y: 0, w: 400, h: 400 });
    await request(app).put(`/api/canvas/frames/${frame.body.id}`).send({ collapsed: 1 });
    await request(app).post("/api/canvas/frames").send({ board_id: other, x: 0, y: 0, w: 400, h: 400 });
    const sticker = await request(app).post("/api/canvas/stickers").send({ board_id: board, text: "QA", x: 100, y: 100 });
    expect(db.prepare("SELECT parent_key FROM canvas_nodes WHERE node_type='sticker' AND node_id=?").get(sticker.body.id)).toEqual({ parent_key: null });
  });
});

function storyBoard() {
  const setting = Number(db.prepare("INSERT INTO settings (name) VALUES ('QA')").run().lastInsertRowid);
  const arc = Number(db.prepare("INSERT INTO story_arcs (setting_id,name) VALUES (?,'QA')").run(setting).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO story_scenes (setting_id,arc_id,name) VALUES (?,?,'A')").run(setting, arc).lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO story_scenes (setting_id,arc_id,name) VALUES (?,?,'B')").run(setting, arc).lastInsertRowid);
  const transition = Number(db.prepare("INSERT INTO story_scene_transitions (from_scene_id,to_scene_id,label) VALUES (?,?,'дверь')").run(a, b).lastInsertRowid);
  const board = Number(db.prepare("INSERT INTO canvas_boards (scope_type,scope_id) VALUES ('arc',?)").run(arc).lastInsertRowid);
  return { setting, arc, a, b, transition, board };
}

describe("маршрут на существующей связи", () => {
  it("после перезагрузки разбивает связь, сохраняя реальный переход и его условие", async () => {
    const { arc, a, b, transition, board } = storyBoard();
    const route = await request(app).post("/api/canvas/routes").send({ board_id: board, x: 200, y: 100, from_key: `scene:${a}`, to_key: `scene:${b}`, kind: "transition" });
    expect(route.status).toBe(201);
    const loaded = await request(app).get(`/api/canvas/board?arc_id=${arc}`);
    expect(loaded.status).toBe(200);
    const edges = loaded.body.edges.filter((edge: { id: string }) => edge.id.includes("::r"));
    expect(edges.map((edge: { source: string; target: string }) => [edge.source, edge.target]))
      .toEqual([[`scene:${a}`, `route:${route.body.id}`], [`route:${route.body.id}`, `scene:${b}`]]);
    expect(db.prepare("SELECT from_scene_id,to_scene_id,label FROM story_scene_transitions WHERE id=?").get(transition))
      .toEqual({ from_scene_id: a, to_scene_id: b, label: "дверь" });
  });
  it("повторная вставка в сегмент сохраняет цепочку без обходного короткого пути", async () => {
    const { arc, a, b, board } = storyBoard();
    const first = await request(app).post("/api/canvas/routes").send({ board_id: board, from_key: `scene:${a}`, to_key: `scene:${b}` });
    const second = await request(app).post("/api/canvas/routes").send({ board_id: board, from_key: `route:${first.body.id}`, to_key: `scene:${b}` });
    expect(second.status).toBe(201);
    const loaded = await request(app).get(`/api/canvas/board?arc_id=${arc}`);
    expect(loaded.body.edges.map((edge: { source: string; target: string }) => [edge.source, edge.target]))
      .toEqual([[`scene:${a}`, `route:${first.body.id}`], [`route:${first.body.id}`, `route:${second.body.id}`], [`route:${second.body.id}`, `scene:${b}`]]);
    expect(db.prepare("SELECT to_key FROM canvas_route_outputs WHERE route_id=?").all(first.body.id))
      .toEqual([{ to_key: `route:${second.body.id}` }]);
  });
  it("не принимает чужой маршрут, неподдерживаемые нити и частичные концы", async () => {
    const a = await freeBoard(), b = await freeBoard();
    const foreign = await request(app).post("/api/canvas/routes").send({ board_id: b });
    for (const body of [
      { from_key: `route:${foreign.body.id}`, to_key: "scene:1" },
      { from_key: "pin:1", to_key: "pin:2", kind: "thread" },
      { from_key: "scene:1" },
    ]) expect((await request(app).post("/api/canvas/routes").send({ board_id: a, ...body })).status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvas_routes WHERE board_id=?").get(a)).toEqual({ n: 0 });
  });
});
