import type Database from "better-sqlite3";

export const CUTSCENE_RUN_SCHEMA = `
CREATE TABLE IF NOT EXISTS cutscene_runs (
  run_id TEXT PRIMARY KEY,
  -- Provenance survives final deletion of an unused original; only active uses have an FK.
  cutscene_id INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'rehearsal')),
  launch_context TEXT NOT NULL,
  version TEXT NOT NULL,
  return_state TEXT NOT NULL,
  audio_scope TEXT NOT NULL CHECK (audio_scope IN ('music', 'all')),
  controller_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cutscene_runs_active ON cutscene_runs ((1)) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS cutscene_run_uses (
  run_id TEXT NOT NULL REFERENCES cutscene_runs(run_id) ON DELETE CASCADE,
  cutscene_id INTEGER NOT NULL REFERENCES cutscenes(id) ON DELETE RESTRICT,
  PRIMARY KEY (run_id, cutscene_id)
);
CREATE TABLE IF NOT EXISTS cutscene_music_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT,
  audio TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cutscene_music_uses (
  cutscene_id INTEGER PRIMARY KEY REFERENCES cutscenes(id) ON DELETE RESTRICT
);
CREATE TRIGGER IF NOT EXISTS cutscene_run_snapshot_immutable
BEFORE UPDATE OF cutscene_id, mode, launch_context, version, return_state, audio_scope, created_at ON cutscene_runs
BEGIN SELECT RAISE(ABORT, 'Cutscene run snapshot is immutable'); END;
`;

export function migrateCutsceneRuns(database: Database.Database): void { database.exec(CUTSCENE_RUN_SCHEMA); }

export interface RegisteredCutsceneRun {
  run_id: string; controller_id: string; mode: "live" | "rehearsal";
  version: string; checkpoint: string; launch_context: string;
}
/** 04 can still be exercised against pre-07 databases while its migration is being staged. */
export function registeredCutsceneRun(database: Database.Database): RegisteredCutsceneRun | undefined {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cutscene_runs'").get()) return undefined;
  return database.prepare(`SELECT run_id, controller_id, mode, version, checkpoint, launch_context
    FROM cutscene_runs WHERE ended_at IS NULL`).get() as RegisteredCutsceneRun | undefined;
}
