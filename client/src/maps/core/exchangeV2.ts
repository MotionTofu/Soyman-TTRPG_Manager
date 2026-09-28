// soyman-map/2 exchange (ADR-0003 §D.6) + чистый V1-import (§39 ТЗ).
// Отдельно от mapExchange.ts (soyman-map/1 не меняется). UI integration — позже:
// это Core API, существующий import flow редактора не тронут.

import type { GeneratorParams } from "../generate";
import { MAP_MAX_SIDE, MAP_MIN_SIDE, MAP_SCALE_ORDER, type MapGrid, type MapScale } from "../mapTypes";
import { cellsBlobStatus, parseCellsBlob } from "../render";
import { migrateLegacyMap, type LegacyMigrationResult } from "./migrateLegacy";
import type { ParseResult } from "./parse";
import type { MapDocumentV5, SoyMapV2Envelope } from "./types";
import { validateMapDocument, type ValidationIssue } from "./validate";

export interface SoyMapV2Meta {
  name: string;
  scale: MapScale;
  cellLore: string;
}

const NAME_MAX = 200;
const CELL_LORE_MAX = 64;

function metaIssue(field: string, message: string): ValidationIssue {
  return { code: "envelope.bad-metadata", path: field, message };
}

function checkMeta(meta: { name?: unknown; scale?: unknown; cellLore?: unknown }): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (typeof meta.name !== "string" || meta.name.trim().length === 0 || meta.name.length > NAME_MAX) {
    out.push(metaIssue("name", `name must be a non-empty string up to ${NAME_MAX} chars`));
  }
  if (typeof meta.scale !== "string" || !(MAP_SCALE_ORDER as readonly string[]).includes(meta.scale)) {
    out.push(metaIssue("scale", `scale must be one of ${MAP_SCALE_ORDER.join(", ")}`));
  }
  if (typeof meta.cellLore !== "string" || meta.cellLore.length > CELL_LORE_MAX) {
    out.push(metaIssue("cellLore", `cellLore must be a string up to ${CELL_LORE_MAX} chars`));
  }
  return out;
}

export function buildSoyMapV2(meta: SoyMapV2Meta, doc: MapDocumentV5, generator?: GeneratorParams): SoyMapV2Envelope {
  return {
    format: "soyman-map/2",
    name: meta.name,
    scale: meta.scale,
    cellLore: meta.cellLore,
    ...(generator ? { generator } : {}),
    document: doc,
  };
}

function checkGenerator(value: unknown): ValidationIssue[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [metaIssue("generator", "generator must be an object")];
  }
  const generator = value as Record<string, unknown>;
  const bounds = { seed: null, sea: [20, 80], mountains: [0, 40], forest: [0, 60] } as const;
  return Object.entries(bounds).flatMap(([key, range]) => {
    const n = generator[key];
    return typeof n === "number" && Number.isInteger(n) && (!range || (n >= range[0] && n <= range[1]))
      ? []
      : [metaIssue(`generator.${key}`, `invalid generator ${key}`)];
  });
}

export function parseSoyMapV2(raw: unknown): ParseResult<SoyMapV2Envelope> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "envelope.not-object", path: "", message: "envelope must be an object" }] };
  }
  const env = raw as Record<string, unknown>;
  if (env.format !== "soyman-map/2") {
    return {
      ok: false,
      errors: [{ code: "envelope.bad-format", path: "format", message: 'expected format "soyman-map/2"' }],
    };
  }
  const errors: ValidationIssue[] = [
    ...checkMeta({ name: env.name, scale: env.scale, cellLore: env.cellLore }),
    ...checkGenerator(env.generator),
    ...validateMapDocument(env.document).map((i) => ({ ...i, path: `document.${i.path}` })),
  ];
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      format: "soyman-map/2",
      name: env.name as string,
      scale: env.scale as MapScale,
      cellLore: env.cellLore as string,
      ...(env.generator === undefined ? {} : {
        generator: {
          seed: (env.generator as GeneratorParams).seed,
          sea: (env.generator as GeneratorParams).sea,
          mountains: (env.generator as GeneratorParams).mountains,
          forest: (env.generator as GeneratorParams).forest,
        },
      }),
      document: env.document as MapDocumentV5,
    },
  };
}

/** Импорт в существующую карту меняет содержимое, но не её сетку и размер. */
export function checkSoyMapV2ImportTarget(
  doc: MapDocumentV5,
  target: { grid: MapGrid; width: number; height: number },
): string | null {
  const grid = doc.grid;
  if (grid?.type === target.grid && grid.columns === target.width && grid.rows === target.height) return null;
  const incoming = grid ? `${grid.type === "hex" ? "гексы" : "квадраты"} ${grid.columns}×${grid.rows}` : "без сетки";
  return `Файл — ${incoming}, а карта — ${target.width}×${target.height} (${target.grid === "hex" ? "гексы" : "квадраты"}). Размер и сетка должны совпадать.`;
}

// --- V1 import: soyman-map/1 → validated legacy → V5 (без UI) ---

export interface LegacyV1ImportMeta {
  name: string;
  grid: MapGrid;
  scale: MapScale;
  cellLore: string;
  width: number;
  height: number;
  gen: GeneratorParams;
}

export interface LegacyV1Import extends LegacyMigrationResult {
  meta: LegacyV1ImportMeta;
}

const DEFAULT_GEN_FALLBACK: GeneratorParams = { seed: 0, sea: 40, mountains: 0, forest: 0 };

function numIn(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fb;
}

/** Чистая функция импорта V1-конверта в V5 (тестируется изолированно). */
export function importSoyMapV1(
  raw: unknown,
  fallbackGen: GeneratorParams = DEFAULT_GEN_FALLBACK,
): ParseResult<LegacyV1Import> {
  const fail = (code: string, path: string, message: string): ParseResult<LegacyV1Import> => ({
    ok: false,
    errors: [{ code, path, message }],
  });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("envelope.not-object", "", "envelope must be an object");
  }
  const env = raw as Record<string, unknown>;
  if (env.format !== "soyman-map/1") {
    return fail("envelope.bad-format", "format", 'expected format "soyman-map/1"');
  }
  if (env.grid !== "square" && env.grid !== "hex") {
    return fail("envelope.bad-grid", "grid", 'grid must be "square" | "hex"');
  }
  if (
    !Number.isInteger(env.width) ||
    !Number.isInteger(env.height) ||
    (env.width as number) < MAP_MIN_SIDE ||
    (env.width as number) > MAP_MAX_SIDE ||
    (env.height as number) < MAP_MIN_SIDE ||
    (env.height as number) > MAP_MAX_SIDE
  ) {
    return fail("envelope.bad-size", "width", `width/height must be integers ${MAP_MIN_SIDE}..${MAP_MAX_SIDE}`);
  }
  if (typeof env.cells !== "string" || cellsBlobStatus(env.cells) === "corrupt") {
    return fail("envelope.bad-cells", "cells", "cells blob is corrupt");
  }
  const metaErrors = checkMeta({ name: env.name, scale: env.scale, cellLore: env.cell_lore });
  if (metaErrors.length > 0) return { ok: false, errors: metaErrors };

  const width = env.width as number;
  const height = env.height as number;
  const grid = env.grid as MapGrid;
  const parsed = parseCellsBlob(env.cells as string);
  // Bounds-check как в mapExchange.validateMapImport (без target — размеры из конверта).
  const inB = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const keyIn = (k: string) => {
    const m = /^(\d+),(\d+)$/.exec(k);
    return !!m && inB(Number(m[1]), Number(m[2]));
  };
  for (const k of [...parsed.terrain.keys(), ...parsed.roads, ...parsed.rivers]) {
    if (!keyIn(k)) return fail("envelope.cell-out-of-bounds", "cells", `cell ${k} outside ${width}x${height}`);
  }
  for (const l of parsed.labels) if (!inB(l.x, l.y)) return fail("envelope.cell-out-of-bounds", "cells.labels", "label outside field");
  for (const r of parsed.rooms)
    if (!inB(r.x, r.y) || !inB(r.x + r.w - 1, r.y + r.h - 1))
      return fail("envelope.cell-out-of-bounds", "cells.rooms", "room outside field");
  for (const d of [...parsed.doors, ...parsed.traps]) if (!inB(d.x, d.y)) return fail("envelope.cell-out-of-bounds", "cells", "object outside field");
  for (const m of parsed.markers) if (!inB(m.x, m.y)) return fail("envelope.cell-out-of-bounds", "cells.markers", "marker outside field");
  if ((parsed.start && !inB(parsed.start.x, parsed.start.y)) || (parsed.finish && !inB(parsed.finish.x, parsed.finish.y)))
    return fail("envelope.cell-out-of-bounds", "cells", "start/finish outside field");

  const migration = migrateLegacyMap({ grid, width, height, cells: parsed });
  return {
    ok: true,
    value: {
      ...migration,
      meta: {
        name: env.name as string,
        grid,
        scale: env.scale as MapScale,
        cellLore: env.cell_lore as string,
        width,
        height,
        gen: {
          seed: typeof env.seed === "number" && Number.isInteger(env.seed) ? (env.seed as number) : fallbackGen.seed,
          sea: numIn(env.sea, 20, 80, fallbackGen.sea),
          mountains: numIn(env.mountains, 0, 40, fallbackGen.mountains),
          forest: numIn(env.forest, 0, 60, fallbackGen.forest),
        },
      },
    },
  };
}
