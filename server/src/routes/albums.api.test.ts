import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import AdmZip from "adm-zip";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Файл альбома (разбор 2026-10-02, Q3–Q7): выгрузка, повторный импорт без
// дублей и отказ на подложенный не-картинку.

let server: typeof import("../index");
let gm: string;
let settingId: number;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('album-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "album-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
  const setting = await request(server.app).post("/api/settings").auth(gm, { type: "bearer" }).send({ name: "Мир альбомов" });
  settingId = setting.body.id;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
});

const importZip = (bytes: Buffer) =>
  request(server.app)
    .post(`/api/albums/import?setting_id=${settingId}`)
    .auth(gm, { type: "bearer" })
    .attach("file", bytes, { filename: "альбом.zip", contentType: "application/zip" });

function albumZip(images: { file: string; name: string }[], files: Record<string, Buffer>) {
  const zip = new AdmZip();
  zip.addFile("album.json", Buffer.from(JSON.stringify({ format: "soyman-album/1", name: "Карты", images }), "utf8"));
  for (const [name, data] of Object.entries(files)) zip.addFile(name, data);
  return zip.toBuffer();
}

describe("файл альбома", () => {
  it("импорт заводит альбом, выгрузка отдаёт его же, повтор не дублирует картинки", async () => {
    const first = await importZip(albumZip([{ file: "images/001-map.png", name: "Карта порта" }], { "images/001-map.png": PNG }));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ album: { name: "Карты" }, added: 1, skipped: 0 });

    const exported = await request(server.app)
      .get(`/api/albums/${first.body.album.id}/export`)
      .auth(gm, { type: "bearer" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    const manifest = JSON.parse(new AdmZip(exported.body as Buffer).getEntry("album.json")!.getData().toString("utf8"));
    expect(manifest.images).toEqual([expect.objectContaining({ name: "Карта порта", file: expect.stringMatching(/^images\//) })]);
    expect(manifest.images[0]).not.toHaveProperty("notes");

    const second = await importZip(exported.body as Buffer);
    // Всё уже в галерее — пустой альбом не заводится.
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ album: null, added: 0, skipped: 1 });
    // Новая картинка (байт в хвосте — другой хэш) — альбом заводится, имя с «(2)».
    const third = await importZip(albumZip([{ file: "images/002.png", name: "Другая" }], { "images/002.png": Buffer.concat([PNG, Buffer.from([0])]) }));
    expect(third.body).toMatchObject({ album: { name: "Карты (2)" }, added: 1, skipped: 0 });
  });

  it("модуль сеттинга несёт альбомы только по галочке, обновление не трогает раскладку получателя", async () => {
    const get = (include: string) => request(server.app).get(`/api/settings/${settingId}/export?include=${include}`).auth(gm, { type: "bearer" });
    expect((await get("resources")).body.albums).toBeUndefined();
    const file = (await get("resources,albums,images")).body;
    expect(file.albums.map((a: { name: string }) => a.name)).toEqual(["Карты", "Карты (2)"]);
    expect(file.resources[0]).toMatchObject({ album_name: "Карты" });
    expect(file.resources[0]).not.toHaveProperty("album_id");

    const created = await request(server.app).post("/api/settings/import").auth(gm, { type: "bearer" }).send(file);
    expect(created.status).toBe(201);
    const albumOf = (sid: number) =>
      db.prepare("SELECT a.name FROM resources r JOIN albums a ON a.id = r.album_id WHERE r.setting_id = ? ORDER BY r.id").all(sid) as { name: string }[];
    expect(albumOf(created.body.id)).toEqual([{ name: "Карты" }, { name: "Карты (2)" }]);

    // Получатель переложил картинку — обновление модуля её не двигает.
    const [mine] = db.prepare("SELECT id FROM albums WHERE setting_id = ? AND name = 'Карты (2)'").all(created.body.id) as { id: number }[];
    db.prepare("UPDATE resources SET album_id = ? WHERE setting_id = ?").run(mine.id, created.body.id);
    const updated = await request(server.app).post(`/api/settings/${created.body.id}/update`).auth(gm, { type: "bearer" }).send(file);
    expect(updated.status).toBe(200);
    expect(albumOf(created.body.id)).toEqual([{ name: "Карты (2)" }, { name: "Карты (2)" }]);
    expect((db.prepare("SELECT COUNT(*) n FROM albums WHERE setting_id = ?").get(created.body.id) as { n: number }).n).toBe(2);
  });

  it("не-картинка под видом png отклоняется целиком", async () => {
    const before = (db.prepare("SELECT COUNT(*) n FROM albums WHERE setting_id = ?").get(settingId) as { n: number }).n;
    const bad = await importZip(albumZip([{ file: "images/x.png", name: "Подлог" }], { "images/x.png": Buffer.from("<script>alert(1)</script>") }));
    expect(bad.status).toBe(400);
    expect((db.prepare("SELECT COUNT(*) n FROM albums WHERE setting_id = ?").get(settingId) as { n: number }).n).toBe(before);
  });
});
