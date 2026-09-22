// Gameplay CRUD/move по EntityId + door pairing + setStart/setFinish.
// Удаление двери чистит пару у партнёра (без dangling). pairedDoorId меняется
// только через pair/unpair API (update его не трогает).

import type {
  EntityId,
  GameplayDoor,
  GameplayEntity,
  GameplayLayer,
  MapDocumentV5,
  Vec2,
} from "../types";
import { translateShape } from "./geometry";
import {
  changed,
  collectIds,
  findLayer,
  isFiniteVec,
  noChange,
  withReplacedLayer,
  mutationError,
  type MutationResult,
} from "./helpers";

interface ResolvedEntity {
  layerIndex: number;
  layer: GameplayLayer;
  itemIndex: number;
  entity: GameplayEntity;
}

function resolveEntity(doc: MapDocumentV5, id: string): ResolvedEntity | { error: MutationResult } {
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (layer.kind !== "gameplay") continue;
    const ii = layer.items.findIndex((e) => e.id === id);
    if (ii !== -1) return { layerIndex: li, layer, itemIndex: ii, entity: layer.items[ii] };
  }
  return {
    error: mutationError("gameplay.unknown-id", "id", `entity "${id}" does not exist`),
  };
}

function resolveGameplayLayer(
  doc: MapDocumentV5,
  layerId: string,
): { index: number; layer: GameplayLayer } | { error: MutationResult } {
  const found = findLayer(doc, layerId);
  if (!found) {
    return {
      error: mutationError("gameplay.unknown-layer", "layerId", `layer "${layerId}" does not exist`),
    };
  }
  if (found.layer.kind !== "gameplay") {
    return {
      error: mutationError(
        "gameplay.wrong-layer-kind",
        "layerId",
        `layer "${layerId}" is ${found.layer.kind}, not gameplay`,
      ),
    };
  }
  return { index: found.index, layer: found.layer };
}

const ENTITY_KINDS = ["room", "door", "trap", "marker", "start", "finish"] as const;

function checkEntityShape(entity: GameplayEntity): MutationResult | null {
  if (!ENTITY_KINDS.includes(entity.kind as (typeof ENTITY_KINDS)[number])) {
    return mutationError("gameplay.unknown-kind", "entity.kind", "expected room | door | trap | marker | start | finish");
  }
  return null;
}

/** Создать gameplay entity (id назначен caller'ом; пара дверей — только null). */
export function createGameplayEntity(
  doc: MapDocumentV5,
  layerId: string,
  entity: GameplayEntity,
): MutationResult {
  const resolved = resolveGameplayLayer(doc, layerId);
  if ("error" in resolved) return resolved.error;
  const bad = checkEntityShape(entity);
  if (bad) return bad;
  if (typeof entity.id !== "string" || entity.id.length === 0) {
    return mutationError("gameplay.bad-id", "entity.id", "entity id must be a non-empty string");
  }
  if (collectIds(doc).has(entity.id)) {
    return mutationError(
      "gameplay.duplicate-id",
      "entity.id",
      `id "${entity.id}" already exists anywhere in document`,
    );
  }
  if (entity.kind === "door" && entity.pairedDoorId !== null) {
    return mutationError(
      "gameplay.pair-on-create",
      "entity.pairedDoorId",
      "create doors unpaired, then use pairDoors",
    );
  }
  const items = [...resolved.layer.items, entity];
  const result = changed(withReplacedLayer(doc, resolved.index, { ...resolved.layer, items }));
  if (result.ok) return { ...result, entityId: entity.id };
  return result;
}

/**
 * Типизированный update через updater. id/kind/pairedDoorId неизменны
 * (пары — только через pair/unpair API). Без изменений → no-op.
 */
export function updateGameplayEntity(
  doc: MapDocumentV5,
  id: string,
  updater: (draft: GameplayEntity) => GameplayEntity,
): MutationResult {
  const resolved = resolveEntity(doc, id);
  if ("error" in resolved) return resolved.error;
  const { layerIndex, layer, itemIndex, entity } = resolved;
  const clone: GameplayEntity = structuredClone(entity);
  const updated = updater(clone);
  if (updated.id !== entity.id) {
    return mutationError("gameplay.id-immutable", "entity.id", "entity id cannot change in update");
  }
  if (updated.kind !== entity.kind) {
    return mutationError("gameplay.kind-immutable", "entity.kind", "entity kind cannot change in update");
  }
  if (
    entity.kind === "door" &&
    updated.kind === "door" &&
    updated.pairedDoorId !== (entity as GameplayDoor).pairedDoorId
  ) {
    return mutationError(
      "gameplay.pair-immutable",
      "entity.pairedDoorId",
      "change pairs only via pairDoors/unpairDoor",
    );
  }
  if (JSON.stringify(updated) === JSON.stringify(entity)) return noChange(doc);
  const items = [...layer.items];
  items[itemIndex] = updated;
  return changed(withReplacedLayer(doc, layerIndex, { ...layer, items }));
}

/** Удалить entity; отсутствующая → no-op. Пара двери чистится у партнёра. */
export function deleteGameplayEntity(doc: MapDocumentV5, id: string): MutationResult {
  const resolved = resolveEntity(doc, id);
  if ("error" in resolved) {
    // Idempotent delete: отсутствующая сущность — валидный no-op.
    return noChange(doc);
  }
  const { layerIndex, layer, itemIndex, entity } = resolved;
  let items = layer.items.filter((_, i) => i !== itemIndex);
  if (entity.kind === "door" && entity.pairedDoorId !== null) {
    const partnerId = entity.pairedDoorId;
    items = items.map((e) =>
      e.kind === "door" && e.id === partnerId ? { ...e, pairedDoorId: null } : e,
    );
  }
  return changed(withReplacedLayer(doc, layerIndex, { ...layer, items }));
}

/** Сдвиг на delta: точки — position, комнаты — translateShape. */
export function moveGameplayEntity(doc: MapDocumentV5, id: string, delta: Vec2): MutationResult {
  if (!isFiniteVec(delta)) {
    return mutationError("gameplay.bad-delta", "delta", "delta must be finite { x, y }");
  }
  if (delta.x === 0 && delta.y === 0) return noChange(doc);
  const resolved = resolveEntity(doc, id);
  if ("error" in resolved) return resolved.error;
  const { layerIndex, layer, itemIndex, entity } = resolved;
  let moved: GameplayEntity;
  if (entity.kind === "room") {
    moved = { ...entity, geometry: translateShape(entity.geometry, delta) };
  } else if (
    entity.kind === "door" ||
    entity.kind === "trap" ||
    entity.kind === "marker" ||
    entity.kind === "start" ||
    entity.kind === "finish"
  ) {
    moved = {
      ...entity,
      position: { x: entity.position.x + delta.x, y: entity.position.y + delta.y },
    };
  } else {
    return mutationError("gameplay.unknown-kind", "id", "unknown gameplay kind");
  }
  const items = [...layer.items];
  items[itemIndex] = moved;
  return changed(withReplacedLayer(doc, layerIndex, { ...layer, items }));
}

function asDoor(
  doc: MapDocumentV5,
  id: string,
): { door: GameplayDoor; layerIndex: number; layer: GameplayLayer; itemIndex: number } | { error: MutationResult } {
  const resolved = resolveEntity(doc, id);
  if ("error" in resolved) return resolved;
  if (resolved.entity.kind !== "door") {
    return {
      error: mutationError("gameplay.wrong-entity-kind", "id", `entity "${id}" is ${resolved.entity.kind}, not door`),
    };
  }
  return { door: resolved.entity, layerIndex: resolved.layerIndex, layer: resolved.layer, itemIndex: resolved.itemIndex };
}

function setPair(
  doc: MapDocumentV5,
  layerIndex: number,
  layer: GameplayLayer,
  doorId: string,
  pairedDoorId: EntityId | null,
): MapDocumentV5 {
  const items = layer.items.map((e) =>
    e.kind === "door" && e.id === doorId ? { ...e, pairedDoorId } : e,
  );
  return withReplacedLayer(doc, layerIndex, { ...layer, items });
}

function setPairOn(doc: MapDocumentV5, doorId: string, pairedDoorId: EntityId | null): MapDocumentV5 {
  const r = resolveEntity(doc, doorId);
  if ("error" in r || r.entity.kind !== "door") return doc;
  return setPair(doc, r.layerIndex, r.layer, doorId, pairedDoorId);
}

/**
 * Связать две двери: разрывает предыдущие пары обеих, ставит взаимную.
 * Уже связанные друг с другом → no-op.
 */
export function pairDoors(doc: MapDocumentV5, aId: string, bId: string): MutationResult {
  if (aId === bId) {
    return mutationError("gameplay.self-pair", "id", "door cannot pair with itself");
  }
  const ra = asDoor(doc, aId);
  if ("error" in ra) return ra.error;
  const rb = asDoor(doc, bId);
  if ("error" in rb) return rb.error;

  if (ra.door.pairedDoorId === bId && rb.door.pairedDoorId === aId) return noChange(doc);

  let next = doc;
  if (ra.door.pairedDoorId !== null) {
    const exA = ra.door.pairedDoorId;
    next = setPairOn(next, aId, null);
    next = setPairOn(next, exA, null);
  }
  const rb2 = asDoor(next, bId);
  if ("error" in rb2) return rb2.error;
  if (rb2.door.pairedDoorId !== null) {
    const exB = rb2.door.pairedDoorId;
    next = setPairOn(next, bId, null);
    next = setPairOn(next, exB, null);
  }
  next = setPairOn(next, aId, bId);
  next = setPairOn(next, bId, aId);
  return changed(next);
}

/** Разорвать пару двери (обе стороны). Уже без пары → no-op. */
export function unpairDoor(doc: MapDocumentV5, id: string): MutationResult {
  const r = asDoor(doc, id);
  if ("error" in r) return r.error;
  if (r.door.pairedDoorId === null) return noChange(doc);
  const partnerId = r.door.pairedDoorId;
  let next = setPair(doc, r.layerIndex, r.layer, id, null);
  const rp = resolveEntity(next, partnerId);
  if (!("error" in rp) && rp.entity.kind === "door") {
    next = setPair(next, rp.layerIndex, rp.layer, partnerId, null);
  }
  return changed(next);
}

/** Editor-операция: заменить Start/Finish (синглтон), не трогая validator. */
export function setStart(
  doc: MapDocumentV5,
  layerId: string,
  spec: { id: EntityId; position: Vec2 },
): MutationResult {
  return setSingleton(doc, layerId, "start", spec);
}

export function setFinish(
  doc: MapDocumentV5,
  layerId: string,
  spec: { id: EntityId; position: Vec2 },
): MutationResult {
  return setSingleton(doc, layerId, "finish", spec);
}

function setSingleton(
  doc: MapDocumentV5,
  layerId: string,
  kind: "start" | "finish",
  spec: { id: EntityId; position: Vec2 },
): MutationResult {
  const resolved = resolveGameplayLayer(doc, layerId);
  if ("error" in resolved) return resolved.error;
  if (typeof spec.id !== "string" || spec.id.length === 0) {
    return mutationError("gameplay.bad-id", "spec.id", "entity id must be a non-empty string");
  }
  if (!isFiniteVec(spec.position)) {
    return mutationError("gameplay.bad-position", "spec.position", "position must be finite { x, y }");
  }
  // Start/Finish — map-level singletons (3A §43): существующий ищется ВО ВСЕХ
  // gameplay-слоях, новый создаётся в target. Старый в другом слое
  // удаляется той же set semantics.
  const existingEverywhere: Array<{ layerIndex: number; id: string; position: { x: number; y: number } }> = [];
  doc.layers.forEach((l, li) => {
    if (l.kind !== "gameplay") return;
    for (const e of l.items) {
      if ((e.kind === "start" || e.kind === "finish") && e.kind === kind) {
        existingEverywhere.push({ layerIndex: li, id: e.id, position: { ...e.position } });
      }
    }
  });
  if (
    existingEverywhere.length === 1 &&
    existingEverywhere[0].id === spec.id &&
    doc.layers[existingEverywhere[0].layerIndex].id === resolved.layer.id &&
    existingEverywhere[0].position.x === spec.position.x &&
    existingEverywhere[0].position.y === spec.position.y
  ) {
    return noChange(doc);
  }
  const removedIds = new Set(existingEverywhere.map((e) => e.id));
  const ids = collectIds(doc);
  for (const rid of removedIds) ids.delete(rid);
  if (ids.has(spec.id)) {
    return mutationError(
      "gameplay.duplicate-id",
      "spec.id",
      `id "${spec.id}" already exists anywhere in document`,
    );
  }
  // Чистим kind во всех gameplay-слоях, создаём в target.
  let next = doc;
  doc.layers.forEach((l, li) => {
    if (l.kind !== "gameplay") return;
    if (!l.items.some((e) => e.kind === kind)) return;
    next = withReplacedLayer(next, li, {
      ...l,
      items: l.items.filter((e) => e.kind !== kind),
    });
  });
  const target = findLayer(next, resolved.layer.id);
  if (!target || target.layer.kind !== "gameplay") {
    return mutationError("gameplay.no-layer", "layerId", "target gameplay layer vanished");
  }
  const items = target.layer.items.filter((e) => e.kind !== kind);
  items.push(
    kind === "start"
      ? { id: spec.id, kind: "start" as const, position: { ...spec.position } }
      : { id: spec.id, kind: "finish" as const, position: { ...spec.position } },
  );
  return changed(withReplacedLayer(next, target.index, { ...target.layer, items }));
}

export type { ResolvedEntity };
