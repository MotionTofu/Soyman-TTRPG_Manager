import { cellCenter, pixelToCell } from "../../grid";
import { createGameplayEntity, setFinish, setStart } from "../../core/mutations/gameplay";
import { legacyDoorWorldPosition } from "../../core/migrateLegacy";
import { addMapObject } from "../../core/mutations/mapObjects";
import { mapAssetPackForId, resolveMapSymbol } from "../../assets/registry";
import type { GameplayEntity, LayerId, MapDocumentV5 } from "../../core/types";
import type { MapGeometry } from "../hooks/useMapSelection";
import type { MapDoorEdge, MapMarkerKind, MapTrapKind } from "../../render";
import type { PaintTool } from "../editorTypes";
import { NO_COMPATIBLE_LAYER_ERROR, resolveToolTargetLayer } from "./layerTargets";

// Создание объектов (Фаза 3A): новые gameplay entities создаются именно
// в target GameplayLayer (§41) — не в первом, не в legacy-layer-gameplay.
// Перемещение/удаление существующих — у Selection; здесь только создание,
// каждый клик — undo-шаг. Формы создания (draft-модалки) остаются у UI.

interface CreateObjectToolsArgs {
  geom: MapGeometry | null;
  lastTrapKind: MapTrapKind;
  markerKind: MapMarkerKind;
  assetId: string;
  activeLayerId: LayerId | null;
  onActiveLayer: (id: LayerId) => void;
  setActionError: (e: string | null) => void;
  documentRef: { current: MapDocumentV5 | null };
  commitDocument: (next: MapDocumentV5, before: MapDocumentV5) => void;
  newId: () => string;
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
    if (kind === "asset") {
      const visual = { type: "asset" as const, assetId: a.assetId };
      const asset = resolveMapSymbol(visual);
      if (!asset) {
        a.setActionError("Ресурс для карты не найден.");
        return;
      }
      if ("kind" in asset && !asset.image) {
        a.setActionError("Изображение ещё загружается. Повторите размещение через мгновение.");
        return;
      }
      const tgt = resolveToolTargetLayer(doc, a.activeLayerId, "object");
      if (!tgt.ok) {
        a.setActionError("Добавьте доступный слой «Свободные объекты» в панели слоёв.");
        return;
      }
      if (!tgt.keptActive) a.onActiveLayer(tgt.layerId);
      const requiredPack = mapAssetPackForId(a.assetId);
      if (!requiredPack) {
        a.setActionError("Ресурс для карты не найден.");
        return;
      }
      const packed = doc.assetPacks.some((pack) => pack.id === requiredPack.id && pack.version === requiredPack.version)
        ? doc
        : { ...doc, assetPacks: [...doc.assetPacks.filter((pack) => pack.id !== requiredPack.id), requiredPack] };
      const r = addMapObject(packed, tgt.layerId, {
        id: a.newId(),
        transform: { position: { x: wx, y: wy }, rotation: 0, scale: { x: 1, y: 1 } },
        visual,
      });
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось разместить объект.");
        return;
      }
      a.commitDocument(r.document, doc);
      a.setActionError(null);
      return;
    }
    // Target GameplayLayer через resolver (§41); нет — structured error.
    const tgt = resolveToolTargetLayer(doc, a.activeLayerId, "gameplay");
    if (!tgt.ok) {
      a.setActionError(NO_COMPATIBLE_LAYER_ERROR);
      return;
    }
    if (!tgt.keptActive) a.onActiveLayer(tgt.layerId);
    const layerId = tgt.layerId;
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
      const targetItems = targetLayerItems(doc, layerId);
      if (
        targetItems.some(
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

function gameplayItems(doc: MapDocumentV5): GameplayEntity[] {
  // Caps — legacy UX-лимиты: считаются по ВСЕМ gameplay-слоям.
  return doc.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : []));
}

/** Сущности конкретного слоя (для positional guards внутри target). */
function targetLayerItems(doc: MapDocumentV5, layerId: string): GameplayEntity[] {
  const l = doc.layers.find((x) => x.id === layerId);
  return l && l.kind === "gameplay" ? l.items : [];
}

export type ObjectTools = ReturnType<typeof createObjectTools>;
