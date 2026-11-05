// Список систем отдаёт плитке счётчики (шаблон «Реестр», Q13): кампании вне
// архива и статьи справочника. Временная база, живая не затрагивается.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let systemId = 0;

beforeAll(async () => {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "systems-counts-test-"));
  const { systemsRouter } = await import("./systems");
  const { db } = await import("../db/db");
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/systems", systemsRouter);

  const id = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).run(...args) as { lastInsertRowid: unknown }).lastInsertRowid);
  systemId = id("INSERT INTO systems (name) VALUES (?)", "Счётная система");
  const sectionId = id("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, ?, ?)", systemId, "Бестиарий", "bestiary");
  for (const name of ["Гоблин", "Орк", "Тролль"]) id("INSERT INTO compendium_entries (system_id, section_id, name) VALUES (?, ?, ?)", systemId, sectionId, name);
  id("INSERT INTO campaigns (name, system_id) VALUES (?, ?)", "Живая", systemId);
  id("INSERT INTO campaigns (name, system_id, archived_at) VALUES (?, ?, datetime('now'))", "В архиве", systemId);
  id("INSERT INTO systems (name) VALUES (?)", "Пустая система");
});

describe("GET /systems — счётчики плитки", () => {
  it("считает кампании без архивных и все статьи справочника", async () => {
    const res = await request(app).get("/api/systems");
    expect(res.status).toBe(200);
    const counted = res.body.find((s: { id: number }) => s.id === systemId);
    expect(counted).toMatchObject({ campaigns_count: 1, entries_count: 3 });
    const empty = res.body.find((s: { name: string }) => s.name === "Пустая система");
    expect(empty).toMatchObject({ campaigns_count: 0, entries_count: 0 });
  });
});
