/**
 * Пустые значения для полей статблока существа. Вынесены из
 * `client/src/components/dnd/DndCreatureForm.tsx`: `emptyDndCharacter`
 * пользуется `emptySpeed`, а тянуть ради этого React-файл в общий пакет
 * нельзя.
 */
import type { DndCreatureSpeed } from "./types";

export function emptySpeed(): DndCreatureSpeed {
  return { walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false, note: "" };
}
