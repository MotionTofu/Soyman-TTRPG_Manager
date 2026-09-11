// Выходы между местами (решения 2026-09-11, §4): маршруты, видимость с
// обоих концов, архив и круг «выгрузка → разворот → слияние». Временную базу
// заводит src/test/setupTempDb.ts — живая база не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { settingLocationsRouter } from "./settingLocations";
import { buildSettingExportData, importSettingExport, updateSettingFromExport } from "./settings";
import { parseExitFields } from "../services/locationExits";

let app: express.Express;
let settingId = 0;
let crypt = 0;
let statue = 0;
let fields = 0;
let tomb = 0;
let foreign = 0;

interface ExitView {
  id: number;
  direction: "out" | "in";
  other_id: number;
  other_name: string;
  how: string;
  travel_time: string;
  one_way: number;
  secret: number;
}

async function exitsOf(id: number): Promise<ExitView[]> {
  const res = await request(app).get(`/api/setting-locations/${id}`);
  expect(res.status).toBe(200);
  return res.body.exits as ExitView[];
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api/setting-locations", settingLocationsRouter);

  const addSetting = db.prepare("INSERT INTO settings (name, description, folder_path, calendar_era) VALUES (?,?,?,?)");
  settingId = Number(addSetting.run("Выходоленд", "", "ExitsTest", "").lastInsertRowid);
  const otherSetting = Number(addSetting.run("Чужеземье", "", "ExitsOther", "").lastInsertRowid);
  const ins = db.prepare(
    "INSERT INTO setting_locations (setting_id, parent_id, name, kind, role, description, folder_path) VALUES (?,?,?,?,?,?,?)"
  );
  const city = Number(ins.run(settingId, null, "Город", "город", "location", "", null).lastInsertRowid);
  crypt = Number(ins.run(settingId, city, "Склеп", "склеп", "location", "", null).lastInsertRowid);
  statue = Number(ins.run(settingId, city, "Статуя", "статуя", "location", "", null).lastInsertRowid);
  fields = Number(ins.run(settingId, city, "Поля", "поля", "location", "", null).lastInsertRowid);
  tomb = Number(ins.run(settingId, fields, "Гробница", "гробница", "location", "", null).lastInsertRowid);
  foreign = Number(ins.run(otherSetting, null, "Баровия", "", "location", "", null).lastInsertRowid);
});

describe("parseExitFields", () => {
  it("даёт умолчания при создании и не трогает отсутствующее при правке", () => {
    expect(parseExitFields({}, false)).toEqual({
      fields: { how: "", travel_time: "", note: "", one_way: 0, secret: 0 },
    });
    expect(parseExitFields({ secret: true }, true)).toEqual({ fields: { secret: 1 } });
  });

  it("отказывает неверным типам и длинам", () => {
    expect(parseExitFields({ how: 5 }, false)).toEqual({ error: "how must be a string" });
    expect(parseExitFields({ one_way: "да" }, false)).toEqual({ error: "one_way must be boolean" });
    expect("error" in parseExitFields({ travel_time: "x".repeat(101) }, false)).toBe(true);
  });
});

describe("выходы: маршруты", () => {
  it("двусторонний выход виден с обоих концов", async () => {
    const res = await request(app)
      .post(`/api/setting-locations/${crypt}/exits`)
      .send({ to_location_id: statue, how: " тропа ", travel_time: "5 минут" });
    expect(res.status).toBe(201);
    expect(res.body.how).toBe("тропа");

    const fromCrypt = await exitsOf(crypt);
    expect(fromCrypt).toHaveLength(1);
    expect(fromCrypt[0]).toMatchObject({ direction: "out", other_id: statue, other_name: "Статуя", travel_time: "5 минут" });

    const fromStatue = await exitsOf(statue);
    expect(fromStatue).toHaveLength(1);
    expect(fromStatue[0]).toMatchObject({ direction: "in", other_id: crypt, how: "тропа" });
  });

  it("односторонний виден только с начала", async () => {
    const res = await request(app)
      .post(`/api/setting-locations/${crypt}/exits`)
      .send({ to_location_id: tomb, how: "подземный ход", one_way: true, secret: true });
    expect(res.status).toBe(201);
    expect((await exitsOf(crypt)).map((e) => e.other_name)).toContain("Гробница");
    expect((await exitsOf(tomb)).map((e) => e.other_name)).not.toContain("Склеп");
  });

  it("отказывает в пути к себе, в чужой мир, в никуда и повтору", async () => {
    const post = (body: object, from = crypt) => request(app).post(`/api/setting-locations/${from}/exits`).send(body);
    expect((await post({ to_location_id: crypt })).status).toBe(400);
    expect((await post({ to_location_id: foreign })).status).toBe(400);
    expect((await post({ to_location_id: 999999 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ to_location_id: statue, how: "тропа" })).status).toBe(409);
    expect((await post({ to_location_id: statue }, 999999)).status).toBe(404);
  });

  it("правка меняет только переданное, удаление убирает", async () => {
    const created = await request(app)
      .post(`/api/setting-locations/${statue}/exits`)
      .send({ to_location_id: fields, how: "через ограду" });
    const id = created.body.id as number;
    const put = await request(app).put(`/api/setting-locations/exits/${id}`).send({ travel_time: "четверть часа" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ how: "через ограду", travel_time: "четверть часа" });
    expect((await request(app).put(`/api/setting-locations/exits/${id}`).send({ one_way: "нет" })).status).toBe(400);

    expect((await request(app).delete(`/api/setting-locations/exits/${id}`)).status).toBe(200);
    expect((await exitsOf(statue)).map((e) => e.other_name)).not.toContain("Поля");
  });

  it("конец в архиве скрывает выход, восстановление возвращает", async () => {
    db.prepare("UPDATE setting_locations SET archived_at = datetime('now') WHERE id = ?").run(statue);
    expect((await exitsOf(crypt)).map((e) => e.other_name)).not.toContain("Статуя");
    db.prepare("UPDATE setting_locations SET archived_at = NULL WHERE id = ?").run(statue);
    expect((await exitsOf(crypt)).map((e) => e.other_name)).toContain("Статуя");
  });
});

describe("выходы: выгрузка и разворот", () => {
  it("едут в файле, пересчитываются и не удваиваются при слиянии", async () => {
    const payload = buildSettingExportData(settingId, []);
    expect(payload).not.toBeNull();
    const exported = payload!.exits ?? [];
    expect(exported).toHaveLength(2);

    const body = JSON.parse(JSON.stringify(payload));
    const newId = await importSettingExport(body);
    const rows = () =>
      db
        .prepare(
          `SELECT f.name AS from_name, t.name AS to_name, e.how, e.one_way, e.secret, e.travel_time
             FROM location_exits e
             JOIN setting_locations f ON f.id = e.from_location_id
             JOIN setting_locations t ON t.id = e.to_location_id
            WHERE f.setting_id = ?
            ORDER BY e.id`
        )
        .all(newId);
    expect(rows()).toEqual([
      { from_name: "Склеп", to_name: "Статуя", how: "тропа", one_way: 0, secret: 0, travel_time: "5 минут" },
      { from_name: "Склеп", to_name: "Гробница", how: "подземный ход", one_way: 1, secret: 1, travel_time: "" },
    ]);

    await updateSettingFromExport(newId, JSON.parse(JSON.stringify(payload)));
    expect(rows()).toHaveLength(2);
  });
});
