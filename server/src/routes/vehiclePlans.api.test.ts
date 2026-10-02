// Чертёж транспорта (гриллинг профилей 2026-10-02, Q9; тикет 05): картинка
// судна, пины постов и метки-подписи.

import fs from "fs";
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { vaultAbs } from "../services/filesystem";
import { vehiclePlansRouter } from "./vehiclePlans";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");

let app: express.Express;
let ship = 0;
let helm = 0;
let otherPost = 0;

beforeAll(() => {
  const systemId = Number(
    db.prepare("INSERT INTO systems (name, folder_path) VALUES ('D&D', 'Systems/D&D-чертёж')").run().lastInsertRowid
  );
  const sectionId = Number(db.prepare("INSERT INTO system_sections (system_id, name) VALUES (?, 'Транспорт')").run(systemId).lastInsertRowid);
  const entry = db.prepare("INSERT INTO compendium_entries (system_id, section_id, kind, name, parent_id) VALUES (?, ?, 'vehicle', ?, ?)");
  ship = Number(entry.run(systemId, sectionId, "Галера", null).lastInsertRowid);
  helm = Number(entry.run(systemId, sectionId, "Штурвал", ship).lastInsertRowid);
  const other = Number(entry.run(systemId, sectionId, "Шлюп", null).lastInsertRowid);
  otherPost = Number(entry.run(systemId, sectionId, "Руль шлюпа", other).lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/vehicle-plans", vehiclePlansRouter);
});

describe("чертёж судна", () => {
  it("картинка загружается и отдаётся адресом", async () => {
    const res = await request(app)
      .post(`/api/vehicle-plans/${ship}/image`)
      .attach("file", PNG, { filename: "galley.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT blueprint_image_path FROM compendium_entries WHERE id = ?").get(ship) as {
      blueprint_image_path: string;
    };
    expect(fs.existsSync(vaultAbs(row.blueprint_image_path))).toBe(true);
    const plan = await request(app).get(`/api/vehicle-plans/${ship}`);
    expect(plan.body.blueprint_image_url).toBeTruthy();
  });

  it("пин поста и метка; чужой пост не ставится", async () => {
    const post = await request(app).post(`/api/vehicle-plans/${ship}/pins`).send({ post_id: helm, x: 80, y: 50 });
    expect(post.status).toBe(201);
    const label = await request(app).post(`/api/vehicle-plans/${ship}/pins`).send({ text: " Трюм ", x: 40, y: 140 });
    expect(label.status).toBe(201);
    expect(label.body).toMatchObject({ text: "Трюм", y: 100 });
    const alien = await request(app).post(`/api/vehicle-plans/${ship}/pins`).send({ post_id: otherPost, x: 1, y: 1 });
    expect(alien.status).toBe(400);
    const plan = await request(app).get(`/api/vehicle-plans/${ship}`);
    expect(plan.body.pins.map((p: { post_name: string | null; text: string }) => p.post_name ?? p.text)).toEqual(["Штурвал", "Трюм"]);
  });

  it("метка переименовывается, у поста текст не меняется", async () => {
    const plan = await request(app).get(`/api/vehicle-plans/${ship}`);
    const [postPin, labelPin] = plan.body.pins as { id: number }[];
    const renamed = await request(app).put(`/api/vehicle-plans/pins/${labelPin.id}`).send({ text: "Баллиста", x: 10 });
    expect(renamed.body).toMatchObject({ text: "Баллиста", x: 10 });
    const post = await request(app).put(`/api/vehicle-plans/pins/${postPin.id}`).send({ text: "x" });
    expect(post.body.text).toBe("");
  });

  it("пост уходит — его пин тоже", () => {
    db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(helm);
    const n = db.prepare("SELECT COUNT(*) AS n FROM blueprint_pins WHERE entry_id = ?").get(ship) as { n: number };
    expect(n.n).toBe(1);
  });

  it("«Убрать чертёж» снимает и пины", async () => {
    const res = await request(app).delete(`/api/vehicle-plans/${ship}/image`);
    expect(res.status).toBe(200);
    const plan = await request(app).get(`/api/vehicle-plans/${ship}`);
    expect(plan.body).toEqual({ blueprint_image_url: null, pins: [] });
  });
});
