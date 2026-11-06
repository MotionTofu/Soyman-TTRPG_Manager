import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let app: express.Express;
let systemId: number, sectionId: number, classId: number, userId: number;
let db: typeof import("../db/db").db;
beforeAll(async () => {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "systems-overview-"));
  ({ db } = await import("../db/db"));
  const { systemsRouter } = await import("./systems");
  const insert = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  userId = insert("INSERT INTO users (username, password_hash, role) VALUES ('overview-gm', 'test', 'gm')");
  const otherUser = insert("INSERT INTO users (username, password_hash, role) VALUES ('other-gm', 'test', 'gm')");
  systemId = insert("INSERT INTO systems (name) VALUES ('Обзор Д')");
  const otherSystem = insert("INSERT INTO systems (name) VALUES ('Другая система')");
  sectionId = insert("INSERT INTO system_sections (system_id, name, kind) VALUES (?, 'Классы', 'class')", systemId);
  classId = insert("INSERT INTO compendium_entries (system_id, section_id, kind, name) VALUES (?, ?, 'class', 'Воин')", systemId, sectionId);
  const child = insert("INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name) VALUES (?, ?, ?, 'feature', 'Дыхание')", systemId, sectionId, classId);
  const foreignSection = insert("INSERT INTO system_sections (system_id, name, kind) VALUES (?, 'Классы', 'class')", otherSystem);
  const foreign = insert("INSERT INTO compendium_entries (system_id, section_id, kind, name) VALUES (?, ?, 'class', 'Чужой')", otherSystem, foreignSection);
  db.prepare("INSERT INTO compendium_favourites (user_id, entry_id) VALUES (?, ?), (?, ?), (?, ?)").run(userId, classId, otherUser, child, userId, foreign);
  app = express();
  app.use((req, _res, next) => { Object.assign(req, { user: { id: userId, role: "gm" } }); next(); });
  app.use("/systems", systemsRouter);
}, 120000);

describe("Обзор системы «Д»", () => {
  it("считает классы отдельно от вложенных умений", async () => {
    const response = await request(app).get(`/systems/${systemId}/entry-counts`);
    expect(response.status).toBe(200);
    expect(response.body).toContainEqual({ section_id: sectionId, count: 2, class_count: 1, species_count: 0 });
  });
  it("читает только избранное пользователя внутри системы и ничего не пишет", async () => {
    const before = db.prepare("SELECT total_changes() AS n").get();
    const response = await request(app).get(`/systems/${systemId}/entries/favourites`);
    expect(response.status).toBe(200);
    expect(response.body.map((entry: { id: number }) => entry.id)).toEqual([classId]);
    expect(response.body[0]).toMatchObject({ name: "Воин", favourite: true, data: {} });
    expect(db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect((await request(app).get("/systems/999999/entries/favourites")).body).toEqual([]);
  });
});
