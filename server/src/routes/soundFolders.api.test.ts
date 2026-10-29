import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { db, openDatabase } from "../db/db";
import { migrateSoundFolders, soundFoldersReady } from "../db/soundFolders";
import { VAULT_ROOT } from "../services/filesystem";
import { soundsRouter } from "./sounds";

const app = express();
app.use(express.json());
app.use("/sounds", soundsRouter);

beforeEach(() => {
  migrateSoundFolders(db);
  db.exec("DELETE FROM sound_folder_items; DELETE FROM sound_folders");
});

function track(role = "background", filePath: string | null = null) {
  return Number(db.prepare("INSERT INTO resources (name, type, scope, category, audio_role, file_path) VALUES ('Audio folders test: звук', 'link', 'global', 'audio', ?, ?)")
    .run(role, filePath).lastInsertRowid);
}

async function folder(role = "background") {
  const result = await request(app).post("/sounds/folders").send({ role, name: "  Для теста  " });
  expect(result.status).toBe(201);
  return result.body.id as number;
}

describe("папки аудиотеки", () => {
  it.each(["background", "ambient", "weather", "stinger"])("создаёт и переименовывает пустую папку раздела %s", async (role) => {
    const id = await folder(role);
    expect((await request(app).get("/sounds/folders")).body).toEqual([{ id, role, name: "Для теста" }]);
    expect((await request(app).put(`/sounds/folders/${id}`).send({ name: "  Новое имя  " })).body)
      .toEqual({ id, role, name: "Новое имя" });
    // Повторный проход миграции не теряет пустые папки.
    migrateSoundFolders(db);
    expect((await request(app).get("/sounds/folders")).body[0].name).toBe("Новое имя");
  });

  it("сохраняет перенос в папку и обратно при повторном чтении", async () => {
    const id = track();
    const folderId = await folder();
    expect((await request(app).put(`/sounds/${id}`).send({ folder_id: folderId })).body.folder_id).toBe(folderId);
    const read = async () => (await request(app).get("/sounds")).body.find((s: { resource_id: number }) => s.resource_id === id);
    expect((await read()).folder_id).toBe(folderId);
    expect((await request(app).put(`/sounds/${id}`).send({ folder_id: null })).status).toBe(200);
    expect((await read()).folder_id).toBeNull();
  });

  it("отклоняет чужой раздел и не сохраняет остальные поля отказанного запроса", async () => {
    const id = track();
    const folderId = await folder("ambient");
    const result = await request(app).put(`/sounds/${id}`).send({ folder_id: folderId, name: "Не сохранять" });
    expect(result.status).toBe(400);
    expect(db.prepare("SELECT name FROM resources WHERE id = ?").get(id)).toEqual({ name: "Audio folders test: звук" });
    for (const invalid of [-1, 0, 1.5, "1", 999999]) {
      expect((await request(app).put(`/sounds/${id}`).send({ folder_id: invalid })).status).toBe(400);
    }
  });

  it("сбрасывает папку при смене роли и позволяет сразу выбрать папку нового раздела", async () => {
    const id = track();
    const oldFolder = await folder();
    const newFolder = await folder("weather");
    await request(app).put(`/sounds/${id}`).send({ folder_id: oldFolder });
    const moved = await request(app).put(`/sounds/${id}`).send({ audio_role: "ambient" });
    expect(moved.body).toMatchObject({ role: "ambient", folder_id: null });
    const assigned = await request(app).put(`/sounds/${id}`).send({ audio_role: "weather", folder_id: newFolder });
    expect(assigned.body).toMatchObject({ role: "weather", folder_id: newFolder });
  });

  it("удаляет только папку и привязки, сохраняя звук, файл, набор и боевую тему", async () => {
    fs.mkdirSync(VAULT_ROOT, { recursive: true });
    const filePath = path.join(VAULT_ROOT, "audio-folder-test.wav");
    fs.writeFileSync(filePath, "test audio bytes");
    const id = track("background", filePath);
    const folderId = await folder();
    const setId = db.prepare("INSERT INTO sound_sets (name) VALUES ('Проверка папок')").run().lastInsertRowid;
    db.prepare("INSERT INTO sound_set_items (set_id, resource_id, role) VALUES (?, ?, 'background')").run(setId, id);
    const playlistId = db.prepare("INSERT INTO playlists (name, scope) VALUES ('Проверка папок', 'battle')").run().lastInsertRowid;
    db.prepare("INSERT INTO playlist_items (playlist_id, resource_id) VALUES (?, ?)").run(playlistId, id);
    await request(app).put(`/sounds/${id}`).send({ folder_id: folderId });
    expect((await request(app).delete(`/sounds/folders/${folderId}`)).status).toBe(200);
    expect((await request(app).get("/sounds")).body.find((s: { resource_id: number }) => s.resource_id === id).folder_id).toBeNull();
    expect(db.prepare("SELECT resource_id FROM sound_set_items WHERE set_id = ?").get(setId)).toEqual({ resource_id: id });
    expect(db.prepare("SELECT resource_id FROM playlist_items WHERE playlist_id = ?").get(playlistId)).toEqual({ resource_id: id });
    expect(fs.readFileSync(filePath, "utf8")).toBe("test audio bytes");
    expect((await request(app).delete(`/sounds/folders/${folderId}`)).status).toBe(404);
  });

  it("удаление ресурса очищает привязку, но сохраняет пустую папку", async () => {
    const id = track();
    const folderId = await folder();
    await request(app).put(`/sounds/${id}`).send({ folder_id: folderId });
    db.prepare("DELETE FROM resources WHERE id = ?").run(id);
    expect(db.prepare("SELECT * FROM sound_folder_items WHERE resource_id = ?").all(id)).toEqual([]);
    expect((await request(app).get("/sounds/folders")).body).toHaveLength(1);
  });

  it("отклоняет пустое имя, неизвестную роль и правку отсутствующей папки", async () => {
    expect((await request(app).post("/sounds/folders").send({ name: "  ", role: "ambient" })).status).toBe(400);
    expect((await request(app).post("/sounds/folders").send({ name: "Папка", role: "other" })).status).toBe(400);
    expect((await request(app).put("/sounds/folders/99999").send({ name: "Имя" })).status).toBe(404);
    expect((await request(app).put(`/sounds/folders/${await folder()}`).send({ name: " " })).status).toBe(400);
  });

  it("до применения миграции сохраняет чтение и правку звуков и явно отказывает в записи папок", async () => {
    db.exec("DROP TABLE sound_folder_items; DROP TABLE sound_folders");
    const id = track();
    expect((await request(app).get("/sounds")).status).toBe(200);
    expect((await request(app).get("/sounds/folders")).body).toEqual([]);
    expect((await request(app).put(`/sounds/${id}`).send({ name: "Проверка" })).status).toBe(200);
    expect((await request(app).post("/sounds/folders").send({ name: "Папка", role: "ambient" })).status).toBe(503);
    expect((await request(app).put(`/sounds/${id}`).send({ folder_id: null })).status).toBe(503);
  });
});

describe("миграция папок", () => {
  it.each(["schema-2026-07-30.sql", "schema-2026-08-22.sql"])("добавляет папки после всех шагов старой базы %s", (fixture) => {
    const dir = fs.mkdtempSync(path.join(process.env.DB_DIR!, "audio-old-"));
    const old = new Database(path.join(dir, "app.db"));
    old.exec(fs.readFileSync(path.join(__dirname, "../db/__fixtures__", fixture), "utf8"));
    old.close();
    const migrated = openDatabase(dir);
    try {
      migrateSoundFolders(migrated);
      expect(soundFoldersReady(migrated)).toBe(true);
      expect(migrated.pragma("foreign_key_check")).toEqual([]);
      migrateSoundFolders(migrated);
      expect(migrated.prepare("SELECT * FROM sound_folders").all()).toEqual([]);
    } finally { migrated.close(); }
  }, 60_000);
});
