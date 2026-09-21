import { cellCenter, pixelToCell } from "../../grid";
import { createGameplayEntity, setFinish, setStart } from "../../core/mutations/gameplay";
import { legacyDoorWorldPosition } from "../../core/migrateLegacy";
import type { MapDocumentV5 } from "../../core/types";
import type { MapGeometry } from "../hooks/useMapSelection";
import type { MapDoorEdge, MapMarkerKind, MapTrapKind } from "../../render";
import type { PaintTool } from "../editorTypes";

// Создание объектов (Фаза 2G): placement-routing door/trap/chest/altar/
// marker/start/finish через V5 create-мутации со stable IDs от editor factory.
// Перемещение/удаление существующих — у Selection; здесь только создание,
// каждый клик — undo-шаг. Формы создания (draft-модалки) остаются у UI.

interface CreateObjectToolsArgs {
  geom: MapGeometry | null;
  lastTrapKind: MapTrapKind;
  markerKind: MapMarkerKind;
  setActionError: (e: string | null) => void;
  documentRef: { current: MapDocumentV5 | null };
  commitDocument: (next: MapDocumentV5, before: MapDocumentV5) => void;
  newId: () => string;
}

function gameplayLayerId(doc: MapDocumentV5): string | null {
  const l = doc.layers.find((x) => x.kind === "gameplay");
  return l ? l.id : null;
}

export function createObjectTools(a: CreateObjectToolsArgs) {
  // Клик-установка объектов: дверь — обычная (вид правится выбором),
  // ловушка — последнего вида, старт/финиш — заменой. Каждый клик — undo-шаг.
  function placeObject(kind: PaintTool, wx: number, wy: number) {
    const g = a.geom;
    const doc = a.documentRef.current;
    if (!g || !doc) return;
    const cell = pixelToCell(g.grid, wx, wy, g.width, g.height);
    if (!cell) return;
    const layerId = gameplayLayerId(doc);
    if (!layerId) {
      a.setActionError("В документе нет gameplay-слоя.");
      return;
    }
    const c = cellCenter(g.grid, cell.x, cell.y);
    if (kind === "door") {
      if (g.grid !== "square") {
        a.setActionError("Двери — только на квадратах: на гексах рёберной модели нет.");
        return;
      }
      const fx = wx - cell.x;
      const fy = wy - cell.y;
      const m = Math.min(fx, 1 - fx, fy, 1 - fy);
      const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
      const pos = legacyDoorWorldPosition(g.grid, cell.x, cell.y, edge);
      const orientation = edge === "n" ? 0 : edge === "e" ? 90 : edge === "s" ? 180 : 270;
      const items = gameplayItems(doc);
      if (items.filter((e) => e.kind === "door").length >= 400) {
        a.setActionError("Дверей слишком много (максимум 400).");
        return;
      }
      if (
        items.some(
          (e) =>
            e.kind === "door" && e.position.x === pos.x && e.position.y === pos.y,
        )
      ) {
        a.setActionError("Здесь уже есть дверь.");
        return;
      }
      const r = createGameplayEntity(doc, layerId, {
        id: a.newId(),
        kind: "door",
        position: pos,
        orientation,
        doorKind: "door",
        secret: false,
        pairedDoorId: null,
      });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось поставить дверь.");
        return;
      }
      a.commitDocument(r.document, doc);
    } else if (kind === "trap") {
      const items = gameplayItems(doc);
      if (items.filter((e) => e.kind === "trap").length >= 300) {
        a.setActionError("Ловушек слишком много (максимум 300).");
        return;
      }
      const r = createGameplayEntity(doc, layerId, {
        id: a.newId(),
        kind: "trap",
        position: { x: c.cx, y: c.cy },
        trapKind: a.lastTrapKind,
      });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось поставить ловушку.");
        return;
      }
      a.commitDocument(r.document, doc);
    } else if (kind === "chest" || kind === "altar" || kind === "marker") {
      const items = gameplayItems(doc);
      if (items.filter((e) => e.kind === "marker").length >= 300) {
        a.setActionError("Маркеров слишком много (максимум 300).");
        return;
      }
      const r = createGameplayEntity(doc, layerId, {
        id: a.newId(),
        kind: "marker",
        position: { x: c.cx, y: c.cy },
        markerKind: kind === "marker" ? a.markerKind : kind,
      });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось поставить маркер.");
        return;
      }
      a.commitDocument(r.document, doc);
    } else if (kind === "start") {
      const r = setStart(doc, layerId, { id: a.newId(), position: { x: c.cx, y: c.cy } });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось поставить старт.");
        return;
      }
      if (r.changed) a.commitDocument(r.document, doc);
    } else if (kind === "finish") {
      const r = setFinish(doc, layerId, { id: a.newId(), position: { x: c.cx, y: c.cy } });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось поставить финиш.");
        return;
      }
      if (r.changed) a.commitDocument(r.document, doc);
    } else {
      return;
    }
    a.setActionError(null);
  }

  return { placeObject };
}

function gameplayItems(doc: MapDocumentV5) {
  const l = doc.layers.find((x) => x.kind === "gameplay");
  return l && l.kind === "gameplay" ? l.items : [];
}

export type ObjectTools = ReturnType<typeof createObjectTools>;
