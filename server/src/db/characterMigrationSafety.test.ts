import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDatabase } from "./db";

function legacyDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-character-rebuild-"));
  const database = new Database(path.join(dir, "app.db"));
  const schema = fs.readFileSync(path.join(__dirname, "__fixtures__/schema-2026-07-30.sql"), "utf8")
    .replace("campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, -- NULL", "campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, -- NULL");
  database.exec(schema);
  database.exec(`INSERT INTO players (id, name) VALUES (1, 'Test player');
    INSERT INTO campaigns (id, name) VALUES (1, 'Test campaign');
    INSERT INTO characters (id, player_id, campaign_id, character_name) VALUES (1, 1, 1, 'Test character');
    CREATE TABLE test_child (id INTEGER PRIMARY KEY, character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE);
    INSERT INTO test_child VALUES (1, 1);
    CREATE INDEX test_character_name ON characters(character_name);
    CREATE TABLE test_audit (name TEXT);
    CREATE TRIGGER test_character_rename AFTER UPDATE OF character_name ON characters
    BEGIN INSERT INTO test_audit VALUES (NEW.character_name); END;`);
  database.close();
  return dir;
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("characters rebuild safety", () => {
  for (const failAt of ["DROP TABLE characters", "ALTER TABLE characters_new RENAME TO characters"]) {
    it(`rolls back and closes the connection after failure at ${failAt}`, () => {
      const dir = legacyDatabase();
      let failed: Database.Database | undefined;
      let foreignKeysOnClose: unknown;
      const close = Database.prototype.close;
      vi.spyOn(Database.prototype, "close").mockImplementation(function (this: Database.Database) {
        if (this === failed) foreignKeysOnClose = this.pragma("foreign_keys", { simple: true });
        return close.call(this);
      });
      const exec = Database.prototype.exec;
      const injected = vi.spyOn(Database.prototype, "exec").mockImplementation(function (this: Database.Database, sql: string) {
        if (sql === failAt) { failed = this; throw new Error("injected rebuild failure"); }
        return exec.call(this, sql);
      });
      try {
        expect(() => openDatabase(dir)).toThrow("injected rebuild failure");
        expect(failed?.open).toBe(false);
        expect(foreignKeysOnClose).toBe(1);
      } finally {
        if (failed?.open) failed.close();
        injected.mockRestore();
      }
      const check = new Database(path.join(dir, "app.db"));
      try {
        expect(check.prepare("SELECT character_name FROM characters").get()).toEqual({ character_name: "Test character" });
        expect(check.prepare("SELECT * FROM test_child").all()).toEqual([{ id: 1, character_id: 1 }]);
        expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'characters_new'").get()).toBeUndefined();
        expect(check.pragma("foreign_key_check")).toEqual([]);
      } finally { check.close(); }
      const next = openDatabase(dir);
      try {
        expect(next.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(next.prepare("SELECT character_name FROM characters").get()).toEqual({ character_name: "Test character" });
        expect(next.prepare("SELECT * FROM test_child").all()).toHaveLength(1);
        expect(next.pragma("foreign_key_check")).toEqual([]);
        expect(next.prepare("SELECT name FROM sqlite_master WHERE name IN ('test_character_name', 'test_character_rename')").all()).toHaveLength(2);
        next.prepare("UPDATE characters SET character_name = 'Renamed' WHERE id = 1").run();
        expect(next.prepare("SELECT name FROM test_audit").all()).toEqual([{ name: "Renamed" }]);
      } finally { next.close(); }
    });
  }

  it("keeps a readable snapshot before rebuilding and preserves children", () => {
    const dir = legacyDatabase();
    const migrated = openDatabase(dir);
    migrated.close();
    const snapshots = fs.readdirSync(dir).filter(n => n.startsWith("app-before-characters-") && n.endsWith(".db"));
    expect(snapshots).toHaveLength(1);
    const snapshot = new Database(path.join(dir, snapshots[0]), { readonly: true });
    try {
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(snapshot.prepare("SELECT character_name FROM characters").get()).toEqual({ character_name: "Test character" });
    } finally { snapshot.close(); }
  });

  it("does not run delayed migrations against a closed database", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = openDatabase(legacyDatabase());
    database.close();
    vi.runAllTimers();
    expect(error.mock.calls.flat().map(String).join(" ")).not.toMatch(/connection is not open/);
  });
});
