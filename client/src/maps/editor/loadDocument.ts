// Version-aware load normalization (Фаза 2G, §10–12).
// Единственная точка входа загрузки в editor state:
//   legacy blob → parse → migrate → validate → compatibility
//   V5         → parse → validate → compatibility
// Результат — MapDocumentV5 + диагноз. Не пишет в БД (§13 ТЗ):
// legacy мигрируется в памяти, персист — лениво первым edit'ом.
// Чистый модуль без React (тестируется напрямую, §82 ТЗ).

import type { MapGrid } from "../mapTypes";
import { parseCellsBlob, cellsBlobStatus } from "../render";
import { assessCurrentEditorCompatibility, type EditorCompatibility } from "../core/compatibility";
import { migrateLegacyMap, type LegacyMigrationWarning } from "../core/migrateLegacy";
import { parseMapDocument } from "../core/parse";
import type { MapDocumentV5 } from "../core/types";
import { validateMapDocument } from "../core/validate";
import { parseStoredMapDocument, upgradeMapDocumentV5, parseMapDocumentV6, type MapDocumentV6 } from "@shared/maps/core";

export interface LoadedEditorDocument {
  document: MapDocumentV5;
  sourceFormat: "legacy" | "v5" | "unsupported";
  status: "supported" | "unsupported" | "corrupt";
  /** Kept separately from a display-only fallback. Never serialize fallback over this. */
  raw: string;
  /** Corrupt legacy / invalid V5: display fallback, autosave blocked. */
  corrupt: boolean;
  compatibility: EditorCompatibility;
  migrationWarnings: LegacyMigrationWarning[];
}

export interface StoredMapInput {
  cells: string;
  grid: MapGrid;
  width: number;
  height: number;
}

/** Пустой canonical документ на сетке W×H (fallback + база clear). */
function emptyGridDocument(grid: MapGrid, width: number, height: number): MapDocumentV5 {
  return migrateLegacyMap({
    grid,
    width,
    height,
    cells: parseCellsBlob(JSON.stringify({ v: 1, cells: {}, roads: [] })),
  }).document;
}

function withCompatibility(
  document: MapDocumentV5,
  sourceFormat: "legacy" | "v5",
  corrupt: boolean,
  migrationWarnings: LegacyMigrationWarning[],
): LoadedEditorDocument {
  const compatibility = assessCurrentEditorCompatibility(document);
  return {
    document,
    sourceFormat,
    status: corrupt ? "corrupt" : compatibility.compatible ? "supported" : "unsupported",
    raw: "",
    corrupt,
    compatibility,
    migrationWarnings,
  };
}

/**
 * Нормализовать хранимый blob в editor document. Не бросает исключений:
 * любая беда → corrupt fallback (пустой документ на мета-сетке).
 */
export function loadStoredEditorDocument(stored: StoredMapInput): LoadedEditorDocument {
  const result = loadV5EditorDocument(stored);
  return { ...result, raw: stored.cells };
}

function unsupportedDocument(stored: StoredMapInput, message: string): LoadedEditorDocument {
  return { document: emptyGridDocument(stored.grid, stored.width, stored.height), sourceFormat: "unsupported",
    status: "unsupported", raw: stored.cells, corrupt: false, migrationWarnings: [],
    compatibility: { compatible: false, reasons: [{ code: "map-version-unsupported", message }] } };
}

function loadV5EditorDocument(stored: StoredMapInput): LoadedEditorDocument {
  const { cells, grid, width, height } = stored;
  const version = parseStoredMapDocument(cells);
  if (version.format === "v6" || version.format === "unsupported") {
    return unsupportedDocument(stored, "Требуется редактор, поддерживающий версию этого документа.");
  }
  let parsed: unknown = null;
  let parsedOk = false;
  try {
    parsed = JSON.parse(cells);
    parsedOk = true;
  } catch {
    // не JSON — corrupt legacy ниже
  }
  if (parsedOk && typeof parsed === "object" && parsed !== null && (parsed as { v?: unknown }).v === 5) {
    // V5 load напрямую, без legacy (§12, §77 ТЗ).
    const result = parseMapDocument(parsed);
    if (result.ok) {
      return withCompatibility(result.value, "v5", false, []);
    }
    if (result.errors.some((e) => e.code.includes("unknown") || e.code === "version.invalid")) {
      return unsupportedDocument(stored, "Неизвестная функция документа; исходные данные сохранены.");
    }
    return withCompatibility(emptyGridDocument(grid, width, height), "v5", true, []);
  }
  if (cellsBlobStatus(cells) === "corrupt") {
    return withCompatibility(emptyGridDocument(grid, width, height), "legacy", true, []);
  }
  // Legacy load: parse → migrate → validate (§11 ТЗ).
  const legacy = parseCellsBlob(cells);
  const migrated = migrateLegacyMap({ grid, width, height, cells: legacy });
  if (validateMapDocument(migrated.document).length > 0) {
    return withCompatibility(emptyGridDocument(grid, width, height), "legacy", true, []);
  }
  return withCompatibility(migrated.document, "legacy", false, migrated.warnings);
}

/** New workspace reader. An upgrade is in memory only, with no write-on-load. */
export type LoadedWorkspaceDocument =
  | { status: "supported"; sourceFormat: "legacy" | "v5" | "v6"; raw: string; document: MapDocumentV6 }
  | { status: "unsupported" | "corrupt"; raw: string; document: null };
export function loadStoredWorkspaceDocument(stored: StoredMapInput): LoadedWorkspaceDocument {
  const detected = parseStoredMapDocument(stored.cells);
  if (detected.format === "unsupported") return { status: "unsupported", raw: stored.cells, document: null };
  if (detected.format === "v6") {
    const parsed = parseMapDocumentV6(stored.cells);
    if (!parsed.ok) return { status: parsed.errors.some((e) => e.code.includes("unknown") || e.code.includes("unsupported")) ? "unsupported" : "corrupt", raw: stored.cells, document: null };
    return { status: "supported", sourceFormat: "v6", raw: stored.cells, document: parsed.value };
  }
  if (detected.format === "v5") {
    const parsed = parseMapDocument(stored.cells);
    if (!parsed.ok) return { status: parsed.errors.some((e) => e.code.includes("unknown")) ? "unsupported" : "corrupt", raw: stored.cells, document: null };
    return { status: "supported", sourceFormat: "v5", raw: stored.cells, document: upgradeMapDocumentV5(parsed.value) };
  }
  const loaded = loadStoredEditorDocument(stored);
  if (loaded.status !== "supported" || loaded.sourceFormat === "unsupported") return { status: loaded.status === "supported" ? "unsupported" : loaded.status, raw: stored.cells, document: null };
  return { status: "supported", sourceFormat: loaded.sourceFormat, raw: stored.cells, document: upgradeMapDocumentV5(loaded.document) };
}
