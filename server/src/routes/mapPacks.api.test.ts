import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Наборы ассетов карт (гриллинг 2026-10-08): объект с вариантами и видами по сторонам, архив вместо удаления.

let server: typeof import("../index");
let gm: string;
let player: string;
let png: Buffer;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const user = (name: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)").run(name, role).lastInsertRowid);
    return signToken({ id, username: name, role, playerId: null, isAdmin: false, tokenVersion: 0 });
  };
  gm = user("packs-gm", "gm");
  player = user("packs-player", "player");
  png = await sharp({ create: { width: 600, height: 300, channels: 4, background: "#aa3355" } }).png().toBuffer();
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
});

const api = () => request(server.app);
const upload = (url: string, fields: Record<string, string>) => {
  const call = api().post(url).auth(gm, { type: "bearer" }).attach("file", png, { filename: "x.png", contentType: "image/png" });
  for (const [key, value] of Object.entries(fields)) call.field(key, value);
  return call;
};

describe("наборы ассетов карт", () => {
  it("игроку наборы закрыты", async () => {
    expect((await api().get("/api/map-packs").auth(player, { type: "bearer" })).status).toBe(403);
  });

  it("объект: размер в клетках, варианты, виды по сторонам, последний вариант не убрать", async () => {
    const pack = (await api().post("/api/map-packs").auth(gm, { type: "bearer" }).send({ name: "Порт", kinds: ["city", "чужое"] })).body;
    expect(pack).toMatchObject({ name: "Порт", kinds: ["city"], archived: false, items: [] });

    const created = await upload(`/api/map-packs/${pack.id}/items`, { name: "Трон", section: "Мебель", w: "2", h: "1" });
    expect(created.status).toBe(201);
    const item = created.body.pack.items[0];
    // 600×300 на 2×1 клетки: стандарт 512×256, картинка крупнее — ужимается до него.
    expect(item).toMatchObject({ name: "Трон", section: "Мебель", w: 2, h: 1, images: [{ role: "variant", width: 512, height: 256 }] });
    expect(created.body.small).toBe(false);

    // Вид сбоку лежит поперёк: 1×2 клетки. Второй вид той же стороны заменяет первый.
    const west = await upload(`/api/map-packs/items/${item.id}/images`, { role: "w" });
    expect(west.body.pack.items[0].images.find((image: { role: string }) => image.role === "w")).toMatchObject({ width: 256, height: 512, archived: false });
    const again = (await upload(`/api/map-packs/items/${item.id}/images`, { role: "w" })).body.pack.items[0].images.filter((image: { role: string }) => image.role === "w");
    expect(again.map((image: { archived: boolean }) => image.archived).sort()).toEqual([false, true]);

    // Вид стороны убирается свободно, единственный вариант — нет.
    const live = again.find((image: { archived: boolean }) => !image.archived);
    expect((await api().delete(`/api/map-packs/images/${live.id}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((await api().delete(`/api/map-packs/images/${item.images[0].id}`).auth(gm, { type: "bearer" })).status).toBe(400);

    // Набор уходит в архив и возвращается; объект из набора убирается пометкой.
    expect((await api().put(`/api/map-packs/${pack.id}/archive`).auth(gm, { type: "bearer" }).send({ archived: true })).body.archived).toBe(true);
    expect((await upload(`/api/map-packs/${pack.id}/items`, { name: "Стул", w: "1", h: "1" })).status).toBe(404);
    expect((await api().put(`/api/map-packs/${pack.id}/archive`).auth(gm, { type: "bearer" }).send({ archived: false })).body.archived).toBe(false);
    const removed = await api().delete(`/api/map-packs/items/${item.id}`).auth(gm, { type: "bearer" });
    expect(removed.body.items[0]).toMatchObject({ archived: true, images: expect.arrayContaining([expect.objectContaining({ role: "variant" })]) });
  });
});
