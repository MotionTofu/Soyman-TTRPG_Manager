import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { resourcesRouter } from "./resources";
import { statblocksRouter } from "./statblocks";
import { buildSystemExportData, importSystemExport, systemsRouter, updateSystemFromExport, type SystemExportData } from "./systems";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, { user: { id: 1, username: "template-retirement", role: "gm", playerId: null, isAdmin: false } });
  next();
});
app.use("/resources", resourcesRouter);
app.use("/statblocks", statblocksRouter);
app.use("/systems", systemsRouter);

beforeAll(() => {
  db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'template-retirement', 'test-only', 'gm')").run();
});

describe("retired statblock templates", () => {
  it("rejects old template writes while ordinary resources remain editable", async () => {
    const retired = await request(app).post("/resources").field("name", "Old template").field("scope", "global").field("type", "statblock_template");
    expect(retired.status).toBe(410);
    const ordinary = await request(app).post("/resources").field("name", "Normal note").field("scope", "global").field("type", "note");
    expect(ordinary.status).toBe(201);
    expect((await request(app).put(`/resources/${ordinary.body.id}`).send({ type: "statblock_template" })).status).toBe(410);
    expect((await request(app).put(`/resources/${ordinary.body.id}`).send({ notes: "Saved normally" })).status).toBe(200);
    expect(db.prepare("SELECT notes, type FROM resources WHERE id = ?").get(ordinary.body.id)).toEqual({ notes: "Saved normally", type: "note" });
  });

  it("does not expose legacy rows in the resource catalog", async () => {
    const id = Number(db.prepare("INSERT INTO resources (name, type, scope) VALUES ('Legacy row', 'statblock_template', 'global')").run().lastInsertRowid);
    try {
      expect((await request(app).get("/resources?type=statblock_template")).body).toEqual([]);
      expect((await request(app).get("/resources")).body.some((row: { id: number }) => row.id === id)).toBe(false);
    } finally { db.prepare("DELETE FROM resources WHERE id = ?").run(id); }
  });

  it("imports and updates real sheets and progression tables without reviving legacy templates", async () => {
    const progression = { columns: [{ key: "l", label: "Уровень" }], rows: [{ l: "1" }, { l: "2" }] };
    const source: SystemExportData = {
      system: { name: "Retirement roundtrip", description: "" },
      sections: [{ id: 1, position: 0, name: "Классы", kind: "classes" }],
      entries: [{ id: 1, section_id: 1, parent_id: null, kind: "class", name: "Следопыт", level: null, data: { progression }, description: "", position: 0,
        statblocks: [{ kind: "full", format: "dnd_character", content: JSON.stringify({ characterName: "Тестовый лист" }), note: "", theme: null, density: null }] }],
      templates: [{ name: "Шаблон для таблицы развития", template_kind: "full", template_format: "text", tags: "", notes: "old table" }],
    };
    const id = await importSystemExport(source);
    const countTemplates = () => (db.prepare("SELECT COUNT(*) n FROM resources WHERE type = 'statblock_template'").get() as { n: number }).n;
    expect(countTemplates()).toBe(0);
    const exported = buildSystemExportData(id, false)!;
    expect(exported.templates).toEqual([]);
    expect(exported.entries[0].data).toMatchObject({ progression });
    expect(exported.entries[0].statblocks?.[0].content).toContain("Тестовый лист");
    const result = await updateSystemFromExport(id, source);
    expect(result.templatesAdded).toBe(0);
    expect(result.templatesUpdated).toBe(0);
    expect(countTemplates()).toBe(0);
    expect(buildSystemExportData(id, false)?.entries[0].data).toMatchObject({ progression });
  });

  it("creates normal structured statblocks without a resource template", async () => {
    const id = Number(db.prepare("INSERT INTO systems (name) VALUES ('Sheet creation')").run().lastInsertRowid);
    const section = Number(db.prepare("INSERT INTO system_sections (system_id, name, kind) VALUES (?, 'Бестиарий', 'bestiary')").run(id).lastInsertRowid);
    const entry = Number(db.prepare("INSERT INTO compendium_entries (system_id, section_id, kind, name) VALUES (?, ?, 'monster', 'Тестовый зверь')").run(id, section).lastInsertRowid);
    const content = JSON.stringify({ name: "Тестовый зверь", armorClass: { value: 12 }, hitPoints: { diceCount: 2, dieSize: 8, bonus: 0 }, actions: [] });
    const created = await request(app).post("/statblocks").send({ owner_type: "compendium_entry", owner_id: entry, format: "dnd_creature", content });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe("full");
    expect(created.body.content).toBe(content);
  });

  it("does not seed resource templates when creating a D&D system", async () => {
    const created = await request(app).post("/systems").send({ name: "D&D without resource templates", template: "dnd" });
    expect(created.status).toBe(201);
    expect((db.prepare("SELECT COUNT(*) n FROM resources WHERE system_id = ? AND type = 'statblock_template'").get(created.body.id) as { n: number }).n).toBe(0);
  });
});
