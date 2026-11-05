import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { db, openDatabase } from "../db/db";
import { galleryRouter } from "./gallery";
import { settingsRouter, buildSettingExportData, importSettingExport, updateSettingFromExport } from "./settings";
import { campaignsRouter } from "./campaigns";
import { settingLocationsRouter } from "./settingLocations";
import { ensureSubfolder, vaultAbs } from "../services/filesystem";
import { storeDeduped, storeDedupedFile } from "../services/vaultDedup";
import type { AuthedRequest } from "../services/auth";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");
const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as AuthedRequest).user = { role: req.headers["x-player"] ? "player" : "gm", playerId: 1 } as AuthedRequest["user"]; next(); });
app.use("/gallery", galleryRouter);
app.use("/settings", settingsRouter);
app.use("/campaigns", campaignsRouter);
app.use("/locations", settingLocationsRouter);
const id = (sql: string, ...args: (string | number)[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
const setting = id("INSERT INTO settings(name, folder_path) VALUES ('Batch3', 'Batch3')");
const campaign = id("INSERT INTO campaigns(name, setting_id, folder_path) VALUES ('Игра', ?, 'Batch3/Campaign')", setting);
const otherSetting = id("INSERT INTO settings(name, folder_path) VALUES ('Other', 'Other')");
const otherCampaign = id("INSERT INTO campaigns(name, setting_id, folder_path) VALUES ('Чужая', ?, 'Other/Campaign')", otherSetting);
const player = id("INSERT INTO players(name) VALUES ('Аня')");
const outsider = id("INSERT INTO players(name) VALUES ('Борис')");
db.prepare("INSERT INTO campaign_roster(campaign_id, player_id) VALUES (?, ?)").run(campaign, player);

describe("profiles batch 3 model", () => {
  it("hard-links a legacy source even when it has no entry in the dedup index", async () => {
    const folder = ensureSubfolder("Batch3", "Legacy");
    const source = path.join(folder, "old.png");
    const target = path.join(folder, "copy.png");
    fs.writeFileSync(vaultAbs(source), PNG);
    await storeDedupedFile(vaultAbs(source), target);
    expect(fs.statSync(vaultAbs(source)).nlink).toBeGreaterThan(1);
    expect(fs.readFileSync(vaultAbs(target))).toEqual(PNG);
  });
  it("upgrades an old database missing all six new columns, preserving rows and remaining idempotent", () => {
    const columns = [["setting_locations", "tags"], ["gallery_images", "source_image_id"], ...["setting_calendar_events", "campaign_calendar_events"].flatMap((table) => [[table, "avatar_image_path"], [table, "thumbnail_image_path"]])];
    for (const [table, column] of columns) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    openDatabase(process.env.DB_DIR!).close();
    openDatabase(process.env.DB_DIR!).close();
    for (const [table, column] of columns) expect((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)).toBe(true);
    expect(db.prepare("SELECT name FROM settings WHERE id = ?").get(setting)).toEqual({ name: "Batch3" });
  });

  it("issues a copy with grants, reuses it and rejects foreign campaigns, sections, players and player role", async () => {
    const being = id("INSERT INTO setting_beings(name, setting_id, folder_path) VALUES ('Мара', ?, 'Batch3/Mara')", setting);
    const file = path.join(ensureSubfolder("Batch3/Mara", "Gallery"), "source.png");
    await storeDeduped(PNG, file);
    const source = id("INSERT INTO gallery_images(owner_type, owner_id, image_path, caption) VALUES ('being', ?, ?, 'Оригинал')", being, file);
    const issue = (body: unknown) => request(app).post(`/gallery/${source}/issue`).send(body);
    const first = await issue({ campaign_id: campaign, section_id: null, player_ids: [] });
    expect(first.status).toBe(200);
    const section = first.body.section_id;
    const copyId = first.body.image_id;
    expect(db.prepare("SELECT name, kind FROM campaign_player_sections WHERE id = ?").get(section)).toEqual({ name: "Изображения", kind: "gallery" });
    expect(db.prepare("SELECT * FROM player_visibility_grants WHERE target_id = ? AND target_type = 'campaign_player_image'").all(copyId)).toHaveLength(0);
    let gallery = await request(app).get(`/gallery?owner_type=being&owner_id=${being}`);
    expect(gallery.body[0].issues[0].players).toEqual([]);
    const second = await issue({ campaign_id: campaign, section_id: section, player_ids: [player, player] });
    expect(second.body.image_id).toBe(copyId);
    expect(db.prepare("SELECT * FROM gallery_images WHERE source_image_id = ?").all(source)).toHaveLength(1);
    const copy = db.prepare("SELECT image_path, caption FROM gallery_images WHERE id = ?").get(copyId) as { image_path: string; caption: string };
    expect(copy.caption).toBe("Оригинал");
    expect(fs.readFileSync(vaultAbs(copy.image_path))).toEqual(PNG);
    expect(fs.statSync(vaultAbs(file)).nlink).toBeGreaterThan(1);
    gallery = await request(app).get(`/gallery?owner_type=being&owner_id=${being}&campaign_id=${campaign}`);
    expect(gallery.body[0].issues[0].players).toEqual([{ id: player, name: "Аня" }]);
    expect((await request(app).get(`/gallery?owner_type=being&owner_id=${being}&campaign_id=${otherCampaign}`)).body[0].issues).toEqual([]);
    const foreignSection = id("INSERT INTO campaign_player_sections(campaign_id, name, kind, folder_path) VALUES (?, 'Чужой', 'gallery', 'Other/Gallery')", otherCampaign);
    const articles = id("INSERT INTO campaign_player_sections(campaign_id, name, kind) VALUES (?, 'Статьи', 'articles')", campaign);
    for (const body of [
      { campaign_id: otherCampaign, section_id: null, player_ids: [] },
      { campaign_id: campaign, section_id: foreignSection, player_ids: [] },
      { campaign_id: campaign, section_id: articles, player_ids: [] },
      { campaign_id: campaign, section_id: section, player_ids: [outsider] },
    ]) expect((await issue(body)).status).toBe(400);
    expect((await request(app).post(`/gallery/${source}/issue`).set("x-player", "1").send({ campaign_id: campaign, section_id: section, player_ids: [] })).status).toBe(403);
    db.prepare("UPDATE gallery_images SET caption='Иначе' WHERE id=?").run(copyId);
    expect((db.prepare("SELECT caption FROM gallery_images WHERE id=?").get(source) as { caption: string }).caption).toBe("Оригинал");
    db.prepare("UPDATE gallery_images SET archived_at=datetime('now') WHERE id=?").run(source);
    expect((await issue({ campaign_id: campaign, section_id: section, player_ids: [] })).status).toBe(400);
    expect(fs.existsSync(vaultAbs(copy.image_path))).toBe(true);
    db.prepare("UPDATE gallery_images SET archived_at=datetime('now') WHERE id=?").run(copyId);
    expect((await request(app).get(`/gallery?owner_type=being&owner_id=${being}&include_archived=true`)).body[0].issues).toEqual([]);
  });

  it("persists location tags and event portraits through export/import and module update", async () => {
    const loc = id("INSERT INTO setting_locations(name, setting_id) VALUES ('Порт', ?)", setting);
    expect((await request(app).put(`/locations/${loc}`).send({ tags: ["порт", "ночь"] })).status).toBe(200);
    expect((await request(app).get(`/locations/${loc}`)).body.tags).toEqual(["порт", "ночь"]);
    const event = id("INSERT INTO setting_calendar_events(setting_id, title, inworld_year, inworld_month, inworld_day) VALUES (?, 'Праздник', 1496, 6, 7)", setting);
    const campEvent = id("INSERT INTO campaign_calendar_events(campaign_id, title, inworld_year, inworld_month, inworld_day) VALUES (?, 'Встреча', 1496, 6, 7)", campaign);
    for (const [type, eid, route] of [["setting_event", event, "settings"], ["campaign_event", campEvent, "campaigns"]] as const) {
      const result = await request(app).post(`/gallery/portrait/${type}/${eid}/avatar`).attach("file", PNG, { filename: "portrait.png", contentType: "image/png" });
      expect(result.status).toBe(200);
      expect(result.body.avatar_image_url).toContain(`/Events/event-${eid}/avatar.png`);
      expect((await request(app).get(`/${route}/calendar-events/${eid}`)).body.avatar_image_url).toBeTruthy();
    }
    const payload = buildSettingExportData(setting, ["calendar", "images"])!;
    expect(payload.calendarEvents?.[0].avatar_data).toBeTruthy();
    expect(payload.calendarEvents?.[0]).not.toHaveProperty("avatar_image_path");
    const restored = await importSettingExport(structuredClone(payload));
    expect((db.prepare("SELECT tags FROM setting_locations WHERE setting_id=?").get(restored) as { tags: string }).tags).toBe('["порт","ночь"]');
    const saved = db.prepare("SELECT id, avatar_image_path FROM setting_calendar_events WHERE setting_id=?").get(restored) as { id: number; avatar_image_path: string };
    expect(saved.avatar_image_path).toContain(`event-${saved.id}`);
    expect(fs.existsSync(vaultAbs(saved.avatar_image_path))).toBe(true);
    await updateSettingFromExport(restored, structuredClone(payload));
    expect(db.prepare("SELECT id FROM setting_calendar_events WHERE setting_id=?").all(restored)).toHaveLength(1);
    const noImages = buildSettingExportData(setting, ["calendar"])!;
    expect(noImages.calendarEvents?.[0]).not.toHaveProperty("avatar_data");
    expect(noImages.calendarEvents?.[0]).not.toHaveProperty("avatar_image_path");
  });
});
