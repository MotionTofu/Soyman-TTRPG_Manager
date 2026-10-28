import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateCutsceneRuns } from "./cutsceneRuns";
import { openDatabase } from "./db";

function oldDatabase() {
  const old = new Database(":memory:"); old.pragma("foreign_keys = ON");
  old.exec("CREATE TABLE cutscenes (id INTEGER PRIMARY KEY); INSERT INTO cutscenes VALUES (1)");
  migrateCutsceneRuns(old); return old;
}
const insert = (database: Database.Database, id = "old-run") => database.prepare(`INSERT INTO cutscene_runs
  (run_id, cutscene_id, mode, launch_context, version, return_state, audio_scope, controller_id, checkpoint, created_at, updated_at)
  VALUES (?, 1, 'live', '{}', '{"savedVersion":"old"}', '{}', 'all', 'old-controller', '{"stepId":"first"}', 'date', 'date')`).run(id);
describe("миграция сохранённых запусков", () => {
  it("повторяется без потери версии, шага, управляющего и удержаний использования", () => {
    const old = oldDatabase();
    try {
      insert(old); old.exec("INSERT INTO cutscene_run_uses VALUES ('old-run', 1)");
      const before = old.prepare("SELECT * FROM cutscene_runs").get(); migrateCutsceneRuns(old);
      expect(old.prepare("SELECT * FROM cutscene_runs").get()).toEqual(before);
      expect(old.prepare("SELECT * FROM cutscene_run_uses").all()).toEqual([{ run_id: "old-run", cutscene_id: 1 }]);
      expect(old.pragma("foreign_key_check")).toEqual([]);
    } finally { old.close(); }
  });
  it("не допускает двух активных запусков, активное использование защищает оригинал, история не блокирует удаление", () => {
    const old = oldDatabase();
    try {
      insert(old); expect(() => insert(old, "second")).toThrow();
      old.exec("INSERT INTO cutscene_run_uses VALUES ('old-run', 1)");
      expect(() => old.exec("DELETE FROM cutscenes")).toThrow();
      old.exec("DELETE FROM cutscene_run_uses; UPDATE cutscene_runs SET ended_at = 'ended'");
      old.exec("DELETE FROM cutscenes");
      expect(old.prepare("SELECT run_id FROM cutscene_runs").get()).toEqual({ run_id: "old-run" });
    } finally { old.close(); }
  });
  it("неизменяемая часть снимка защищена от случайного UPDATE", () => {
    const old = oldDatabase();
    try {
      insert(old);
      expect(() => old.exec("UPDATE cutscene_runs SET version = '{}'")).toThrow("immutable");
      expect(() => old.exec("UPDATE cutscene_runs SET return_state = '{}'")).toThrow("immutable");
      expect(() => old.exec("UPDATE cutscene_runs SET controller_id = 'new', revision = 2")).not.toThrow();
    } finally { old.close(); }
  });
  it.each(["schema-2026-07-30.sql", "schema-2026-08-22.sql"])("обновляет реальную старую схему %s с сохранением кампании/сессии", fixture => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-run-old-"));
    const old = new Database(path.join(dir, "app.db"));
    old.exec(fs.readFileSync(path.join(__dirname, "__fixtures__", fixture), "utf8"));
    const campaign = old.prepare("INSERT INTO campaigns (name) VALUES ('Run 07 old campaign')").run().lastInsertRowid;
    old.prepare("INSERT INTO sessions (campaign_id, date, title) VALUES (?, '2026-10-25', 'Run 07 old session')").run(campaign); old.close();
    const migrated = openDatabase(dir);
    try {
      expect(migrated.prepare("SELECT name FROM campaigns WHERE id = ?").get(campaign)).toEqual({ name: "Run 07 old campaign" });
      expect(migrated.prepare("SELECT title FROM sessions WHERE campaign_id = ?").get(campaign)).toEqual({ title: "Run 07 old session" });
      for (const table of ["cutscene_runs", "cutscene_run_uses", "cutscene_music_state", "cutscene_music_uses"]) expect(migrated.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(migrated.pragma("foreign_key_check")).toEqual([]);
    } finally { migrated.close(); }
  }, 60_000);
});
