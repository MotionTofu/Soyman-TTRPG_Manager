import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import AdmZip from "adm-zip";
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

  it("архив для обмена: выгрузка, совпадение, копия, замена с теми же кодами, чужой файл", async () => {
    const auth = { type: "bearer" } as const;
    const pack = (await api().post("/api/map-packs").auth(gm, auth).send({ name: "Пристань", kinds: ["tactical"], genres: [{ genre: "Фэнтези" }] })).body;
    await upload(`/api/map-packs/${pack.id}/items`, { name: "Бочка" });
    const surface = (await upload(`/api/map-packs/${pack.id}/items`, { name: "Доски", kind: "surface", cells: "2", tier: "2" })).body.pack;
    const exported = await api().get(`/api/map-packs/${pack.id}/export`).auth(gm, auth).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(exported.status).toBe(200);
    const file = exported.body as Buffer, zip = new AdmZip(file);
    const manifest = JSON.parse(zip.readAsText("pack.json"));
    expect(manifest).toMatchObject({ format: "soyman-map-pack", version: 1, pack: { uid: pack.uid, name: "Пристань", genres: [{ genre: "Фэнтези" }] } });
    expect(zip.getEntries().filter((entry) => entry.entryName.startsWith("images/"))).toHaveLength(2);
    const send = (body: Buffer, mode?: string) => {
      const call = api().post("/api/map-packs/import").auth(gm, auth);
      if (mode) call.field("mode", mode);
      return call.attach("file", body, { filename: "pack.zip", contentType: "application/zip" });
    };

    const clash = await send(file);
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: "pack-exists", name: "Пристань" });

    const copy = (await send(file, "copy")).body;
    expect(copy).toMatchObject({ name: "Пристань (копия)", genres: [{ genre: "Фэнтези" }] });
    expect(copy.uid).not.toBe(pack.uid);
    expect(copy.items.map((item: { name: string }) => item.name).sort()).toEqual(["Бочка", "Доски"]);
    expect(copy.items.find((item: { kind: string }) => item.kind === "surface")).toMatchObject({ cells: 2, tier: 2 });
    expect(copy.items.some((item: { uid: string }) => surface.items.some((own: { uid: string }) => own.uid === item.uid))).toBe(false);

    // Замена: вещь, добавленная после выгрузки, уходит в архив; вещи и картинки из файла сохраняют коды и id.
    await upload(`/api/map-packs/${pack.id}/items`, { name: "Лишнее" });
    await api().put(`/api/map-packs/${pack.id}`).auth(gm, auth).send({ name: "Переименовано", kinds: ["city"] });
    const replaced = await send(file, "replace");
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({ id: pack.id, uid: pack.uid, name: "Пристань", kinds: ["tactical"] });
    const live = replaced.body.items.filter((item: { archived: boolean }) => !item.archived);
    expect(live.map((item: { name: string }) => item.name).sort()).toEqual(["Бочка", "Доски"]);
    expect(replaced.body.items.find((item: { name: string }) => item.name === "Лишнее").archived).toBe(true);
    const images = (body: { items: { images: { uid: string; id: number }[] }[] }) => body.items.flatMap((item) => item.images.map((image) => `${image.id}:${image.uid}`)).sort();
    expect(images({ items: live })).toEqual(images({ items: surface.items }));

    // Набор с новым кодом, но с чужими кодами вещей: вещи получают новые коды, чужое не трогается.
    manifest.pack.uid = "11111111-2222-4333-8444-555555555555";
    zip.updateFile("pack.json", Buffer.from(JSON.stringify(manifest)));
    const fresh = (await send(zip.toBuffer())).body;
    expect(fresh.uid).toBe("11111111-2222-4333-8444-555555555555");
    expect(fresh.items.some((item: { uid: string }) => surface.items.some((own: { uid: string }) => own.uid === item.uid))).toBe(false);

    expect((await send(Buffer.from("не архив"))).body.error).toBe("Файл не похож на архив набора");
    manifest.version = 99; zip.updateFile("pack.json", Buffer.from(JSON.stringify(manifest)));
    expect((await send(zip.toBuffer())).body.error).toMatch(/более новой версией/);
    expect((await api().post("/api/map-packs/import").auth(player, auth).attach("file", file, "pack.zip")).status).toBe(403);
  });
});
