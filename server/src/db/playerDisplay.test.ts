import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migratePlayerDisplay } from "./playerDisplay";

describe("миграция общего экрана", () => {
  it("добавляется в старую базу без сессий и повторно не теряет показ/владельца", () => {
    const old = new Database(":memory:");
    old.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)");
    migratePlayerDisplay(old);
    old.prepare("INSERT INTO player_display_state (id, snapshot, owner, revision) VALUES (1, ?, ?, 7)").run('{"source":"kept"}', '{"runId":"kept"}');
    migratePlayerDisplay(old);
    expect(old.prepare("SELECT * FROM player_display_state").get()).toEqual({ id: 1, snapshot: '{"source":"kept"}', owner: '{"runId":"kept"}', transition: null, revision: 7 });
    old.close();
  });
});
