import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../db/db";
import { sceneProfileRouter } from "./sceneProfile";

const app = express();
app.use(sceneProfileRouter);
const id = (sql: string, ...args: (string | number | null)[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
describe("GET scene profile clues", () => {
  it("читает обе стороны стрелок, исключает предложения и не пишет в базу", async () => {
    const setting = id("INSERT INTO settings(name) VALUES ('Профили')");
    const arc = id("INSERT INTO story_arcs(name, setting_id) VALUES ('Дело', ?)", setting);
    const from = id("INSERT INTO story_scenes(name, setting_id, arc_id) VALUES ('Источник', ?, ?)", setting, arc);
    const to = id("INSERT INTO story_scenes(name, setting_id, arc_id) VALUES ('Цель', ?, ?)", setting, arc);
    id("INSERT INTO story_clues(scene_id, arc_id, text, how, target_type, target_id) VALUES (?, ?, 'Письмо', 'В столе', 'scene', ?)", from, arc, to);
    id("INSERT INTO story_clues(scene_id, arc_id, text, proposed) VALUES (?, ?, 'Черновик', 1)", from, arc);
    const before = db.prepare("SELECT total_changes() AS n").get();
    const out = await request(app).get(`/scenes/${from}/profile-clues`);
    const incoming = await request(app).get(`/scenes/${to}/profile-clues`);
    expect(out.status).toBe(200);
    expect(out.body.outgoing).toHaveLength(1);
    expect(out.body.outgoing[0]).toMatchObject({ text: "Письмо", how: "В столе", target_title: "Цель" });
    expect(incoming.body.incoming[0]).toMatchObject({ from_scene_id: from, from_scene_name: "Источник" });
    expect(db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect((await request(app).get("/scenes/999999/profile-clues")).status).toBe(404);
  });
  it("для кампании использует улики копии и не дублирует исходные", async () => {
    const setting = id("INSERT INTO settings(name) VALUES ('Другой мир')");
    const campaign = id("INSERT INTO campaigns(name, setting_id) VALUES ('Игра', ?)", setting);
    const arc = id("INSERT INTO story_arcs(name, setting_id) VALUES ('Глава', ?)", setting);
    const original = id("INSERT INTO story_scenes(name, setting_id, arc_id) VALUES ('Сцена', ?, ?)", setting, arc);
    const override = id("INSERT INTO story_scenes(name, setting_id, arc_id, campaign_id, source_scene_id) VALUES ('Правка', ?, ?, ?, ?)", setting, arc, campaign, original);
    id("INSERT INTO story_clues(scene_id, text) VALUES (?, 'Основа')", original);
    id("INSERT INTO story_clues(scene_id, text) VALUES (?, 'Копия')", override);
    const response = await request(app).get(`/scenes/${original}/profile-clues?campaign_id=${campaign}`);
    expect(response.body.outgoing.map((c: { text: string }) => c.text)).toEqual(["Копия"]);
    db.prepare("UPDATE story_scenes SET arc_id = NULL WHERE id IN (?, ?)").run(original, override);
    const standalone = await request(app).get(`/scenes/${original}/profile-clues?campaign_id=${campaign}`);
    expect(standalone.body.outgoing.map((c: { text: string }) => c.text)).toEqual(["Копия"]);
  });
  it("не теряет вход из другого приключения и называет цель сцены без приключения", async () => {
    const setting = id("INSERT INTO settings(name) VALUES ('Стрелки между книгами')");
    const fromArc = id("INSERT INTO story_arcs(name, setting_id) VALUES ('Откуда', ?)", setting);
    const toArc = id("INSERT INTO story_arcs(name, setting_id) VALUES ('Куда', ?)", setting);
    const from = id("INSERT INTO story_scenes(name, setting_id, arc_id) VALUES ('Снаружи', ?, ?)", setting, fromArc);
    const to = id("INSERT INTO story_scenes(name, setting_id, arc_id) VALUES ('Внутри', ?, ?)", setting, toArc);
    const standalone = id("INSERT INTO story_scenes(name, setting_id) VALUES ('Без приключения', ?)", setting);
    id("INSERT INTO story_clues(scene_id, text, target_type, target_id) VALUES (?, 'Между книгами', 'scene', ?)", from, to);
    id("INSERT INTO story_clues(scene_id, text, target_type, target_id) VALUES (?, 'Отдельная', 'scene', ?)", standalone, to);
    const incoming = await request(app).get(`/scenes/${to}/profile-clues`);
    expect(incoming.body.incoming.map((c: { text: string }) => c.text)).toEqual(["Между книгами", "Отдельная"]);
    const external = await request(app).get(`/scenes/${from}/profile-clues`);
    expect(external.body.outgoing[0].target_title).toBe("Внутри");
    const outgoing = await request(app).get(`/scenes/${standalone}/profile-clues`);
    expect(outgoing.body.outgoing[0].target_title).toBe("Внутри");
  });
});
