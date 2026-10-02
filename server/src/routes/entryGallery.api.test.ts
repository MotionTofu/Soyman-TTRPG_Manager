// Галерея записи компендиума (просьба владельца 2026-10-02): картинки ложатся
// в папку раздела системы и уходят вместе с записью.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { galleryRouter } from "./gallery";
import { systemsRouter } from "./systems";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");

let app: express.Express;
let entryId = 0;

beforeAll(() => {
  const systemId = Number(
    db.prepare("INSERT INTO systems (name, folder_path) VALUES ('Галерейная', 'Systems/Галерейная')").run().lastInsertRowid
  );
  const sectionId = Number(
    db.prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, 'Бестиарий', 'bestiary')").run(systemId)
      .lastInsertRowid
  );
  entryId = Number(
    db
      .prepare(
        `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, data, description, position)
         VALUES (?, ?, NULL, 'monster', 'Ааракокра', '{}', '', 0)`
      )
      .run(systemId, sectionId).lastInsertRowid
  );
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/gallery", galleryRouter);
  app.use("/api/systems", systemsRouter);
});

describe("галерея записи компендиума", () => {
  it("принимает картинку и отдаёт её списком", async () => {
    const res = await request(app)
      .post("/api/gallery")
      .field("owner_type", "compendium_entry")
      .field("owner_id", String(entryId))
      .attach("file", PNG, { filename: "art.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.image_path).toContain("Bestiary");
    const list = await request(app).get(`/api/gallery?owner_type=compendium_entry&owner_id=${entryId}`);
    expect(list.body).toHaveLength(1);
  });

  it("удаление записи убирает её галерею", async () => {
    expect((await request(app).delete(`/api/systems/entries/${entryId}`)).status).toBe(200);
    const left = db.prepare("SELECT COUNT(*) AS n FROM gallery_images WHERE owner_type = 'compendium_entry' AND owner_id = ?").get(entryId) as { n: number };
    expect(left.n).toBe(0);
  });
});
