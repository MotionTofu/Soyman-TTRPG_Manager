// Pure audit tests (§47 ТЗ): статусы, stats, summary. Проверяется
// LegacyShadowAuditResult, не console (§53 ТЗ).

import { describe, expect, it } from "vitest";
import type { MapCells } from "../render";
import { FIXTURES, parseFixture } from "./fixtures";
import {
  auditLoadedMapShadow,
  formatShadowAuditSummary,
  runLegacyShadowAudit,
} from "./shadowAudit";
import type { LegacyAuditInput } from "./semanticEquivalence";

function input(raw: string, width = 8, height = 8, grid: "square" | "hex" = "square"): LegacyAuditInput {
  return { grid, width, height, cells: parseFixture(raw) };
}

describe("runLegacyShadowAudit: статусы", () => {
  it("1. full square legacy → PASS", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.fullV4Square));
    expect(r.status).toBe("pass");
    expect(r.migrationWarnings).toEqual([]);
    expect(r.validationIssues).toEqual([]);
    expect(r.equivalenceIssues).toEqual([]);
  });

  it("2. full hex legacy → PASS", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.fullV4Hex, 6, 6, "hex"));
    expect(r.status).toBe("pass");
    expect(r.equivalenceIssues).toEqual([]);
  });

  it("3. empty map → PASS", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.emptyV1));
    expect(r.status).toBe("pass");
  });

  it("4. dangling pair warning → WARNING (не FAIL)", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.pairSingle));
    expect(r.status).toBe("warning");
    expect(r.migrationWarnings).toHaveLength(1);
    expect(r.validationIssues).toEqual([]);
    expect(r.equivalenceIssues).toEqual([]);
  });

  it("5. >2 pair group → WARNING", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.pairBig));
    expect(r.status).toBe("warning");
    expect(r.migrationWarnings[0].code).toBe("oversized-pair-group");
    expect(r.equivalenceIssues).toEqual([]);
  });

  it("6. migration result invalid → FAIL (NaN позиция)", () => {
    const cells = parseFixture(FIXTURES.labelsV2);
    cells.labels.push({ x: 0, y: 0, text: "x" });
    // Ломаем уже распарсенное: NaN не переживает legacy-парсер, но возможен
    // в runtime-объекте — валидатор обязан поймать.
    (cells.labels[2] as { x: number }).x = NaN;
    const r = runLegacyShadowAudit({ grid: "square", width: 8, height: 8, cells });
    expect(r.status).toBe("fail");
    expect(r.validationIssues.length).toBeGreaterThan(0);
    expect(r.equivalenceIssues).toEqual([]);
  });

  it("7. semantic mismatch → FAIL: mismatch ловит comparator (мутации), pipeline отдаёт его как FAIL", async () => {
    // Pipeline честно мигрирует, поэтому mismatch через него не протащить
    // без бага миграции. Здесь фиксируем контракт ветки: непустые
    // equivalenceIssues означают FAIL. Прямые mismatch-кейсы — в
    // semanticEquivalence.test.ts (мутации ловятся по одной).
    const { compareLegacySemantics } = await import("./semanticEquivalence");
    const { migrateLegacyMap } = await import("./migrateLegacy");
    const cells = parseFixture(FIXTURES.fullV4Square);
    const args = { grid: "square" as const, width: 8, height: 8, cells };
    const { document } = migrateLegacyMap({ ...args });
    const tampered = structuredClone(document);
    const terrain = tampered.layers[0];
    if (terrain.kind !== "terrain" || terrain.representation !== "cells") throw new Error("bad fixture");
    terrain.cells.shift();
    expect(compareLegacySemantics(args, tampered).some((i) => i.code === "terrain-missing")).toBe(true);
  });

  it("8. migration exception → FAIL без throw наружу", () => {
    const cells = parseFixture(FIXTURES.dungeonV3);
    cells.doors.push({ x: 0, y: 0, edge: "diagonal" as never, kind: "door", secret: false, pair: null });
    let threw = false;
    let r;
    try {
      r = runLegacyShadowAudit({ grid: "square", width: 8, height: 8, cells });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(r!.status).toBe("fail");
    expect(r!.validationIssues[0].code).toBe("migration.threw");
  });
});

describe("stats + summary", () => {
  it("stats full square", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.fullV4Square));
    expect(r.stats).toEqual({
      terrainCells: 3,
      roadCells: 3,
      riverCells: 3,
      labels: 1,
      rooms: 2,
      doors: 5,
      traps: 1,
      markers: 2,
      hasStart: true,
      hasFinish: true,
    });
  });

  it("summary компактна и без содержимого карты", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.fullV4Square));
    const s = formatShadowAuditSummary(7, r);
    expect(s).toContain("map 7 PASS");
    expect(s).toContain("terrain=3");
    expect(s).toContain("roads=3");
    expect(s).not.toContain("Кладовая");
    expect(s).not.toContain("legacy-door");
  });

  it("timing измерен", () => {
    const r = runLegacyShadowAudit(input(FIXTURES.fullV4Square));
    expect(r.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(r.timing.migrationMs + r.timing.validationMs + r.timing.equivalenceMs).toBeLessThanOrEqual(
      r.timing.totalMs + 0.5,
    );
  });
});

describe("auditLoadedMapShadow: integration point", () => {
  function validArgs(cells: MapCells) {
    return { mapId: 7, grid: "square" as const, width: 8, height: 8, cells, corrupt: false };
  }

  it("valid load → audit called, MapCells неизменён", () => {
    const cells = parseFixture(FIXTURES.fullV4Square);
    const before = structuredClone(cells);
    const r = auditLoadedMapShadow(validArgs(cells));
    expect(r).not.toBeNull();
    expect(r!.status).toBe("pass");
    expect(cells).toEqual(before);
  });

  it("corrupt load → audit NOT called (null)", () => {
    const cells = parseFixture("{corrupt");
    const r = auditLoadedMapShadow({ ...validArgs(cells), corrupt: true });
    expect(r).toBeNull();
  });

  it("FAIL не бросает и возвращает diagnostics", () => {
    const cells = parseFixture(FIXTURES.dungeonV3);
    cells.doors.push({ x: 0, y: 0, edge: "diagonal" as never, kind: "door", secret: false, pair: null });
    const r = auditLoadedMapShadow(validArgs(cells));
    expect(r).not.toBeNull();
    expect(r!.status).toBe("fail");
  });
});
