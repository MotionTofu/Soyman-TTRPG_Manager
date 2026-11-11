import type { MapDocumentV6 } from "@shared/maps/core";
import { prepareMapImageAssets } from "../assets/registry";
import { prepareLabelFonts } from "../labelStyle";
import { worldBounds } from "../grid";
import { downloadCanvas } from "../mapExport";
import type { MapFull } from "../mapTypes";
import { renderMap, type RenderOptions } from "../render";
import { workspaceDrawingStyle } from "./drawingStyle";
import { createWorkspaceRenderModel } from "./renderV6";
import type { TokenDisplay } from "./useTokenPresentations";

/** Точек на клетку: 64, но так, чтобы длинная сторона карты не превысила 8192 — предел холста у части браузеров. */
export const picturePixels = (cells: number) => Math.max(8, Math.min(64, Math.floor(8192 / cells)));

/** Карта целиком в PNG, как её видит Мастер: то же оформление, что в редакторе, без рабочей разметки.
 * Эффекты печати и погода в картинку не попадают — они живут только в новой отрисовке. */
type GridOptions = Pick<RenderOptions, "showGrid" | "gridColor" | "gridOpacity" | "gridLineWidth" | "gridLineStyle">;

/** Карта целиком на холсте: px точек на клетку, рамка с полями — вместе с картой. */
function drawWholeMap(map: MapFull, document: MapDocumentV6, displays: ReadonlyMap<string, TokenDisplay> | undefined, grid: GridOptions, pixels: (side: number) => number) {
  const frame = document.appearance?.frame ?? 0, inner = worldBounds(map.grid, map.width, map.height);
  const bounds = { minX: inner.minX - frame, minY: inner.minY - frame, maxX: inner.maxX + frame, maxY: inner.maxY + frame }, w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  const px = pixels(Math.max(w, h));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * px)); canvas.height = Math.max(1, Math.round(h * px));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  renderMap(ctx, canvas.width, canvas.height, { grid: map.grid, width: map.width, height: map.height, model: createWorkspaceRenderModel(document, displays).model,
    scale: px, ox: -bounds.minX * px, oy: -bounds.minY * px, ...grid, showCoords: false, hover: null, ...workspaceDrawingStyle(document), playerView: false, selectedId: null });
  return canvas;
}

// Подложка — рабочая разметка Мастера (П4): ни в картинку, ни в миниатюру не попадает.
const withoutReference = (document: MapDocumentV6): MapDocumentV6 => ({ ...document, layers: document.layers.filter(layer => layer.kind !== "reference") });

export async function downloadMapPicture(map: MapFull, document: MapDocumentV6, displays: ReadonlyMap<string, TokenDisplay> | undefined, grid: GridOptions) {
  document = withoutReference(document);
  await Promise.all([prepareMapImageAssets(document), prepareLabelFonts(document)]);
  const canvas = drawWholeMap(map, document, displays, grid, picturePixels);
  if (!canvas) throw new Error("Не удалось подготовить картинку");
  downloadCanvas(canvas, map.name);
}

/** Длинная сторона миниатюры в точках: плитка списка — 16:10 шириной до ~360 px. */
export const THUMBNAIL_SIDE = 320;
/** Предел сервера на миниатюру (mapsValidation, MAP_MAX_THUMBNAIL_CHARS). */
const THUMBNAIL_MAX_CHARS = 300_000;

/** Миниатюра для списка карт (гриллинг «Д» 2026-11-06, Q16): та же отрисовка, что у «Скачать картинку», без сетки.
 * Синхронно — картинки и шрифты уже загружены открытым редактором; что не успело, догонит следующая миниатюра. */
export function renderMapThumbnail(map: MapFull, document: MapDocumentV6): string | null {
  const canvas = drawWholeMap(map, withoutReference(document), undefined, { showGrid: false }, (side) => THUMBNAIL_SIDE / side);
  if (!canvas) return null;
  const url = canvas.toDataURL("image/png");
  return url.length <= THUMBNAIL_MAX_CHARS ? url : null;
}
