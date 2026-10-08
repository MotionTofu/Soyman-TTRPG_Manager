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
  it("линия, столб, переправа и россыпь: у каждой свои данные и свой размер картинки", async () => {
    const pack = (await api().post("/api/map-packs").auth(gm, { type: "bearer" }).send({ name: "Тракт" })).body;
    // Полоса 600×300 при ширине 1 клетка: высота 256 точек, длина по пропорциям — 2 клетки.
    const line = (await upload(`/api/map-packs/${pack.id}/items`, { kind: "line", name: "Плетень", use: "wall", width: "1" })).body.pack.items[0];
    expect(line).toMatchObject({ kind: "line", use: "wall", width: 1, images: [{ role: "variant", width: 512, height: 256 }] });
    // Столб — квадрат в две ширины линии; второй заменяет первый.
    await upload(`/api/map-packs/items/${line.id}/images`, { role: "post" });
    const posts = (await upload(`/api/map-packs/items/${line.id}/images`, { role: "post" })).body.pack.items[0].images.filter((image: { role: string }) => image.role === "post");
    expect(posts.filter((image: { archived: boolean }) => !image.archived)).toHaveLength(1);
    expect(posts[0]).toMatchObject({ width: 512, height: 512 });
    const made = (await upload(`/api/map-packs/${pack.id}/items`, { kind: "crossing", name: "Мост", deck: "ford", width: "чушь" })).body.pack.items;
    expect(made.find((item: { kind: string }) => item.kind === "crossing")).toMatchObject({ deck: "ford", width: 2 });
    const scatter = (await upload(`/api/map-packs/${pack.id}/items`, { kind: "scatter", name: "Кусты", size: "2", density: "99" })).body.pack.items.find((item: { kind: string }) => item.kind === "scatter");
    expect(scatter).toMatchObject({ size: 2, density: 4, images: [{ width: 512, height: 512 }] });
    const door = (await upload(`/api/map-packs/${pack.id}/items`, { kind: "door", name: "Ворота", span: "2", secret: "true" })).body.pack.items.find((item: { kind: string }) => item.kind === "door");
    expect(door).toMatchObject({ span: 2, secret: true, images: [{ width: 512, height: 256 }] });
    const edited = await api().put(`/api/map-packs/items/${line.id}`).auth(gm, { type: "bearer" }).send({ use: "мимо", width: 3 });
    expect(edited.body.items.find((item: { id: number }) => item.id === line.id)).toMatchObject({ use: "road", width: 3 });
  });

  it("поверхность: квадратный образец без полей, число клеток и средний цвет", async () => {
    const pack = (await api().post("/api/map-packs").auth(gm, { type: "bearer" }).send({ name: "Пол" })).body;
    const made = await upload(`/api/map-packs/${pack.id}/items`, { kind: "surface", name: "Плитка", cells: "2" });
    expect(made.status).toBe(201);
    const item = made.body.pack.items[0];
    // 600×300 обрезается до квадрата; образец на 2 клетки — 512 точек, исходник мельче не растягивается.
    expect(item).toMatchObject({ kind: "surface", cells: 2, fill: expect.stringMatching(/^#a[9ab]335[456]$/), images: [{ role: "variant", width: 300, height: 300 }] });
    // Вид «со стороны» поверхности не положен: приходит обычным вариантом.
    const variant = await upload(`/api/map-packs/items/${item.id}/images`, { role: "w" });
    expect(variant.body.pack.items[0].images.map((image: { role: string }) => image.role)).toEqual(["variant", "variant"]);
    const edited = await api().put(`/api/map-packs/items/${item.id}`).auth(gm, { type: "bearer" }).send({ cells: 99 });
    expect(edited.body.items[0]).toMatchObject({ cells: 16, fill: item.fill });
    // Кромка: по умолчанию край как у встроенных; значения зажимаются; маска кромки — отдельная картинка, новая заменяет прежнюю.
    expect(item).toMatchObject({ edge_width: 0.25, edge_rough: 0, tier: 1 });
    const edged = await api().put(`/api/map-packs/items/${item.id}`).auth(gm, { type: "bearer" }).send({ edge_width: 5, edge_rough: 0.6, tier: 2 });
    expect(edged.body.items[0]).toMatchObject({ cells: 16, edge_width: 1, edge_rough: 0.6, tier: 2 });
    await upload(`/api/map-packs/items/${item.id}/images`, { role: "edge" });
    const masks = (await upload(`/api/map-packs/items/${item.id}/images`, { role: "edge" })).body.pack.items[0].images.filter((image: { role: string }) => image.role === "edge");
    expect(masks.filter((image: { archived: boolean }) => !image.archived)).toHaveLength(1);
  });

  it("жанры набора: до трёх пар, мусор отбрасывается", async () => {
    const genres = [{ genre: "Фэнтези", subgenre: "Тёмное фэнтези" }, { genre: "Хоррор" }, { subgenre: "без жанра" }, "строка", { genre: "Реализм" }, { genre: "Странное" }];
    const made = await api().post("/api/map-packs").auth(gm, { type: "bearer" }).send({ name: "Жанровый", kinds: ["city"], genres });
    expect(made.body.genres).toEqual([{ genre: "Фэнтези", subgenre: "Тёмное фэнтези" }, { genre: "Хоррор" }, { genre: "Реализм" }]);
    const cleared = await api().put(`/api/map-packs/${made.body.id}`).auth(gm, { type: "bearer" }).send({ name: "Жанровый", kinds: ["city"] });
    expect(cleared.body.genres).toEqual([]);
  });
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
