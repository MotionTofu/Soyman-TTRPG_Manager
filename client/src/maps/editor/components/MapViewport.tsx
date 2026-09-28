import { useEffect, useState } from "react";
import { subscribeMapImageAssets } from "../../assets/registry";
import { brushCells, cellCenter, cellKey, coordLabel } from "../../grid";
import { MAP_GRID_LABELS, formatMeters, parseCellLore } from "../../mapTypes";
import type { MapFull } from "../../mapTypes";
import { readChrome, renderMap } from "../../render";
import type { MapRenderModel } from "../../renderModel";
import type { BrushSize, PaintTool } from "../editorTypes";
import type { Camera } from "../hooks/useMapCamera";
import { rulerMeasure } from "../tools/rulerTools";
import type { RulerState } from "../tools/rulerTools";

// Viewport карты (Фаза 2G): canvas, DPR/setup, render effect, привязки
// input-хендлеров, курсор. Получает готовую read-only MapRenderModel —
// storage format не знает (§47 ТЗ).

export interface MapViewportInput {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onDoubleClick: () => void;
  spaceDown: boolean;
}

interface MapViewportProps {
  wrapRef: { current: HTMLDivElement | null };
  canvasRef: { current: HTMLCanvasElement | null };
  map: MapFull | null;
  model: MapRenderModel | null;
  cam: Camera;
  view: {
    showGrid: boolean;
    showCoords: boolean;
    previewAsPlayer: boolean;
    canEdit: boolean;
  };
  tool: {
    tool: PaintTool;
    brushSize: BrushSize;
    wallLineMode: boolean;
  };
  overlays: {
    hover: string | null;
    selectedId: string | null;
    ruler: RulerState | null;
    wallDraft: { x: number; y: number }[] | null;
    wallLive: { x: number; y: number } | null;
    rectPreview: { x: number; y: number; w: number; h: number } | null;
  };
  input: MapViewportInput;
}

export function MapViewport({ wrapRef, canvasRef, map, model, cam, view, tool, overlays, input }: MapViewportProps) {
  const [imageRevision, setImageRevision] = useState(0);
  useEffect(() => subscribeMapImageAssets(() => setImageRevision((revision) => revision + 1)), []);
  // Кадр. Зависимости — те же, что были (selectedId — чистая производная
  // от selected, canEdit в deps не было и нет — quirk сохранён).
  // canvasRef/wrapRef стабильны весь маунт — в deps не добавляем, как было.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !map || !model) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const chrome = readChrome();
    renderMap(ctx, rect.width, rect.height, {
      grid: map.grid,
      width: map.width,
      height: map.height,
      model,
      scale: cam.scale,
      ox: cam.ox,
      oy: cam.oy,
      showGrid: view.showGrid,
      showCoords: view.showCoords,
      hover: overlays.hover,
      // Этап G: футпринт кистей 2/3 (и реки/дороги/ластика/стены-даба) — целиком,
      // а не одна клетка; остальным инструментам — одиночка через hover.
      hoverCells: (() => {
        if (!overlays.hover) return null;
        const paints =
          tool.tool === "brush" ||
          tool.tool === "road" ||
          tool.tool === "river" ||
          tool.tool === "eraser" ||
          (tool.tool === "wall" && !tool.wallLineMode);
        if (!paints) return null;
        const [hx, hy] = overlays.hover.split(",").map(Number);
        if (!Number.isInteger(hx) || !Number.isInteger(hy)) return null;
        return brushCells(map.grid, hx, hy, tool.brushSize, map.width, map.height).map((c) =>
          cellKey(c.x, c.y)
        );
      })(),
      chrome,
      // Игрок всегда видит карту глазами игрока; у мастера — тумблер превью (§6).
      playerView: !view.canEdit || view.previewAsPlayer,
      fogGuide: view.canEdit && !view.previewAsPlayer && tool.tool === "fog",
      selectedId: overlays.selectedId,
    });
    // Линейка поверх поля (P2-1): экранные координаты, читаема при любом зуме.
    if (overlays.ruler) {
      const ruler = overlays.ruler;
      const end = ruler.b ?? ruler.a;
      const pa = cellCenter(map.grid, ruler.a.x, ruler.a.y);
      const pb = cellCenter(map.grid, end.x, end.y);
      const ax = cam.ox + pa.cx * cam.scale;
      const ay = cam.oy + pa.cy * cam.scale;
      const bx = cam.ox + pb.cx * cam.scale;
      const by = cam.oy + pb.cy * cam.scale;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [px, py] of [[ax, ay], [bx, by]] as const) {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.strokeStyle = chrome.ink;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const m = rulerMeasure(map.grid, ruler.a.x, ruler.a.y, end.x, end.y);
      const per = parseCellLore(map.cell_lore);
      const label =
        `${coordLabel(ruler.a.x, ruler.a.y)}→${coordLabel(end.x, end.y)} · ${m.cells} кл` +
        (per !== null ? ` · ${formatMeters(m.dist * per)}` : "");
      ctx.font = "12px Oswald, sans-serif";
      const tw = ctx.measureText(label).width;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - 12;
      ctx.fillStyle = chrome.paper;
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 1;
      ctx.fillRect(mx - tw / 2 - 6, my - 11, tw + 12, 20);
      ctx.strokeRect(mx - tw / 2 - 6, my - 11, tw + 12, 20);
      ctx.fillStyle = chrome.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my);
      ctx.restore();
    }
    // Полилиния стен (Этап E): пунктир по вершинам + живой конец + точки вершин.
    if (overlays.wallDraft && overlays.wallDraft.length > 0) {
      const wallDraft = overlays.wallDraft;
      const pts = overlays.wallLive ? [...wallDraft, overlays.wallLive] : wallDraft;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(cam.ox + pts[0].x * cam.scale, cam.oy + pts[0].y * cam.scale);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(cam.ox + pts[i].x * cam.scale, cam.oy + pts[i].y * cam.scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = chrome.paper;
      for (const p of wallDraft) {
        ctx.beginPath();
        ctx.arc(cam.ox + p.x * cam.scale, cam.oy + p.y * cam.scale, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    // Прямоугольник создаваемой комнаты (выбор): пунктир чернилами.
    if (overlays.rectPreview) {
      const rectPreview = overlays.rectPreview;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(
        cam.ox + rectPreview.x * cam.scale,
        cam.oy + rectPreview.y * cam.scale,
        rectPreview.w * cam.scale,
        rectPreview.h * cam.scale
      );
      ctx.restore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps — deps 1:1 со старым эффектом.
  }, [
    map,
    model,
    imageRevision,
    cam,
    view.showGrid,
    view.showCoords,
    overlays.hover,
    overlays.ruler,
    overlays.selectedId,
    overlays.rectPreview,
    view.previewAsPlayer,
    overlays.wallDraft,
    overlays.wallLive,
    tool.tool,
    tool.brushSize,
    tool.wallLineMode,
  ]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={
        map
          ? `Карта «${map.name}», поле ${map.width} на ${map.height}, ${MAP_GRID_LABELS[map.grid].toLowerCase()}`
          : "Карта"
      }
      onPointerDown={input.onPointerDown}
      onPointerMove={input.onPointerMove}
      onPointerUp={input.onPointerUp}
      onPointerCancel={input.onPointerCancel}
      onDoubleClick={input.onDoubleClick}
      onTouchStart={input.onTouchStart}
      onTouchMove={input.onTouchMove}
      onTouchEnd={input.onTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: "block",
        cursor: !view.canEdit
          ? "default"
          : input.spaceDown
            ? "grab"
            : tool.tool === "picker"
              ? "copy"
              : tool.tool === "select"
                ? "default"
                : "crosshair",
      }}
    />
  );
}
