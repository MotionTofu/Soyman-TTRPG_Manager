import type { MapDocumentV6 } from "@shared/maps/core";
import { prepareMapImageAssets } from "../assets/registry";
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
export async function downloadMapPicture(map: MapFull, document: MapDocumentV6, displays: ReadonlyMap<string, TokenDisplay> | undefined,
  grid: Pick<RenderOptions, "showGrid" | "gridColor" | "gridOpacity" | "gridLineWidth" | "gridLineStyle">) {
  await prepareMapImageAssets(document);
  const bounds = worldBounds(map.grid, map.width, map.height), w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  const px = picturePixels(Math.max(w, h));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.round(w * px); canvas.height = Math.round(h * px);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить картинку");
  renderMap(ctx, canvas.width, canvas.height, { grid: map.grid, width: map.width, height: map.height, model: createWorkspaceRenderModel(document, displays).model,
    scale: px, ox: -bounds.minX * px, oy: -bounds.minY * px, ...grid, showCoords: false, hover: null, ...workspaceDrawingStyle(document), playerView: false, selectedId: null });
  downloadCanvas(canvas, map.name);
}
