import { useEffect, useRef, useState } from "react";
import {
  deleteGameplayEntity,
  moveGameplayEntity,
} from "../../core/mutations/gameplay";
import { findEntityLayer } from "../../core/mutations/layers";
import { deleteMapObject, moveMapObject } from "../../core/mutations/mapObjects";
import { legacyDoorWorldPosition, legacyEdgeOrientation } from "../../core/migrateLegacy";
import { hitTestGameplay } from "../../core/selection/hitTest";
import type { V5Selection } from "../../core/selection/types";
import type { GameplayEntity, LayerId, MapDocumentV5 } from "../../core/types";
import { cellCenter, pixelToCell } from "../../grid";
import type { MapGrid } from "../../mapTypes";
import type { MapDoorEdge } from "../../render";

// Выбор объектов карты (Фаза 2G): identity — stable EntityId (V5Selection),
// а не индексы массивов. Sibling-delete и reorder выбор не ломают.
// Pointer orchestration — как раньше, у страницы/Input.
// History хук не владеет: изменения уходят через commitDocument.

export type { V5Selection };

export interface MapGeometry {
  grid: MapGrid;
  width: number;
  height: number;
}

export interface ObjDragSession {
  sel: NonNullable<V5Selection>;
  ox: number;
  oy: number;
  before: MapDocumentV5;
}

export interface ObjMoveAnchor {
  ox: number;
  oy: number;
  before: MapDocumentV5;
}

// Жёсткое перемещение из снапшота начала drag (без накопления).
// Точки — в центр текущей клетки; дверь — на ребро по указателю +
// жёсткий сдвиг пары; комната — абсолютный origo от anchor с клампом.
// Чистое ядро: возвращает черновик или null, если перемещать некуда/нельзя.
export function moveSelectedInDocument(
  before: MapDocumentV5,
  sel: NonNullable<V5Selection>,
  anchor: { ox: number; oy: number },
  geom: MapGeometry,
  wx: number,
  wy: number
): MapDocumentV5 | null {
  const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
  if (!cell) return null;
  if (sel.kind === "object") {
    const r = moveMapObject(before, sel.entityId, { x: wx - anchor.ox, y: wy - anchor.oy });
    return r.ok ? r.document : null;
  }
  if (sel.kind === "door") {
    // Двери — только квадраты (legacy-ограничение сохранено).
    if (geom.grid !== "square") return null;
    const fx = wx - cell.x;
    const fy = wy - cell.y;
    const m = Math.min(fx, 1 - fx, fy, 1 - fy);
    const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
    const target = legacyDoorWorldPosition(geom.grid, cell.x, cell.y, edge);
    const orientation = legacyEdgeOrientation(edge);
    const found = findGameplay(before, sel.entityId);
    if (!found || found.kind !== "door") return null;
    const dx = target.x - found.position.x;
    const dy = target.y - found.position.y;
    let doc = before;
    let moved = false;
    if (dx !== 0 || dy !== 0) {
      const r = moveGameplayEntity(doc, sel.entityId, { x: dx, y: dy });
      if (!r.ok) return null;
      if (r.changed) {
        doc = r.document;
        moved = true;
      }
      // Пара едет жёстко тем же сдвигом (legacy: вся pair-группа).
      const pairedId = pairOf(doc, sel.entityId);
      if (pairedId) {
        const r2 = moveGameplayEntity(doc, pairedId, { x: dx, y: dy });
        if (r2.ok && r2.changed) {
          doc = r2.document;
          moved = true;
        }
      }
    }
    if (found.orientation !== orientation) {
      const upd = updateDoorOrientation(doc, sel.entityId, orientation);
      if (upd) {
        doc = upd.document;
        moved = true;
      }
    }
    return moved ? doc : before;
  }
  if (sel.kind === "trap" || sel.kind === "marker" || sel.kind === "start" || sel.kind === "finish") {
    const cur = positionOf(before, sel.entityId);
    if (!cur) return null;
    // Точка — в центр текущей клетки (grid-snapped UX сохранён).
    const c = cellCenter(geom.grid, cell.x, cell.y);
    const r = moveGameplayEntity(before, sel.entityId, { x: c.cx - cur.x, y: c.cy - cur.y });
    if (!r.ok) return null;
    return r.changed ? r.document : before;
  }
  if (sel.kind === "room") {
    const found = findGameplay(before, sel.entityId);
    if (!found || found.kind !== "room" || found.geometry.type !== "rect") return null;
    const g = gridDims(before) ?? geom;
    const nx = Math.max(0, Math.min(g.width - found.geometry.w, cell.x - anchor.ox));
    const ny = Math.max(0, Math.min(g.height - found.geometry.h, cell.y - anchor.oy));
    const r = moveGameplayEntity(before, sel.entityId, {
      x: nx - found.geometry.x,
      y: ny - found.geometry.y,
    });
    if (!r.ok) return null;
    return r.changed ? r.document : before;
  }
  return null;
}

function findGameplay(doc: MapDocumentV5, id: string): GameplayEntity | undefined {
  for (const layer of doc.layers) {
    if (layer.kind !== "gameplay") continue;
    const e = layer.items.find((x) => x.id === id);
    if (e) return e;
  }
  return undefined;
}

function positionOf(doc: MapDocumentV5, id: string): { x: number; y: number } | null {
  const e = findGameplay(doc, id);
  if (!e || e.kind === "room") return null;
  return e.position;
}

function pairOf(doc: MapDocumentV5, id: string): string | null {
  const e = findGameplay(doc, id);
  if (!e || e.kind !== "door") return null;
  return e.pairedDoorId;
}

function gridDims(doc: MapDocumentV5): MapGeometry | null {
  if (!doc.grid) return null;
  return { grid: doc.grid.type, width: doc.grid.columns, height: doc.grid.rows };
}

function updateDoorOrientation(
  doc: MapDocumentV5,
  id: string,
  orientation: number
): { ok: boolean; changed: boolean; document: MapDocumentV5 } | null {
  const e = findGameplay(doc, id);
  if (!e || e.kind !== "door" || e.orientation === orientation) return null;
  // Локальное обновление orientation (pairedDoorId/id/kind — untouched).
  const layers = doc.layers.map((l) => {
    if (l.kind !== "gameplay") return l;
    return {
      ...l,
      items: l.items.map((x) => (x.kind === "door" && x.id === id ? { ...x, orientation } : x)),
    };
  });
  return { ok: true, changed: true, document: { ...doc, layers } };
}

// Удаление выбранного: парная дверь чистится внутри Mutation Core
// (второй участник пары остаётся с pairedDoorId null).
// Возвращает { next, before } для commitDocument или null, если удалять нечего.
export function deleteSelectedFromDocument(
  live: MapDocumentV5,
  sel: V5Selection
): { next: MapDocumentV5; before: MapDocumentV5 } | null {
  const r = sel.kind === "object" ? deleteMapObject(live, sel.entityId) : deleteGameplayEntity(live, sel.entityId);
  if (!r.ok || !r.changed) return null;
  return { next: r.document, before: live };
}

interface UseMapSelectionArgs {
  document: MapDocumentV5 | null;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  // Мутация с историей — снаружи: хук историей не владеет.
  commitDocument: (next: MapDocumentV5, before: MapDocumentV5) => void;
  // 3A §30: выбор entity переключает active layer на owning layer.
  onActiveLayer: (id: LayerId) => void;
}

export function useMapSelection({ document, documentRef, setDocument, commitDocument, onActiveLayer }: UseMapSelectionArgs) {
  const [selected, setSelected] = useState<V5Selection | null>(null);
  const selectedRef = useRef<V5Selection | null>(null);
  selectedRef.current = selected;
  // Сохраняем выбор через собственные правки объекта; удаление или загрузка
  // другого документа без этого ID сбрасывают его.
  useEffect(() => {
    setSelected((current) => current && document && findEntityLayer(document, current.entityId) ? current : null);
  }, [document]);

  function select(sel: NonNullable<V5Selection>) {
    setSelected(sel);
    // Owning layer становится active (§30): следующее действие инструмента
    // идёт туда же, куда кликнул пользователь.
    const doc = documentRef.current;
    if (doc) {
      const own = findEntityLayer(doc, sel.entityId);
      if (own) onActiveLayer(own.layerId);
    }
  }

  function clearSelection() {
    setSelected(null);
  }

  function hitAt(wx: number, wy: number): { sel: V5Selection } | null {
    const doc = documentRef.current;
    if (!doc) return null;
    const hit = hitTestGameplay(doc, { x: wx, y: wy });
    return hit ? { sel: hit } : null;
  }

  function moveSelectedTo(
    session: ObjDragSession,
    geom: MapGeometry,
    wx: number,
    wy: number
  ) {
    // §90: lock — editor authorization. Даже если drag начался до lock,
    // мутация заблокированного слоя останавливается до Core.
    const live = documentRef.current;
    if (!live) return;
    const own = findEntityLayer(live, session.sel.entityId);
    if (!own) return;
    const layer = live.layers[own.layerIndex];
    if (!layer || (layer.kind !== "gameplay" && layer.kind !== "object") || layer.locked || !layer.visible) return;
    const draft = moveSelectedInDocument(session.before, session.sel, session, geom, wx, wy);
    if (!draft) return;
    documentRef.current = draft;
    setDocument(draft);
  }

  function deleteSelected() {
    const s = selectedRef.current;
    if (!s) return;
    const doc = documentRef.current;
    if (!doc) return;
    // §90: удаление из locked/hidden слоя запрещено оркестрацией.
    const own = findEntityLayer(doc, s.entityId);
    if (!own) return;
    const layer = doc.layers[own.layerIndex];
    if (!layer || (layer.kind !== "gameplay" && layer.kind !== "object") || layer.locked || !layer.visible) return;
    const r = deleteSelectedFromDocument(doc, s);
    if (!r) return;
    commitDocument(r.next, r.before);
    setSelected(null);
  }

  return {
    selected,
    selectedRef,
    select,
    clearSelection,
    hitAt,
    moveSelectedTo,
    deleteSelected,
  };
}
