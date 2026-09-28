// Улики на холсте приключения: стрелки «×N», счётчики правила трёх, лоток.
// Настоящие роутеры на временной базе; живая база не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { canvasRouter } from "./canvas";
import { storyRouter } from "./story";

let app: express.Express;
let arcId = 0;
let chapterId = 0;
const s: Record<string, number> = {};

const id = (r: { lastInsertRowid: unknown }) => Number(r.lastInsertRowid);

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/canvas", canvasRouter);
  app.use("/api/story", storyRouter);

  const settingId = id(db.prepare("INSERT INTO settings (name) VALUES ('S')").run());
  arcId = id(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Алхимик')").run(settingId));
  chapterId = id(
    db.prepare("INSERT INTO story_arcs (setting_id, parent_id, name, kind) VALUES (?, ?, 'Глава', 'chapter')").run(settingId, arcId)
  );
  const mk = (key: string, arc: number, role = "normal") =>
    (s[key] = id(
      db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name, node_role) VALUES (?, ?, ?, ?)").run(settingId, arc, key, role)
    ));
  mk("start", arcId, "start");
  mk("guild", arcId);
  mk("widow", arcId);
  mk("lab", arcId, "finale");
  mk("dock", chapterId);
  db.prepare("INSERT INTO story_scene_transitions (from_scene_id, to_scene_id, label) VALUES (?, ?, 'люк')").run(s.guild, s.lab);
  const clue = db.prepare(
    "INSERT INTO story_clues (arc_id, scene_id, text, target_type, target_id) VALUES (?, ?, ?, 'scene', ?)"
  );
  clue.run(arcId, s.start, "фонарь", s.guild);
  clue.run(arcId, s.start, "счёт", s.guild);
  clue.run(arcId, s.widow, "слух", s.guild);
  clue.run(arcId, s.start, "письмо", s.widow);
  // Из сцены главы — на другом холсте, но в счётчике приключения.
  clue.run(chapterId, s.dock, "ключ", s.widow);
  db.prepare("INSERT INTO story_clues (arc_id, scene_id, text) VALUES (?, NULL, 'в лотке')").run(arcId);
});

describe("холст приключения: улики", () => {
  it("рисует одну стрелку на пару с «×N» и считает правило трёх по всему приключению", async () => {
    const res = await request(app).get(`/api/canvas/board?arc_id=${arcId}`);
    expect(res.status).toBe(200);
    const clueEdges = res.body.edges.filter((e: { kind: string }) => e.kind === "clue");
    const startGuild = clueEdges.find((e: { id: string }) => e.id === `clue:${s.start}:${s.guild}`);
    expect(startGuild).toMatchObject({ source: `scene:${s.start}`, target: `scene:${s.guild}`, label: "×2" });
    // Стрелка из главы на этот холст не ложится — её конец на другом холсте.
    expect(clueEdges.some((e: { source: string }) => e.source === `scene:${s.dock}`)).toBe(false);

    const scene = (key: string) =>
      res.body.nodes.find((n: { node_type: string; node_id: number }) => n.node_type === "scene" && n.node_id === s[key]).scene;
    expect(scene("guild")).toMatchObject({ clue_in: 3, clue_out: 0, passage_in: false });
    // Улика из сцены главы засчитана: правило трёх — по приключению.
    expect(scene("widow")).toMatchObject({ clue_in: 2, clue_out: 1 });
    expect(scene("lab")).toMatchObject({ clue_in: 0, passage_in: true, node_role: "finale" });
    expect(scene("start")).toMatchObject({ node_role: "start", clue_out: 3 });
    expect(res.body.clue_tray.map((c: { text: string }) => c.text)).toEqual(["в лотке"]);
  });

  it("тайна, положенная на холст, — узел со своими входящими уликами (Q20)", async () => {
    const secret = id(db.prepare("INSERT INTO story_secrets (arc_id, title) VALUES (?, 'Инсценировка')").run(arcId));
    db.prepare("INSERT INTO story_clues (arc_id, scene_id, text, target_type, target_id) VALUES (?, ?, 'не плачет', 'secret', ?)").run(
      arcId,
      s.widow,
      secret
    );
    const before = await request(app).get(`/api/canvas/board?arc_id=${arcId}`);
    // Не положена — стрелки нет.
    expect(before.body.edges.some((e: { id: string }) => e.id === `clue:${s.widow}:s${secret}`)).toBe(false);

    const put = await request(app).post("/api/canvas/board/node").send({ arc_id: arcId, node_type: "secret", node_id: secret, x: 10, y: 10 });
    expect(put.status).toBe(201);
    const res = await request(app).get(`/api/canvas/board?arc_id=${arcId}`);
    const node = res.body.nodes.find((n: { key: string }) => n.key === `secret:${secret}`);
    expect(node.secret).toMatchObject({ title: "Инсценировка", clue_in: 1 });
    const edge = res.body.edges.find((e: { id: string }) => e.id === `clue:${s.widow}:s${secret}`);
    expect(edge).toMatchObject({ source: `scene:${s.widow}`, target: `secret:${secret}`, kind: "clue" });
    // Следующие проверки считают исходы вдовы — улика к тайне им не нужна.
    db.prepare("DELETE FROM story_clues WHERE target_type = 'secret' AND target_id = ?").run(secret);
  });

  it("список выводов отдаёт узлы приключения вместе с главами и счётчиками", async () => {
    const res = await request(app).get(`/api/story/arcs/${chapterId}/clues`);
    expect(res.status).toBe(200);
    expect(res.body.root_arc_id).toBe(arcId);
    const widow = res.body.nodes.find((n: { id: number }) => n.id === s.widow);
    expect(widow).toMatchObject({ clue_in: 2, clue_out: 1 });
  });
});

describe("исходы проверок больше не ведут в сцену", () => {
  it("миграция снимает цель и дописывает, куда вело", async () => {
    const checkId = id(db.prepare("INSERT INTO story_scene_checks (scene_id, what) VALUES (?, 'слух')").run(s.guild));
    const empty = id(
      db
        .prepare("INSERT INTO story_check_outcomes (check_id, label, consequence, target_type, target_id) VALUES (?, 'Успех', '', 'scene', ?)")
        .run(checkId, s.lab)
    );
    const filled = id(
      db
        .prepare("INSERT INTO story_check_outcomes (check_id, label, consequence, target_type, target_id) VALUES (?, 'Провал', 'шум', 'scene', ?)")
        .run(checkId, s.lab)
    );
    db.prepare("DELETE FROM app_settings WHERE key = 'node_design_outcomes_v1'").run();
    const { switchToDatabase } = await import("../db/db");
    const path = await import("path");
    switchToDatabase(path.dirname(db.name));
    const row = (oid: number) =>
      db.prepare("SELECT consequence, target_type, target_id FROM story_check_outcomes WHERE id = ?").get(oid);
    expect(row(empty)).toEqual({ consequence: "Вело в «lab»", target_type: null, target_id: null });
    expect(row(filled)).toEqual({ consequence: "шум (вело в «lab»)", target_type: null, target_id: null });
  });
});
