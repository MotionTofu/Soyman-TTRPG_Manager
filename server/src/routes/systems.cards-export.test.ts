import { describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import path from "path";
import request from "supertest";
import { db } from "../db/db";
import { modulesRouter } from "./modules";
import { buildSystemExportData, importSystemExport } from "./systems";

describe("system card export and import", () => {
  it("embeds a class card and restores it into the Cards folder", async () => {
    const sourceName = "Card roundtrip source";
    const sourceFolder = path.join("Systems", sourceName);
    const systemId = Number(
      db
        .prepare("INSERT INTO systems (name, description, folder_path) VALUES (?, '', ?)")
        .run(sourceName, sourceFolder).lastInsertRowid
    );
    const sectionId = Number(
      db
        .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, 'Классы', 'classes')")
        .run(systemId).lastInsertRowid
    );
    const entryId = Number(
      db
        .prepare(
          `INSERT INTO compendium_entries
             (system_id, section_id, kind, name, level, data, description, position)
           VALUES (?, ?, 'class', 'Следопыт', NULL, '{}', '', 0)`
        )
        .run(systemId, sectionId).lastInsertRowid
    );

    const originalBytes = Buffer.from("card-image-roundtrip");
    const storedPath = path.join(sourceFolder, "Cards", `entry-${entryId}-avatar.webp`);
    const absolutePath = path.join(process.env.VAULT_ROOT as string, storedPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, originalBytes);
    db.prepare("UPDATE compendium_entries SET avatar_image_path = ? WHERE id = ?").run(storedPath, entryId);

    const exported = buildSystemExportData(systemId, true);
    expect(exported?.entries[0]?.avatar_data?.base64).toBe(originalBytes.toString("base64"));

    const importedSystemId = await importSystemExport(exported!);
    const restored = db
      .prepare("SELECT avatar_image_path FROM compendium_entries WHERE system_id = ? AND name = 'Следопыт'")
      .get(importedSystemId) as { avatar_image_path: string };

    expect(restored.avatar_image_path.replaceAll("\\", "/")).toContain("/Cards/");
    expect(fs.readFileSync(path.join(process.env.VAULT_ROOT as string, restored.avatar_image_path))).toEqual(originalBytes);
  });

  it("installs a system export with a Dragonborn lineage and keeps its species and resistance", async () => {
    const sourceId = Number(db.prepare("INSERT INTO systems (name) VALUES (?)")
      .run("Dragonborn export source").lastInsertRowid);
    const sectionId = Number(db.prepare(
      "INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, 'Виды', 'species')"
    ).run(sourceId).lastInsertRowid);
    const insertEntry = db.prepare(
      "INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, data) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const speciesId = Number(insertEntry.run(sourceId, sectionId, null, "species", "Драконорождённый", "{}").lastInsertRowid);
    const data = { effects: [{ id: "lineage-resist", type: "resistance", when: "always", damageType: { id: 0, name: "Огненный" } }] };
    insertEntry.run(sourceId, sectionId, speciesId, "lineage", "Красный дракон", JSON.stringify(data));

    const app = express();
    app.use("/api/modules", modulesRouter);
    const installed = await request(app)
      .post("/api/modules/import-file?install=system")
      .attach("file", Buffer.from(JSON.stringify(buildSystemExportData(sourceId, false))), "dragonborn.json");
    expect(installed.status, JSON.stringify(installed.body)).toBe(201);
    expect(installed.body.system_id).not.toBe(sourceId);
    const entries = db.prepare(
      "SELECT id, parent_id, kind, data FROM compendium_entries WHERE system_id = ? AND kind IN ('species', 'lineage')"
    ).all(installed.body.system_id) as { id: number; parent_id: number | null; kind: string; data: string }[];
    const species = entries.find((entry) => entry.kind === "species");
    const lineage = entries.find((entry) => entry.kind === "lineage");
    expect(species?.id).toEqual(expect.any(Number));
    expect(lineage?.parent_id).toBe(species?.id);
    expect(JSON.parse(lineage!.data)).toEqual(data);
  });
});
