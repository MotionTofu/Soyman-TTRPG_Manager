// Кабинет игрока, шаг 2: ступень выдачи и игроцкий текст.
//
// Главная опасность шага — невидимая: неверное умолчание молча урезало бы уже
// розданное. Поэтому тесты бьют в три точки: умолчание старых грантов,
// смена ступени через API и — самое важное — ответ /player/*: при
// 'mentioned' полные поля не приходят С СЕРВЕРА (проверяется тело ответа,
// а не экран).

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { playerRouter } from "./player";
import { visibilityGrantsRouter } from "./visibilityGrants";

let app: express.Express;
let campaignId = 0;
let campaign2Id = 0;
let settingId = 0;
let playerId = 0;
let locOpen = 0;
let beingMentioned = 0;
let communityOpen = 0;
let eventMentioned = 0;

function asPlayer(req: Record<string, unknown>, _res: unknown, next: () => void): void {
  req["user"] = { id: 7, role: "player", playerId, isAdmin: false, tokenVersion: 0 };
  next();
}

beforeAll(() => {
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Тестовый мир')").run().lastInsertRowid);
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Марина')").run().lastInsertRowid);
  campaignId = Number(
    db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Стол Сары', ?)").run(settingId).lastInsertRowid
  );
  campaign2Id = Number(
    db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Стол Герберта', ?)").run(settingId).lastInsertRowid
  );
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, playerId);
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaign2Id, playerId);

  locOpen = Number(
    db
      .prepare(
        "INSERT INTO setting_locations (setting_id, name, kind, description, player_text, avatar_image_path) VALUES (?, 'Вотердип', 'city', 'ПРАВДА-ПРО-ВОТЕРДИП', 'СЛУХ-ПРО-ВОТЕРДИП', 'vault/loc.jpg')"
      )
      .run(settingId).lastInsertRowid
  );
  beingMentioned = Number(
    db
      .prepare(
        "INSERT INTO setting_beings (setting_id, name, category, history, player_text, avatar_image_path) VALUES (?, 'Мирт', 'key_figure', 'ТАЙНАЯ-БИОГРАФИЯ', 'СЛУХ-ПРО-МИРТА', 'vault/being.jpg')"
      )
      .run(settingId).lastInsertRowid
  );
  communityOpen = Number(
    db
      .prepare("INSERT INTO setting_communities (setting_id, name, description, player_text) VALUES (?, 'Арфа', 'ОПИСАНИЕ-АРФЫ', 'СЛУХ-ПРО-АРФУ')")
      .run(settingId).lastInsertRowid
  );
  eventMentioned = Number(
    db
      .prepare(
        "INSERT INTO setting_calendar_events (setting_id, title, description, player_text, inworld_year, inworld_month, inworld_day) VALUES (?, 'Падение', 'ЧТО-БЫЛО-НА-САМОМ-ДЕЛЕ', 'СЛУХ-ПРО-ПАДЕНИЕ', 1492, 3, 15)"
      )
      .run(settingId).lastInsertRowid
  );

  app = express();
  app.use(express.json());
  app.use("/api/player", asPlayer, playerRouter);
  app.use("/api/visibility-grants", visibilityGrantsRouter);
});

describe("ступень выдачи: умолчание и смена", () => {
  it("старый грант без ступени читается как 'open'", () => {
    db.prepare(
      "INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, 'setting_location', ?)"
    ).run(campaignId, playerId, locOpen);
    const row = db
      .prepare("SELECT access_level FROM player_visibility_grants WHERE campaign_id = ? AND target_id = ?")
      .get(campaignId, locOpen) as { access_level: string };
    expect(row.access_level).toBe("open");
  });

  it("POST без ступени не трогает существующую, с упомянутой — выставляет", async () => {
    db.prepare(
      "INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, 'setting_being', ?)"
    ).run(campaignId, playerId, beingMentioned);
    // Повторный грант без ступени — как раньше: строка остаётся 'open'.
    const keep = await request(app)
      .post("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_being", target_id: beingMentioned });
    expect(keep.status).toBe(201);
    const kept = db
      .prepare("SELECT access_level FROM player_visibility_grants WHERE campaign_id = ? AND target_type = 'setting_being' AND target_id = ?")
      .get(campaignId, beingMentioned) as { access_level: string };
    expect(kept.access_level).toBe("open");

    const set = await request(app)
      .post("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_being", target_id: beingMentioned, access_level: "mentioned" });
    expect(set.status).toBe(201);
    const changed = db
      .prepare("SELECT access_level FROM player_visibility_grants WHERE campaign_id = ? AND target_type = 'setting_being' AND target_id = ?")
      .get(campaignId, beingMentioned) as { access_level: string };
    expect(changed.access_level).toBe("mentioned");

    // Гранты для остальных сущностей теста.
    await request(app).post("/api/visibility-grants").send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_community", target_id: communityOpen });
    await request(app).post("/api/visibility-grants").send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_calendar_event", target_id: eventMentioned, access_level: "mentioned" });
  });

  it("неизвестная ступень отвергается, чужой грант через PUT не правится", async () => {
    const bad = await request(app)
      .post("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_location", target_id: locOpen, access_level: "half-open" });
    expect(bad.status).toBe(400);
    const missing = await request(app)
      .put("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_location", target_id: 999999, access_level: "mentioned" });
    expect(missing.status).toBe(404);
  });

  it("PUT меняет ступень без разрыва выдачи", async () => {
    const res = await request(app)
      .put("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_location", target_id: locOpen, access_level: "mentioned" });
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT access_level FROM player_visibility_grants WHERE campaign_id = ? AND target_type = 'setting_location' AND target_id = ?")
      .get(campaignId, locOpen) as { access_level: string };
    expect(row.access_level).toBe("mentioned");
    // Возвращаем как было — дальше тесты ждут 'open' у локации.
    await request(app)
      .put("/api/visibility-grants")
      .send({ campaign_id: campaignId, player_id: playerId, target_type: "setting_location", target_id: locOpen, access_level: "open" });
  });
});

describe("ступень выдачи: ответ /player/*", () => {
  it("setting-player-content: упомянутое — только имя, вид и картинка", async () => {
    const res = await request(app).get(`/api/player/campaigns/${campaignId}/setting-player-content`);
    expect(res.status).toBe(200);

    const loc = (res.body.locations as Record<string, unknown>[]).find((l) => l["id"] === locOpen);
    expect(loc).toMatchObject({ name: "Вотердип", kind: "city", access_level: "open" });
    expect(loc?.["description"]).toBe("ПРАВДА-ПРО-ВОТЕРДИП");
    expect(loc?.["player_text"]).toBe("СЛУХ-ПРО-ВОТЕРДИП");
    expect(loc?.["avatar_image_url"]).toContain("vault/loc.jpg");

    const being = (res.body.beings as Record<string, unknown>[]).find((b) => b["id"] === beingMentioned);
    expect(being).toMatchObject({ name: "Мирт", category: "key_figure", access_level: "mentioned" });
    expect(being?.["avatar_image_url"]).toContain("vault/being.jpg");
    // Ключевая проверка шага: полные поля не приходят с сервера вовсе.
    expect("history" in (being ?? {})).toBe(false);
    expect("description" in (being ?? {})).toBe(false);
    expect("player_text" in (being ?? {})).toBe(false);
    expect("behavior" in (being ?? {})).toBe(false);
    expect("secret" in (being ?? {})).toBe(false);

    const community = (res.body.communities as Record<string, unknown>[]).find((c) => c["id"] === communityOpen);
    expect(community).toMatchObject({ name: "Арфа", access_level: "open" });
    expect(community?.["player_text"]).toBe("СЛУХ-ПРО-АРФУ");

    const event = (res.body.chronicleEvents as Record<string, unknown>[]).find((e) => e["id"] === eventMentioned);
    expect(event).toMatchObject({ title: "Падение", inworld_year: 1492, access_level: "mentioned" });
    expect("description" in (event ?? {})).toBe(false);
    expect("player_text" in (event ?? {})).toBe(false);
  });

  it("settings/:id: 'open' в одной кампании побеждает 'mentioned' в другой", async () => {
    // Упомянули то же существо во второй кампании — там оно только упомянуто.
    await request(app).post("/api/visibility-grants").send({ campaign_id: campaign2Id, player_id: playerId, target_type: "setting_community", target_id: communityOpen, access_level: "mentioned" });
    const res = await request(app).get(`/api/player/settings/${settingId}`);
    expect(res.status).toBe(200);
    const community = (res.body.communities as Record<string, unknown>[]).find((c) => c["id"] === communityOpen);
    // В первой кампании открыто — сводка показывает открытое.
    expect(community).toMatchObject({ access_level: "open" });
    expect(community?.["description"]).toBe("ОПИСАНИЕ-АРФЫ");
  });
});

describe("«Глазами игрока»: превью идёт тем же расчётом", () => {
  it("превью Мира совпадает с ответом /player/* того же игрока", async () => {
    const playerRes = await request(app).get(`/api/player/campaigns/${campaignId}/setting-player-content`);
    expect(playerRes.status).toBe(200);
    const preview = await request(app).get(
      `/api/visibility-grants/preview?campaign_id=${campaignId}&player_id=${playerId}`
    );
    expect(preview.status).toBe(200);
    expect(preview.body.setting).toEqual(playerRes.body);
  });

  it("превью «От мастера» совпадает с player-sections того же игрока", async () => {
    const sectionId = Number(
      db.prepare("INSERT INTO campaign_player_sections (campaign_id, name, kind) VALUES (?, 'Записки', 'articles')").run(campaignId).lastInsertRowid
    );
    const articleId = Number(
      db.prepare("INSERT INTO campaign_player_articles (section_id, title, content) VALUES (?, 'Карта', 'текст')").run(sectionId).lastInsertRowid
    );
    void articleId;
    await request(app).post("/api/visibility-grants").send({ campaign_id: campaignId, player_id: playerId, target_type: "campaign_player_section", target_id: sectionId });
    const playerRes = await request(app).get(`/api/player/campaigns/${campaignId}/player-sections`);
    expect(playerRes.status).toBe(200);
    const preview = await request(app).get(
      `/api/visibility-grants/preview?campaign_id=${campaignId}&player_id=${playerId}`
    );
    expect(preview.status).toBe(200);
    expect(preview.body.sections).toEqual(playerRes.body);
  });

  it("превью знает и открытое старой галочкой — как /visible у игрока", async () => {
    const { setting_id: settingId } = db.prepare("SELECT setting_id FROM campaigns WHERE id = ?").get(campaignId) as {
      setting_id: number;
    };
    expect(settingId).toBeTruthy();
    db.prepare(
      "INSERT INTO setting_calendar_events (setting_id, title, description, inworld_year, inworld_month, inworld_day, visible_to_players) VALUES (?, 'Затмение', 'текст', 1200, 1, 1, 1)"
    ).run(settingId);
    const playerRes = await request(app).get(`/api/player/campaigns/${campaignId}/visible`);
    expect(playerRes.status).toBe(200);
    const preview = await request(app).get(
      `/api/visibility-grants/preview?campaign_id=${campaignId}&player_id=${playerId}`
    );
    expect(preview.status).toBe(200);
    expect(preview.body.flagged.chronicleEvents.map((e: { title: string }) => e.title)).toContain("Затмение");
    expect(preview.body.flagged).toEqual({
      locationArticles: playerRes.body.locationArticles,
      beingArticles: playerRes.body.beingArticles,
      chronicleEvents: playerRes.body.chronicleEvents,
    });
  });

  it("чужой игрок и чужая кампания — 404, а не чужие данные", async () => {
    const outsiderId = Number(db.prepare("INSERT INTO players (name) VALUES ('Чужой')").run().lastInsertRowid);
    expect((await request(app).get(`/api/visibility-grants/preview?campaign_id=${campaignId}&player_id=${outsiderId}`)).status).toBe(404);
    expect((await request(app).get(`/api/visibility-grants/preview?campaign_id=999999&player_id=${playerId}`)).status).toBe(404);
    expect((await request(app).get(`/api/visibility-grants/preview?campaign_id=${campaignId}`)).status).toBe(400);
  });
});

describe("игроцкий текст: запись мастером", () => {
  it("PUT локации, существа, общины и события принимают player_text", async () => {
    // Мастерские ручки смонтированы напрямую, без авторизации — как в других тестах.
    const locApp = express();
    locApp.use(express.json());
    const { settingLocationsRouter } = await import("./settingLocations");
    const { settingBeingsRouter } = await import("./settingBeings");
    const { settingCommunitiesRouter } = await import("./settingCommunities");
    const { settingsRouter } = await import("./settings");
    locApp.use("/api/setting-locations", settingLocationsRouter);
    locApp.use("/api/setting-beings", settingBeingsRouter);
    locApp.use("/api/setting-communities", settingCommunitiesRouter);
    locApp.use("/api/settings", settingsRouter);

    const r1 = await request(locApp).put(`/api/setting-locations/${locOpen}`).send({ player_text: "Новый слух" });
    expect(r1.status).toBe(200);
    expect(r1.body.player_text).toBe("Новый слух");

    const r2 = await request(locApp).put(`/api/setting-beings/${beingMentioned}`).send({ player_text: "Слух про Мирта" });
    expect(r2.status).toBe(200);
    expect(r2.body.player_text).toBe("Слух про Мирта");

    const r3 = await request(locApp).put(`/api/setting-communities/${communityOpen}`).send({ player_text: "Слух про Арфу" });
    expect(r3.status).toBe(200);
    expect(r3.body.player_text).toBe("Слух про Арфу");

    const r4 = await request(locApp).put(`/api/settings/calendar-events/${eventMentioned}`).send({ player_text: "Слух про Падение" });
    expect(r4.status).toBe(200);
    expect(r4.body.player_text).toBe("Слух про Падение");

    const tooLong = await request(locApp).put(`/api/setting-locations/${locOpen}`).send({ player_text: "x".repeat(20000) });
    expect(tooLong.status).toBe(400);
  });
});
