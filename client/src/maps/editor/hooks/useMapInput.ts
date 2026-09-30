import { useEffect, useRef, useState } from "react";
import { cellKey, pixelToCell } from "../../grid";
import type { MapDocumentV5, SplineNode } from "../../core/types";
import { deformFreePath, hitEditableFreePath, moveSplineHandle,
  type FreePathJoin } from "../freePathEditing";
import type { Camera } from "./useMapCamera";
import type { MapGeometry, V5Selection } from "./useMapSelection";
import type { PaintTool } from "../editorTypes";
import type { MapInputTools } from "../tools/types";

// Оркестрация ввода редактора карт (Фаза 1, Этап Input): pointer/touch
// state machine, раньше жившая инлайном в MapEditorPage. Приоритет —
// semantics 1:1, не «упрощение UX».
//
// Хук НЕ владеет доменной логикой инструментов (как рисуется forest,
// paired door, flood fill — всё это остаётся странице и приходит колбэками
// в tools). Хук решает: какое действие сейчас происходит и кому передать
// событие.
//
// Состояния (плоско, ref'ами — как было, без reducer'а ради reducer'а):
//   Idle            — ничего активного (все ref'ы пусты)
//   Panning         — dragRef set (middle mouse / Space+ЛКМ)
//   Painting        — history stroke открыт (мышь или один палец тача)
//   DraggingObject  — objDragRef set (moved — после порога 6px)
//   DraggingRect    — rectRef set (isRect — после порога 6px)
//   Shaping         — shapeDragRef set (мышь)
//   TouchPaint      — strokeTouchRef set (один палец красит)
//   Pinching        — pinchRef set (два пальца: пан/зум, stroke закрыт)
//
// Факт о таче (важно, расходится с интуицией «один палец — пан»):
// один палец с кистью РИСУЕТ тем же мазком, что мышь, с остальными
// инструментами — тапает; пан/зум — только двумя пальцами. Сохранено как есть.

export interface MapInputCamera {
  setCam: (updater: (c: Camera) => Camera) => void;
  camRef: { current: Camera };
  toWorld: (e: { clientX: number; clientY: number }) => {
    wx: number;
    wy: number;
    rx: number;
    ry: number;
  };
  touchToWorld: (clientX: number, clientY: number) => { wx: number; wy: number };
}

export interface MapInputHistory {
  beginStroke: () => void;
  markStrokeChanged: () => void;
  commitStroke: () => void;
  isPainting: () => boolean;
  push: (before: MapDocumentV5) => void;
}

export interface MapInputSelection {
  hitAt: (wx: number, wy: number) => { sel: V5Selection } | null;
  select: (sel: NonNullable<V5Selection>) => void;
  moveSelectedTo: (
    session: { sel: NonNullable<V5Selection>; ox: number; oy: number; before: MapDocumentV5 },
    geom: MapGeometry,
    wx: number,
    wy: number
  ) => void;
}

export type FreePathOrigin =
  | { action: "extend" | "branch"; pathId: string; nodeIndex: number }
  | { action: "branch-segment"; pathId: string; segmentIndex: number; t: number };

interface UseMapInputArgs {
  canvasRef: { current: HTMLCanvasElement | null };
  documentRef: { current: MapDocumentV5 | null };
  camera: MapInputCamera;
  history: MapInputHistory;
  selection: MapInputSelection;
  geom: MapGeometry | null;
  tool: PaintTool;
  freePathMode: boolean;
  freePathEditMode: boolean;
  selectedFreePathId: string | null;
  canEdit: boolean;
  onFreePathPreview: (draft: { anchors: { x: number; y: number }[];
    hover: { x: number; y: number } | null } | null) => void;
  onFreePathBegin: (kind: "road" | "river") => boolean;
  onFreePathCommit: (points: { x: number; y: number }[], kind: "road" | "river",
    origin?: FreePathOrigin) => void;
  onFreePathSelect: (pathId: string | null, nodeIndex?: number | null,
    join?: FreePathJoin) => void;
  onFreePathEditPreview: (draft: { pathId: string; nodes: SplineNode[] } | null) => void;
  onFreePathEditCommit: (pathId: string, nodes: SplineNode[]) => void;
  // Состояние стен/линейки для маршрутизации (зеркало через argsRef,
  // значения — из страницы, второго постоянного зеркала не заводим).
  wallMode: boolean;
  wallDraft: { x: number; y: number }[] | null;
  ruler: { locked: boolean } | null;
  setHover: (h: string | null) => void;
  setRectPreview: (r: { x: number; y: number; w: number; h: number } | null) => void;
  onFogCell: (x: number, y: number, reverse: boolean) => boolean;
  tools: MapInputTools;
}

export interface ObjDragState {
  sel: NonNullable<V5Selection>;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  before: MapDocumentV5;
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 6;

// Якорь drag комнаты: origo rect в клеточных координатах (для migrated-карт
// совпадает с legacy; overlay берёт его для абсолютного позиционирования).
function findRoomRect(
  doc: MapDocumentV5,
  id: string
): { x: number; y: number; w: number; h: number } | null {
  for (const layer of doc.layers) {
    if (layer.kind !== "gameplay") continue;
    const e = layer.items.find((x) => x.id === id);
    if (e && e.kind === "room" && e.geometry.type === "rect") return e.geometry;
  }
  return null;
}

export function useMapInput(args: UseMapInputArgs) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const dragRef = useRef<{ button: number; sx: number; sy: number; ox: number; oy: number } | null>(
    null
  );
  const pinchRef = useRef<{ dist: number; scale: number; mx: number; my: number } | null>(null);
  const touches = useRef(new globalThis.Map<number, { x: number; y: number }>());
  const strokeTouchRef = useRef<number | null>(null);
  const freePathRef = useRef<{ x: number; y: number }[] | null>(null);
  const freePathKindRef = useRef<"road" | "river" | null>(null);
  const freePathOriginRef = useRef<FreePathOrigin | null>(null);
  const freePathDragRef = useRef<{
    pathId: string; kind: "road" | "river"; nodes: SplineNode[]; anchorIndex: number;
    handleKind: "anchor" | "in" | "out";
    sx: number; sy: number; touchId: number | null; edited: SplineNode[] | null;
  } | null>(null);
  const objDragRef = useRef<ObjDragState | null>(null);
  const rectRef = useRef<{ sx: number; sy: number; wx: number; wy: number; isRect: boolean } | null>(
    null
  );
  const shapeDragRef = useRef<{ sx: number; sy: number } | null>(null);
  // C3: pointermove шлёт события чаще кадров — копим последнюю точку и красим
  // один раз за кадр, иначе каждый move клонирует весь Map клеток.
  const paintRafRef = useRef(0);
  const pendingPaintRef = useRef<{ wx: number; wy: number } | null>(null);
  // Правая кнопка — временный ластик (P1-10): инструмент не переключает.
  // Живёт здесь (ставит/снимает routing), читает paintAt страницы.
  const eraseOverrideRef = useRef(false);
  // Прямоугольник комнаты делят pointerup и панели модалок — наружу.
  const roomRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  function paintFogAt(a: UseMapInputArgs, wx: number, wy: number): boolean {
    if (!a.geom) return false;
    const cell = pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height);
    return cell ? a.onFogCell(cell.x, cell.y, eraseOverrideRef.current) : false;
  }

  function addFreePathAnchor(a: UseMapInputArgs, wx: number, wy: number) {
    if (!a.geom || (a.tool !== "road" && a.tool !== "river") ||
      !pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height)) return;
    const points = freePathRef.current ?? [];
    const last = points.at(-1);
    if (last && Math.hypot(wx - last.x, wy - last.y) < 0.06) return;
    if (points.length === 0 && !a.onFreePathBegin(a.tool)) return;
    const next = [...points, { x: wx, y: wy }];
    if (points.length === 0) freePathOriginRef.current = null;
    freePathKindRef.current = a.tool;
    freePathRef.current = next;
    a.onFreePathPreview({ anchors: next, hover: null });
  }

  function previewFreePath(a: UseMapInputArgs, wx: number, wy: number) {
    const anchors = freePathRef.current;
    if (!anchors || !a.geom) return;
    const hover = pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height)
      ? { x: wx, y: wy } : null;
    a.onFreePathPreview({ anchors, hover });
  }

  function finishFreePath(a: UseMapInputArgs, commit: boolean) {
    const points = freePathRef.current;
    const kind = freePathKindRef.current;
    const origin = freePathOriginRef.current;
    freePathRef.current = null;
    freePathKindRef.current = null;
    freePathOriginRef.current = null;
    if (points) a.onFreePathPreview(null);
    if (commit && points && points.length >= 2 && kind) {
      if (origin) a.onFreePathCommit(points, kind, origin);
      else a.onFreePathCommit(points, kind);
    }
  }

  function startFreePathFrom(point: { x: number; y: number }, kind: "road" | "river",
    origin: FreePathOrigin): boolean {
    const a = argsRef.current;
    if (!a.canEdit || !a.geom || !pixelToCell(a.geom.grid, point.x, point.y,
      a.geom.width, a.geom.height) || kind !== a.tool) return false;
    if (freePathRef.current) finishFreePath(a, false);
    freePathRef.current = [{ ...point }];
    freePathKindRef.current = kind;
    freePathOriginRef.current = origin;
    a.onFreePathPreview({ anchors: [{ ...point }], hover: null });
    return true;
  }

  function removeFreePathAnchor(a: UseMapInputArgs) {
    const points = freePathRef.current;
    if (!points) return;
    if (points.length <= 1) {
      finishFreePath(a, false);
      return;
    }
    const next = points.slice(0, -1);
    freePathRef.current = next;
    a.onFreePathPreview({ anchors: next, hover: null });
  }

  function moveFreePathHandle(a: UseMapInputArgs, wx: number, wy: number) {
    const drag = freePathDragRef.current;
    if (!drag || !a.geom || !pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height)) return;
    const dx = wx - drag.sx;
    const dy = wy - drag.sy;
    if (Math.hypot(dx, dy) < 0.001) return;
    drag.edited = drag.handleKind === "anchor"
      ? deformFreePath(drag.nodes, drag.anchorIndex, dx, dy)
      : moveSplineHandle(drag.nodes, drag.anchorIndex, drag.handleKind, dx, dy);
    a.onFreePathEditPreview({ pathId: drag.pathId, nodes: drag.edited });
  }

  function finishFreePathHandle(a: UseMapInputArgs, commit: boolean) {
    const drag = freePathDragRef.current;
    if (!drag) return;
    freePathDragRef.current = null;
    a.onFreePathEditPreview(null);
    if (commit && drag.edited) a.onFreePathEditCommit(drag.pathId, drag.edited);
  }

  function flushPaint() {
    const a = argsRef.current;
    paintRafRef.current = 0;
    const p = pendingPaintRef.current;
    pendingPaintRef.current = null;
    if (!p || !a.canEdit) return;
    if (a.tool === "fog" ? paintFogAt(a, p.wx, p.wy) : a.tools.paint.paintAt(p.wx, p.wy, { eraseOverride: eraseOverrideRef.current }))
      a.history.markStrokeChanged();
  }

  function cancelPendingPaint() {
    if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    paintRafRef.current = 0;
    flushPaint();
  }

  // Переключение в просмотр может застать незавершённый мазок/drag.
  // Закрываем жест и отменяем отложенный кадр, чтобы правка не дошла после
  // включения режима только для чтения.
  useEffect(() => {
    if (args.canEdit) return;
    const a = argsRef.current;
    if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    paintRafRef.current = 0;
    pendingPaintRef.current = null;
    const drag = objDragRef.current;
    if (drag) a.tools.objects.cancelDrag(drag.before);
    objDragRef.current = null;
    rectRef.current = null;
    shapeDragRef.current = null;
    strokeTouchRef.current = null;
    finishFreePath(a, false);
    finishFreePathHandle(a, false);
    eraseOverrideRef.current = false;
    a.setRectPreview(null);
    if (a.history.isPainting()) a.history.commitStroke();
  }, [args.canEdit]);

  useEffect(() => {
    if (args.freePathMode && args.freePathEditMode && args.tool === freePathDragRef.current?.kind) return;
    finishFreePathHandle(argsRef.current, false);
  }, [args.freePathMode, args.freePathEditMode, args.tool]);

  useEffect(() => {
    if (args.freePathMode && !args.freePathEditMode && args.tool === freePathKindRef.current) return;
    finishFreePath(argsRef.current, false);
  }, [args.freePathMode, args.freePathEditMode, args.tool]);

  // Пробел — временная панорама левой кнопкой.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = argsRef.current;
      if (!a.canEdit || !a.freePathMode || a.freePathEditMode ||
        (a.tool !== "road" && a.tool !== "river") || !freePathRef.current ||
        e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.code === "Enter") {
        e.preventDefault();
        finishFreePath(a, true);
      } else if (e.code === "Backspace") {
        e.preventDefault();
        removeFreePathAnchor(a);
      } else if (e.code === "Escape") {
        e.preventDefault();
        finishFreePath(a, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function capture(e: { target: unknown; pointerId: number }) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerDown(e: React.PointerEvent) {
    const a = argsRef.current;
    if (e.pointerType === "touch") return; // тач — ниже, по указателям
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      capture(e);
      dragRef.current = {
        button: e.button,
        sx: e.clientX,
        sy: e.clientY,
        ox: a.camera.camRef.current.ox,
        oy: a.camera.camRef.current.oy,
      };
      return;
    }
    if (e.button !== 0 || spaceDown || !a.canEdit || !a.geom) {
      // Правая кнопка — стереть, не переключая инструмент (P1-10). Средняя и
      // пробел — панорама (выше). Контекстное меню браузера прибито на canvas.
      if (e.button === 2 && !spaceDown && a.canEdit && a.geom) {
        if (a.freePathMode && (a.tool === "road" || a.tool === "river")) return;
        capture(e);
        a.history.beginStroke();
        eraseOverrideRef.current = true;
        const { wx, wy } = a.camera.toWorld(e);
        if (a.tool === "fog" ? paintFogAt(a, wx, wy) : a.tools.paint.paintAt(wx, wy, { eraseOverride: eraseOverrideRef.current }))
          a.history.markStrokeChanged();
      }
      return;
    }
    const geom = a.geom;
    const { wx, wy } = a.camera.toWorld(e);
    if (a.tool === "fog") {
      capture(e);
      a.history.beginStroke();
      if (paintFogAt(a, wx, wy)) a.history.markStrokeChanged();
      return;
    }
    // Выбор (пакет A + P1-3): клик по объекту — потянуть или панель; по пустому —
    // тянуть прямоугольник комнаты или панель создания. Двери на рёбрах —
    // только квадраты (на гексах создание дверей заблокировано в модалке).
    if (a.tool === "select") {
        const hit = a.selection.hitAt(wx, wy);
      if (hit) {
        const doc = a.documentRef.current;
        if (!doc) return;
        let ox = 0;
        let oy = 0;
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (hit.sel.kind === "room" && cell) {
          const rect = findRoomRect(doc, hit.sel.entityId);
          if (rect) {
            ox = cell.x - rect.x;
            oy = cell.y - rect.y;
          }
        }
        if (hit.sel.kind === "object") {
          const object = doc.layers.flatMap((layer) => layer.kind === "object" ? layer.items : []).find((item) => item.id === hit.sel.entityId);
          if (object) {
            ox = wx - object.transform.position.x;
            oy = wy - object.transform.position.y;
          }
        }
        capture(e);
        objDragRef.current = {
          sel: hit.sel,
          sx: e.clientX,
          sy: e.clientY,
          ox,
          oy,
          before: doc,
          moved: false,
        };
        a.selection.select(hit.sel);
      } else {
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (cell) {
          capture(e);
          rectRef.current = { sx: e.clientX, sy: e.clientY, wx, wy, isRect: false };
        }
      }
      return;
    }
    // Линейка (P2-1): первый клик — начало, второй — конец (замер остаётся,
    // пока выбран инструмент); клик по готовому — новый замер.
    if (a.tool === "ruler") {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      if (cell) a.tools.ruler.tap(cell);
      return;
    }
    // Подпись (P2-2): клик — модалка новой/правки. Мазков нет, undo — шагом.
    if (a.tool === "label") {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      if (cell) a.tools.label.open(cell.x, cell.y);
      return;
    }
    // Стены линией (Этап E): клик — вершина; финиш — дабл-клик/Enter (см. ниже).
    if (a.tool === "wall" && a.wallMode) {
      if (!pixelToCell(geom.grid, wx, wy, geom.width, geom.height)) return;
      a.tools.wall.tapVertex(wx, wy);
      return;
    }
    // Шейп (Этап E): drag от угла к углу; тач — два тапа (см. onTouchStart).
    if (a.tool === "shape") {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      if (cell) {
        capture(e);
        shapeDragRef.current = { sx: cell.x, sy: cell.y };
        a.tools.shape.startDrag(cell);
      }
      return;
    }
    // Инструменты-установщики (Этап F): клик — объект на карту, каждый — undo-шаг.
    const placeTool = a.tool;
    if (
      placeTool === "door" ||
      placeTool === "trap" ||
      placeTool === "chest" ||
      placeTool === "altar" ||
      placeTool === "marker" ||
      placeTool === "start" ||
      placeTool === "finish" ||
      placeTool === "asset"
    ) {
      a.tools.paint.placeObject(placeTool, wx, wy);
      return;
    }
    if (e.altKey) {
      // Пипетка поверх любого инструмента (P1-9 + Этап C).
      a.tools.paint.altPick(wx, wy);
      return;
    }
    if (a.freePathMode && (a.tool === "road" || a.tool === "river")) {
      if (a.freePathEditMode) {
        const hit = hitEditableFreePath(a.documentRef.current, a.tool, a.selectedFreePathId,
          { x: wx, y: wy }, a.camera.camRef.current.scale);
        if (hit?.join) a.onFreePathSelect(hit.pathId, hit.handleIndex, hit.join);
        else a.onFreePathSelect(hit?.pathId ?? null, hit?.handleIndex);
        if (hit?.handleIndex !== null && hit?.handleIndex !== undefined) {
          capture(e);
          freePathDragRef.current = { pathId: hit.pathId, kind: a.tool, nodes: hit.nodes,
            anchorIndex: hit.handleIndex, handleKind: hit.handleKind ?? "anchor",
            sx: wx, sy: wy, touchId: null, edited: null };
        }
        return;
      }
      if (e.detail === undefined || e.detail <= 1) addFreePathAnchor(a, wx, wy);
      return;
    }
    if (a.tool === "fill" || a.tool === "picker") {
      a.tools.paint.singleAction(wx, wy);
      return;
    }
    capture(e);
    a.history.beginStroke();
    const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
    if (cell && a.tools.paint.paintAt(wx, wy, { eraseOverride: eraseOverrideRef.current }))
      a.history.markStrokeChanged();
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = argsRef.current;
    if (e.pointerType === "touch") return;
    const d = dragRef.current;
    if (d) {
      a.camera.setCam((c) => ({ ...c, ox: d.ox + (e.clientX - d.sx), oy: d.oy + (e.clientY - d.sy) }));
      return;
    }
    if (!a.geom) return;
    const geom = a.geom;
    const { wx, wy } = a.camera.toWorld(e);
    if (freePathDragRef.current?.touchId === null) {
      if ((e.buttons & 1) !== 0) moveFreePathHandle(a, wx, wy);
      return;
    }
    if (freePathRef.current) {
      previewFreePath(a, wx, wy);
      return;
    }
    if (!a.canEdit) {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      a.setHover(cell ? cellKey(cell.x, cell.y) : null);
      return;
    }
    if (a.history.isPainting() && (e.buttons & 3) !== 0) {
      pendingPaintRef.current = { wx, wy };
      if (!paintRafRef.current)
        paintRafRef.current = requestAnimationFrame(() => flushPaint());
    }
    // Drag объекта / прямоугольник комнаты (выбор): живьём из снапшота.
    // Комнаты/ловушки/старт — на любой сетке; двери таскаются только на квадратах.
    const od = objDragRef.current;
    if (od && a.tool === "select" && (od.sel.kind !== "door" || geom.grid === "square")) {
      if (!od.moved && Math.hypot(e.clientX - od.sx, e.clientY - od.sy) > DRAG_THRESHOLD_PX)
        od.moved = true;
      if (od.moved) a.selection.moveSelectedTo(od, geom, wx, wy);
      return;
    }
    const rc = rectRef.current;
    if (rc && a.tool === "select") {
      if (!rc.isRect && Math.hypot(e.clientX - rc.sx, e.clientY - rc.sy) > DRAG_THRESHOLD_PX)
        rc.isRect = true;
      if (rc.isRect) {
        const ra = pixelToCell(geom.grid, rc.wx, rc.wy, geom.width, geom.height);
        const b = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (ra && b) {
          a.setRectPreview({
            x: Math.min(ra.x, b.x),
            y: Math.min(ra.y, b.y),
            w: Math.abs(ra.x - b.x) + 1,
            h: Math.abs(ra.y - b.y) + 1,
          });
        }
      }
      return;
    }
    // Живой конец полилинии стен следует за курсором (только если уже есть вершины).
    if (a.tool === "wall" && a.wallMode && a.wallDraft && a.wallDraft.length > 0) {
      const { wx: wwx, wy: wwy } = a.camera.toWorld(e);
      a.tools.wall.hoverLive(wwx, wwy);
    }
    // Шейп-drag: прямоугольник от стартового угла.
    const sd = shapeDragRef.current;
    if (sd && a.tool === "shape") {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      if (cell) a.tools.shape.moveDrag({ x: sd.sx, y: sd.sy }, cell);
      return;
    }
    // Живой конец замера следует за курсором, пока второй клик не зафиксировал.
    if (a.tool === "ruler" && a.ruler && !a.ruler.locked && a.canEdit) {
      const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
      a.tools.ruler.hover(cell);
    }
    const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
    a.setHover(cell ? cellKey(cell.x, cell.y) : null);
  }

  function onPointerUp(e: React.PointerEvent) {
    const a = argsRef.current;
    if (freePathDragRef.current?.touchId === null) {
      const { wx, wy } = a.camera.toWorld(e);
      moveFreePathHandle(a, wx, wy);
      finishFreePathHandle(a, true);
      return;
    }
    if (a.freePathMode && !a.freePathEditMode && (a.tool === "road" || a.tool === "river")) return;
    // Отпускание объекта (выбор): двинули — шаг в историю, клик — панель.
    const od = objDragRef.current;
    if (od) {
      objDragRef.current = null;
      eraseOverrideRef.current = false;
      if (od.moved) {
        a.history.push(od.before);
        a.selection.select(od.sel);
      } else {
        a.selection.select(od.sel);
        a.tools.objects.openPanel(od.sel);
      }
      return;
    }
    // Отпускание прямоугольника (выбор): тянули — комната, клик — создание.
    const rc = rectRef.current;
    if (rc) {
      rectRef.current = null;
      a.setRectPreview(null);
      if (rc.isRect && a.geom && a.canEdit) {
        const geom = a.geom;
        const ra = pixelToCell(geom.grid, rc.wx, rc.wy, geom.width, geom.height);
        const { wx, wy } = a.camera.toWorld(e);
        const b = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (ra && b) {
          const rect = {
            x: Math.min(ra.x, b.x),
            y: Math.min(ra.y, b.y),
            w: Math.abs(ra.x - b.x) + 1,
            h: Math.abs(ra.y - b.y) + 1,
          };
          roomRectRef.current = rect;
          a.tools.objects.roomRect(rect);
        }
      } else if (!rc.isRect && a.geom && a.canEdit) {
        const geom = a.geom;
        const { wx, wy } = a.camera.toWorld(e);
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (cell) a.tools.objects.create(cell, wx, wy);
      }
      return;
    }
    // Отпускание шейпа: применить прямоугольник содержимым.
    const shd = shapeDragRef.current;
    if (shd) {
      shapeDragRef.current = null;
      a.setRectPreview(null);
      if (a.geom && a.canEdit) {
        const { wx, wy } = a.camera.toWorld(e);
        const cell = pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height);
        if (cell) a.tools.shape.apply({ x: shd.sx, y: shd.sy }, cell);
      }
      return;
    }
    if (dragRef.current && e.pointerId !== undefined) dragRef.current = null;
    eraseOverrideRef.current = false;
    // Докрасить последний накопленный move до закрытия мазка, иначе штрих
    // оборвётся на кадр раньше отпускания.
    cancelPendingPaint();
    if (a.history.isPainting()) a.history.commitStroke();
  }

  function onPointerCancel() {
    const a = argsRef.current;
    finishFreePathHandle(a, false);
    // Отмена drag — откат к снапшоту, без истории.
    const od = objDragRef.current;
    if (od) {
      objDragRef.current = null;
      a.tools.objects.cancelDrag(od.before);
    }
    rectRef.current = null;
    a.setRectPreview(null);
    dragRef.current = null;
    eraseOverrideRef.current = false;
    cancelPendingPaint();
    if (a.history.isPainting()) a.history.commitStroke();
  }

  // Тач: один палец рисует (тем же мазком, что мышь), два — пан/зум.
  // Второй палец посреди мазка закрывает мазок и начинает пан/зум.
  function onTouchStart(e: React.TouchEvent) {
    const a = argsRef.current;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (touches.current.size === 1 && a.canEdit && a.geom && strokeTouchRef.current === null) {
      const geom = a.geom;
      const t = e.changedTouches[0];
      if (a.freePathMode && (a.tool === "road" || a.tool === "river")) {
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        if (a.freePathEditMode) {
          const hit = hitEditableFreePath(a.documentRef.current, a.tool, a.selectedFreePathId,
            { x: wx, y: wy }, a.camera.camRef.current.scale);
          if (hit?.join) a.onFreePathSelect(hit.pathId, hit.handleIndex, hit.join);
          else a.onFreePathSelect(hit?.pathId ?? null, hit?.handleIndex);
          if (hit?.handleIndex !== null && hit?.handleIndex !== undefined) {
            freePathDragRef.current = { pathId: hit.pathId, kind: a.tool, nodes: hit.nodes,
              anchorIndex: hit.handleIndex, handleKind: hit.handleKind ?? "anchor",
              sx: wx, sy: wy, touchId: t.identifier, edited: null };
          }
          return;
        }
        addFreePathAnchor(a, wx, wy);
        return;
      }
      if (a.tool === "fill" || a.tool === "picker") {
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        a.tools.paint.singleAction(wx, wy);
      } else if (a.tool === "ruler") {
        // Тач-замер тапами (без живого конца): тап — начало, тап — конец.
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (cell) a.tools.ruler.tap(cell);
      } else if (a.tool === "label") {
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (cell) a.tools.label.open(cell.x, cell.y);
      } else if (a.tool === "select") {
        // Тач: только тап-панели (drag объектов — мышь; на таче нет ховера).
        // Двери — только квадраты, остальное — везде.
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
      const hit = a.selection.hitAt(wx, wy);
        if (hit) {
          a.selection.select(hit.sel);
          a.tools.objects.openPanel(hit.sel);
        } else {
          const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
          if (cell) a.tools.objects.create(cell, wx, wy);
        }
      } else if (a.tool === "shape") {
        // Тач-шейп: тап — первый угол, тап — второй (прямоугольник готов).
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(geom.grid, wx, wy, geom.width, geom.height);
        if (cell) a.tools.shape.tap(cell);
      } else if (
        a.tool === "door" ||
        a.tool === "trap" ||
        a.tool === "chest" ||
        a.tool === "altar" ||
        a.tool === "marker" ||
        a.tool === "start" ||
        a.tool === "finish" ||
        a.tool === "asset"
      ) {
        // Тач-установка: тап — объект (иначе тач красил бы террейном).
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        a.tools.paint.placeObject(a.tool, wx, wy);
      } else {
        strokeTouchRef.current = t.identifier;
        a.history.beginStroke();
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        if (a.tool === "fog" ? paintFogAt(a, wx, wy) : a.tools.paint.paintAt(wx, wy, { eraseOverride: eraseOverrideRef.current }))
          a.history.markStrokeChanged();
      }
      return;
    }
    if (touches.current.size === 2) {
      // preventDefault не нужен: CSS touch-action:none уже гасит
      // нативные пан/зум, а в React-синтетике он только ругается.
      if (strokeTouchRef.current !== null) {
        strokeTouchRef.current = null;
        a.history.commitStroke();
      }
      finishFreePathHandle(a, false);
      const [ta, tb] = [...touches.current.values()];
      const canvas = a.canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      pinchRef.current = {
        dist: Math.hypot(ta.x - tb.x, ta.y - tb.y),
        scale: a.camera.camRef.current.scale,
        mx: (ta.x + tb.x) / 2 - rect.left,
        my: (ta.y + tb.y) / 2 - rect.top,
      };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    const a = argsRef.current;
    if (freePathDragRef.current && freePathDragRef.current.touchId !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== freePathDragRef.current?.touchId) continue;
        touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        moveFreePathHandle(a, wx, wy);
      }
      return;
    }
    if (!a.canEdit && strokeTouchRef.current !== null) {
      strokeTouchRef.current = null;
      if (a.history.isPainting()) a.history.commitStroke();
    }
    if (strokeTouchRef.current !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== strokeTouchRef.current) continue;
        touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        if (a.tool === "fog" ? paintFogAt(a, wx, wy) : a.tools.paint.paintAt(wx, wy, { eraseOverride: eraseOverrideRef.current }))
          a.history.markStrokeChanged();
      }
      return;
    }
    if (touches.current.size !== 2 || !pinchRef.current) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const [ta, tb] = [...touches.current.values()];
    const p = pinchRef.current;
    const dist = Math.hypot(ta.x - tb.x, ta.y - tb.y);
    if (dist < 1) return;
    const canvas = a.canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = (ta.x + tb.x) / 2 - rect.left;
    const my = (ta.y + tb.y) / 2 - rect.top;
    const scale = Math.min(240, Math.max(4, (p.scale * dist) / p.dist));
    const k = scale / a.camera.camRef.current.scale;
    a.camera.setCam((c) => ({
      scale,
      ox: mx - (p.mx - c.ox) * k - (mx - p.mx),
      oy: my - (p.my - c.oy) * k - (my - p.my),
    }));
  }

  function onTouchEnd(e: React.TouchEvent) {
    const a = argsRef.current;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === freePathDragRef.current?.touchId) {
        const t = e.changedTouches[i];
        const { wx, wy } = a.camera.touchToWorld(t.clientX, t.clientY);
        moveFreePathHandle(a, wx, wy);
        finishFreePathHandle(a, true);
      }
      if (e.changedTouches[i].identifier === strokeTouchRef.current) {
        strokeTouchRef.current = null;
        a.history.commitStroke();
      }
      touches.current.delete(e.changedTouches[i].identifier);
    }
    if (touches.current.size < 2) pinchRef.current = null;
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    spaceDown,
    finishFreePath: () => finishFreePath(argsRef.current, true),
    startFreePathFrom,
    cancelFreePath: () => finishFreePath(argsRef.current, false),
    removeFreePathAnchor: () => removeFreePathAnchor(argsRef.current),
    roomRectRef,
    rectRef,
    shapeDragRef,
  };
}
