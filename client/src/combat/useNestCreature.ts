import { useMemo } from "react";
import { useResource } from "../data/hooks";
import { statblockListPath } from "../data/statblocks";
import { parseDndStatblock } from "../components/EntityPreviewModal";
import type { DndCreatureData, InitiativeEntry, Statblock } from "../types";

const NO_STATBLOCKS: Statblock[] = [];

/** Статблок существа строки — из того же кэша, что карточки и бестиарий. */
export function useNestCreature(entry: InitiativeEntry): DndCreatureData | null {
  const type = entry.entity_type;
  const path =
    entry.entity_id != null && (type === "being" || type === "compendium_entry")
      ? statblockListPath(type, entry.entity_id)
      : null;
  const rows = useResource<Statblock[]>(path).data ?? NO_STATBLOCKS;
  const sb = rows.find((s) => s.format === "dnd_creature");
  // Разбор — по строке статблока: новый объект на каждой отрисовке
  // перерисовывал бы статблок гнезда при любом щелчке на ленте.
  return useMemo(() => (sb ? (parseDndStatblock(sb) as DndCreatureData) : null), [sb]);
}
