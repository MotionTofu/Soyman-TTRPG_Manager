import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDatabase } from "./db";
import { migrateCutscenes } from "./cutscenes";
import { migrateCutsceneMedia } from "./cutsceneMedia";

describe("миграция катсцен", () => {
  it("медиа и их удержания сохраняются при повторной миграции", () => {
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec("CREATE TABLE campaigns (id INTEGER PRIMARY KEY); CREATE TABLE sessions (id INTEGER PRIMARY KEY)");
      migrateCutscenes(database); migrateCutsceneMedia(database);
      database.exec(`INSERT INTO cutscenes (id, uid, name, document, saved_version, created_at, updated_at)
        VALUES (1, 'uid', 'Катсцена', '{}', 'v', 'date', 'date');
        INSERT INTO cutscene_media VALUES ('file', 1, 'image', 'Cutscenes/media/file.png', 'name', 'image/png', NULL, 'ready', 'date');
        INSERT INTO cutscene_media_holds VALUES ('snapshot', 'run', 'file');`);
      migrateCutsceneMedia(database);
      expect(database.prepare("SELECT * FROM cutscene_media_holds").all()).toEqual([{ holder_kind: "snapshot", holder_key: "run", media_id: "file" }]);
      expect(() => database.exec("DELETE FROM cutscene_media")).toThrow();
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  });
  it("повторяется без потери документов и независимых привязок", () => {
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      database.exec("CREATE TABLE campaigns (id INTEGER PRIMARY KEY); CREATE TABLE sessions (id INTEGER PRIMARY KEY)");
      migrateCutscenes(database);
      database.exec(`INSERT INTO campaigns VALUES (1); INSERT INTO sessions VALUES (2);
        INSERT INTO cutscenes (id, uid, name, document, saved_version, created_at, updated_at)
        VALUES (3, 'uid', 'Оригинал', '{}', 'version', 'date', 'date');
        INSERT INTO campaign_cutscenes VALUES (1, 3); INSERT INTO session_cutscenes VALUES (2, 3, 0);`);
      migrateCutscenes(database);
      expect(database.prepare("SELECT saved_version FROM cutscenes").get()).toEqual({ saved_version: "version" });
      expect(database.prepare("SELECT * FROM session_cutscenes").all()).toEqual([{ session_id: 2, cutscene_id: 3, position: 0 }]);
      expect(() => database.prepare("DELETE FROM cutscenes WHERE id = 3").run()).toThrow();
      database.exec("DELETE FROM campaigns; DELETE FROM sessions");
      expect(database.prepare("SELECT name FROM cutscenes").get()).toEqual({ name: "Оригинал" });
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally { database.close(); }
  });

  it.each(["schema-2026-07-30.sql", "schema-2026-08-22.sql"])("сохраняет кампанию и сессию старого релиза %s", fixture => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-cutscene-old-"));
    const old = new Database(path.join(dir, "app.db"));
    old.exec(fs.readFileSync(path.join(__dirname, "__fixtures__", fixture), "utf8"));
    const campaign = Number(old.prepare("INSERT INTO campaigns (name) VALUES ('Cutscene migration campaign')").run().lastInsertRowid);
    const session = Number(old.prepare("INSERT INTO sessions (campaign_id, date, title) VALUES (?, '2026-10-25', 'Cutscene migration session')")
      .run(campaign).lastInsertRowid);
    old.close();
    const migrated = openDatabase(dir);
    try {
      expect(migrated.prepare("SELECT name FROM campaigns WHERE id = ?").get(campaign)).toEqual({ name: "Cutscene migration campaign" });
      expect(migrated.prepare("SELECT title FROM sessions WHERE id = ?").get(session)).toEqual({ title: "Cutscene migration session" });
      expect(migrated.prepare("SELECT * FROM cutscenes").all()).toEqual([]);
      expect(migrated.prepare("SELECT * FROM campaign_cutscenes").all()).toEqual([]);
      expect(migrated.prepare("SELECT * FROM session_cutscenes").all()).toEqual([]);
    } finally { migrated.close(); }
  }, 60_000);
});
