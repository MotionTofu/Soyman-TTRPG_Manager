// V5 selection identity (Фаза 2E). Источник identity — EntityId,
// никаких array index. Kind — для быстрого routing (не identity).

import type { EntityId } from "../types";

export type V5SelectableKind = "door" | "trap" | "marker" | "start" | "finish" | "room" | "object";

export interface V5Selection {
  entityId: EntityId;
  kind: V5SelectableKind;
}
