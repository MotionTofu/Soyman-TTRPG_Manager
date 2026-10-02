import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Группы циклов (разбор 2026-10-02, Q23): многие-ко-многим, чужие циклы не
// попадают, удаление цикла выпадает из группы, удаление группы циклы не трогает.

let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('cycles-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "cycles-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
});

const api = () => request(server.app);
const auth = { type: "bearer" } as const;

describe("группы циклов", () => {
  it("цикл в нескольких группах, чужой цикл отброшен, каскады", async () => {
    const mine = (await api().post("/api/settings").auth(gm, auth).send({ name: "Небесный мир" })).body.id;
    const other = (await api().post("/api/settings").auth(gm, auth).send({ name: "Чужой мир" })).body.id;
    const cycle = (name: string, sid: number) => api().post(`/api/settings/${sid}/cycles`).auth(gm, auth).send({ name, period_days: 28 });
    const moon = (await cycle("Луна", mine)).body.id;
    const tide = (await cycle("Прилив", mine)).body.id;
    const foreign = (await cycle("Чужая луна", other)).body.id;

    const sky = await api().post(`/api/settings/${mine}/cycle-groups`).auth(gm, auth).send({ name: "Небо", cycle_ids: [moon, foreign] });
    expect(sky.status).toBe(201);
    expect(sky.body).toMatchObject({ name: "Небо", cycle_ids: [moon] });
    await api().post(`/api/settings/${mine}/cycle-groups`).auth(gm, auth).send({ name: "Вода", cycle_ids: [moon, tide] });

    const renamed = await api().put(`/api/settings/cycle-groups/${sky.body.id}`).auth(gm, auth).send({ name: "Небосвод" });
    expect(renamed.body).toMatchObject({ name: "Небосвод", cycle_ids: [moon] });

    await api().delete(`/api/settings/cycles/${moon}`).auth(gm, auth);
    const groups = (await api().get(`/api/settings/${mine}/cycle-groups`).auth(gm, auth)).body;
    expect(groups.map((g: { name: string; cycle_ids: number[] }) => [g.name, g.cycle_ids])).toEqual([
      ["Небосвод", []],
      ["Вода", [tide]],
    ]);

    await api().delete(`/api/settings/cycle-groups/${sky.body.id}`).auth(gm, auth);
    expect((await api().get(`/api/settings/${mine}/cycles`).auth(gm, auth)).body.map((c: { id: number }) => c.id)).toEqual([tide]);
  });

  it("элемент — отрезок с необязательным концом, через границу оборота можно", async () => {
    const sid = (await api().post("/api/settings").auth(gm, auth).send({ name: "Мир зим" })).body.id;
    const year = (await api().post(`/api/settings/${sid}/cycles`).auth(gm, auth).send({ name: "Сезоны", period_days: 365 })).body.id;
    const winter = await api().post(`/api/settings/cycles/${year}/points`).auth(gm, auth).send({ name: "Зима", day_offset: 271, day_end: 90 });
    expect(winter.body).toMatchObject({ day_offset: 271, day_end: 90 });
    expect((await api().post(`/api/settings/cycles/${year}/points`).auth(gm, auth).send({ name: "Ошибка", day_offset: 1, day_end: 365 })).status).toBe(400);
    const moved = await api().put(`/api/settings/cycle-points/${winter.body.id}`).auth(gm, auth).send({ day_end: null, name: "Солнцестояние" });
    expect(moved.body).toMatchObject({ name: "Солнцестояние", day_offset: 271, day_end: null });
    const file = (await api().get(`/api/settings/${sid}/export?include=calendar`).auth(gm, auth)).body;
    expect(file.cycles[0].points[0]).toMatchObject({ name: "Солнцестояние", day_end: null });
  });

  it("циклы кампании: видны только ей, в группе с циклами сеттинга, не едут в экспорт, переносятся в сеттинг", async () => {
    const sid = (await api().post("/api/settings").auth(gm, auth).send({ name: "Мир с кампаниями" })).body.id;
    const camp = (await api().post("/api/campaigns").auth(gm, auth).send({ name: "Первая", setting_id: sid })).body.id;
    const other = (await api().post("/api/campaigns").auth(gm, auth).send({ name: "Вторая", setting_id: sid })).body.id;
    const stranger = (await api().post("/api/campaigns").auth(gm, auth).send({ name: "Чужая" })).body.id;
    const sky = (await api().post(`/api/settings/${sid}/cycles`).auth(gm, auth).send({ name: "Луна", period_days: 28 })).body.id;
    const curse = await api().post(`/api/settings/${sid}/cycles`).auth(gm, auth).send({ name: "Проклятие", period_days: 7, campaign_id: camp });
    expect(curse.body.campaign_id).toBe(camp);
    expect((await api().post(`/api/settings/${sid}/cycles`).auth(gm, auth).send({ name: "Х", period_days: 7, campaign_id: stranger })).status).toBe(400);

    const names = async (q: string) =>
      (await api().get(`/api/settings/${sid}/cycles${q}`).auth(gm, auth)).body.map((c: { name: string }) => c.name);
    expect(await names("")).toEqual(["Луна"]);
    expect(await names(`?campaign=${camp}`)).toEqual(["Луна", "Проклятие"]);
    expect(await names(`?campaign=${other}`)).toEqual(["Луна"]);

    const group = await api().post(`/api/settings/${sid}/cycle-groups`).auth(gm, auth).send({ name: "Ночь", cycle_ids: [sky, curse.body.id], campaign_id: camp });
    expect(group.body).toMatchObject({ campaign_id: camp, cycle_ids: [sky, curse.body.id].sort((a, b) => a - b) });
    // Группа сеттинга цикл кампании не берёт.
    const settingGroup = await api().post(`/api/settings/${sid}/cycle-groups`).auth(gm, auth).send({ name: "Небо", cycle_ids: [sky, curse.body.id] });
    expect(settingGroup.body.cycle_ids).toEqual([sky]);
    expect((await api().get(`/api/settings/${sid}/cycle-groups`).auth(gm, auth)).body.map((g: { name: string }) => g.name)).toEqual(["Небо"]);
    expect((await api().get(`/api/settings/${sid}/cycle-groups?campaign=${camp}`).auth(gm, auth)).body.map((g: { name: string }) => g.name)).toEqual(["Небо", "Ночь"]);

    const file = (await api().get(`/api/settings/${sid}/export?include=calendar`).auth(gm, auth)).body;
    expect(file.cycles.map((c: { name: string }) => c.name)).toEqual(["Луна"]);
    expect(file.cycleGroups.map((g: { name: string }) => g.name)).toEqual(["Небо"]);

    await api().post(`/api/settings/cycles/${curse.body.id}/to-setting`).auth(gm, auth);
    expect(await names(`?campaign=${other}`)).toEqual(["Луна", "Проклятие"]);

    // Удаление кампании в интерфейсе — архив; настоящее удаление уносит её группы.
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(camp);
    expect(db.prepare("SELECT COUNT(*) n FROM setting_cycle_groups WHERE campaign_id = ?").get(camp)).toEqual({ n: 0 });
  });

  it("циклы и группы едут с календарём; повторное обновление не дублирует", async () => {
    const src = (await api().post("/api/settings").auth(gm, auth).send({ name: "Мир с луной" })).body.id;
    const moon = (await api().post(`/api/settings/${src}/cycles`).auth(gm, auth).send({ name: "Луна", period_days: 30 })).body.id;
    await api().post(`/api/settings/cycles/${moon}/points`).auth(gm, auth).send({ name: "полнолуние", day_offset: 15 });
    await api().post(`/api/settings/${src}/cycle-groups`).auth(gm, auth).send({ name: "Небо", cycle_ids: [moon] });

    expect((await api().get(`/api/settings/${src}/export?include=resources`).auth(gm, auth)).body.cycles).toBeUndefined();
    const file = (await api().get(`/api/settings/${src}/export?include=calendar`).auth(gm, auth)).body;
    expect(file.cycleGroups).toEqual([{ name: "Небо", position: 0, cycles: ["Луна"] }]);

    const created = (await api().post("/api/settings/import").auth(gm, auth).send(file)).body.id;
    await api().post(`/api/settings/${created}/update`).auth(gm, auth).send(file);
    const cycles = (await api().get(`/api/settings/${created}/cycles`).auth(gm, auth)).body;
    expect(cycles.map((c: { name: string; period_days: number; points: { name: string; day_offset: number }[] }) => [c.name, c.period_days, c.points.map((p) => [p.name, p.day_offset])])).toEqual([
      ["Луна", 30, [["полнолуние", 15]]],
    ]);
    const groups = (await api().get(`/api/settings/${created}/cycle-groups`).auth(gm, auth)).body;
    expect(groups).toEqual([expect.objectContaining({ name: "Небо", cycle_ids: [cycles[0].id] })]);
  });
});
