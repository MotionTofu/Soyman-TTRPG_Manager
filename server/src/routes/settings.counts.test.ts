import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../db/db";
import type { AuthedRequest } from "../services/auth";
import { settingsRouter } from "./settings";

const app = express();
app.use((req: AuthedRequest, _res, next) => {
  req.user = { id: 1, username: "gm", role: "gm", playerId: null, isAdmin: true, tokenVersion: 0 };
  next();
});
app.use("/settings", settingsRouter);

function createSetting() {
  return Number(db.prepare("INSERT INTO settings (name) VALUES ('Мир')").run().lastInsertRowid);
}

async function counts(id: number) {
  return (await request(app).get(`/settings/${id}/counts`).expect(200)).body;
}

describe("содержимое вкладок профиля сеттинга", () => {
  it("кампания, её собственная хроника и её приключения не наполняют профиль сеттинга", async () => {
    const id = createSetting();
    const campaign = db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Игра', ?)").run(id).lastInsertRowid;
    db.prepare("INSERT INTO setting_calendar_timelines (setting_id, campaign_id, name) VALUES (?, ?, 'Линия кампании')").run(id, campaign);
    db.prepare("INSERT INTO story_arcs (setting_id, campaign_id, name) VALUES (?, ?, 'Арка кампании')").run(id, campaign);
    db.prepare("INSERT INTO story_arcs (setting_id, is_default, name) VALUES (?, 1, 'Сцены вне приключений')").run(id);

    expect(await counts(id)).toMatchObject({
      hasChronicle: false, hasAdventures: false, hasGallery: false, adventures: 0,
    });
  });

  it("Хроника учитывает даты сущностей и линии времени без событий", async () => {
    const id = createSetting();
    const location = db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Город')").run(id).lastInsertRowid;
    db.prepare("INSERT INTO important_dates (owner_type, owner_id, title, day) VALUES ('location', ?, 'Ярмарка', 1)").run(location);
    expect(await counts(id)).toMatchObject({ hasChronicle: true, events: 0 });

    db.prepare("UPDATE setting_locations SET archived_at = datetime('now') WHERE id = ?").run(location);
    expect(await counts(id)).toMatchObject({ hasChronicle: false });

    db.prepare("INSERT INTO setting_calendar_timelines (setting_id, name) VALUES (?, 'История города')").run(id);
    expect(await counts(id)).toMatchObject({ hasChronicle: true, events: 0 });
  });

  it("Приключения учитывают архив и старые сцены без приключения", async () => {
    const id = createSetting();
    const arc = db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Поход')").run(id).lastInsertRowid;
    expect(await counts(id)).toMatchObject({ hasAdventures: true, adventures: 1 });

    db.prepare("UPDATE story_arcs SET archived_at = datetime('now') WHERE id = ?").run(arc);
    expect(await counts(id)).toMatchObject({ hasAdventures: false, adventures: 0 });

    db.prepare("INSERT INTO story_scenes (setting_id, name) VALUES (?, 'Переправа')").run(id);
    expect(await counts(id)).toMatchObject({ hasAdventures: true, adventures: 0 });
  });

  it("Галерея учитывает альбомы и привязанные изображения без категории", async () => {
    const id = createSetting();
    const other = createSetting();
    db.prepare("INSERT INTO resources (setting_id, name, scope, category) VALUES (?, 'Справочник', 'setting', 'pdf')").run(id);
    expect(await counts(id)).toMatchObject({ hasGallery: false });

    const image = db.prepare(`
      INSERT INTO resources (setting_id, name, scope, link_url) VALUES (?, 'Берег', 'setting', 'https://example.com/coast.WEBP?v=1')
    `).run(other).lastInsertRowid;
    db.prepare("INSERT INTO resource_setting_links (owner_type, owner_id, setting_id) VALUES ('resource', ?, ?)").run(image, id);
    expect(await counts(id)).toMatchObject({ hasGallery: true });

    db.prepare("UPDATE resources SET archived_at = datetime('now') WHERE id = ?").run(image);
    expect(await counts(id)).toMatchObject({ hasGallery: false });

    db.prepare("INSERT INTO albums (setting_id, name) VALUES (?, 'Референсы')").run(id);
    expect(await counts(id)).toMatchObject({ hasGallery: true });
  });
});
