// Круг «выгрузка → разворот» для весов локаций (план «Зоны локаций»,
// этап 9): role, наполнение и origin едут в файле и пересчитываются.
// Временная база И временное хранилище (DB_DIR и VAULT_ROOT выставляются ДО
// импорта модулей — у них побочный эффект открытия базы): живая база и
// живое хранилище не затрагиваются никак.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let db: {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { lastInsertRowid: number | bigint };
    all: (...args: unknown[]) => Record<string, unknown>[];
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
  };
  exec: (sql: string) => void;
};
let buildSettingExportData: (id: number | string, include: string[]) => {
  locations: {
    id: number;
    name: string;
    role?: string;
    origin_location_id?: number | null;
    content?: { kind: string; text: string }[];
  }[];
} | null;
let importSettingExport: (body: unknown) => Promise<number>;
let updateSettingFromExport: (targetId: number, body: unknown) => Promise<{ locationsUpdated: number }>;

let srcSettingId = 0;
let oldRoomId = 0;

beforeAll(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zones-roundtrip-"));
  process.env.DB_DIR = path.join(tmpRoot, "db");
  process.env.VAULT_ROOT = path.join(tmpRoot, "vault");
  ({ db } = await import("../db/db"));
  ({ buildSettingExportData, importSettingExport, updateSettingFromExport } =
    await import("./settings"));

  // Источник: город (место) → район (сектор) → две комнаты (точки) +
  // поместье (место) с origin на комнату.
  const s = db
    .prepare("INSERT INTO settings (name, description, folder_path, calendar_era) VALUES (?,?,?,?)")
    .run("Тестоленд", "", "TestExport", "");
  srcSettingId = Number(s.lastInsertRowid);
  const ins = db.prepare(
    "INSERT INTO setting_locations (setting_id, parent_id, name, kind, role, description, folder_path) VALUES (?,?,?,?,?,?,?)"
  );
  const city = Number(
    ins.run(srcSettingId, null, "Тестоград", "город", "location", "", "TestExport/География/Тестоград")
      .lastInsertRowid
  );
  const district = Number(
    ins.run(srcSettingId, city, "Северный", "район", "sector", "", "TestExport/География/Тестоград/Северный")
      .lastInsertRowid
  );
  oldRoomId = Number(
    ins.run(srcSettingId, district, "Караулка", "комната", "spot", "пахнет псиной", null).lastInsertRowid
  );
  ins.run(srcSettingId, district, "Зал эха", "зал", "spot", "", null);
  const manor = Number(
    ins.run(srcSettingId, district, "Поместье", "", "location", "", "TestExport/География/Тестоград/Северный/Поместье")
      .lastInsertRowid
  );
  db.prepare("UPDATE setting_locations SET origin_location_id = ? WHERE id = ?").run(oldRoomId, manor);
  const insContent = db.prepare("INSERT INTO location_content (location_id, kind, text) VALUES (?,?,?)");
  insContent.run(oldRoomId, "secret", "тайник под плитой");
  insContent.run(oldRoomId, "loot", "сундук");
}, 120000);

describe("zones export/import round-trip", () => {
  it("выгрузка несёт role, наполнение и origin", () => {
    const payload = buildSettingExportData(srcSettingId, []);
    expect(payload).not.toBeNull();
    const byName = new Map(payload!.locations.map((l) => [l.name, l]));
    expect(byName.get("Тестоград")!.role).toBe("location");
    expect(byName.get("Северный")!.role).toBe("sector");
    expect(byName.get("Караулка")!.role).toBe("spot");
    expect(byName.get("Караулка")!.content).toEqual([
      { kind: "secret", text: "тайник под плитой" },
      { kind: "loot", text: "сундук" },
    ]);
    expect(byName.get("Зал эха")!.content).toBeUndefined();
    expect(byName.get("Поместье")!.origin_location_id).toBe(oldRoomId);
  });

  let newSettingId = 0;

  it("разворот: роли, наполнение, пересчёт origin, точки без папок", async () => {
    const payload = buildSettingExportData(srcSettingId, []);
    newSettingId = await importSettingExport(payload);
    const rows = db
      .prepare(
        "SELECT id, parent_id, name, role, folder_path, origin_location_id FROM setting_locations WHERE setting_id = ?"
      )
      .all(newSettingId) as {
      id: number;
      parent_id: number | null;
      name: string;
      role: string;
      folder_path: string | null;
      origin_location_id: number | null;
    }[];
    expect(rows).toHaveLength(5);
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("Тестоград")!.role).toBe("location");
    expect(byName.get("Северный")!.role).toBe("sector");
    const room = byName.get("Караулка")!;
    expect(room.role).toBe("spot");
    // Точка папки не получила, район и город — получили.
    expect(room.folder_path).toBeNull();
    expect(byName.get("Северный")!.folder_path).not.toBeNull();
    expect(byName.get("Тестоград")!.folder_path).not.toBeNull();
    // Дерево пересчитано на новые id.
    expect(byName.get("Северный")!.parent_id).toBe(byName.get("Тестоград")!.id);
    expect(room.parent_id).toBe(byName.get("Северный")!.id);
    // Наполнение приехало за точкой.
    const content = db
      .prepare("SELECT kind, text FROM location_content WHERE location_id = ? ORDER BY id")
      .all(room.id) as { kind: string; text: string }[];
    expect(content).toEqual([
      { kind: "secret", text: "тайник под плитой" },
      { kind: "loot", text: "сундук" },
    ]);
    // Origin пересчитан на НОВУЮ комнату, а не сырой id из файла.
    const manor = byName.get("Поместье")!;
    expect(manor.origin_location_id).not.toBe(oldRoomId);
    expect(manor.origin_location_id).toBe(room.id);
  });

  it("merge: обновление без дублей наполнения, origin жив", async () => {
    const payload = buildSettingExportData(srcSettingId, []);
    const summary = await updateSettingFromExport(newSettingId, payload);
    expect(summary.locationsUpdated).toBe(5);
    const room = db
      .prepare("SELECT id FROM setting_locations WHERE setting_id = ? AND name = ?")
      .get(newSettingId, "Караулка") as { id: number };
    const content = db
      .prepare("SELECT kind, text FROM location_content WHERE location_id = ? ORDER BY id")
      .all(room.id) as { kind: string; text: string }[];
    expect(content).toHaveLength(2);
    const manor = db
      .prepare("SELECT id, origin_location_id FROM setting_locations WHERE setting_id = ? AND name = ?")
      .get(newSettingId, "Поместье") as { id: number; origin_location_id: number };
    expect(manor.origin_location_id).toBe(room.id);
  });
});
