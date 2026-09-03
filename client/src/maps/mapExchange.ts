// Обмен JSON выгрузка/загрузка (C7: вынесено из MapEditorPage — чистые функции;
// компонент держит FileReader, состояние и историю).

import { parseKey } from "./grid";
import type { GeneratorParams } from "./generate";
import { cellsBlobStatus, parseCellsBlob, serializeCells, type MapCells } from "./render";
import type { MapGrid, MapScale } from "./mapTypes";

export interface MapExportDoc {
  format: "soyman-map/1";
  name: string;
  grid: MapGrid;
  scale: MapScale;
  cell_lore: string;
  width: number;
  height: number;
  seed: number;
  sea: number;
  mountains: number;
  forest: number;
  cells: string;
}

export function buildMapExport(
  meta: { name: string; grid: MapGrid; scale: MapScale; cell_lore: string; width: number; height: number },
  gen: GeneratorParams,
  cells: MapCells
): MapExportDoc {
  return {
    format: "soyman-map/1",
    name: meta.name,
    grid: meta.grid,
    scale: meta.scale,
    cell_lore: meta.cell_lore,
    width: meta.width,
    height: meta.height,
    seed: gen.seed,
    sea: gen.sea,
    mountains: gen.mountains,
    forest: gen.forest,
    cells: serializeCells(cells),
  };
}

// То же санитизирование имён, что у PNG: слэши/точки/контрольные ломают download.
export function sanitizeDownloadName(name: string): string {
  return (
    (name.trim() || "map").replace(/[\\/:*?"<>|]/g, "_").replace(/[\u0000-\u001f]/g, "").slice(0, 100) || "map"
  );
}

export interface MapImportTarget {
  grid: MapGrid;
  width: number;
  height: number;
}

// Проверка файла перед загрузкой в ТЕКУЩУЮ карту (имя/размер не трогаем:
// сетка — навсегда, чужой размер режем ошибкой, а не кропом).
export function validateMapImport(
  raw: unknown,
  target: MapImportTarget,
  fallbackGen: GeneratorParams
): { ok: true; cells: MapCells; gen: GeneratorParams } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== "soyman-map/1")
    return { ok: false, error: "Не похоже на выгрузку карты (ждём soyman-map/1)." };
  const doc = raw as Record<string, unknown>;
  if (doc.grid !== target.grid || doc.width !== target.width || doc.height !== target.height) {
    return {
      ok: false,
      error:
        `Файл — ${doc.grid === "hex" ? "гексы" : "квадраты"} ${String(doc.width)}×${String(doc.height)}, ` +
        `а карта — ${target.width}×${target.height}. Размер и сетка должны совпадать.`,
    };
  }
  if (typeof doc.cells !== "string" || cellsBlobStatus(doc.cells) === "corrupt")
    return { ok: false, error: "Клетки в файле повреждены." };
  const parsed = parseCellsBlob(doc.cells);
  const w = target.width;
  const h = target.height;
  const inB = (x: number, y: number) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h;
  for (const k of [...parsed.terrain.keys(), ...parsed.roads, ...parsed.rivers]) {
    const p = parseKey(k);
    if (!p || !inB(p.x, p.y)) return { ok: false, error: `Файл шире поля: клетка ${k} снаружи ${w}×${h}.` };
  }
  for (const l of parsed.labels) if (!inB(l.x, l.y)) return { ok: false, error: "Подпись из файла снаружи поля." };
  for (const r of parsed.rooms)
    if (!inB(r.x, r.y) || !inB(r.x + r.w - 1, r.y + r.h - 1))
      return { ok: false, error: "Комната из файла снаружи поля." };
  for (const d of [...parsed.doors, ...parsed.traps])
    if (!inB(d.x, d.y)) return { ok: false, error: "Объект из файла снаружи поля." };
  for (const m of parsed.markers)
    if (!inB(m.x, m.y)) return { ok: false, error: "Маркер из файла снаружи поля." };
  if ((parsed.start && !inB(parsed.start.x, parsed.start.y)) || (parsed.finish && !inB(parsed.finish.x, parsed.finish.y)))
    return { ok: false, error: "Старт/финиш из файла снаружи поля." };
  const num = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fb;
  return {
    ok: true,
    cells: parsed,
    gen: {
      seed: typeof doc.seed === "number" && Number.isInteger(doc.seed) ? doc.seed : fallbackGen.seed,
      sea: num(doc.sea, 20, 80, fallbackGen.sea),
      mountains: num(doc.mountains, 0, 40, fallbackGen.mountains),
      forest: num(doc.forest, 0, 60, fallbackGen.forest),
    },
  };
}
