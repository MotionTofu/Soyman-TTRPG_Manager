// Обложка приключения (гриллинг профилей 2026-10-02, доска 37): загрузка в
// сеттинге пишет оригинал, из кампании — её копию, не трогая файл оригинала.

import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { vaultAbs } from "../services/filesystem";
import { storyRouter } from "./story";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");

let app: express.Express;
let arcId = 0;
let campaignId = 0;

beforeAll(() => {
  const settingId = Number(
    db.prepare("INSERT INTO settings (name, folder_path) VALUES ('Вотердип', 'Settings/Вотердип-обложка')").run().lastInsertRowid
  );
  arcId = Number(db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'Ограбление дракона')").run(settingId).lastInsertRowid);
  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Золото Вотердипа')").run().lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/story", storyRouter);
});

const upload = (fields: Record<string, string> = {}) => {
  let req = request(app).post(`/api/story/arcs/${arcId}/thumbnail`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", PNG, { filename: "cover.png", contentType: "image/png" });
};

describe("обложка приключения", () => {
  let originalPath = "";

  it("загружается в оригинал и отдаётся адресом", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    originalPath = res.body.thumbnail_image_path;
    expect(fs.existsSync(vaultAbs(originalPath))).toBe(true);
    const arc = await request(app).get(`/api/story/arcs/${arcId}`);
    expect(arc.body.thumbnail_image_url).toBeTruthy();
  });

  it("из кампании ложится в её копию, файл оригинала цел", async () => {
    const res = await upload({ campaign_id: String(campaignId) });
    expect(res.status).toBe(200);
    expect(res.body.thumbnail_image_path).not.toBe(originalPath);
    expect(fs.existsSync(vaultAbs(originalPath))).toBe(true);
    const own = await request(app).get(`/api/story/arcs/${arcId}?campaign_id=${campaignId}`);
    expect(own.body.thumbnail_image_path).toBe(res.body.thumbnail_image_path);
    const plain = await request(app).get(`/api/story/arcs/${arcId}`);
    expect(plain.body.thumbnail_image_path).toBe(originalPath);
  });
});
