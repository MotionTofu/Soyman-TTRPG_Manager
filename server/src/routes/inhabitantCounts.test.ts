// «Кто здесь» в реестре Географии (доска 16б): прямые жители места —
// существа и сообщества, без архивных и без чужих сеттингов. Временную базу
// заводит src/test/setupTempDb.ts — живая база не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { settingLocationsRouter } from "./settingLocations";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api/setting-locations", settingLocationsRouter);
});

const id = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);

describe("кто здесь", () => {
  it("считает существ и сообщества места, архивные и чужие — нет", async () => {
    const mine = id("INSERT INTO settings (name) VALUES ('Счёт жителей')");
    const other = id("INSERT INTO settings (name) VALUES ('Чужой мир')");
    const tavern = id("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Таверна')", mine);
    const cellar = id("INSERT INTO setting_locations (setting_id, parent_id, name) VALUES (?, ?, 'Подвал')", mine, tavern);
    const away = id("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Далеко')", other);
    const being = (name: string, archived = false) =>
      id(`INSERT INTO setting_beings (setting_id, name, archived_at) VALUES (?, ?, ${archived ? "datetime('now')" : "NULL"})`, mine, name);
    for (const b of [being("Хозяин"), being("Повар"), being("Призрак", true)]) {
      db.prepare("INSERT INTO being_locations (being_id, location_id) VALUES (?, ?)").run(b, tavern);
    }
    db.prepare("INSERT INTO being_locations (being_id, location_id) VALUES (?, ?)").run(being("Крыса"), cellar);
    const guild = id("INSERT INTO setting_communities (setting_id, name) VALUES (?, 'Гильдия')", mine);
    db.prepare("INSERT INTO community_locations (community_id, location_id) VALUES (?, ?)").run(guild, tavern);
    db.prepare("INSERT INTO being_locations (being_id, location_id) VALUES (?, ?)").run(being("Странник"), away);

    const res = await request(app).get(`/api/setting-locations/inhabitant-counts?setting_id=${mine}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ [tavern]: 3, [cellar]: 1 });
  });
});
