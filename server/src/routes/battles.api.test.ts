// Бой и его лог (боевой режим, шаг 4): «Старт» заводит бой с именем по сцене,
// строки пишутся и отменяются, правка листа игроком встаёт в лог (Q69),
// «Продолжить в следующей сессии» переносит бойцов и время (Q24, Q82).

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

let app: express.Express;
let db: typeof import("../db/db").db;
let campaignId = 0;
let s1 = 0;

const insert = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);

beforeAll(async () => {
  ({ db } = await import("../db/db"));
  const { sessionsRouter } = await import("./sessions");
  const { battlesRouter } = await import("./battles");
  const { statblocksRouter } = await import("./statblocks");
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/battles", battlesRouter);
  app.use("/api/statblocks", statblocksRouter);
  const { campaignsRouter } = await import("./campaigns");
  app.use("/api/campaigns", campaignsRouter);

  const settingId = insert("INSERT INTO settings (name, folder_path) VALUES ('S', 'Settings/S')");
  campaignId = insert("INSERT INTO campaigns (name, setting_id, folder_path) VALUES ('C', ?, 'Campaigns/C')", settingId);
  s1 = insert("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-20', 'planned')", campaignId);
  const scene = insert("INSERT INTO story_scenes (campaign_id, name) VALUES (?, 'Засада у моста')", campaignId);
  insert("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?)", s1, scene);
}, 120_000);

describe("бой и лог", () => {
  it("«Старт» заводит бой по сцене, «Конец боя» закрывает", async () => {
    const start = await request(app).put(`/api/sessions/${s1}/combat`).send({ active: true, turn_entry_id: null, round: 1 });
    expect(start.status).toBe(200);
    const info = (await request(app).get(`/api/sessions/${s1}/battle`)).body;
    expect(info).toMatchObject({ name: "Засада у моста", log_count: 0, carried_from: null });
    expect(info.running_since).toBeTruthy();

    const line = await request(app)
      .post(`/api/battles/${info.id}/log`)
      .send({ session_id: s1, round: 1, kind: "event", text: "Упырь −12 (22 → 10)", changes: [] });
    expect(line.status).toBe(200);
    const undone = await request(app).put(`/api/battles/log/${line.body.id}`).send({ undone: true });
    expect(undone.body.undone).toBe(true);

    await request(app).put(`/api/sessions/${s1}/combat`).send({ active: false, turn_entry_id: null });
    expect((await request(app).get(`/api/sessions/${s1}/battle`)).body).toBeNull();
    // Второй бой в той же сцене — с номером.
    await request(app).put(`/api/sessions/${s1}/combat`).send({ active: true, turn_entry_id: null, round: 1 });
    expect((await request(app).get(`/api/sessions/${s1}/battle`)).body.name).toBe("Засада у моста · 2");
  });

  it("правка листа персонажа в бою — строка лога с автором", async () => {
    const playerId = insert("INSERT INTO players (name) VALUES ('Игрок 1')");
    const charId = insert("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Тарган')", playerId, campaignId);
    const sb = insert(
      "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES ('character', ?, 'full', 'dnd_character', ?, '')",
      charId,
      JSON.stringify({ hitPointsCurrent: "52", conditions: [] })
    );
    insert("INSERT INTO initiative_entries (session_id, entity_type, entity_id, name) VALUES (?, 'character', ?, 'Тарган')", s1, charId);
    await request(app).put(`/api/statblocks/${sb}`).send({ contentPatch: { hitPointsCurrent: "45" } });
    // Правка с пульта (combat: true) пульт пишет сам — сервер молчит.
    await request(app).put(`/api/statblocks/${sb}`).send({ contentPatch: { hitPointsCurrent: "40" }, combat: true });
    const { id } = (await request(app).get(`/api/sessions/${s1}/battle`)).body;
    const log = (await request(app).get(`/api/battles/${id}/log`)).body;
    expect(log.map((l: { kind: string; text: string; author: string }) => [l.kind, l.text, l.author])).toEqual([
      ["sheet", "Тарган −7 (52 → 45)", "Мастер"],
    ]);
  });

  it("перенос: бойцы и бой — в следующую сессию, время копится по сессиям", async () => {
    const s2 = insert("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-10-27', 'planned')", campaignId);
    const { id } = (await request(app).get(`/api/sessions/${s1}/battle`)).body;
    expect((await request(app).get(`/api/sessions/${s1}/battle`)).body.carry_target).toMatchObject({ id: s2 });
    const carry = await request(app).post(`/api/sessions/${s1}/combat/carry`).send({});
    expect(carry.body.target).toMatchObject({ id: s2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM initiative_entries WHERE session_id = ?").get(s2)).toEqual({ n: 1 });
    const there = (await request(app).get(`/api/sessions/${s2}/battle`)).body;
    expect(there).toMatchObject({ id, carried_from: expect.any(Number), running_since: null });
    const summary = (await request(app).get(`/api/sessions/${s1}/battles`)).body;
    expect(summary.map((b: { name: string; carried_to: number | null; ended: boolean }) => [b.name, b.ended, !!b.carried_to])).toEqual([
      ["Засада у моста", true, false],
      ["Засада у моста · 2", false, true],
    ]);
    expect(summary[1].taken).toBe(7);
  });

  it("перенос без следующей сессии ждёт первую заведённую", async () => {
    const s3 = insert("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-11-01', 'planned')", campaignId);
    await request(app).put(`/api/sessions/${s3}/combat`).send({ active: true, turn_entry_id: null, round: 2 });
    db.prepare("UPDATE sessions SET status = 'held' WHERE id <> ?").run(s3);
    const carry = await request(app).post(`/api/sessions/${s3}/combat/carry`).send({});
    expect(carry.body.target).toBeNull();
    // «Завершить» вечер после переноса не закрывает ждущий бой.
    db.prepare("UPDATE sessions SET live_mode = 'live' WHERE id = ?").run(s3);
    const { sessionNotesRouter } = await import("./sessionNotes");
    const live = express().use(express.json()).use("/api/sessions", sessionNotesRouter);
    await request(live).post(`/api/sessions/${s3}/live`).send({ mode: null });
    const created = await request(app).post("/api/sessions").send({ campaign_id: campaignId, date: "2026-11-08" });
    const info = (await request(app).get(`/api/sessions/${created.body.id}/battle`)).body;
    expect(info).toBeTruthy();
    expect(db.prepare("SELECT combat_active, combat_round FROM sessions WHERE id = ?").get(created.body.id)).toEqual({
      combat_active: 1,
      combat_round: 2,
    });
  });
});

describe("«Вызовы вечера» LitM (Д33, Q15)", () => {
  it("итоги и спотлайт считаются из неотменённых строк лога", async () => {
    const { diffValues, sheetView, emptySceneState } = await import("@soyman/shared");
    const systemId = insert("INSERT INTO systems (name, code) VALUES ('Legend in the Mist (тест)', 'litm')");
    const settingId = insert("INSERT INTO settings (name, folder_path) VALUES ('S2', 'Settings/S2')");
    const camp = insert("INSERT INTO campaigns (name, setting_id, system_id, folder_path) VALUES ('L', ?, ?, 'Campaigns/L')", settingId, systemId);
    const ses = insert("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-11-07', 'planned')", camp);
    const playerId = insert("INSERT INTO players (name) VALUES ('Игрок L')");
    const hero = insert("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Воин')", playerId, camp);
    await request(app).put(`/api/sessions/${ses}/combat`).send({ active: true, turn_entry_id: null, round: 1 });
    const info = (await request(app).get(`/api/sessions/${ses}/battle`)).body;
    expect(info.name).toBe("Вызовы 1");

    const limit = (marks: number[]) => ({ state: { limits: [{ name: "Изгнать", max: 2, turns: false, note: "", status: "изгнан", marks }] } });
    const scene = emptySceneState();
    const lit = { ...scene, spotlight: { current: hero, acted: [hero], counts: { [hero]: 1 } } };
    const blank = { themes: [], storyThemes: [], fellowshipTheme: {} };
    const lines = [
      { target: { t: "row", id: 1, name: "Домовой", party: false }, ops: diffValues(limit([]), limit([1, 2])) },
      { target: { t: "row", id: 2, name: "Сцена", party: false }, ops: diffValues({ state: scene }, { state: lit }) },
      { target: { t: "sheet", cid: hero, name: "Воин", party: true }, ops: diffValues(sheetView({ ...blank, statuses: [] }), sheetView({ ...blank, statuses: [{ name: "ранен", marks: [2] }] })) },
    ];
    for (const c of lines) {
      await request(app).post(`/api/battles/${info.id}/log`).send({ session_id: ses, kind: c.target.name === "Сцена" ? "turn" : "event", text: "—", changes: [c] });
    }
    const summary = (await request(app).get(`/api/sessions/${ses}/battles`)).body[0];
    expect(summary.litm).toEqual({
      overcome: [{ name: "Домовой", by: "Изгнать" }],
      statuses: [{ cid: hero, name: "Воин", list: ["ранен-2"] }],
      spotlight: [{ id: hero, name: "Воин", n: 1 }],
    });
    expect((await request(app).get(`/api/campaigns/${camp}/litm-spotlight`)).body).toEqual({ [hero]: 1 });

    // Стол игрока (Q19): спотлайт и теги сцены — только пока сессия идёт.
    const { playerRouter } = await import("./player");
    const papp = express();
    papp.use(express.json());
    papp.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req["user"] = { role: "player", playerId };
      next();
    });
    papp.use("/api/player", playerRouter);
    insert("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)", camp, playerId);
    insert("INSERT INTO initiative_entries (session_id, name, kind, state) VALUES (?, 'Сцена', 'litm_scene', ?)", ses, JSON.stringify({ ...lit, tags: [{ name: "ливень", hindering: true }] }));
    expect((await request(papp).get(`/api/player/campaigns/${camp}/litm-table`)).body).toBeNull();
    db.prepare("UPDATE sessions SET live_mode = 'live' WHERE id = ?").run(ses);
    expect((await request(papp).get(`/api/player/campaigns/${camp}/litm-table`)).body).toEqual({
      spotlight: hero,
      tags: [{ name: "ливень", hindering: true }],
      statuses: [],
      journey: null,
      camp: null,
    });

    // Путешествие и привал (пульт v2, Q15): угроза виньетки — без последствий.
    const journey = { entryId: 17130, name: "Тёмный лес", kind: "Местность", tags: [], consequences: ["тайное"], steps: 4, gap: "часы", passed: [{ name: "Мшистая поляна", outcome: "overcome" }] };
    db.prepare("UPDATE initiative_entries SET state = ? WHERE session_id = ? AND kind = 'litm_scene'").run(JSON.stringify({ ...lit, journey, camp: { sojourn: false, step: 3, used: { [hero]: ["rest"] }, done: [hero] } }), ses);
    const vignette = { name: "Замёрзший ручей", nameEn: "", threat: "*скользкий лёд*", consequences: ["Падаете (*ушиб-2*)."], blocksPath: true, journeyId: 17130 };
    insert("INSERT INTO initiative_entries (session_id, name, kind, state) VALUES (?, 'Замёрзший ручей', 'litm_challenge', ?)", ses, JSON.stringify({ limits: [], statuses: [], vignette }));
    const table = (await request(papp).get(`/api/player/campaigns/${camp}/litm-table`)).body;
    expect(table.journey).toEqual({ name: "Тёмный лес", kind: "Местность", steps: 4, gap: "часы", passed: 1, now: { name: "Замёрзший ручей", threat: "*скользкий лёд*" } });
    expect(table.camp).toEqual({ step: 3, sojourn: false });
    expect(JSON.stringify(table)).not.toContain("ушиб");
  });
});
