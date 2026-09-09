// Входящие связи сцены: настоящий роутер на временной базе.
// Живая база не затрагивается никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let fromId = 0;
let toId = 0;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-incoming-test-"));
  process.env.DB_DIR = tmpDir;
  const { storyRouter } = await import("./story");
  const { db } = await import("../db/db");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/story", storyRouter);

  const settingId = Number(
    (db.prepare("INSERT INTO settings (name) VALUES ('S')").run() as { lastInsertRowid: unknown }).lastInsertRowid
  );
  const arcId = Number(
    (db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'A')").run(settingId) as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
  const mkScene = (name: string) =>
    Number(
      (
        db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, ?)").run(settingId, arcId, name) as {
          lastInsertRowid: unknown;
        }
      ).lastInsertRowid
    );
  fromId = mkScene("Откуда");
  toId = mkScene("Куда");
  db.prepare("INSERT INTO story_scene_transitions (from_scene_id, to_scene_id, label) VALUES (?, ?, 'дверь')").run(
    fromId,
    toId
  );
  const checkId = Number(
    (
      db.prepare("INSERT INTO story_scene_checks (scene_id, what) VALUES (?, 'слух')").run(fromId) as {
        lastInsertRowid: unknown;
      }
    ).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO story_check_outcomes (check_id, label, target_type, target_id) VALUES (?, 'Успех', 'scene', ?)"
  ).run(checkId, toId);
}, 120000);

describe("incoming сцены", () => {
  it("отдаёт переходы и исходы, ведущие в сцену", async () => {
    const res = await request(app).get(`/api/story/scenes/${toId}/incoming`);
    expect(res.status).toBe(200);
    expect(res.body.transitions).toHaveLength(1);
    expect(res.body.transitions[0]).toMatchObject({ from_scene_id: fromId, from_scene_name: "Откуда", label: "дверь" });
    expect(res.body.outcomes).toHaveLength(1);
    expect(res.body.outcomes[0]).toMatchObject({ from_scene_id: fromId, from_scene_name: "Откуда", label: "Успех" });
  });

  it("у сцены без входящих — пусто, у несуществующей — 404", async () => {
    const empty = await request(app).get(`/api/story/scenes/${fromId}/incoming`);
    expect(empty.status).toBe(200);
    expect(empty.body.transitions).toEqual([]);
    expect(empty.body.outcomes).toEqual([]);
    expect((await request(app).get("/api/story/scenes/999999/incoming")).status).toBe(404);
  });
});
