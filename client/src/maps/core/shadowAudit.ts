// Shadow audit pipeline (Фаза 2C, §7–11, §29–36 ТЗ).
// Чистый модуль без React: migrate → validate → equivalence → status.
// V5 — одноразовый derived snapshot, нигде не хранится, ни на что не влияет.

import { migrateLegacyMap, type LegacyMigrationWarning } from "./migrateLegacy";
import type { ParseResult } from "./parse";
import {
  compareLegacySemantics,
  type LegacyAuditInput,
  type SemanticEquivalenceIssue,
} from "./semanticEquivalence";
import type { MapDocumentV5 } from "./types";
import { validateMapDocument, type ValidationIssue } from "./validate";

export type ShadowAuditStatus = "pass" | "warning" | "fail";

export interface ShadowAuditStats {
  terrainCells: number;
  roadCells: number;
  riverCells: number;
  labels: number;
  rooms: number;
  doors: number;
  traps: number;
  markers: number;
  hasStart: boolean;
  hasFinish: boolean;
}

export interface ShadowAuditTiming {
  migrationMs: number;
  validationMs: number;
  equivalenceMs: number;
  totalMs: number;
}

export interface LegacyShadowAuditResult {
  status: ShadowAuditStatus;
  migrationWarnings: LegacyMigrationWarning[];
  validationIssues: ValidationIssue[];
  equivalenceIssues: SemanticEquivalenceIssue[];
  stats: ShadowAuditStats;
  timing: ShadowAuditTiming;
}

function emptyStats(): ShadowAuditStats {
  return {
    terrainCells: 0,
    roadCells: 0,
    riverCells: 0,
    labels: 0,
    rooms: 0,
    doors: 0,
    traps: 0,
    markers: 0,
    hasStart: false,
    hasFinish: false,
  };
}

function collectStats(doc: MapDocumentV5): ShadowAuditStats {
  const stats = emptyStats();
  for (const l of doc.layers) {
    if (l.kind === "terrain" && l.representation === "cells") {
      stats.terrainCells = l.cells.length;
    } else if (l.kind === "path") {
      for (const p of l.paths) {
        if (p.geometry.type !== "cell-network") continue;
        if (p.kind === "road") stats.roadCells += p.geometry.cells.length;
        if (p.kind === "river") stats.riverCells += p.geometry.cells.length;
      }
    } else if (l.kind === "label") {
      stats.labels = l.items.length;
    } else if (l.kind === "gameplay") {
      for (const e of l.items) {
        if (e.kind === "room") stats.rooms++;
        else if (e.kind === "door") stats.doors++;
        else if (e.kind === "trap") stats.traps++;
        else if (e.kind === "marker") stats.markers++;
        else if (e.kind === "start") stats.hasStart = true;
        else if (e.kind === "finish") stats.hasFinish = true;
      }
    }
  }
  return stats;
}

function failResult(
  migrationWarnings: LegacyMigrationWarning[] = [],
  validationIssues: ValidationIssue[] = [],
  equivalenceIssues: SemanticEquivalenceIssue[] = [],
  timing?: ShadowAuditTiming,
): LegacyShadowAuditResult {
  return {
    status: "fail",
    migrationWarnings,
    validationIssues,
    equivalenceIssues,
    stats: emptyStats(),
    timing: timing ?? { migrationMs: 0, validationMs: 0, equivalenceMs: 0, totalMs: 0 },
  };
}

/**
 * Полный shadow audit одной legacy-карты. Не бросает исключений:
 * падение миграции превращается в FAIL-результат (§29 ТЗ).
 * Не чинит документ и не canonicalize'ит invalid (§45 ТЗ).
 */
export function runLegacyShadowAudit(input: LegacyAuditInput): LegacyShadowAuditResult {
  const t0 = performance.now();
  let document: MapDocumentV5;
  let migrationWarnings: LegacyMigrationWarning[];
  try {
    const migrated = migrateLegacyMap({
      grid: input.grid,
      width: input.width,
      height: input.height,
      cells: input.cells,
    });
    document = migrated.document;
    migrationWarnings = migrated.warnings;
  } catch (e) {
    const totalMs = performance.now() - t0;
    return failResult([], [
      {
        code: "migration.threw",
        path: "",
        message: `migrateLegacyMap threw: ${e instanceof Error ? e.message : String(e)}`,
      },
    ], [], { migrationMs: totalMs, validationMs: 0, equivalenceMs: 0, totalMs });
  }
  const t1 = performance.now();
  const validationIssues = validateMapDocument(document);
  const t2 = performance.now();
  // Equivalence имеет смысл только на валидном V5; на invalid — FAIL уже есть,
  // а comparator может дать шум поверх (§45–46: не чинить, не смешивать).
  const equivalenceIssues =
    validationIssues.length === 0 ? compareLegacySemantics(input, document) : [];
  const t3 = performance.now();

  const timing: ShadowAuditTiming = {
    migrationMs: t1 - t0,
    validationMs: t2 - t1,
    equivalenceMs: t3 - t2,
    totalMs: t3 - t0,
  };

  if (validationIssues.length > 0 || equivalenceIssues.length > 0) {
    return {
      status: "fail",
      migrationWarnings,
      validationIssues,
      equivalenceIssues,
      stats: collectStats(document),
      timing,
    };
  }
  return {
    status: migrationWarnings.length > 0 ? "warning" : "pass",
    migrationWarnings,
    validationIssues: [],
    equivalenceIssues: [],
    stats: collectStats(document),
    timing,
  };
}

/** Компактная однострочная сводка для console (§54 ТЗ). Без содержимого карты. */
export function formatShadowAuditSummary(mapId: number | string, result: LegacyShadowAuditResult): string {
  const s = result.stats;
  const entities = s.labels + s.rooms + s.doors + s.traps + s.markers + (s.hasStart ? 1 : 0) + (s.hasFinish ? 1 : 0);
  return (
    `[Map V5 shadow] map ${mapId} ${result.status.toUpperCase()} ` +
    `terrain=${s.terrainCells} roads=${s.roadCells} rivers=${s.riverCells} ` +
    `entities=${entities} warnings=${result.migrationWarnings.length} ` +
    `${result.timing.totalMs.toFixed(1)}ms`
  );
}

export interface LoadedMapAuditArgs extends LegacyAuditInput {
  mapId: number;
  /** cellsBlobStatus(raw) === "corrupt": fallback, не настоящая карта (§6 ТЗ). */
  corrupt: boolean;
}

/**
 * Точка интеграции load-flow (§37 ТЗ): валидный load → audit, corrupt → skip.
 * Возвращает результат локально в вызове (страница его не хранит); null = skipped.
 * Репортинг — только в DEV; сам audit выполняется всегда и ни на что не влияет.
 */
export function auditLoadedMapShadow(args: LoadedMapAuditArgs): LegacyShadowAuditResult | null {
  if (args.corrupt) {
    if (import.meta.env.DEV) {
      console.debug(`[Map V5 shadow] map ${args.mapId} SKIPPED (corrupt blob fallback)`);
    }
    return null;
  }
  const result = runLegacyShadowAudit(args);
  if (import.meta.env.DEV) {
    const summary = formatShadowAuditSummary(args.mapId, result);
    if (result.status === "pass") {
      console.debug(summary);
    } else if (result.status === "warning") {
      console.warn(summary, result.migrationWarnings);
    } else {
      console.error(summary, {
        validationIssues: result.validationIssues,
        equivalenceIssues: result.equivalenceIssues,
      });
    }
  }
  return result;
}

export type { LegacyAuditInput, ParseResult };
