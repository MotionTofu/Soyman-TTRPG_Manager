import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;
let player: string;
let entryA: number;
let entryB: number;

const gmReq = (method: "get" | "post" | "put" | "delete", url: string) =>
  request(server.app)[method](`/api/workbench${url}`).auth(gm, { type: "bearer" });
const blocks = async () => (await gmReq("get", "/blocks")).body as { id: string; kind: string; revision: number; entry_id: number | null; title: string; text: string }[];

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const token = (name: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)").run(name, role).lastInsertRowid);
    return signToken({ id, username: name, role, playerId: null, isAdmin: false, tokenVersion: 0 });
  };
  gm = token("workbench-gm", "gm");
  player = token("workbench-player", "player");
  const system = Number(db.prepare("INSERT INTO systems (name) VALUES ('Система верстака')").run().lastInsertRowid);
  const section = Number(db.prepare("INSERT INTO system_sections (system_id, name, kind) VALUES (?, 'Заклинания', 'spell')").run(system).lastInsertRowid);
  const entry = db.prepare("INSERT INTO compendium_entries (system_id, section_id, kind, name, description) VALUES (?, ?, 'spell', ?, 'Текст')");
  entryA = Number(entry.run(system, section, "Свет").lastInsertRowid);
  entryB = Number(entry.run(system, section, "Брызги кислоты").lastInsertRowid);
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
});

describe("workbench draft", () => {
  it("is the GM's alone", async () => {
    expect((await request(server.app).get("/api/workbench/blocks").auth(player, { type: "bearer" })).status).toBe(403);
  });

  it("adds cards from the bag once, however often they are sent", async () => {
    const first = await gmReq("post", "/cards").send({ entry_ids: [entryA, entryB, entryA, 999_999] });
    expect(first.body).toEqual({ added: 2, count: 2 });
    const again = await gmReq("post", "/cards").send({ entry_ids: [entryB] });
    expect(again.body).toEqual({ added: 0, count: 2 });
    expect((await blocks()).map((b) => b.entry_id)).toEqual([entryA, entryB]);
  });

  it("adds own text and page breaks at the end and keeps the order it is given", async () => {
    const text = await gmReq("post", "/blocks").send({ kind: "text" });
    const brk = await gmReq("post", "/blocks").send({ kind: "page_break" });
    expect(text.status).toBe(201);
    expect((await gmReq("post", "/blocks").send({ kind: "card" })).status).toBe(400);
    const ids = (await blocks()).map((b) => b.id);
    expect(ids.slice(-2)).toEqual([text.body.id, brk.body.id]);
    const reversed = [...ids].reverse();
    expect((await gmReq("put", "/order").send({ ids: reversed })).status).toBe(200);
    expect((await blocks()).map((b) => b.id)).toEqual(reversed);
  });

  it("refuses a text edit made over another window's save", async () => {
    const [block] = (await blocks()).filter((b) => b.kind === "text");
    const mine = await gmReq("put", `/blocks/${block.id}`).send({ text: "Колокол бьёт трижды", base_revision: block.revision });
    expect(mine.status).toBe(200);
    expect(mine.body.revision).toBe(block.revision + 1);
    // Второе окно правило от старой версии.
    const stale = await gmReq("put", `/blocks/${block.id}`).send({ text: "Другое", base_revision: block.revision });
    expect(stale.status).toBe(409);
    expect(stale.body.block.text).toBe("Колокол бьёт трижды");
    // Ширина и галочки текст не трогают — им версия не нужна.
    expect((await gmReq("put", `/blocks/${block.id}`).send({ width: "half" })).body.width).toBe("half");
    const forced = await gmReq("put", `/blocks/${block.id}`).send({ text: "Другое", force: true });
    expect(forced.body.text).toBe("Другое");
  });

  it("gives a removed block back whole for «Вернуть»", async () => {
    const [block] = (await blocks()).filter((b) => b.kind === "text");
    const removed = await gmReq("delete", `/blocks/${block.id}`);
    expect(removed.status).toBe(200);
    expect((await blocks()).some((b) => b.id === block.id)).toBe(false);
    const restored = await gmReq("post", "/blocks/restore").send(removed.body);
    expect(restored.status).toBe(201);
    expect(restored.body).toMatchObject({ id: block.id, text: "Другое", width: "half" });
  });

  it("keeps a card whose compendium entry was deleted, for «Запись удалена»", async () => {
    db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(entryB);
    expect((await blocks()).some((b) => b.entry_id === entryB)).toBe(true);
  });

  it("clears everything on «Очистить верстак»", async () => {
    expect((await gmReq("delete", "/blocks")).status).toBe(200);
    expect(await blocks()).toEqual([]);
  });
});
