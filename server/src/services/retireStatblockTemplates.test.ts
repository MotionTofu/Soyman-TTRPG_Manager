import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { retire, restore } = require("../../scripts/retireStatblockTemplates.cjs") as {
  retire: (db: Database.Database, dbPath: string, output: string) => Promise<{ retired: number }>;
  restore: (db: Database.Database, manifest: string) => { restored: number };
};

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-template-retirement-"));
  const dbPath = path.join(directory, "app.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, name TEXT, type TEXT, notes TEXT, file_path TEXT);
    CREATE TABLE statblocks (id INTEGER PRIMARY KEY, format TEXT, content TEXT);
    CREATE TABLE generic_links (from_type TEXT, from_id INTEGER, to_type TEXT, to_id INTEGER);
    CREATE TABLE annotations (resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE);
    INSERT INTO resources VALUES (14, '12345678-1234-1234-1234-123456789abc', 'Гуманоид', 'statblock_template', 'HP: __', NULL);
    INSERT INTO resources VALUES (20, 'abcdefab-1234-1234-1234-123456789abc', 'Таблица', 'statblock_template', '| Уровень |', NULL);
    INSERT INTO resources VALUES (21, 'normal', 'Обычный ресурс', 'note', 'Сохранить', NULL);
    INSERT INTO statblocks VALUES (1, 'dnd_character', '{"characterName":"Герой"}');`);
  return { db, dbPath, directory, output: path.join(directory, "archive") };
}

describe("reversible retirement of unused templates", () => {
  it("backs up exact records, retires only templates, and restores original identities", async () => {
    const f = fixture();
    try {
      const before = f.db.prepare("SELECT * FROM resources ORDER BY id").all();
      const sheets = f.db.prepare("SELECT * FROM statblocks").all();
      expect((await retire(f.db, f.dbPath, f.output)).retired).toBe(2);
      expect(f.db.prepare("SELECT * FROM resources").all()).toEqual([before[2]]);
      expect(f.db.prepare("SELECT * FROM statblocks").all()).toEqual(sheets);
      const backup = new Database(path.join(f.output, "app-before.sqlite"), { readonly: true });
      try { expect(backup.prepare("SELECT * FROM resources ORDER BY id").all()).toEqual(before); } finally { backup.close(); }
      expect((await retire(f.db, f.dbPath, f.output)).retired).toBe(0);
      expect(restore(f.db, path.join(f.output, "resources.json")).restored).toBe(2);
      expect(f.db.prepare("SELECT * FROM resources ORDER BY id").all()).toEqual(before);
      expect(() => restore(f.db, path.join(f.output, "resources.json"))).toThrow("occupied");
    } finally { f.db.close(); }
  });

  it.each(["foreign-key", "entity-link", "uid", "short-uid", "legacy-id"])("refuses to remove a template referenced through %s", async reference => {
    const f = fixture();
    try {
      if (reference === "foreign-key") f.db.exec("INSERT INTO annotations VALUES (14)");
      if (reference === "entity-link") f.db.exec("INSERT INTO generic_links VALUES ('resource', 14, 'being', 1)");
      if (reference === "uid") f.db.prepare("UPDATE resources SET notes = ? WHERE id = 21").run("soyman:resource/12345678-1234-1234-1234-123456789abc");
      if (reference === "short-uid") f.db.prepare("UPDATE resources SET notes = ? WHERE id = 21").run("[[resource@12345678|home|Шаблон]]");
      if (reference === "legacy-id") f.db.prepare("UPDATE resources SET notes = ? WHERE id = 21").run("[[resource:14|Шаблон]]");
      await expect(retire(f.db, f.dbPath, f.output)).rejects.toThrow("dependencies");
      expect(f.db.prepare("SELECT COUNT(*) n FROM resources").get()).toEqual({ n: 3 });
      expect(fs.existsSync(f.output)).toBe(false);
    } finally { f.db.close(); }
  });
});
