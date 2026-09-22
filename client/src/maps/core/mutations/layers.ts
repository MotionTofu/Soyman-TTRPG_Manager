// Layer Mutation Core (Фаза 3A, §45–56).
// Операции над document.layers[]: create/delete/rename/visible/locked/
// opacity/move. Семантика как у content-мутаций 2E: immutable, changed:false
// при no-op, structured errors, output valid V5, untouched — по reference.
// ID нового слоя приходит извне (editor createLayerId, §48); Core UUID не
// вызывает. Global ID uniqueness — через collectIds (§49).

import type {
  EntityId,
  GameplayLayer,
  LabelLayer,
  LayerId,
  MapDocumentV5,
  MapLayer,
  PathLayer,
  TerrainCellLayer,
} from "../types";
import { collectIds, findLayer, withReplacedLayer } from "./helpers";
import { changed, mutationError, noChange, type MutationResult } from "./types";

export interface LayerSpec {
  id: string;
  name: string;
}

function checkNewId(doc: MapDocumentV5, id: unknown): { ok: true } | { ok: false; error: MutationResult } {
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: mutationError("layer.bad-id", "spec.id", "layer id must be a non-empty string"),
    };
  }
  if (collectIds(doc).has(id)) {
    return {
      ok: false,
      error: mutationError(
        "layer.duplicate-id",
        "spec.id",
        `id "${id}" already exists anywhere in document`,
      ),
    };
  }
  return { ok: true };
}

function checkName(name: unknown): { ok: true; name: string } | { ok: false; error: MutationResult } {
  if (typeof name !== "string" || name.trim().length === 0) {
    return {
      ok: false,
      error: mutationError("layer.bad-name", "name", "layer name must be a non-empty string"),
    };
  }
  return { ok: true, name };
}

function baseOf(spec: LayerSpec): { id: LayerId; name: string; visible: boolean; locked: boolean; opacity: number } {
  return { id: spec.id, name: spec.name, visible: true, locked: false, opacity: 1 };
}

/** Новый TerrainCellLayer: representation cells, default builtin terrain/plain (§50). */
export function createTerrainLayer(doc: MapDocumentV5, spec: LayerSpec): MutationResult {
  const idCheck = checkNewId(doc, spec.id);
  if (!idCheck.ok) return idCheck.error;
  const nameCheck = checkName(spec.name);
  if (!nameCheck.ok) return nameCheck.error;
  const layer: TerrainCellLayer = {
    ...baseOf(spec),
    name: nameCheck.name,
    kind: "terrain",
    defaultMaterial: { type: "builtin", key: "terrain/plain" },
    representation: "cells",
    cells: [],
  };
  return changed({ ...doc, layers: [...doc.layers, layer] });
}

/** Новый PathLayer: paths [] (§51). */
export function createPathLayer(doc: MapDocumentV5, spec: LayerSpec): MutationResult {
  const idCheck = checkNewId(doc, spec.id);
  if (!idCheck.ok) return idCheck.error;
  const nameCheck = checkName(spec.name);
  if (!nameCheck.ok) return nameCheck.error;
  const layer: PathLayer = { ...baseOf(spec), name: nameCheck.name, kind: "path", paths: [] };
  return changed({ ...doc, layers: [...doc.layers, layer] });
}

/** Новый GameplayLayer: items [] (§52). */
export function createGameplayLayer(doc: MapDocumentV5, spec: LayerSpec): MutationResult {
  const idCheck = checkNewId(doc, spec.id);
  if (!idCheck.ok) return idCheck.error;
  const nameCheck = checkName(spec.name);
  if (!nameCheck.ok) return nameCheck.error;
  const layer: GameplayLayer = { ...baseOf(spec), name: nameCheck.name, kind: "gameplay", items: [] };
  return changed({ ...doc, layers: [...doc.layers, layer] });
}

/** Новый LabelLayer: items [] (§53). */
export function createLabelLayer(doc: MapDocumentV5, spec: LayerSpec): MutationResult {
  const idCheck = checkNewId(doc, spec.id);
  if (!idCheck.ok) return idCheck.error;
  const nameCheck = checkName(spec.name);
  if (!nameCheck.ok) return nameCheck.error;
  const layer: LabelLayer = { ...baseOf(spec), name: nameCheck.name, kind: "label", items: [] };
  return changed({ ...doc, layers: [...doc.layers, layer] });
}

/**
 * Удалить слой целиком (§55). Gameplay-слой с дверями: surviving pairedDoorId,
 * ссылающиеся на удалённые двери, обнуляются (§56) — output valid.
 */
export function deleteLayer(doc: MapDocumentV5, layerId: string): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  const removed = doc.layers[found.index];
  const removedDoorIds = new Set<string>();
  if (removed.kind === "gameplay") {
    for (const e of removed.items) {
      if (e.kind === "door") removedDoorIds.add(e.id);
    }
  }
  const layers: MapLayer[] = [];
  for (let i = 0; i < doc.layers.length; i++) {
    if (i === found.index) continue;
    const l = doc.layers[i];
    if (removedDoorIds.size > 0 && l.kind === "gameplay") {
      let scrubbed = false;
      const items = l.items.map((e) => {
        if (e.kind === "door" && e.pairedDoorId !== null && removedDoorIds.has(e.pairedDoorId)) {
          scrubbed = true;
          return { ...e, pairedDoorId: null };
        }
        return e;
      });
      layers.push(scrubbed ? { ...l, items } : l);
      continue;
    }
    layers.push(l);
  }
  return changed({ ...doc, layers });
}

/** Переименовать слой. То же имя → no-op. */
export function renameLayer(doc: MapDocumentV5, layerId: string, name: string): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  const nameCheck = checkName(name);
  if (!nameCheck.ok) return nameCheck.error;
  if (found.layer.name === nameCheck.name) return noChange(doc);
  return changed(withReplacedLayer(doc, found.index, { ...found.layer, name: nameCheck.name }));
}

/** Видимость слоя. То же значение → no-op. */
export function setLayerVisible(doc: MapDocumentV5, layerId: string, visible: boolean): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  if (typeof visible !== "boolean") {
    return mutationError("layer.bad-visible", "visible", "visible must be a boolean");
  }
  if (found.layer.visible === visible) return noChange(doc);
  return changed(withReplacedLayer(doc, found.index, { ...found.layer, visible }));
}

/** Lock слоя. То же значение → no-op. */
export function setLayerLocked(doc: MapDocumentV5, layerId: string, locked: boolean): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  if (typeof locked !== "boolean") {
    return mutationError("layer.bad-locked", "locked", "locked must be a boolean");
  }
  if (found.layer.locked === locked) return noChange(doc);
  return changed(withReplacedLayer(doc, found.index, { ...found.layer, locked }));
}

/** Opacity слоя: finite 0..1, иначе structured error. То же значение → no-op. */
export function setLayerOpacity(doc: MapDocumentV5, layerId: string, opacity: number): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    return mutationError("layer.bad-opacity", "opacity", "opacity must be a finite number in [0,1]");
  }
  if (found.layer.opacity === opacity) return noChange(doc);
  return changed(withReplacedLayer(doc, found.index, { ...found.layer, opacity }));
}

/**
 * Переместить слой на позицию toIndex (clamp в диапазон). Та же позиция → no-op.
 * UI Move Up/Down вычисляет индекс (вверх стека = +1, последний = верхний).
 */
export function moveLayer(doc: MapDocumentV5, layerId: string, toIndex: number): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("layer.not-found", "layerId", `layer "${layerId}" does not exist`);
  }
  if (!Number.isInteger(toIndex)) {
    return mutationError("layer.bad-index", "toIndex", "toIndex must be an integer");
  }
  const clamped = Math.max(0, Math.min(doc.layers.length - 1, toIndex));
  if (clamped === found.index) return noChange(doc);
  const layers = doc.layers.filter((_, i) => i !== found.index);
  layers.splice(clamped, 0, found.layer);
  return changed({ ...doc, layers });
}

export interface EntityOwnership {
  /** ID слоя-владельца. */
  layerId: LayerId;
  /** Индекс слоя в document.layers. */
  layerIndex: number;
  kind: MapLayer["kind"];
}

/**
 * Pure ownership lookup: entityId → слой-владелец (§88).
 * Не хранить stale duplicate ownership map в React state — спрашивать Core.
 * Охватывает paths/objects/scatter/labels/gameplay (+ mask chunks).
 */
export function findEntityLayer(doc: MapDocumentV5, entityId: EntityId): EntityOwnership | null {
  if (typeof entityId !== "string" || entityId.length === 0) return null;
  for (let i = 0; i < doc.layers.length; i++) {
    const l = doc.layers[i];
    let owns = false;
    if (l.kind === "terrain" && l.representation === "mask") {
      owns = l.mask.chunks.some((c) => c.id === entityId);
    } else if (l.kind === "path") {
      owns = l.paths.some((p) => p.id === entityId);
    } else if (l.kind === "object") {
      owns = l.items.some((o) => o.id === entityId);
    } else if (l.kind === "scatter") {
      owns = l.areas.some((a) => a.id === entityId);
    } else if (l.kind === "label") {
      owns = l.items.some((x) => x.id === entityId);
    } else if (l.kind === "gameplay") {
      owns = l.items.some((e) => e.id === entityId);
    }
    if (owns) return { layerId: l.id, layerIndex: i, kind: l.kind };
  }
  return null;
}
