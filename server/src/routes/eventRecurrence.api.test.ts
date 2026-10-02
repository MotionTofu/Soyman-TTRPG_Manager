import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Повторяющееся ⇄ обычное событие (разбор 2026-10-02, Q1–Q7): перенос между
// таблицами; при переносе события снимается всё, что на нём держалось.

let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('recur-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "recur-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
});

const api = () => request(server.app);
const auth = { type: "bearer" } as const;

describe("повторяющееся ⇄ обычное", () => {
  it("событие уходит в ежегодную дату вместе с копиями, дата существа возвращается событием с упоминанием", async () => {
    const sid = (await api().post("/api/settings").auth(gm, auth).send({ name: "Мир праздников" })).body.id;
    await api().post("/api/campaigns").auth(gm, auth).send({ name: "Кампания", setting_id: sid });
    const ev = (await api().post(`/api/settings/${sid}/calendar-events`).auth(gm, auth).send({ title: "Праздник урожая", description: "Пляски", inworld_year: 1490, inworld_month: 9, inworld_day: 21 })).body;

    const footprint = (await api().get(`/api/settings/calendar-events/${ev.id}/footprint`).auth(gm, auth)).body;
    expect(footprint.campaign_copies).toBeGreaterThanOrEqual(0);

    const date = await api().post(`/api/settings/calendar-events/${ev.id}/to-recurring`).auth(gm, auth).send({ recurrence: "annual" });
    expect(date.status).toBe(201);
    expect(date.body).toMatchObject({ owner_type: "setting", owner_id: sid, title: "Праздник урожая", description: "Пляски", recurrence: "annual", month: 9, day: 21 });
    expect(db.prepare("SELECT 1 FROM setting_calendar_events WHERE id = ?").get(ev.id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) n FROM campaign_calendar_events WHERE title = 'Праздник урожая'").get()).toEqual({ n: 0 });

    const being = (await api().post("/api/setting-beings").auth(gm, auth).send({ setting_id: sid, name: "Мирт" })).body;
    const birthday = db
      .prepare("INSERT INTO important_dates (owner_type, owner_id, title, recurrence, month, day) VALUES ('being', ?, 'День рождения', 'annual', 3, 5)")
      .run(being.id).lastInsertRowid;
    const back = await api().post(`/api/settings/${sid}/important-dates/${birthday}/to-event`).auth(gm, auth).send({ year: 1496, month: 3, day: 5 });
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ title: "День рождения", inworld_year: 1496, inworld_month: 3, inworld_day: 5, description: `[[being:${being.id}|Мирт]]` });
    expect(db.prepare("SELECT 1 FROM important_dates WHERE id = ?").get(birthday)).toBeUndefined();
    // Упоминание даёт существу разовую дату со ссылкой на событие.
    expect(db.prepare("SELECT recurrence FROM important_dates WHERE source_event_id = ?").get(back.body.id)).toEqual({ recurrence: "once" });

    // Чужой сеттинг дату не получит.
    const other = (await api().post("/api/settings").auth(gm, auth).send({ name: "Чужой" })).body.id;
    expect((await api().post(`/api/settings/${other}/important-dates/${date.body.id}/to-event`).auth(gm, auth).send({ year: 1, month: 1, day: 1 })).status).toBe(404);
  });

  it("неточное событие повторить нельзя", async () => {
    const sid = (await api().post("/api/settings").auth(gm, auth).send({ name: "Мир смут" })).body.id;
    const ev = (await api().post(`/api/settings/${sid}/calendar-events`).auth(gm, auth).send({ title: "Смута", inworld_year: 1400, inworld_month: 1, inworld_day: 1 })).body;
    await api().put(`/api/settings/calendar-events/${ev.id}`).auth(gm, auth).send({ date_precision: "year" });
    const res = await api().post(`/api/settings/calendar-events/${ev.id}/to-recurring`).auth(gm, auth).send({ recurrence: "annual" });
    expect(res.status).toBe(400);
    expect(db.prepare("SELECT 1 n FROM setting_calendar_events WHERE id = ?").get(ev.id)).toEqual({ n: 1 });
  });
});
