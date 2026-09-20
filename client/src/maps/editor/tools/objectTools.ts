import { pixelToCell } from "../../grid";
import type { MapFull } from "../../mapTypes";
import type { MapCells, MapDoorEdge, MapMarkerKind, MapTrapKind } from "../../render";
import type { PaintTool } from "../editorTypes";

// Создание объектов (Фаза 1, Tool Controller): placement-routing
// door/trap/chest/altar/marker/start/finish. Перемещение/удаление
// существующих — у Selection; здесь только создание, каждый клик — undo-шаг.
// Формы создания (draft-модалки) остаются у UI.

interface CreateObjectToolsArgs {
  map: MapFull | null;
  lastTrapKind: MapTrapKind;
  markerKind: MapMarkerKind;
  setActionError: (e: string | null) => void;
  cellsRef: { current: MapCells };
  commitChange: (next: MapCells, before: MapCells) => void;
  clone: (c: MapCells) => MapCells;
}

export function createObjectTools(a: CreateObjectToolsArgs) {
  // Клик-установка объектов (Этап F): дверь — обычная (вид правится выбором),
  // ловушка — последнего вида, старт/финиш — заменой. Каждый клик — undo-шаг.
  function placeObject(kind: PaintTool, wx: number, wy: number) {
    if (!a.map) return;
    const cell = pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height);
    if (!cell) return;
    const before = a.clone(a.cellsRef.current);
    if (kind === "door") {
      if (a.map.grid !== "square") {
        a.setActionError("Двери — только на квадратах: на гексах рёберной модели нет.");
        return;
      }
      if (before.doors.length >= 400) {
        a.setActionError("Дверей слишком много (максимум 400).");
        return;
      }
      const fx = wx - cell.x;
      const fy = wy - cell.y;
      const m = Math.min(fx, 1 - fx, fy, 1 - fy);
      const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
      if (before.doors.some((d) => d.x === cell.x && d.y === cell.y && d.edge === edge)) {
        a.setActionError("Здесь уже есть дверь.");
        return;
      }
      a.commitChange(
        { ...before, doors: [...before.doors, { x: cell.x, y: cell.y, edge, kind: "door", secret: false, pair: null }] },
        before
      );
    } else if (kind === "trap") {
      if (before.traps.length >= 300) {
        a.setActionError("Ловушек слишком много (максимум 300).");
        return;
      }
      a.commitChange({ ...before, traps: [...before.traps, { x: cell.x, y: cell.y, kind: a.lastTrapKind }] }, before);
    } else if (kind === "chest" || kind === "altar") {
      if (before.markers.length >= 300) {
        a.setActionError("Маркеров слишком много (максимум 300).");
        return;
      }
      a.commitChange({ ...before, markers: [...before.markers, { x: cell.x, y: cell.y, kind }] }, before);
    } else if (kind === "marker") {
      if (before.markers.length >= 300) {
        a.setActionError("Маркеров слишком много (максимум 300).");
        return;
      }
      a.commitChange({ ...before, markers: [...before.markers, { x: cell.x, y: cell.y, kind: a.markerKind }] }, before);
    } else if (kind === "start") {
      a.commitChange({ ...before, start: { x: cell.x, y: cell.y } }, before);
    } else if (kind === "finish") {
      a.commitChange({ ...before, finish: { x: cell.x, y: cell.y } }, before);
    } else {
      return;
    }
    a.setActionError(null);
  }

  return { placeObject };
}

export type ObjectTools = ReturnType<typeof createObjectTools>;
