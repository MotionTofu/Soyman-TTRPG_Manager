// Детерминированные legacy IDs и скелет слоёв миграции (ADR-0003 §D.3–D.4).
// Никакого random/UUID при миграции: повторный вызов на том же входе —
// canonical-identical документ.

import type { EntityId, LayerId } from "./types";

export const LEGACY_LAYER_IDS = {
  terrain: "lyr-terrain",
  river: "lyr-river",
  road: "lyr-road",
  objects: "lyr-objects",
  scatter: "lyr-scatter",
  gameplay: "lyr-gameplay",
  labels: "lyr-labels",
} as const;

export interface LegacyLayerSkeleton {
  id: LayerId;
  name: string;
  kind: "terrain" | "path" | "object" | "scatter" | "gameplay" | "label";
  visible: boolean;
  locked: boolean;
  opacity: number;
}

// Точный порядок снизу вверх (сверен с renderMap): terrain → river → road →
// objects → scatter → gameplay → labels. Часть детерминизма — не менять.
export const LEGACY_LAYER_SKELETON: readonly LegacyLayerSkeleton[] = [
  { id: LEGACY_LAYER_IDS.terrain, name: "Terrain", kind: "terrain", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.river, name: "Rivers", kind: "path", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.road, name: "Roads", kind: "path", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.objects, name: "Objects", kind: "object", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.scatter, name: "Scatter", kind: "scatter", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.gameplay, name: "Gameplay", kind: "gameplay", visible: true, locked: false, opacity: 1 },
  { id: LEGACY_LAYER_IDS.labels, name: "Labels", kind: "label", visible: true, locked: false, opacity: 1 },
];

export function legacyLayerId(kind: keyof typeof LEGACY_LAYER_IDS): LayerId {
  return LEGACY_LAYER_IDS[kind];
}

/** N — индекс в исходном legacy-массиве (парсер уже детерминировал порядок). */
export function legacyRoomId(index: number): EntityId {
  return `legacy-room-${index}`;
}

export function legacyDoorId(index: number): EntityId {
  return `legacy-door-${index}`;
}

export function legacyTrapId(index: number): EntityId {
  return `legacy-trap-${index}`;
}

export function legacyMarkerId(index: number): EntityId {
  return `legacy-marker-${index}`;
}

export function legacyLabelId(index: number): EntityId {
  return `legacy-label-${index}`;
}

export const LEGACY_START_ID: EntityId = "legacy-start";
export const LEGACY_FINISH_ID: EntityId = "legacy-finish";

export function legacyPathId(kind: "road" | "river"): EntityId {
  return `legacy-path-${kind}`;
}
