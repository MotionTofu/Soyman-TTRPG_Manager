import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { VAULT_ROOT } from "../services/filesystem";
import { signToken } from "../services/auth";

// Папку кампании удалили или перенесли в проводнике: приложение это видит,
// говорит об этом и умеет вернуть папку, не плодя вторую рядом с настоящей.
let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('folder-gm', 'test-only', 'gm')").run().lastInsertRowid
  );
  gm = signToken({ id, username: "folder-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((e) => (e ? reject(e) : resolve())));
});

// Ответы сервера отдают *_path абсолютными (absolutizeVaultPaths), а в базе
// они относительные — тесту нужны обе формы.
function absOf(p: string): string {
  return path.isAbsolute(p) ? p : path.join(VAULT_ROOT, p);
}
function relOf(p: string): string {
  return path.isAbsolute(p) ? path.relative(VAULT_ROOT, p) : p;
}

async function createCampaign(name: string): Promise<{ id: number; folder: string }> {
  const r = await request(server.app).post("/api/campaigns").auth(gm, { type: "bearer" }).send({ name });
  expect(r.status).toBe(201);
  return { id: r.body.id as number, folder: r.body.folder_path as string };
}

describe("кампания с пропавшей папкой", () => {
  it("список и профиль помечают кампанию, переименование отказывает", async () => {
    const c = await createCampaign("ПропалаПапка");
    const before = await request(server.app).get(`/api/campaigns/${c.id}`).auth(gm, { type: "bearer" });
    expect(before.body.folder_missing).toBe(false);

    fs.rmSync(absOf(c.folder), { recursive: true, force: true });

    const after = await request(server.app).get(`/api/campaigns/${c.id}`).auth(gm, { type: "bearer" });
    expect(after.body.folder_missing).toBe(true);
    const list = (await request(server.app).get("/api/campaigns").auth(gm, { type: "bearer" })).body as {
      id: number;
      folder_missing: boolean;
    }[];
    expect(list.find((x) => x.id === c.id)!.folder_missing).toBe(true);

    // Раньше здесь падало 500 «Cannot rename: source folder missing».
    const rename = await request(server.app).put(`/api/campaigns/${c.id}`).auth(gm, { type: "bearer" }).send({ name: "Новое имя" });
    expect(rename.status).toBe(409);
    expect(String(rename.body.error)).toContain("Папки кампании нет в хранилище");
    expect((db.prepare("SELECT name FROM campaigns WHERE id = ?").get(c.id) as { name: string }).name).toBe("ПропалаПапка");
  });

  it("починка привязывает найденную папку с тем же именем, а не заводит вторую", async () => {
    const c = await createCampaign("Переехала");
    const abs = absOf(c.folder);
    fs.writeFileSync(path.join(abs, "map.jpg"), "jpg");
    // Путь в базе испорчен, а папка с файлами на месте — типичный переезд базы.
    db.prepare("UPDATE campaigns SET folder_path = ? WHERE id = ?").run(path.join("Campaigns", "Переехала-СтароеИмя"), c.id);

    const repair = await request(server.app).post(`/api/campaigns/${c.id}/folder/repair`).auth(gm, { type: "bearer" }).send({});
    expect(repair.status).toBe(200);
    expect(repair.body.bound).toBe(true);
    expect(relOf(repair.body.folder_path)).toBe(relOf(c.folder));
    expect(fs.existsSync(path.join(abs, "map.jpg"))).toBe(true);
    expect(fs.readdirSync(path.join(VAULT_ROOT, "Campaigns")).filter((n) => n.startsWith("Переехала")).length).toBe(1);

    const again = await request(server.app).post(`/api/campaigns/${c.id}/folder/repair`).auth(gm, { type: "bearer" }).send({});
    expect(again.status).toBe(409);
  });

  it("починка заводит пустую папку, когда искать нечего", async () => {
    const c = await createCampaign("СовсемБезПапки");
    fs.rmSync(absOf(c.folder), { recursive: true, force: true });
    db.prepare("UPDATE campaigns SET folder_path = NULL WHERE id = ?").run(c.id);

    const repair = await request(server.app).post(`/api/campaigns/${c.id}/folder/repair`).auth(gm, { type: "bearer" }).send({});
    expect(repair.status).toBe(200);
    expect(repair.body.bound).toBe(false);
    expect(fs.existsSync(absOf(repair.body.folder_path))).toBe(true);
  });

  it("персонаж заводится, даже когда папки игрока нет — она создаётся заново", async () => {
    const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Игрок без папки')").run().lastInsertRowid);
    const userId = Number(
      db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('folder-player', 'test-only', 'player', ?)").run(playerId).lastInsertRowid
    );
    const token = signToken({ id: userId, username: "folder-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });

    // Раньше здесь падало 500: standaloneCharacterFolder на folder_path = NULL.
    const r = await request(server.app).post("/api/player/characters").auth(token, { type: "bearer" }).send({ character_name: "Первый" });
    expect(r.status).toBe(201);
    const folder = (db.prepare("SELECT folder_path AS p FROM players WHERE id = ?").get(playerId) as { p: string }).p;
    expect(folder).toBeTruthy();
    expect(fs.existsSync(absOf(folder))).toBe(true);
  });

  it("Мастер заводит персонажа в кампании с пропавшей папкой — папка возвращается", async () => {
    const c = await createCampaign("ПерсонажБезПапки");
    fs.rmSync(absOf(c.folder), { recursive: true, force: true });
    const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Игрок кампании')").run().lastInsertRowid);

    const r = await request(server.app).post("/api/characters").auth(gm, { type: "bearer" })
      .send({ player_id: playerId, campaign_id: c.id, character_name: "Новичок" });
    expect(r.status).toBe(201);
    const folder = (db.prepare("SELECT folder_path AS p FROM campaigns WHERE id = ?").get(c.id) as { p: string }).p;
    expect(fs.existsSync(absOf(folder))).toBe(true);
    expect(fs.existsSync(absOf(r.body.folder_path))).toBe(true);
  });

  it("«Указать папку» на «Здоровье» предлагает только свободные папки и привязывает выбранную", async () => {
    const c = await createCampaign("ВыборПапки");
    const lost = path.join("Campaigns", "ВыборПапки-Потеряшка");
    fs.mkdirSync(path.join(VAULT_ROOT, lost), { recursive: true });
    fs.writeFileSync(path.join(VAULT_ROOT, lost, "note.txt"), "txt");
    db.prepare("UPDATE campaigns SET folder_path = ? WHERE id = ?").run(path.join("Campaigns", "ВыборПапки-Битая"), c.id);

    const free = (await request(server.app).get(`/api/health/campaign-folders?id=${c.id}`).auth(gm, { type: "bearer" })).body as {
      folders: string[];
    };
    expect(free.folders).toContain(lost);
    // Папка самой кампании свободна (её путь испорчен), чужие — нет.
    const taken = db.prepare("SELECT folder_path AS p FROM campaigns WHERE id != ? AND folder_path IS NOT NULL").all(c.id) as { p: string }[];
    for (const t of taken) expect(free.folders).not.toContain(relOf(t.p));

    const bind = await request(server.app).post("/api/health/path/bind").auth(gm, { type: "bearer" })
      .send({ table: "campaigns", column: "folder_path", id: c.id, path: lost });
    expect(bind.status).toBe(200);
    expect((db.prepare("SELECT folder_path AS p FROM campaigns WHERE id = ?").get(c.id) as { p: string }).p).toBe(lost);

    const again = await request(server.app).post("/api/health/path/bind").auth(gm, { type: "bearer" })
      .send({ table: "campaigns", column: "folder_path", id: c.id, path: lost });
    expect(again.status).toBe(409);
  });
});
