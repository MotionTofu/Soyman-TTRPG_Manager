import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
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
});
