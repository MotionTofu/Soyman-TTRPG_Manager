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

export interface LoadedEditorDocument {
  document: MapDocumentV5;
  sourceFormat: "legacy" | "v5";
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
  return {
    document,
    sourceFormat,
    corrupt,
    compatibility: assessCurrentEditorCompatibility(document),
    migrationWarnings,
  };
}

/**
 * Нормализовать хранимый blob в editor document. Не бросает исключений:
 * любая беда → corrupt fallback (пустой документ на мета-сетке).
 */
export function loadStoredEditorDocument(stored: StoredMapInput): LoadedEditorDocument {
  const { cells, grid, width, height } = stored;
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
