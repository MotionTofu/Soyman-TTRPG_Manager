import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;
let player: string;
let settingId: number;
let campaignId: number;
let otherCampaignId: number;
const auth = { type: "bearer" } as const;
const api = () => request(server.app);
const eventBody = { title: "Поставка", inworld_year: 1496, inworld_month: 6, inworld_day: 7 };
const ownEvent = async (extra = {}) => {
  const response = await api().post(`/api/campaigns/${campaignId}/calendar-events`).auth(gm, auth).send({ ...eventBody, ...extra });
  expect(response.status).toBe(201);
  return response.body.id as number;
};
const session = (campaign = campaignId) => Number(db.prepare(
  "INSERT INTO sessions (campaign_id, date, status, title) VALUES (?, '2026-10-25', 'held', 'Встреча')"
).run(campaign).lastInsertRowid);
const link = (sid: number, kind: string, id: number) => api().post("/api/links").auth(gm, auth)
  .send({ from_type: "session", from_id: sid, to_type: kind, to_id: id, section: "session_events" });

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const gmId = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('chronicle-gm', 'test', 'gm')").run().lastInsertRowid);
  gm = signToken({ id: gmId, username: "chronicle-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Мир хроники')").run().lastInsertRowid);
  campaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Хроника', ?)").run(settingId).lastInsertRowid);
  otherCampaignId = Number(db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Другая', ?)").run(settingId).lastInsertRowid);
  const playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Читатель хроники')").run().lastInsertRowid);
  const userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('chronicle-player', 'test', 'player', ?)").run(playerId).lastInsertRowid);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, playerId);
  player = signToken({ id: userId, username: "chronicle-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
});

describe("модель хроники кампании", () => {
  it("создание, чтение и частичная правка полей профиля; невидимость по умолчанию", async () => {
    const id = await ownEvent({ description: "Кратко", full_description: "Подробно", consequences: "Последствия", visible_to_players: true, player_text: "Для игроков" });
    const result = await api().get(`/api/campaigns/calendar-events/${id}`).auth(gm, auth);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ campaign_id: campaignId, setting_id: settingId, full_description: "Подробно", consequences: "Последствия", visible_to_players: 1, player_text: "Для игроков", sessions: [] });
    const changed = await api().put(`/api/campaigns/calendar-events/${id}`).auth(gm, auth).send({ player_text: "", visible_to_players: false, full_description: "Новый текст" });
    expect(changed.body).toMatchObject({ player_text: "", visible_to_players: 0, full_description: "Новый текст", consequences: "Последствия" });
    const location = Number(db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Участник-место')").run(settingId).lastInsertRowid);
    const relation = await api().post("/api/entity-relations").auth(gm, auth)
      .send({ from_type: "campaign_event", from_id: id, to_type: "location", to_id: location, tone: "neutral" });
    expect(relation.status).toBe(201);
    const participants = (await api().get(`/api/entity-relations?entity_type=campaign_event&entity_id=${id}`).auth(gm, auth)).body;
    expect(participants.outgoing).toEqual([expect.objectContaining({ to_type: "location", to_id: location })]);
    const hidden = await ownEvent();
    expect((await api().get(`/api/campaigns/calendar-events/${hidden}`).auth(gm, auth)).body).toMatchObject({ visible_to_players: 0, player_text: "" });
    expect((await api().get("/api/campaigns/calendar-events/99999999").auth(gm, auth)).status).toBe(404);
  });

  it("сессии связаны с обоими видами событий, читаются в обе стороны, чужая кампания отклонена", async () => {
    const id = await ownEvent();
    const sid = session();
    const worldId = Number(db.prepare("INSERT INTO setting_calendar_events (setting_id, title, inworld_year, inworld_month, inworld_day) VALUES (?, 'Событие мира', 1496, 6, 7)").run(settingId).lastInsertRowid);
    expect((await link(sid, "campaign_event", id)).status).toBe(201);
    expect((await link(sid, "setting_event", worldId)).status).toBe(201);
    expect((await link(session(otherCampaignId), "campaign_event", id)).status).toBe(400);
    const events = (await api().get(`/api/sessions/${sid}/calendar-events`).auth(gm, auth)).body;
    expect(events.map((e: { source: string }) => e.source).sort()).toEqual(["campaign", "setting"]);
    for (const [prefix, eid] of [["campaigns", id], ["settings", worldId]] as const) {
      const sessions = (await api().get(`/api/${prefix}/calendar-events/${eid}`).auth(gm, auth)).body.sessions;
      expect(sessions).toEqual([expect.objectContaining({ id: sid, title: "Встреча", campaign_id: campaignId, session_number: expect.any(Number) })]);
    }
    const list = (await api().get(`/api/campaigns/${campaignId}/calendar-events`).auth(gm, auth)).body;
    expect(list.find((e: { id: number; source: string }) => e.id === id && e.source === "campaign").sessions[0].id).toBe(sid);
  });

  it("игрок видит событие только по флагу, получает player_text, без выдач и мастерских подробностей", async () => {
    const id = await ownEvent({ description: "Секрет Мастера", full_description: "Тайна", consequences: "Ещё тайна", player_text: "Публичный текст" });
    const visible = async () => (await api().get(`/api/player/campaigns/${campaignId}/visible`).auth(player, auth)).body.chronicleEvents as { id: number; source: string; description: string }[];
    expect((await visible()).some((e) => e.id === id && e.source === "campaign")).toBe(false);
    await api().put(`/api/campaigns/calendar-events/${id}`).auth(gm, auth).send({ visible_to_players: true });
    const content = (await visible()).find((e) => e.id === id && e.source === "campaign");
    expect(content?.description).toBe("Публичный текст");
    expect(JSON.stringify(content)).not.toContain("Тайна");
    expect(JSON.stringify(content)).not.toContain("Секрет Мастера");
    expect(db.prepare("SELECT COUNT(*) AS n FROM player_visibility_grants WHERE campaign_id = ?").get(campaignId)).toEqual({ n: 0 });
    await api().put(`/api/campaigns/calendar-events/${id}`).auth(gm, auth).send({ player_text: "", description: "Открытое описание" });
    expect((await visible()).find((e) => e.id === id && e.source === "campaign")?.description).toBe("Открытое описание");
    await api().put(`/api/campaigns/calendar-events/${id}`).auth(gm, auth).send({ visible_to_players: false });
    expect((await visible()).some((e) => e.id === id && e.source === "campaign")).toBe(false);
  });

  it("все ключи палитры сохраняются, null возвращает чередование, неизвестный ключ даёт 400", async () => {
    const cycle = Number(db.prepare("INSERT INTO setting_cycles (setting_id, name, period_days, anchor_year, anchor_month, anchor_day) VALUES (?, 'Луна', 28, 1496, 1, 1)").run(settingId).lastInsertRowid);
    const created = await api().post(`/api/settings/cycles/${cycle}/points`).auth(gm, auth).send({ name: "Полная", day_offset: 14, color: "blue" });
    expect(created.status).toBe(201);
    expect(created.body.color).toBe("blue");
    for (const color of ["ochre", "green", "blue", "slate", "plum", "red", "brown", "ink", "moss", null]) {
      const changed = await api().put(`/api/settings/cycle-points/${created.body.id}`).auth(gm, auth).send({ color });
      expect(changed.status).toBe(200);
      expect(changed.body.color).toBe(color);
    }
    expect((await api().put(`/api/settings/cycle-points/${created.body.id}`).auth(gm, auth).send({ color: "#ff0000" })).status).toBe(400);
    expect((await api().post(`/api/settings/cycles/${cycle}/points`).auth(gm, auth).send({ name: "Ошибка", day_offset: 0, color: "unknown" })).status).toBe(400);
  });

  it("удаление и каскад убирают generic_links; архив сессии сохраняет восстановимость", async () => {
    const id = await ownEvent();
    const sid = session();
    const location = Number(db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Место удаления')").run(settingId).lastInsertRowid);
    await api().post("/api/entity-relations").auth(gm, auth).send({ from_type: "campaign_event", from_id: id, to_type: "location", to_id: location });
    await link(sid, "campaign_event", id);
    await api().delete(`/api/campaigns/calendar-events/${id}`).auth(gm, auth);
    expect(db.prepare("SELECT COUNT(*) AS n FROM generic_links WHERE to_type = 'campaign_event' AND to_id = ?").get(id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM entity_relations WHERE from_type = 'campaign_event' AND from_id = ?").get(id)).toEqual({ n: 0 });
    const another = await ownEvent();
    await link(sid, "campaign_event", another);
    await api().delete(`/api/sessions/${sid}`).auth(gm, auth);
    expect((await api().get(`/api/campaigns/calendar-events/${another}`).auth(gm, auth)).body.sessions).toEqual([]);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    expect(db.prepare("SELECT COUNT(*) AS n FROM generic_links WHERE from_type = 'session' AND from_id = ?").get(sid)).toEqual({ n: 0 });
    const child = Number(db.prepare("INSERT INTO campaign_calendar_events (campaign_id, title, inworld_year, inworld_month, inworld_day) VALUES (?, 'Каскад', 1496, 6, 7)").run(otherCampaignId).lastInsertRowid);
    const childSession = session(otherCampaignId);
    await link(childSession, "campaign_event", child);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(otherCampaignId);
    expect(db.prepare("SELECT COUNT(*) AS n FROM generic_links WHERE to_type = 'campaign_event' AND to_id = ?").get(child)).toEqual({ n: 0 });
  });
});
