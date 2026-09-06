// Список записей раздела отдаёт плитке готовые combat_roles и DPR:
// настоящий роутер на временной базе, живая база не затрагивается никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let systemId = 0;
let sectionId = 0;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "systems-entries-test-"));
  process.env.DB_DIR = tmpDir;
  const { systemsRouter } = await import("./systems");
  const { db } = await import("../db/db");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/systems", systemsRouter);

  systemId = Number(
    (db.prepare("INSERT INTO systems (name) VALUES (?)").run("Тестовая система") as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
  sectionId = Number(
    (
      db
        .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, ?, ?)")
        .run(systemId, "Бестиарий", "bestiary") as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
  const entryId = Number(
    (
      db
        .prepare(
          `INSERT INTO compendium_entries
             (system_id, section_id, parent_id, kind, name, level, data, description, position, combat_roles)
           VALUES (?, ?, NULL, 'monster', 'Тестовый когтистый', NULL, '{}', '', 0, ?)`
        )
        .run(systemId, sectionId, JSON.stringify(["Ближний бой"])) as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
  const content = JSON.stringify({
    name: "Тестовый когтистый",
    armorClass: { value: 15, note: "" },
    hitPoints: { diceCount: 6, dieSize: 10, bonus: 18 },
    actions: [
      {
        name: "Мультиатака",
        category: "attack",
        isMultiattack: true,
        description: "Совершает две атаки когтями.",
      },
      { name: "Когти", category: "attack", damage: "1к6+3 рубящий", description: "" },
    ],
    bonusActions: [],
  });
  db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES ('compendium_entry', ?, 'monster', 'dnd_creature', ?, '')`
  ).run(entryId, content);
}, 120000);

describe("systems entries list", () => {
  it("отдаёт combat_roles массивом и DPR из статблока", async () => {
    const res = await request(app).get(`/api/systems/${systemId}/entries?section_id=${sectionId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].combat_roles).toEqual(["Ближний бой"]);
    // 2 × floor(3.5+3) = 12
    expect(res.body[0].dpr).toBe(12);
    expect(res.body[0].dpr_approx).toBe(false);
    // КЗ и хиты из статблока: 6 × 5.5 + 18 = 51
    expect(res.body[0].statblock_ac).toBe("15");
    expect(res.body[0].statblock_hp).toBe("51");
  });
});
