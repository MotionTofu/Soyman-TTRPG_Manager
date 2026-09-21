// Exchange V2 tests (§54 ТЗ): build/parse/roundtrip/invalid + V1 import.

import { describe, expect, it } from "vitest";
import { buildMapExport } from "../mapExchange";
import { serializeCells } from "../render";
import {
  buildSoyMapV2,
  importSoyMapV1,
  parseSoyMapV2,
} from "./exchangeV2";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import { serializeMapDocument } from "./serialize";
import type { MapDocumentV5 } from "./types";
import { validateMapDocument } from "./validate";

function doc8(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

const META = { name: "Тестовая", scale: "locality" as const, cellLore: "5 м" };

describe("soyman-map/2", () => {
  it("build → parse → roundtrip", () => {
    const doc = doc8();
    const env = buildSoyMapV2(META, doc);
    expect(env.format).toBe("soyman-map/2");
    const parsed = parseSoyMapV2(JSON.parse(JSON.stringify(env)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeMapDocument(parsed.value.document)).toBe(serializeMapDocument(doc));
    expect(validateMapDocument(parsed.value.document)).toEqual([]);
  });

  it("invalid format", () => {
    const r = parseSoyMapV2({ format: "soyman-map/1" });
    expect(r.ok).toBe(false);
  });

  it("invalid document (битые двери)", () => {
    const doc = structuredClone(doc8());
    const g = doc.layers.find((l) => l.id === "lyr-gameplay");
    if (g && g.kind === "gameplay") {
      const door = g.items.find((e) => e.kind === "door");
      if (door && door.kind === "door") door.pairedDoorId = "ghost";
    }
    const r = parseSoyMapV2(buildSoyMapV2(META, doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path.startsWith("document."))).toBe(true);
  });

  it("invalid metadata (пустое имя, плохой scale, длинный cellLore)", () => {
    const doc = doc8();
    expect(parseSoyMapV2({ format: "soyman-map/2", name: "", scale: "locality", cellLore: "", document: doc }).ok).toBe(false);
    expect(
      parseSoyMapV2({ format: "soyman-map/2", name: "x", scale: "galaxy", cellLore: "", document: doc }).ok,
    ).toBe(false);
    expect(
      parseSoyMapV2({ format: "soyman-map/2", name: "x", scale: "locality", cellLore: "y".repeat(65), document: doc }).ok,
    ).toBe(false);
  });

  it("не объект — ошибка, не исключение", () => {
    expect(parseSoyMapV2(null).ok).toBe(false);
    expect(parseSoyMapV2("str").ok).toBe(false);
  });
});

describe("importSoyMapV1", () => {
  function v1Envelope() {
    const cells = parseFixture(FIXTURES.fullV4Square);
    return buildMapExport(
      { name: "Импорт", grid: "square", scale: "locality", cell_lore: "5 м", width: 8, height: 8 },
      { seed: 42, sea: 55, mountains: 12, forest: 30 },
      cells,
    );
  }

  it("V1 конверт → V5 документ + meta + gen", () => {
    const r = importSoyMapV1(JSON.parse(JSON.stringify(v1Envelope())));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.meta.name).toBe("Импорт");
    expect(r.value.meta.grid).toBe("square");
    expect(r.value.meta.width).toBe(8);
    expect(r.value.meta.gen).toEqual({ seed: 42, sea: 55, mountains: 12, forest: 30 });
    expect(validateMapDocument(r.value.document)).toEqual([]);
    // Тот же результат, что прямая миграция.
    const direct = serializeMapDocument(
      migrateLegacyMap({ grid: "square", width: 8, height: 8, cells: parseFixture(FIXTURES.fullV4Square) }).document,
    );
    expect(serializeMapDocument(r.value.document)).toBe(direct);
  });

  it("битые cells → ошибка", () => {
    expect(importSoyMapV1({ format: "soyman-map/1", grid: "square", width: 8, height: 8, cells: "garbage" }).ok).toBe(false);
  });

  it("чужой формат / сетка / размер → ошибка", () => {
    expect(importSoyMapV1({ format: "soyman-map/2" }).ok).toBe(false);
    expect(importSoyMapV1({ format: "soyman-map/1", grid: "tri", width: 8, height: 8, cells: serializeCells(parseFixture(FIXTURES.emptyV1)) }).ok).toBe(
      false,
    );
    expect(importSoyMapV1({ format: "soyman-map/1", grid: "square", width: 5, height: 8, cells: "{}" }).ok).toBe(false);
  });

  it("клетка снаружи поля → ошибка", () => {
    const bad = { ...v1Envelope(), cells: JSON.stringify({ v: 4, cells: { "99,0": "forest" }, roads: [] }) };
    expect(importSoyMapV1(bad).ok).toBe(false);
  });
});
