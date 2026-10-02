// Корабль кампании (спека profiles-paper-2, «Корабль кампании»): запись на
// основе судна компендиума — хиты корпуса и постов, экипаж, груз, архив.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { campaignVesselsRouter } from "./campaignVessels";
import { vesselRow, vesselView } from "../services/campaignVessels";

let app: express.Express;
let campaignId = 0;
let galley = 0;
let helm = 0;
let oars = 0;
let foreignPost = 0;
let renna = 0;
let stranger = 0;
let captain = 0;
let vesselId = 0;

beforeAll(() => {
  const systemId = Number(db.prepare("INSERT INTO systems (name) VALUES ('D&D-корабль')").run().lastInsertRowid);
  const sectionId = Number(db.prepare("INSERT INTO system_sections (system_id, name) VALUES (?, 'Транспорт')").run(systemId).lastInsertRowid);
  const entry = db.prepare(
    "INSERT INTO compendium_entries (system_id, section_id, kind, name, parent_id, data) VALUES (?, ?, ?, ?, ?, ?)"
  );
  galley = Number(
    entry.run(systemId, sectionId, "vehicle", "Галера", null, JSON.stringify({ hp: "500", damage_threshold: "20", crew: "80", category: "Корабль" }))
      .lastInsertRowid
  );
  helm = Number(entry.run(systemId, sectionId, "vehicle_post", "Штурвал", galley, JSON.stringify({ hp: "50" })).lastInsertRowid);
  oars = Number(entry.run(systemId, sectionId, "vehicle_post", "Вёсла", galley, JSON.stringify({ hp: "100" })).lastInsertRowid);
  const sloop = Number(entry.run(systemId, sectionId, "vehicle", "Шлюп", null, "{}").lastInsertRowid);
  foreignPost = Number(entry.run(systemId, sectionId, "vehicle_post", "Руль шлюпа", sloop, "{}").lastInsertRowid);

  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Побережье')").run().lastInsertRowid);
  captain = Number(db.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Капитан Ворн')").run(settingId).lastInsertRowid);
  const otherSetting = Number(db.prepare("INSERT INTO settings (name) VALUES ('Чужой')").run().lastInsertRowid);
  const alien = Number(db.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Чужак')").run(otherSetting).lastInsertRowid);
  void alien;
  campaignId = Number(
    db.prepare("INSERT INTO campaigns (name, system_id, setting_id) VALUES ('Морская', ?, ?)").run(systemId, settingId).lastInsertRowid
  );
  const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Аня-море')").run().lastInsertRowid);
  renna = Number(
    db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Ренна')").run(playerId, campaignId)
      .lastInsertRowid
  );
  stranger = Number(
    db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, NULL, 'Бродяга')").run(playerId).lastInsertRowid
  );

  app = express();
  app.use(express.json());
  app.use("/api/campaign-vessels", campaignVesselsRouter);
});

describe("корабль кампании", () => {
  it("заводится на основе судна; имя по умолчанию — основы", async () => {
    const bases = await request(app).get(`/api/campaign-vessels/campaign/${campaignId}/bases`);
    expect(bases.body.map((b: { name: string }) => b.name)).toEqual(["Галера", "Шлюп"]);

    const bad = await request(app).post(`/api/campaign-vessels/campaign/${campaignId}`).send({ entry_id: helm });
    expect(bad.status).toBe(400);

    const res = await request(app).post(`/api/campaign-vessels/campaign/${campaignId}`).send({ entry_id: galley, name: "Чайка" });
    expect(res.status).toBe(201);
    vesselId = res.body.id;
    expect(res.body.name).toBe("Чайка");
    expect(res.body.hull).toEqual({ hp: 500, max: 500, threshold: 20 });
    expect(res.body.posts.map((p: { name: string; hp: number }) => [p.name, p.hp])).toEqual([
      ["Штурвал", 50],
      ["Вёсла", 100],
    ]);
    expect(res.body.notes).toBe("");
  });

  it("хиты корпуса и поста: ноль — пост выведен из строя", async () => {
    const hull = await request(app).put(`/api/campaign-vessels/${vesselId}`).send({ hull_hp: 420 });
    expect(hull.body.hull.hp).toBe(420);
    expect((await request(app).put(`/api/campaign-vessels/${vesselId}`).send({ hull_hp: -3 })).status).toBe(400);

    const post = await request(app).put(`/api/campaign-vessels/${vesselId}/posts/${helm}`).send({ hp: 0 });
    expect(post.body.posts.find((p: { id: number }) => p.id === helm)).toMatchObject({ hp: 0, broken: true });
    expect((await request(app).put(`/api/campaign-vessels/${vesselId}/posts/${foreignPost}`).send({ hp: 1 })).status).toBe(400);
  });

  it("текущие не выше максимума, если максимум в компендиуме уменьшили", () => {
    db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify({ hp: "300" }), galley);
    expect(vesselView(vesselRow(vesselId)!, { gm: true }).hull).toMatchObject({ hp: 300, max: 300 });
    db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(
      JSON.stringify({ hp: "500", damage_threshold: "20", crew: "80" }),
      galley
    );
  });

  it("экипаж: персонаж кампании и существо её сеттинга; перевод на другой пост", async () => {
    const add = await request(app).post(`/api/campaign-vessels/${vesselId}/crew`).send({ post_id: helm, character_id: renna });
    expect(add.status).toBe(201);
    await request(app).post(`/api/campaign-vessels/${vesselId}/crew`).send({ post_id: helm, being_id: captain });
    expect((await request(app).post(`/api/campaign-vessels/${vesselId}/crew`).send({ post_id: helm, character_id: stranger })).status).toBe(400);

    const moved = await request(app).post(`/api/campaign-vessels/${vesselId}/crew`).send({ post_id: oars, character_id: renna });
    const byPost = (id: number) => moved.body.posts.find((p: { id: number }) => p.id === id).crew.map((c: { name: string }) => c.name);
    expect(byPost(helm)).toEqual(["Капитан Ворн"]);
    expect(byPost(oars)).toEqual(["Ренна"]);

    const unnamed = await request(app).put(`/api/campaign-vessels/${vesselId}/posts/${oars}`).send({ unnamed: 32 });
    expect(unnamed.body.crew_total).toEqual({ named: 2, unnamed: 32, capacity: 80 });
  });

  it("груз строками", async () => {
    const res = await request(app).post(`/api/campaign-vessels/${vesselId}/cargo`).send({ text: "Бочки рома", amount: "12" });
    expect(res.body.cargo).toEqual([{ id: expect.any(Number), text: "Бочки рома", amount: "12" }]);
    const id = res.body.cargo[0].id;
    const upd = await request(app).put(`/api/campaign-vessels/${vesselId}/cargo/${id}`).send({ amount: "10" });
    expect(upd.body.cargo[0].amount).toBe("10");
  });

  it("игроку — без заметок Мастера", async () => {
    await request(app).put(`/api/campaign-vessels/${vesselId}`).send({ notes: "Капитан — предатель" });
    const view = vesselView(vesselRow(vesselId)!, { gm: false });
    expect("notes" in view).toBe(false);
    expect(view.posts.length).toBe(2);
  });

  it("архив: удаляется насовсем только оттуда, возвращается с экипажем", async () => {
    expect((await request(app).delete(`/api/campaign-vessels/${vesselId}`)).status).toBe(400);
    await request(app).post(`/api/campaign-vessels/${vesselId}/archive`);
    const back = await request(app).post(`/api/campaign-vessels/${vesselId}/restore`);
    expect(back.body.archived_at).toBeNull();
    expect(back.body.crew_total.named).toBe(2);
    const list = await request(app).get(`/api/campaign-vessels/campaign/${campaignId}`);
    expect(list.body[0]).toMatchObject({ name: "Чайка", hull: { hp: 420 }, broken_posts: ["Штурвал"] });
  });
});
