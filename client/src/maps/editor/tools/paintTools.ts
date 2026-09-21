import { brushCells, pixelToCell } from "../../grid";
import { applyTerrainCellEdits, floodTerrainFill, readTerrainMaterialAt } from "../../core/mutations/terrain";
import type { MaterialRef } from "../../core/refs";
import type { MapDocumentV5 } from "../../core/types";
import type { MapGeometry } from "../hooks/useMapSelection";
import type { BrushSize, PaintTool } from "../editorTypes";
import { addCellsToEditablePath, removeCellsFromEditablePath } from "./v5paths";

// Красящие инструменты (Фаза 2G): paintAt/singleAction/altPick через V5
// Mutation Core. Историю не владеют: мазок закрывает Input (без push здесь),
// точечные действия пушат через push. documentRef зеркалится синхронно
// (P0-1: changed считается ДО setDocument, реф — оптимистично сразу).

function materialForCode(code: string): MaterialRef {
  return { type: "builtin", key: `terrain/${code}` };
}

function codeOfMaterial(m: MaterialRef): string | null {
  if (m.type === "builtin" && m.key.startsWith("terrain/")) return m.key.slice("terrain/".length);
  return null;
}

function terrainLayerId(doc: MapDocumentV5): string | null {
  const l = doc.layers.find((x) => x.kind === "terrain");
  return l ? l.id : null;
}

export interface PaintAtOptions {
  // Временный RMB-ластик: решает Input и передаёт значением (без зависимости
  // tools → input). Выбранный инструмент при этом не меняется.
  eraseOverride?: boolean;
}

interface Ctx {
  geom: MapGeometry | null;
  tool: PaintTool;
  terrain: string;
  brushSize: BrushSize;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  push: (before: MapDocumentV5) => void;
  newId: () => string;
  selectTool: (t: PaintTool) => void;
  setTerrain: (t: string) => void;
  setActionError: (e: string | null) => void;
}

interface CreatePaintToolsArgs {
  geom: MapGeometry | null;
  tool: PaintTool;
  terrain: string;
  brushSize: BrushSize;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  push: (before: MapDocumentV5) => void;
  newId: () => string;
  selectTool: (t: PaintTool) => void;
  setTerrain: (t: string) => void;
  setActionError: (e: string | null) => void;
}

function commit(ctx: Ctx, before: MapDocumentV5, next: MapDocumentV5, push: boolean): boolean {
  ctx.documentRef.current = next;
  ctx.setDocument(next);
  if (push) ctx.push(before);
  return true;
}

// Мазок кистью/оверлеем/ластиком по клеткам вокруг центра.
function paintStrokeCells(
  ctx: Ctx,
  g: MapGeometry,
  doc: MapDocumentV5,
  cx: number,
  cy: number,
  tool: PaintTool,
  terrainCode: string,
): boolean {
  const brush = brushCells(g.grid, cx, cy, ctx.brushSize, g.width, g.height);
  if (tool === "road" || tool === "river") {
    // Оверлеи ложатся поверх любого террейна (река — и поверх дороги).
    const r = addCellsToEditablePath(
      doc,
      tool,
      brush.map((c) => ({ x: c.x, y: c.y })),
      ctx.newId,
    );
    if (!r.ok) {
      ctx.setActionError(r.issues[0]?.message ?? "Не удалось положить путь.");
      return false;
    }
    if (!r.changed) return false;
    return commit(ctx, doc, r.document, false);
  }
  const layerId = terrainLayerId(doc);
  if (!layerId) {
    ctx.setActionError("В документе нет terrain-слоя.");
    return false;
  }
  if (tool === "eraser") {
    // Ластик: террейн → default (Core удаляет override), дороги/реки — снять.
    const def = doc.layers.find((l) => l.id === layerId);
    const defaultMaterial: MaterialRef =
      def && def.kind === "terrain" ? def.defaultMaterial : materialForCode("plain");
    const r = applyTerrainCellEdits(
      doc,
      layerId,
      brush.map((c) => ({ x: c.x, y: c.y, material: defaultMaterial })),
    );
    let next = doc;
    let changed = false;
    if (!r.ok) {
      ctx.setActionError(r.issues[0]?.message ?? "Не удалось стереть.");
      return false;
    }
    if (r.changed) {
      next = r.document;
      changed = true;
    }
    for (const kind of ["road", "river"] as const) {
      const rr = removeCellsFromEditablePath(
        next,
        kind,
        brush.map((c) => ({ x: c.x, y: c.y })),
      );
      if (!rr.ok) {
        ctx.setActionError(rr.issues[0]?.message ?? "Не удалось снять путь.");
        return false;
      }
      if (rr.changed) {
        next = rr.document;
        changed = true;
      }
    }
    if (!changed) return false;
    return commit(ctx, doc, next, false);
  }
  const r = applyTerrainCellEdits(
    doc,
    layerId,
    brush.map((c) => ({ x: c.x, y: c.y, material: materialForCode(terrainCode) })),
  );
  if (!r.ok) {
    ctx.setActionError(r.issues[0]?.message ?? "Не удалось покрасить.");
    return false;
  }
  if (!r.changed) return false;
  return commit(ctx, doc, r.document, false);
}

export function createPaintTools(a: CreatePaintToolsArgs) {
  const ctx: Ctx = a;

  function paintAt(wx: number, wy: number, opts: PaintAtOptions = {}): boolean {
    const g = ctx.geom;
    const doc = ctx.documentRef.current;
    if (!g || !doc) return false;
    const cell = pixelToCell(g.grid, wx, wy, g.width, g.height);
    if (!cell) return false;
    const effTool = opts.eraseOverride ? "eraser" : ctx.tool;
    // Стена дабом — та же кисть террейна, только краска зафиксирована.
    const effTerrain = effTool === "wall" ? "wall" : ctx.terrain;
    return paintStrokeCells(ctx, g, doc, cell.x, cell.y, effTool, effTerrain);
  }

  function singleAction(wx: number, wy: number) {
    const g = ctx.geom;
    const doc = ctx.documentRef.current;
    if (!g || !doc) return;
    const cell = pixelToCell(g.grid, wx, wy, g.width, g.height);
    if (!cell) return;
    if (ctx.tool === "picker") {
      const layerId = terrainLayerId(doc);
      if (!layerId) return;
      const r = readTerrainMaterialAt(doc, layerId, cell.x, cell.y);
      if (!r.ok) {
        ctx.setActionError(r.issues[0]?.message ?? "Не удалось взять террейн.");
        return;
      }
      const code = codeOfMaterial(r.material);
      if (code === null) {
        ctx.setActionError("Этот материал кистью не покрасить.");
        return;
      }
      ctx.setTerrain(code);
      ctx.selectTool("brush");
      return;
    }
    // fill
    const layerId = terrainLayerId(doc);
    if (!layerId) {
      ctx.setActionError("В документе нет terrain-слоя.");
      return;
    }
    const r = floodTerrainFill(doc, layerId, cell.x, cell.y, materialForCode(ctx.terrain));
    if (!r.ok) {
      ctx.setActionError(r.issues[0]?.message ?? "Не удалось залить.");
      return;
    }
    if (!r.changed) return;
    commit(ctx, doc, r.document, true);
  }

  function altPick(wx: number, wy: number) {
    const g = ctx.geom;
    const doc = ctx.documentRef.current;
    if (!g || !doc) return;
    // Пипетка поверх любого инструмента (P1-9 + Этап C): берёт террейн, а клетка
    // с оверлеем включает его инструмент (дорога — верхняя, потом река).
    // С активным оверлеем Alt+клик наоборот точечно снимает его, террейн не трогая.
    const cell = pixelToCell(g.grid, wx, wy, g.width, g.height);
    if (!cell) return;
    const active = ctx.tool;
    if (active === "road" || active === "river") {
      const r = removeCellsFromEditablePath(doc, active, [{ x: cell.x, y: cell.y }]);
      if (!r.ok) {
        ctx.setActionError(r.issues[0]?.message ?? "Не удалось снять путь.");
        return;
      }
      if (!r.changed) return;
      commit(ctx, doc, r.document, true);
      return;
    }
    const layerId = terrainLayerId(doc);
    if (!layerId) return;
    const read = readTerrainMaterialAt(doc, layerId, cell.x, cell.y);
    if (!read.ok) return;
    const code = codeOfMaterial(read.material);
    if (code === null) {
      ctx.setActionError("Этот материал кистью не покрасить.");
      return;
    }
    ctx.setTerrain(code);
    ctx.selectTool(pickOverlayTool(doc, cell.x, cell.y));
  }

  return { paintAt, singleAction, altPick };
}

// Оверлей под курсором: дорога — верхняя, потом река, иначе кисть.
function pickOverlayTool(doc: MapDocumentV5, x: number, y: number): PaintTool {
  let river = false;
  for (const layer of doc.layers) {
    if (layer.kind !== "path") continue;
    for (const p of layer.paths) {
      if (p.geometry.type !== "cell-network") continue;
      if (p.kind !== "road" && p.kind !== "river") continue;
      if (p.geometry.cells.some((c) => c.x === x && c.y === y)) {
        if (p.kind === "road") return "road";
        river = true;
      }
    }
  }
  return river ? "river" : "brush";
}

export type PaintTools = ReturnType<typeof createPaintTools>;
