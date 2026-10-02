// Хроника кампании — частный случай хроники сеттинга (спека campaign-paper,
// Q28): события сеттинга живые, кампания только скрывает их у себя; прежние
// копии склеиваются миграцией.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db, migrateCampaignEventCopies } from "../db/db";
import { campaignsRouter } from "./campaigns";
import { getFlaggedSettingContent } from "../services/playerContent";

let app: express.Express;
let settingId = 0;
let campaignId = 0;

const event = (title: string, extra: Record<string, unknown> = {}) =>
  Number(
    db
      .prepare(
        `INSERT INTO setting_calendar_events (setting_id, title, description, inworld_year, inworld_month, inworld_day, visible_to_players, created_at)
         VALUES (?, ?, ?, 1492, 1, ?, 1, ?)`
      )
      .run(settingId, title, extra.description ?? "", extra.day ?? 1, extra.created_at ?? "2026-01-01 00:00:00").lastInsertRowid
  );

beforeAll(() => {
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Хроникальный')").run().lastInsertRowid);
  campaignId = Number(
    db.prepare("INSERT INTO campaigns (name, setting_id, created_at) VALUES ('Хроника', ?, '2026-01-01 00:00:00')").run(settingId).lastInsertRowid
  );
  app = express();
  app.use(express.json());
  app.use("/api/campaigns", campaignsRouter);
});

describe("хроника кампании без копий", () => {
  it("событие сеттинга видно живым, скрывается и возвращается", async () => {
    const id = event("Коронация", { day: 5 });
    let list = (await request(app).get(`/api/campaigns/${campaignId}/calendar-events`)).body as { id: number; source: string; hidden: number }[];
    expect(list.find((e) => e.source === "setting" && e.id === id)?.hidden).toBe(0);
    db.prepare("UPDATE setting_calendar_events SET title = 'Коронация Ксанатара' WHERE id = ?").run(id);
    list = (await request(app).get(`/api/campaigns/${campaignId}/calendar-events`)).body;
    expect((list.find((e) => e.id === id && e.source === "setting") as unknown as { title: string }).title).toBe("Коронация Ксанатара");

    await request(app).put(`/api/campaigns/${campaignId}/hidden-events/${id}`).send({ hidden: true });
    list = (await request(app).get(`/api/campaigns/${campaignId}/calendar-events`)).body;
    expect(list.find((e) => e.id === id && e.source === "setting")?.hidden).toBe(1);
    expect(getFlaggedSettingContent(settingId, campaignId).chronicleEvents.some((e) => e.id === id)).toBe(false);
    expect(getFlaggedSettingContent(settingId).chronicleEvents.some((e) => e.id === id)).toBe(true);

    await request(app).put(`/api/campaigns/${campaignId}/hidden-events/${id}`).send({ hidden: false });
    list = (await request(app).get(`/api/campaigns/${campaignId}/calendar-events`)).body;
    expect(list.find((e) => e.id === id && e.source === "setting")?.hidden).toBe(0);
  });

  it("миграция: нетронутая копия уходит, правленая остаётся своей, удалённая — скрытие", () => {
    const untouched = event("Затмение", { day: 10, created_at: "2026-02-01 00:00:00" });
    const edited = event("Пожар", { day: 11, description: "сгорел квартал", created_at: "2026-02-01 00:00:00" });
    const deleted = event("Ярмарка", { day: 12, created_at: "2026-02-01 00:00:00" });
    const older = event("Основание", { day: 13, created_at: "2025-01-01 00:00:00" });
    const copy = db.prepare(
      "INSERT INTO campaign_calendar_events (campaign_id, title, description, inworld_year, inworld_month, inworld_day) VALUES (?, ?, ?, 1492, 1, ?)"
    );
    copy.run(campaignId, "Затмение", "", 10);
    copy.run(campaignId, "Пожар", "сгорел квартал и склад", 11);
    db.prepare("DELETE FROM campaign_hidden_events WHERE campaign_id = ?").run(campaignId);

    migrateCampaignEventCopies(db);

    const own = db.prepare("SELECT title FROM campaign_calendar_events WHERE campaign_id = ?").all(campaignId) as { title: string }[];
    expect(own.map((r) => r.title)).toEqual(["Пожар"]);
    const hidden = (db.prepare("SELECT event_id FROM campaign_hidden_events WHERE campaign_id = ?").all(campaignId) as { event_id: number }[]).map(
      (r) => r.event_id
    );
    expect(hidden).toContain(edited);
    expect(hidden).toContain(deleted);
    expect(hidden).not.toContain(untouched);
    expect(hidden).not.toContain(older);
  });
});
