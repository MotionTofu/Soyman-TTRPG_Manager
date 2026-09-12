// «Партия здесь» (решения 2026-09-11, §3): сцена, ручная отметка, их порядок.
// Временную базу заводит src/test/setupTempDb.ts.

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db/db";
import { partyPlace, setPartyPlace, settingPartyPlaces } from "./partyPlace";

let settingId = 0;
let otherSetting = 0;
let city = 0;
let district = 0;
let port = 0;
let foreign = 0;
let campaign = 0;
let session = 0;
let sceneWithPlaces = 0;
let sceneWithout = 0;

const run = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
const launch = (sceneId: number, at: string) =>
  db.prepare("INSERT INTO session_scenes (session_id, scene_id, launched_at) VALUES (?, ?, ?)").run(session, sceneId, at);

beforeAll(() => {
  settingId = run("INSERT INTO settings (name, folder_path) VALUES ('Партия', 'Settings/Party')");
  otherSetting = run("INSERT INTO settings (name, folder_path) VALUES ('Чужой', 'Settings/Other')");
  const loc = (setting: number, parent: number | null, name: string) =>
    run("INSERT INTO setting_locations (setting_id, parent_id, name) VALUES (?, ?, ?)", setting, parent, name);
  city = loc(settingId, null, "Вотердип");
  district = loc(settingId, city, "Город Мёртвых");
  port = loc(settingId, city, "Порт");
  foreign = loc(otherSetting, null, "Баровия");

  campaign = run("INSERT INTO campaigns (name, setting_id) VALUES ('Однажды', ?)", settingId);
  session = run("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2026-09-12', 'planned')", campaign);

  sceneWithPlaces = run("INSERT INTO story_scenes (setting_id, name) VALUES (?, 'Одной ногой в могиле')", settingId);
  const placeOf = (sceneId: number, locationId: number) =>
    db
      .prepare(
        "INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, 'location', ?, 'scene_location')"
      )
      .run(sceneId, locationId);
  placeOf(sceneWithPlaces, district);
  placeOf(sceneWithPlaces, port);
  sceneWithout = run("INSERT INTO story_scenes (setting_id, name) VALUES (?, 'Разговор в пути')", settingId);
});

describe("partyPlace", () => {
  it("ни запусков, ни отметки — точки нет", () => {
    expect(partyPlace(campaign).location).toBeNull();
  });

  it("место последней запущенной сцены, остальные — «также в сцене»", () => {
    // Запуск в прошлом: отметка «Мы здесь» ниже ставится текущим временем и
    // должна оказаться младше него.
    launch(sceneWithPlaces, "2020-01-01 19:00:00");
    const p = partyPlace(campaign);
    expect(p.source).toBe("scene");
    expect(p.location?.name).toBe("Город Мёртвых");
    expect(p.path.map((x) => x.name)).toEqual(["Вотердип", "Город Мёртвых"]);
    expect(p.also.map((x) => x.name)).toEqual(["Порт"]);
    expect(p.scene?.name).toBe("Одной ногой в могиле");
  });

  it("«Мы здесь» перебивает сцену и кладёт место в панель сессии", () => {
    expect(setPartyPlace(session, port)).toEqual({ campaignId: campaign });
    const p = partyPlace(campaign);
    expect(p.source).toBe("manual");
    expect(p.location?.name).toBe("Порт");
    const link = db
      .prepare(
        "SELECT origin FROM generic_links WHERE from_type = 'session' AND from_id = ? AND to_type = 'location' AND to_id = ? AND section = 'locations'"
      )
      .get(session, port) as { origin: string } | undefined;
    expect(link?.origin).toBe("live");
  });

  it("отметка в архиве не считается — решает сцена", () => {
    db.prepare("UPDATE setting_locations SET archived_at = datetime('now') WHERE id = ?").run(port);
    expect(partyPlace(campaign).location?.name).toBe("Город Мёртвых");
    db.prepare("UPDATE setting_locations SET archived_at = NULL WHERE id = ?").run(port);
    expect(partyPlace(campaign).location?.name).toBe("Порт");
  });

  it("следующий запуск перебивает отметку, даже без места", () => {
    launch(sceneWithout, "2999-01-01 00:00:00");
    const p = partyPlace(campaign);
    expect(p.location).toBeNull();
    expect(p.source).toBeNull();
    expect(p.scene?.name).toBe("Разговор в пути");
  });

  it("отказывает в чужом мире, в никуда и без сессии", () => {
    expect(setPartyPlace(session, foreign)).toMatchObject({ status: 400 });
    expect(setPartyPlace(session, 999999)).toMatchObject({ status: 400 });
    expect(setPartyPlace(999999, city)).toMatchObject({ status: 404 });
  });

  it("флажки сеттинга — путь до места партии", () => {
    setPartyPlace(session, district);
    // Отметка младше запуска «2999 года» — чтобы проверить путь, запуск убираем.
    db.prepare("DELETE FROM session_scenes WHERE scene_id = ?").run(sceneWithout);
    // Завершённая кампания с отметкой флажка не ставит.
    const finished = run("INSERT INTO campaigns (name, setting_id, status) VALUES ('Прошлая', ?, 'completed')", settingId);
    const oldSession = run("INSERT INTO sessions (campaign_id, date, status) VALUES (?, '2025-01-01', 'held')", finished);
    expect(setPartyPlace(oldSession, port)).toEqual({ campaignId: finished });
    expect(settingPartyPlaces(settingId)).toEqual([
      { campaign_id: campaign, campaign_name: "Однажды", location_id: district, path_ids: [city, district] },
    ]);
    expect(settingPartyPlaces(otherSetting)).toEqual([]);
  });
});
