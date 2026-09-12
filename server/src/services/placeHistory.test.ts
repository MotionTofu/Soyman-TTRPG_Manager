// «Что здесь было» (решения 2026-09-11, §2, п. 8): какие сцены «впереди» и
// какие сессии «были». Временную базу заводит src/test/setupTempDb.ts.

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db/db";
import { HISTORY_LIMIT, placeHistory } from "./placeHistory";

let settingId = 0;
let dungeon = 0;
let room = 0;
let port = 0;
let campaign = 0;
let otherCampaign = 0;
let overrideId = 0;

const run = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);

beforeAll(() => {
  settingId = run("INSERT INTO settings (name, folder_path) VALUES ('История', 'Settings/History')");
  const loc = (parent: number | null, name: string, role: string) =>
    run("INSERT INTO setting_locations (setting_id, parent_id, name, role) VALUES (?, ?, ?, ?)", settingId, parent, name, role);
  dungeon = loc(null, "Синий переулок", "location");
  room = loc(dungeon, "Гостевая книга", "spot");
  port = loc(null, "Порт", "location");

  campaign = run("INSERT INTO campaigns (name, setting_id) VALUES ('Вотердип', ?)", settingId);
  otherCampaign = run("INSERT INTO campaigns (name, setting_id) VALUES ('Однажды', ?)", settingId);

  const adventure = run("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Приключение')", settingId);
  const chapter = run(
    "INSERT INTO story_arcs (setting_id, parent_id, name, kind) VALUES (?, ?, 'Глава', 'chapter')",
    settingId,
    adventure
  );
  const foreignArc = run("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Чужое приключение')", settingId);
  db.prepare("INSERT INTO campaign_adventures (campaign_id, arc_id) VALUES (?, ?)").run(campaign, adventure);
  // Завершённая кампания с тем же приключением: её сцены «впереди» не бывают.
  const finished = run("INSERT INTO campaigns (name, setting_id, status) VALUES ('Прошлая', ?, 'completed')", settingId);
  db.prepare("INSERT INTO campaign_adventures (campaign_id, arc_id) VALUES (?, ?)").run(finished, adventure);

  const scene = (arc: number | null, name: string, extra: { campaign?: number; source?: number; library?: number } = {}) =>
    run(
      "INSERT INTO story_scenes (setting_id, arc_id, campaign_id, source_scene_id, library_scene_id, name) VALUES (?, ?, ?, ?, ?, ?)",
      settingId,
      arc,
      extra.campaign ?? null,
      extra.source ?? null,
      extra.library ?? null,
      name
    );
  const placeOf = (sceneId: number, locationId: number) =>
    db
      .prepare(
        "INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, 'location', ?, 'scene_location')"
      )
      .run(sceneId, locationId);

  const inRoom = scene(chapter, "Гостевая книга");
  placeOf(inRoom, room);
  const done = scene(adventure, "Пройденная");
  placeOf(done, dungeon);
  db.prepare("INSERT INTO campaign_scene_state (campaign_id, scene_id, status) VALUES (?, ?, 'done')").run(campaign, done);
  const foreign = scene(foreignArc, "Чужая");
  placeOf(foreign, dungeon);
  // Исходник ведёт в порт, копия кампании — в переулок: у кампании место копии.
  const original = scene(adventure, "Исходник");
  placeOf(original, port);
  overrideId = scene(adventure, "Копия кампании", { campaign, source: original });
  placeOf(overrideId, dungeon);
  // Вставка заготовки: место лежит на заготовке.
  const blank = run("INSERT INTO story_scenes (setting_id, name, in_library) VALUES (?, 'Заготовка', 1)", settingId);
  placeOf(blank, dungeon);
  const insertion = scene(adventure, "Заготовка", { library: blank });

  const session = (campaignId: number, date: string, status: string) =>
    run("INSERT INTO sessions (campaign_id, date, status) VALUES (?, ?, ?)", campaignId, date, status);
  const sessionLink = (sessionId: number, locationId: number, section: string, origin: string) =>
    db
      .prepare(
        "INSERT INTO generic_links (from_type, from_id, to_type, to_id, section, origin) VALUES ('session', ?, 'location', ?, ?, ?)"
      )
      .run(sessionId, locationId, section, origin);

  const launched = session(campaign, "2026-08-01", "held");
  db.prepare("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?)").run(launched, inRoom);
  const plannedOnly = session(campaign, "2026-09-20", "planned");
  sessionLink(plannedOnly, dungeon, "locations", "planned");
  const liveTonight = session(campaign, "2026-09-12", "planned");
  sessionLink(liveTonight, room, "locations", "live");
  const mentioned = session(campaign, "2026-08-15", "held");
  sessionLink(mentioned, dungeon, "mention", "planned");
  const mentionedAhead = session(campaign, "2026-09-27", "planned");
  sessionLink(mentionedAhead, dungeon, "mention", "planned");
  const otherLaunch = session(otherCampaign, "2026-08-20", "held");
  db.prepare("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?)").run(otherLaunch, insertion);

  // Много проведённых сессий в порту — для предела.
  for (let i = 1; i <= HISTORY_LIMIT + 2; i++) {
    const s = session(campaign, `2026-07-${String(i).padStart(2, "0")}`, "held");
    sessionLink(s, port, "mention", "planned");
  }
});

describe("placeHistory: впереди", () => {
  it("сцены приключений кампании с местом и вложенными, без пройденных и чужих", () => {
    const h = placeHistory(dungeon, { campaignId: campaign })!;
    expect(h.ahead.map((a) => [a.scene_name, a.place_name])).toEqual([
      ["Гостевая книга", "Гостевая книга"],
      ["Копия кампании", null],
      ["Заготовка", null],
    ]);
    expect(h.ahead.find((a) => a.scene_name === "Копия кампании")?.scene_id).toBe(overrideId);
  });

  it("запущенная, но не отмеченная сцена остаётся впереди — с датой запуска", () => {
    const h = placeHistory(dungeon, { campaignId: campaign })!;
    expect(h.ahead.find((a) => a.scene_name === "Гостевая книга")?.launched_at).toBeTruthy();
    expect(h.ahead.find((a) => a.scene_name === "Копия кампании")?.launched_at).toBeNull();
    // Заготовку запускала другая кампания — этой она не считается.
    expect(h.ahead.find((a) => a.scene_name === "Заготовка")?.launched_at).toBeNull();
  });

  it("у вложенного места — только его сцены, без подписи", () => {
    const h = placeHistory(room, { campaignId: campaign })!;
    expect(h.ahead.map((a) => [a.scene_name, a.place_name])).toEqual([["Гостевая книга", null]]);
  });

  it("место исходника, подменённого копией, кампания не видит", () => {
    expect(placeHistory(port, { campaignId: campaign })!.ahead).toEqual([]);
  });

  it("в профиле — только идущие кампании: завершённая сцен впереди не даёт", () => {
    const h = placeHistory(dungeon)!;
    expect(new Set(h.ahead.map((a) => a.campaign_name))).toEqual(new Set(["Вотердип"]));
  });

  it("кампания без приключений ничего не добавляет", () => {
    expect(placeHistory(dungeon, { campaignId: otherCampaign })!.ahead).toEqual([]);
  });
});

describe("placeHistory: было", () => {
  it("запуск, место за столом и упоминание в проведённой; планы — нет", () => {
    const h = placeHistory(dungeon)!;
    expect(h.visits.map((v) => [v.date, v.campaign_name, v.reasons])).toEqual([
      ["2026-09-12", "Вотердип", ["panel"]],
      ["2026-08-20", "Однажды", ["scene"]],
      ["2026-08-15", "Вотердип", ["mention"]],
      ["2026-08-01", "Вотердип", ["scene"]],
    ]);
  });

  it("фильтр кампании", () => {
    const h = placeHistory(dungeon, { campaignId: campaign })!;
    expect(h.visits.map((v) => v.date)).toEqual(["2026-09-12", "2026-08-15", "2026-08-01"]);
  });

  it("предел строк и «все»", () => {
    const short = placeHistory(port, { campaignId: campaign })!;
    expect(short.visits).toHaveLength(HISTORY_LIMIT);
    expect(short.visits_total).toBe(HISTORY_LIMIT + 2);
    expect(placeHistory(port, { campaignId: campaign, all: true })!.visits).toHaveLength(HISTORY_LIMIT + 2);
  });

  it("нет места — null", () => {
    expect(placeHistory(999999)).toBeNull();
  });
});
