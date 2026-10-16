// Записи слоя кампании (ADR-0006, задача 01): владелец из кампании, графа из
// словаря вида, первая запись задействует сущность, замена не трогает
// прежнюю, адрес меняется только у черновика, записи удалённого существа
// подметает уборка сирот.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { entityRecordsRouter } from "./entityRecords";
import { collectOrphans, sweepOrphans } from "../services/orphans";
import { campaignsOfEntity } from "../services/entityRecords";

let app: express.Express;
let campaignId = 0;
let otherCampaignId = 0;
let sessionId = 0;
let otherSessionId = 0;
let canal = 0;
let choir = 0;
let stranger = 0;
let characterId = 0;
let otherCharacterId = 0;

const participation = (type: string, id: number) =>
  db
    .prepare("SELECT manual FROM participations WHERE context_type = 'campaign' AND context_id = ? AND entity_type = ? AND entity_id = ?")
    .get(campaignId, type, id) as { manual: number } | undefined;

beforeAll(() => {
  const settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Город каналов')").run().lastInsertRowid);
  const otherSettingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Чужой мир')").run().lastInsertRowid);
  canal = Number(
    db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Мёртвый канал')").run(settingId).lastInsertRowid
  );
  choir = Number(
    db.prepare("INSERT INTO setting_communities (setting_id, name) VALUES (?, 'Хор')").run(settingId).lastInsertRowid
  );
  stranger = Number(
    db.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, 'Чужак')").run(otherSettingId).lastInsertRowid
  );
  campaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Мёртвый канал', ?)").run(settingId).lastInsertRowid);
  otherCampaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Другая', ?)").run(settingId).lastInsertRowid);
  sessionId = Number(
    db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-01')").run(campaignId).lastInsertRowid
  );
  otherSessionId = Number(
    db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-01')").run(otherCampaignId).lastInsertRowid
  );
  const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Аня')").run().lastInsertRowid);
  const pc = (campaign: number, name: string) =>
    Number(
      db.prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, ?)")
        .run(playerId, campaign, name).lastInsertRowid
    );
  characterId = pc(campaignId, "Ренна");
  otherCharacterId = pc(otherCampaignId, "Чужая");

  app = express();
  app.use(express.json());
  app.use("/api", entityRecordsRouter);
});

const create = (body: Record<string, unknown>, campaign = campaignId) =>
  request(app).post(`/api/campaigns/${campaign}/records`).send(body);

describe("создание", () => {
  it("первая запись о месте задействует его в кампании (manual = 0)", async () => {
    expect(participation("location", canal)).toBeUndefined();
    const res = await create({
      owner_type: "location",
      owner_id: canal,
      aspect: "access",
      text: "  Проход закрыт решёткой  ",
      certainty: "rumor",
      session_id: sessionId,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      owner_type: "location",
      owner_name: "Мёртвый канал",
      aspect: "access",
      text: "Проход закрыт решёткой",
      status: "established",
      certainty: "rumor",
      known_to: "gm",
      source: "manual",
      session_id: sessionId,
      replaced_by: null,
    });
    expect(participation("location", canal)).toEqual({ manual: 0 });
  });

  it("запись о персонаже кампании ссылку не заводит", async () => {
    const res = await create({ owner_type: "character", owner_id: characterId, aspect: "hooks", text: "Должна гильдии" });
    expect(res.status).toBe(201);
    expect(participation("character", characterId)).toBeUndefined();
  });

  // Тела — функциями: id известны только после beforeAll.
  it.each<[string, () => Record<string, unknown>]>([
    ["сущность чужого сеттинга", () => ({ owner_type: "being", owner_id: stranger, text: "x" })],
    ["персонаж чужой кампании", () => ({ owner_type: "character", owner_id: otherCharacterId, text: "x" })],
    ["чужая кампания владельцем", () => ({ owner_type: "campaign", owner_id: otherCampaignId, text: "x" })],
    ["вид не из словаря", () => ({ owner_type: "artifact", owner_id: 1, text: "x" })],
    ["графа не из словаря вида", () => ({ owner_type: "location", owner_id: canal, aspect: "want", text: "x" })],
    ["встреча другой кампании", () => ({ owner_type: "location", owner_id: canal, text: "x", session_id: otherSessionId })],
    ["пустой текст", () => ({ owner_type: "location", owner_id: canal, text: "   " })],
    ["статус не из списка", () => ({ owner_type: "location", owner_id: canal, text: "x", status: "fact" })],
  ])("отклоняет: %s", async (_label, body) => {
    const res = await create(body());
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("кампания без сеттинга не принимает записи о сущностях", async () => {
    const lone = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Без мира')").run().lastInsertRowid);
    const res = await create({ owner_type: "location", owner_id: canal, text: "x" }, lone);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Кампания не привязана к сеттингу");
  });
});

describe("замена", () => {
  it("создаёт новую запись с replaces_id, прежняя не меняется и знает, кем заменена", async () => {
    const first = (await create({ owner_type: "community", owner_id: choir, aspect: "want", text: "Хор помогает" })).body;
    const before = db.prepare("SELECT * FROM entity_records WHERE id = ?").get(first.id);

    const res = await request(app)
      .post(`/api/records/${first.id}/replace`)
      .send({ text: "Предложен обмен, не принят", aspect: "fear", session_id: sessionId });
    expect(res.status).toBe(201);
    // Владелец и графа — от прежней записи, даже если прислали другую.
    expect(res.body).toMatchObject({ replaces_id: first.id, owner_type: "community", owner_id: choir, aspect: "want" });

    expect(db.prepare("SELECT * FROM entity_records WHERE id = ?").get(first.id)).toEqual(before);
    const list = await request(app).get(`/api/campaigns/${campaignId}/records?owner_type=community&owner_id=${choir}`);
    expect(list.body.records.map((r: { id: number; replaced_by: number | null }) => [r.id, r.replaced_by])).toEqual([
      [res.body.id, null],
      [first.id, res.body.id],
    ]);
  });

  it("заменённую запись второй раз не заменить — только последнюю", async () => {
    const first = (await create({ owner_type: "community", owner_id: choir, text: "раз" })).body;
    await request(app).post(`/api/records/${first.id}/replace`).send({ text: "два" });
    const res = await request(app).post(`/api/records/${first.id}/replace`).send({ text: "три" });
    expect(res.status).toBe(409);
  });
});

describe("правка", () => {
  it("у установленной записи владельца не сменить", async () => {
    const rec = (await create({ owner_type: "location", owner_id: canal, text: "Вода стоит" })).body;
    const res = await request(app).put(`/api/records/${rec.id}`).send({ owner_type: "community", owner_id: choir });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Сменить, о ком запись, можно только у черновика");
  });

  it("черновик без адреса получает адрес и задействует сущность", async () => {
    const draft = (
      await create({ owner_type: "campaign", owner_id: campaignId, aspect: "unsorted", status: "draft", text: "Кто-то следит" })
    ).body;
    const being = Number(
      db.prepare("INSERT INTO setting_beings (setting_id, name) SELECT setting_id, 'Смотритель' FROM campaigns WHERE id = ?")
        .run(campaignId).lastInsertRowid
    );
    // Графа «unsorted» у существа не бывает — без новой графы адрес не меняется.
    const bad = await request(app).put(`/api/records/${draft.id}`).send({ owner_type: "being", owner_id: being });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .put(`/api/records/${draft.id}`)
      .send({ owner_type: "being", owner_id: being, aspect: "knows", status: "established", text: "Смотритель следит за шлюзом" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ owner_type: "being", owner_name: "Смотритель", aspect: "knows", status: "established" });
    expect(participation("being", being)).toEqual({ manual: 0 });
  });

  it("отброшенное не видно в списке, пока не спросили", async () => {
    const rec = (await create({ owner_type: "location", owner_id: canal, text: "Ошибка" })).body;
    await request(app).put(`/api/records/${rec.id}`).send({ status: "discarded" });
    const plain = await request(app).get(`/api/campaigns/${campaignId}/records`);
    expect(plain.body.records.some((r: { id: number }) => r.id === rec.id)).toBe(false);
    const asked = await request(app).get(`/api/campaigns/${campaignId}/records?status=discarded`);
    expect(asked.body.records.map((r: { id: number }) => r.id)).toEqual([rec.id]);
  });

  it("встреча фильтрует список", async () => {
    const res = await request(app).get(`/api/campaigns/${campaignId}/records?session_id=${sessionId}`);
    expect(res.body.records.length).toBeGreaterThan(0);
    expect(res.body.records.every((r: { session_id: number }) => r.session_id === sessionId)).toBe(true);
  });
});

describe("уборка сирот", () => {
  it("запись удалённого существа подметается", async () => {
    const being = Number(
      db.prepare("INSERT INTO setting_beings (setting_id, name) SELECT setting_id, 'Однодневка' FROM campaigns WHERE id = ?")
        .run(campaignId).lastInsertRowid
    );
    const rec = (await create({ owner_type: "being", owner_id: being, text: "Был и нет" })).body;
    db.prepare("DELETE FROM setting_beings WHERE id = ?").run(being);
    expect(collectOrphans()["entity_records:being"]).toEqual([expect.objectContaining({ id: rec.id })]);
    sweepOrphans();
    expect(db.prepare("SELECT 1 FROM entity_records WHERE id = ?").get(rec.id)).toBeUndefined();
  });
});

describe("«Мир кампании»", () => {
  const world = async () => (await request(app).get(`/api/campaigns/${campaignId}/world`)).body;

  it("отдаёт задействованные сущности со сводкой записей", async () => {
    const lock = Number(
      db.prepare("INSERT INTO setting_locations (setting_id, name, kind) SELECT setting_id, 'Шлюз', 'шлюз' FROM campaigns WHERE id = ?")
        .run(campaignId).lastInsertRowid
    );
    await create({ owner_type: "location", owner_id: lock, text: "Шлюз открыт", session_id: sessionId });
    await create({ owner_type: "location", owner_id: lock, text: "Говорят, его чинили", certainty: "rumor" });
    await create({ owner_type: "location", owner_id: lock, text: "Кто-то был внутри", status: "draft" });
    const old = (await create({ owner_type: "location", owner_id: lock, text: "Шлюз ржавый" })).body;
    await request(app).post(`/api/records/${old.id}/replace`).send({ text: "Шлюз смазан" });
    await create({ owner_type: "location", owner_id: lock, text: "Мимо", status: "discarded" });

    const body = await world();
    expect(body.entities.find((e: { entity_id: number; entity_type: string }) => e.entity_type === "location" && e.entity_id === lock)).toEqual({
      entity_type: "location",
      entity_id: lock,
      name: "Шлюз",
      category: "шлюз",
      manual: false,
      // Действующие: «открыт», «чинили» (слух), «смазан»; заменённая и отброшенная не в счёт.
      records: 3,
      drafts: 1,
      rumors: 1,
      last_session: expect.objectContaining({ id: sessionId, date: "2026-10-01" }),
    });
    // Существа, затем сообщества, затем места.
    const types = body.entities.map((e: { entity_type: string }) => e.entity_type);
    expect(types).toEqual([...types].sort((a: string, b: string) => ["being", "community", "location"].indexOf(a) - ["being", "community", "location"].indexOf(b)));
  });

  it("задействовать руками можно только сущность сеттинга кампании", async () => {
    const quiet = Number(
      db.prepare("INSERT INTO setting_beings (setting_id, name, category) SELECT setting_id, 'Тихоня', 'key_figure' FROM campaigns WHERE id = ?")
        .run(campaignId).lastInsertRowid
    );
    expect((await request(app).post(`/api/campaigns/${campaignId}/world`).send({ entity_type: "being", entity_id: stranger })).status).toBe(400);
    expect((await request(app).post(`/api/campaigns/${campaignId}/world`).send({ entity_type: "character", entity_id: characterId })).status).toBe(400);
    const res = await request(app).post(`/api/campaigns/${campaignId}/world`).send({ entity_type: "being", entity_id: quiet });
    expect(res.status).toBe(201);
    expect(participation("being", quiet)).toEqual({ manual: 1 });
    expect((await world()).entities).toContainEqual(
      expect.objectContaining({ entity_type: "being", entity_id: quiet, name: "Тихоня", category: "key_figure", manual: true, records: 0, last_session: null })
    );

    // Без записей — убирается.
    const del = await request(app).delete(`/api/campaigns/${campaignId}/world/being/${quiet}`);
    expect(del.status).toBe(200);
    expect(participation("being", quiet)).toBeUndefined();
  });

  it("сущность с записями не убрать — 409 с объяснением", async () => {
    const res = await request(app).delete(`/api/campaigns/${campaignId}/world/location/${canal}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/записи/);
    expect(participation("location", canal)).toEqual({ manual: 0 });
  });

  it("профиль сущности знает, в каких кампаниях она задействована", () => {
    expect(campaignsOfEntity("location", canal)).toEqual([
      expect.objectContaining({ id: campaignId, name: "Мёртвый канал", records: expect.any(Number), last_session: expect.objectContaining({ id: sessionId }) }),
    ]);
    expect(campaignsOfEntity("being", stranger)).toEqual([]);
  });
});
