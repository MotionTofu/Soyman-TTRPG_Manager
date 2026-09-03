// Сборка PNG-экспорта карты (C7: вынесено из MapEditorPage — чистая функция от
// снапшота, без состояния компонента; компонент держит только busy-флаг и таймер).

import { worldBounds } from "./grid";
import {
  MAP_DOOR_FILL,
  MAP_DOOR_LABELS,
  MAP_MARKER_LABELS,
  MAP_ROOM_LABELS,
  MAP_ROOM_TINT,
  MAP_RIVER_FILL,
  MAP_RIVER_LABEL,
  MAP_TERRAIN_FILL,
  MAP_TERRAIN_LABELS,
  MAP_TERRAIN_ORDER,
  MAP_TRAP_GLYPHS,
  MAP_TRAP_LABELS,
  doorForView,
  drawTerrainMotif,
  renderMap,
  readChrome,
  terrainMotifInk,
  type MapCells,
  type MapMarkerKind,
} from "./render";
import { MAP_SCALE_LABELS, type MapGrid, type MapScale } from "./mapTypes";

export interface PngSnapshot {
  grid: MapGrid;
  width: number;
  height: number;
  name: string;
  scale: MapScale;
  cell_lore: string;
  cells: MapCells;
  /** true — вид игрока (секретное вырезано, легенда без спойлеров) */
  pv: boolean;
  withLegend: boolean;
  withGrid: boolean;
  withCoords: boolean;
  fileName: string;
}

export function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const safe = (name.trim() || "map").replace(/[\\/:*?"<>|]/g, "_");
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "image/png");
}

export function buildAndDownloadPng(snap: PngSnapshot, PX: number) {
  const pad = Math.max(8, Math.round(PX / 4));
  const b = worldBounds(snap.grid, snap.width, snap.height);
  const mapW = Math.round((b.maxX - b.minX) * PX + pad * 2);
  const mapH = Math.round((b.maxY - b.minY) * PX + pad * 2);
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = mapW;
  mapCanvas.height = mapH;
  const mctx = mapCanvas.getContext("2d");
  if (!mctx) return;
  const chrome = readChrome();
  renderMap(mctx, mapW, mapH, {
    grid: snap.grid,
    width: snap.width,
    height: snap.height,
    cells: snap.cells,
    scale: PX,
    ox: pad - b.minX * PX,
    oy: pad - b.minY * PX,
    showGrid: snap.withGrid,
    showCoords: snap.withCoords,
    hover: null,
    chrome,
    // Экспорт: мастер — полный или глазами игрока (чекбокс); игрок — всегда свой.
    playerView: snap.pv,
    selectedKey: null,
  });
  if (!snap.withLegend) {
    downloadCanvas(mapCanvas, snap.fileName);
    return;
  }
  // Легенда справа от поля: название, шкала, террейны + дорога + объекты с карты,
  // внизу — «1 клетка = …» и графическая линейка. Без неё печатная карта нема (P0-7).
  const LW = 250;
  const gap = pad;
  const titleH = 64;
  const rowH = 24;
  const footH = 64;
  const pv = snap.pv;
  const live = snap.cells;
  type LegRow =
    | { kind: "terrain"; code: string }
    | { kind: "swatch"; color: string; label: string }
    | { kind: "glyph"; glyph: string; label: string }
    | { kind: "line" }
    | { kind: "river" }
    | { kind: "marker"; mkind: MapMarkerKind }
    | { kind: "sf"; which: "start" | "finish" };
  // Д-12: в виде игрока — только реально присутствующие террейны (иначе легенда
  // спойлерит биомы, которых на карте нет); равнина — фон, она видна всегда.
  const present = new Set(live.terrain.values());
  const terrainCodes = pv
    ? MAP_TERRAIN_ORDER.filter((code) => code === "plain" || present.has(code))
    : [...MAP_TERRAIN_ORDER];
  const legRows: LegRow[] = terrainCodes.map((code) => ({ kind: "terrain", code }) as LegRow);
  for (const d of live.doors) {
    const { kind, hidden } = doorForView(d, pv);
    if (hidden) continue;
    if (!legRows.some((r) => r.kind === "swatch" && r.label === MAP_DOOR_LABELS[kind])) {
      legRows.push({ kind: "swatch", color: MAP_DOOR_FILL[kind], label: MAP_DOOR_LABELS[kind] });
    }
  }
  // Ловушки — только мастер (игрок их не видит и на поле).
  if (!pv) {
    for (const t of live.traps) {
      if (!legRows.some((r) => r.kind === "glyph" && r.label === MAP_TRAP_LABELS[t.kind])) {
        legRows.push({ kind: "glyph", glyph: MAP_TRAP_GLYPHS[t.kind], label: MAP_TRAP_LABELS[t.kind] });
      }
    }
  }
  for (const r of live.rooms) {
    const label = MAP_ROOM_LABELS[r.type] ?? r.type;
    if (!legRows.some((x) => x.kind === "swatch" && x.label === label)) {
      legRows.push({ kind: "swatch", color: MAP_ROOM_TINT[r.type] ?? chrome.paper, label });
    }
  }
  if (live.start) legRows.push({ kind: "sf", which: "start" });
  if (live.finish) legRows.push({ kind: "sf", which: "finish" });
  // Маркеры видны и игрокам (решение: как комнаты) — в легенде всегда, если есть на карте.
  for (const mk of live.markers) {
    if (!legRows.some((r) => r.kind === "marker" && r.mkind === mk.kind)) {
      legRows.push({ kind: "marker", mkind: mk.kind });
    }
  }
  legRows.push({ kind: "line" });
  // Река — только если есть на карте (иначе лишний шум в легенде).
  if (live.rivers.size > 0) legRows.push({ kind: "river" });
  const legLabels: Record<string, string> = { line: "Дорога", river: MAP_RIVER_LABEL, start: "Старт", finish: "Финиш" };
  const legContentH = titleH + legRows.length * rowH + footH;
  const W = mapW + gap + LW + pad * 2;
  const contentH = Math.max(mapH, legContentH);
  const H = contentH + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = chrome.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(mapCanvas, pad, pad);
  const lx = pad + mapW + gap;
  let y = pad + 6;
  ctx.fillStyle = chrome.ink;
  ctx.font = "16px Oswald, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(snap.name, lx, y + 18, LW);
  ctx.fillStyle = chrome.muted;
  ctx.font = "11px Oswald, sans-serif";
  ctx.fillText(`${MAP_SCALE_LABELS[snap.scale]} · ${snap.width}×${snap.height}`, lx, y + 38, LW);
  y += titleH;
  ctx.font = "12px sans-serif";
  legRows.forEach((row, i) => {
    const ry = y + i * rowH;
    const label =
      row.kind === "terrain"
        ? (MAP_TERRAIN_LABELS[row.code] ?? row.code)
        : row.kind === "line"
          ? legLabels.line
          : row.kind === "river"
            ? legLabels.river
            : row.kind === "marker"
              ? (MAP_MARKER_LABELS[row.mkind] ?? row.mkind)
              : row.kind === "sf"
                ? legLabels[row.which]
                : row.label;
    if (row.kind === "line" || row.kind === "river") {
      ctx.strokeStyle = row.kind === "river" ? MAP_RIVER_FILL : chrome.ink;
      ctx.lineWidth = row.kind === "river" ? 5 : 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lx, ry + 7);
      ctx.lineTo(lx + 14, ry + 7);
      ctx.stroke();
    } else if (row.kind === "glyph") {
      ctx.fillStyle = chrome.paper;
      ctx.fillRect(lx, ry, 14, 14);
      ctx.strokeStyle = chrome.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx + 0.5, ry + 0.5, 14, 14);
      ctx.fillStyle = chrome.ink;
      ctx.font = "700 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(row.glyph, lx + 7, ry + 7.5);
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else if (row.kind === "marker") {
      // Миниатюры полевых фигур (те же формы, что на карте).
      const mcx = lx + 7;
      const mcy = ry + 7;
      ctx.strokeStyle = chrome.ink;
      ctx.fillStyle = chrome.paper;
      ctx.lineWidth = 1;
      if (row.mkind === "chest") {
        ctx.fillRect(lx + 1, ry + 1, 12, 12);
        ctx.strokeRect(lx + 1.5, ry + 1.5, 12, 12);
        ctx.beginPath();
        ctx.moveTo(lx + 1, ry + 6);
        ctx.lineTo(lx + 13, ry + 6);
        ctx.stroke();
      } else if (row.mkind === "altar") {
        ctx.beginPath();
        ctx.arc(mcx, mcy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mcx, mcy, 2, 0, Math.PI * 2);
        ctx.fillStyle = chrome.ink;
        ctx.fill();
      } else if (row.mkind === "city") {
        ctx.beginPath();
        ctx.moveTo(mcx, ry + 1);
        ctx.lineTo(lx + 13, mcy);
        ctx.lineTo(mcx, ry + 13);
        ctx.lineTo(lx + 1, mcy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mcx, mcy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = chrome.ink;
        ctx.fill();
      } else if (row.mkind === "village") {
        ctx.beginPath();
        ctx.moveTo(lx + 1, ry + 13);
        ctx.lineTo(lx + 1, ry + 7);
        ctx.lineTo(mcx, ry + 1);
        ctx.lineTo(lx + 13, ry + 7);
        ctx.lineTo(lx + 13, ry + 13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (row.mkind === "camp") {
        ctx.beginPath();
        ctx.moveTo(lx + 1, ry + 13);
        ctx.lineTo(mcx, ry + 1);
        ctx.lineTo(lx + 13, ry + 13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (row.mkind === "metro") {
        const dia = (r: number) => {
          ctx.beginPath();
          ctx.moveTo(mcx, mcy - r);
          ctx.lineTo(mcx + r, mcy);
          ctx.lineTo(mcx, mcy + r);
          ctx.lineTo(mcx - r, mcy);
          ctx.closePath();
        };
        dia(6);
        ctx.fill();
        ctx.stroke();
        dia(2.5);
        ctx.stroke();
      } else if (row.mkind === "battle") {
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(lx + 2, ry + 2);
        ctx.lineTo(lx + 12, ry + 12);
        ctx.moveTo(lx + 12, ry + 2);
        ctx.lineTo(lx + 2, ry + 12);
        ctx.stroke();
      } else {
        ctx.fillRect(mcx - 2, ry + 2, 4, 10);
        ctx.strokeRect(mcx - 1.5, ry + 2.5, 4, 10);
      }
    } else if (row.kind === "sf") {
      if (row.which === "start") {
        ctx.beginPath();
        ctx.arc(lx + 7, ry + 7, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#0a4a2a";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#3dd68c";
        ctx.stroke();
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(lx + 1, ry + 1, 12, 12);
        ctx.fillStyle = chrome.ink;
        ctx.fillRect(lx + 1, ry + 1, 6, 6);
        ctx.fillRect(lx + 7, ry + 7, 6, 6);
        ctx.strokeStyle = chrome.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(lx + 1.5, ry + 1.5, 12, 12);
      }
    } else {
      const swatch = row.kind === "terrain" ? (MAP_TERRAIN_FILL[row.code] as string) : row.color;
      ctx.fillStyle = swatch;
      ctx.fillRect(lx, ry, 14, 14);
      ctx.strokeStyle = chrome.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx + 0.5, ry + 0.5, 14, 14);
      // Д-11: мотив террейна в свотче — иначе «ёлочки» на карте и квадрат в легенде.
      if (row.kind === "terrain" && row.code !== "plain") {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.strokeStyle = terrainMotifInk(row.code, chrome);
        ctx.fillStyle = terrainMotifInk(row.code, chrome);
        drawTerrainMotif(ctx, row.code, lx + 7, ry + 7, 14);
        ctx.restore();
      }
    }
    ctx.fillStyle = chrome.ink;
    ctx.fillText(label, lx + 22, ry + 12, LW - 24);
  });
  ctx.fillStyle = chrome.muted;
  ctx.font = "12px monospace";
  ctx.fillText(`1 клетка = ${snap.cell_lore}`, lx, pad + contentH - 22, LW);
  // Д-2: графическая линейка (не зависит от DPI печати): отрезок 5 клеток с рисками.
  {
    const barCells = 5;
    const barW = Math.min(barCells * PX, LW - 30);
    const by = pad + contentH - 10;
    ctx.strokeStyle = chrome.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, by);
    ctx.lineTo(lx + barW, by);
    ctx.moveTo(lx, by - 3);
    ctx.lineTo(lx, by + 3);
    ctx.moveTo(lx + barW, by - 3);
    ctx.lineTo(lx + barW, by + 3);
    ctx.stroke();
    ctx.fillStyle = chrome.muted;
    ctx.fillText(`${barCells} кл`, lx + barW + 4, by + 4, 40);
  }
  downloadCanvas(canvas, snap.fileName);
}
