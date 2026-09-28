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

describe("карта кампании: улики между приключениями (шаг 8)", () => {
  it("стрелка «×N» из приключения в приключение, счётчики, роль копии и проход", async () => {
    const settingId = (db.prepare("SELECT setting_id FROM story_arcs WHERE id = ?").get(arcId) as { setting_id: number })
      .setting_id;
    const crypt = id(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Склеп')").run(settingId));
    const tower = id(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Башня')").run(settingId));
    const campaignId = id(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('К8', ?)").run(settingId));
    for (const a of [arcId, crypt, tower])
      db.prepare("INSERT INTO campaign_adventures (campaign_id, arc_id) VALUES (?, ?)").run(campaignId, a);
    db.prepare("INSERT INTO story_arc_transitions (from_arc_id, to_arc_id, label) VALUES (?, ?, '')").run(crypt, tower);
    const clue = db.prepare(
      "INSERT INTO story_clues (arc_id, scene_id, text, target_type, target_id) VALUES (?, ?, ?, 'adventure', ?)"
    );
    clue.run(arcId, s.widow, "карта склепа", crypt);
    clue.run(chapterId, s.dock, "ключ от склепа", crypt);
    await request(app).put(`/api/story/arcs/${crypt}`).send({ campaign_id: campaignId, node_role: "proactive" });

    const res = await request(app).get(`/api/canvas/board?campaign_id=${campaignId}`);
    expect(res.status).toBe(200);
    const adv = (arc: number) =>
      res.body.nodes.find((n: { node_type: string; node_id: number }) => n.node_type === "adventure" && n.node_id === arc)
        .adventure;
    expect(adv(arcId)).toMatchObject({ clue_in: 0, clue_out: 2, passage_in: false });
    expect(adv(crypt)).toMatchObject({ clue_in: 2, node_role: "proactive" });
    expect(adv(tower)).toMatchObject({ clue_in: 0, passage_in: true, node_role: "normal" });
    expect(res.body.edges.find((e: { id: string }) => e.id === `clue:a${arcId}:a${crypt}`)).toMatchObject({
      kind: "clue",
      source: `adventure:${arcId}`,
      target: `adventure:${crypt}`,
      label: "×2",
    });

    // Схема сеттинга видит ту же стрелку, но роль — сеттинга, не кампании.
    const scheme = await request(app).get(`/api/canvas/board?setting_id=${settingId}`);
    const cryptNode = scheme.body.nodes.find(
      (n: { node_type: string; node_id: number }) => n.node_type === "adventure" && n.node_id === crypt
    );
    expect(cryptNode.adventure).toMatchObject({ clue_in: 2, node_role: "normal" });
    expect(scheme.body.edges.some((e: { id: string }) => e.id === `clue:a${arcId}:a${crypt}`)).toBe(true);

    // Холст приключения: исходящие — висящим разъёмом у сцены-источника,
    // входящие — плашкой на холсте цели (Q41).
    const own = await request(app).get(`/api/canvas/board?arc_id=${arcId}&campaign_id=${campaignId}`);
    const widow = own.body.nodes.find((n: { node_type: string; node_id: number }) => n.node_type === "scene" && n.node_id === s.widow);
    expect(widow.scene.outside).toEqual([
      expect.objectContaining({ dir: "out", clue: true, scene_id: 0, scene_name: "Склеп", board_arc_id: crypt }),
    ]);
    const target = await request(app).get(`/api/canvas/board?arc_id=${crypt}&campaign_id=${campaignId}`);
    expect(target.body.adventure_clues_in).toEqual([{ arc_id: arcId, name: "Алхимик", n: 2 }]);

    // Карточке узла — цели «Приключения» с карты кампании, без своего.
    const card = (await request(app).get(`/api/story/arcs/${arcId}/clues?campaign_id=${campaignId}`)).body;
    expect(card.adventures.map((a: { id: number }) => a.id).sort()).toEqual([crypt, tower].sort());
  });
});
