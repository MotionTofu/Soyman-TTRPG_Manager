import { useEffect, useRef, useState } from "react";
import { pixelToCell } from "../../grid";
import type { MapFull, MapGrid } from "../../mapTypes";
import type { MapCells, MapDoorEdge } from "../../render";

// Выбор объектов карты (Фаза 1, Этап Selection): объектная семантика выбора,
// раньше жившая инлайном в MapEditorPage. Модель та же (индексы массивов,
// без multi-select/rotation/IDs). Pointer orchestration (threshold, capture,
// click-vs-drag, pan, touch, paint, rAF, room-прямоугольник) остаётся странице
// до Этапа Input — хук даёт только операции, которые Input будет вызывать.
// History хук не владеет: изменения уходят через commitChange.

// Слой объектов: выбор. Индекс — в массивы cells.
export type ObjSel =
  | { kind: "door"; index: number }
  | { kind: "trap"; index: number }
  | { kind: "marker"; index: number }
  | { kind: "room"; index: number }
  | { kind: "start"; index: -1 }
  | { kind: "finish"; index: -1 };

export function selectedKeyOf(s: ObjSel | null): string | null {
  if (!s) return null;
  return s.kind === "start" || s.kind === "finish" ? s.kind : `${s.kind}:${s.index}`;
}

// Хит-тест (P1-3): комнаты/ловушки/старт/финиш — на любой сетке (позиция
// клеточная); двери на рёбрах n/s/e/w — только квадраты, на гексах рёбер
// такой модели нет, и создание дверей там заблокировано.
// Приоритет: door → trap → marker → start/finish → room.
export function hitObjectAt(
  grid: MapGrid,
  width: number,
  height: number,
  cells: MapCells,
  wx: number,
  wy: number
): { sel: ObjSel } | null {
  const cell = pixelToCell(grid, wx, wy, width, height);
  if (!cell) return null;
  const cs = cells;
  if (grid === "square") {
    const fx = wx - cell.x;
    const fy = wy - cell.y;
    const dl = fx;
    const dr = 1 - fx;
    const dt = fy;
    const db = 1 - fy;
    const m = Math.min(dl, dr, dt, db);
    const edge = m === dl ? "w" : m === dr ? "e" : m === dt ? "n" : "s";
    const di = cs.doors.findIndex((d) => d.x === cell.x && d.y === cell.y && d.edge === edge);
    if (di !== -1) return { sel: { kind: "door", index: di } };
  }
  const ti = cs.traps.findIndex((t) => t.x === cell.x && t.y === cell.y);
  if (ti !== -1) return { sel: { kind: "trap", index: ti } };
  const mi = cs.markers.findIndex((m) => m.x === cell.x && m.y === cell.y);
  if (mi !== -1) return { sel: { kind: "marker", index: mi } };
  if (cs.start && cs.start.x === cell.x && cs.start.y === cell.y)
    return { sel: { kind: "start", index: -1 } };
  if (cs.finish && cs.finish.x === cell.x && cs.finish.y === cell.y)
    return { sel: { kind: "finish", index: -1 } };
  for (let i = cs.rooms.length - 1; i >= 0; i--) {
    const r = cs.rooms[i];
    if (cell.x >= r.x && cell.x < r.x + r.w && cell.y >= r.y && cell.y < r.y + r.h)
      return { sel: { kind: "room", index: i } };
  }
  return null;
}

export interface ObjMoveAnchor {
  ox: number;
  oy: number;
  before: MapCells;
}

// Жёсткое перемещение объекта из снапшота начала drag (без накопления):
// пара дверей едет жёстко тем же дельта-сдвигом, dragged — на новое ребро.
// Чистое ядро: возвращает черновик или null, если перемещать некуда/нельзя.
// Запись черновика (cellsRef+setCells, без history — шаг закроется на pointerup)
// делает хук, как раньше делал moveObjTo.
export function moveSelectedInCells(
  src: MapCells,
  sel: NonNullable<ObjSel>,
  anchor: { ox: number; oy: number },
  grid: MapGrid,
  width: number,
  height: number,
  wx: number,
  wy: number,
  clone: (c: MapCells) => MapCells
): MapCells | null {
  const cell = pixelToCell(grid, wx, wy, width, height);
  if (!cell) return null;
  const draft = clone(src);
  const s = sel;
  if (s.kind === "door") {
    // Рёбра n/s/e/w — квадратная модель; на гексах дверей нет (создание заблокировано).
    if (grid !== "square") return null;
    const d = src.doors[s.index];
    if (!d) return null;
    const fx = wx - cell.x;
    const fy = wy - cell.y;
    const m = Math.min(fx, 1 - fx, fy, 1 - fy);
    const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
    const dx = cell.x - d.x;
    const dy = cell.y - d.y;
    const members =
      d.pair != null
        ? src.doors.map((_, i) => i).filter((i) => src.doors[i].pair === d.pair)
        : [s.index];
    for (const i of members) {
      const nx = src.doors[i].x + dx;
      const ny = src.doors[i].y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return null;
    }
    for (const i of members) {
      draft.doors[i] = {
        ...draft.doors[i],
        x: src.doors[i].x + dx,
        y: src.doors[i].y + dy,
        edge: i === s.index ? edge : draft.doors[i].edge,
      };
    }
  } else if (s.kind === "trap") {
    if (!src.traps[s.index]) return null;
    draft.traps[s.index] = { ...draft.traps[s.index], x: cell.x, y: cell.y };
  } else if (s.kind === "marker") {
    if (!src.markers[s.index]) return null;
    draft.markers[s.index] = { ...draft.markers[s.index], x: cell.x, y: cell.y };
  } else if (s.kind === "start") {
    draft.start = { x: cell.x, y: cell.y };
  } else if (s.kind === "finish") {
    draft.finish = { x: cell.x, y: cell.y };
  } else if (s.kind === "room") {
    const r = src.rooms[s.index];
    if (!r) return null;
    draft.rooms[s.index] = {
      ...r,
      x: Math.max(0, Math.min(width - r.w, cell.x - anchor.ox)),
      y: Math.max(0, Math.min(height - r.h, cell.y - anchor.oy)),
    };
  }
  return draft;
}

// Удаление выбранного: парные двери — целиком по pair, start/finish → null.
// Возвращает { next, before } для commitChange или null, если удалять нечего
// (ветка else исходного deleteSelected).
export function deleteSelectedFromCells(
  live: MapCells,
  sel: ObjSel,
  clone: (c: MapCells) => MapCells
): { next: MapCells; before: MapCells } | null {
  const before = clone(live);
  if (sel.kind === "door" && before.doors[sel.index]) {
    const target = before.doors[sel.index];
    const doors =
      target.pair != null
        ? before.doors.filter((x) => x.pair !== target.pair)
        : before.doors.filter((_, i) => i !== sel.index);
    return { next: { ...before, doors }, before };
  } else if (sel.kind === "trap" && before.traps[sel.index]) {
    return { next: { ...before, traps: before.traps.filter((_, i) => i !== sel.index) }, before };
  } else if (sel.kind === "marker" && before.markers[sel.index]) {
    return { next: { ...before, markers: before.markers.filter((_, i) => i !== sel.index) }, before };
  } else if (sel.kind === "room" && before.rooms[sel.index]) {
    return { next: { ...before, rooms: before.rooms.filter((_, i) => i !== sel.index) }, before };
  } else if (sel.kind === "start") {
    return { next: { ...before, start: null }, before };
  } else if (sel.kind === "finish") {
    return { next: { ...before, finish: null }, before };
  }
  return null;
}

export interface ObjDragSession {
  sel: NonNullable<ObjSel>;
  ox: number;
  oy: number;
  before: MapCells;
}

interface UseMapSelectionArgs {
  cells: MapCells;
  cellsRef: { current: MapCells };
  setCells: (c: MapCells) => void;
  // Мутация с историей — снаружи (обычно mutateObjects страницы):
  // хук историей не владеет.
  commitChange: (next: MapCells, before: MapCells) => void;
  clone: (c: MapCells) => MapCells;
}

export function useMapSelection({
  cells,
  cellsRef,
  setCells,
  commitChange,
  clone,
}: UseMapSelectionArgs) {
  const [selected, setSelected] = useState<ObjSel | null>(null);
  const selectedRef = useRef<ObjSel | null>(null);
  selectedRef.current = selected;
  // Любая замена клеток выбор сбрасывает (панели и drag живут на рефах,
  // им не мешает).
  useEffect(() => {
    setSelected(null);
  }, [cells]);

  function select(sel: NonNullable<ObjSel>) {
    setSelected(sel);
  }

  function clearSelection() {
    setSelected(null);
  }

  function hitAt(map: MapFull | null, wx: number, wy: number): { sel: ObjSel } | null {
    if (!map) return null;
    return hitObjectAt(map.grid, map.width, map.height, cellsRef.current, wx, wy);
  }

  function moveSelectedTo(session: ObjDragSession, map: MapFull | null, wx: number, wy: number) {
    if (!map) return;
    const draft = moveSelectedInCells(
      session.before,
      session.sel,
      session,
      map.grid,
      map.width,
      map.height,
      wx,
      wy,
      clone
    );
    if (!draft) return;
    cellsRef.current = draft;
    setCells(draft);
  }

  function deleteSelected() {
    const s = selectedRef.current;
    if (!s) return;
    const r = deleteSelectedFromCells(cellsRef.current, s, clone);
    if (!r) return;
    commitChange(r.next, r.before);
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
