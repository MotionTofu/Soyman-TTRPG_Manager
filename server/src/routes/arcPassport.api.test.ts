// Приключение (гриллинг профилей 2026-10-02, Q14–Q15): паспорт ключами
// паспорта сеттинга, «Чем кончилось» по осям, достоверность тайн; правка из
// кампании ложится в её копию и не теряет паспорт оригинала.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { storyRouter } from "./story";

let app: express.Express;
let arcId = 0;
let campaignId = 0;
let secretId = 0;

beforeAll(() => {
  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Вотердип')").run().lastInsertRowid);
  arcId = Number(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Ограбление дракона')").run(settingId).lastInsertRowid);
  secretId = Number(
    db.prepare("INSERT INTO story_secrets (arc_id, title) VALUES (?, 'Камень у Ксанатара')").run(arcId).lastInsertRowid
  );
  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Золото Вотердипа')").run().lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/story", storyRouter);
});

describe("паспорт и исходы приключения", () => {
  it("хранятся по словарю, чужие ключи отбрасываются", async () => {
    const put = await request(app)
      .put(`/api/story/arcs/${arcId}`)
      .send({
        passport: { central_question: "Найдут ли золото?", tone: "лёгкий", hacked: "x" },
        outcomes: { goal: "золото у партии", junk: "y" },
      });
    expect(put.status).toBe(200);
    const res = await request(app).get(`/api/story/arcs/${arcId}`);
    expect(res.body.passport).toEqual({ central_question: "Найдут ли золото?", tone: "лёгкий" });
    expect(res.body.outcomes).toEqual({ goal: "золото у партии" });
  });

  it("правка из кампании сохраняет паспорт оригинала в её копии", async () => {
    await request(app).put(`/api/story/arcs/${arcId}`).send({ campaign_id: campaignId, outcomes: { cost: "сгорела таверна" } });
    const res = await request(app).get(`/api/story/arcs/${arcId}?campaign_id=${campaignId}`);
    expect(res.body.passport.central_question).toBe("Найдут ли золото?");
    expect(res.body.outcomes).toEqual({ cost: "сгорела таверна" });
    const original = await request(app).get(`/api/story/arcs/${arcId}`);
    expect(original.body.outcomes).toEqual({ goal: "золото у партии" });
  });
});

describe("достоверность тайны", () => {
  it("принимает известно · слух · спорно и снимается пустой строкой", async () => {
    let res = await request(app).put(`/api/story/secrets/${secretId}`).send({ certainty: "rumor" });
    expect(res.body.certainty).toBe("rumor");
    res = await request(app).put(`/api/story/secrets/${secretId}`).send({ certainty: "" });
    expect(res.body.certainty).toBe("");
  });

  it("не принимает чужое значение", async () => {
    const res = await request(app).put(`/api/story/secrets/${secretId}`).send({ certainty: "maybe" });
    expect(res.status).toBe(400);
  });
});
