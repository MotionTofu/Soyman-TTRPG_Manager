import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { CompendiumEntry } from "../types";
import { CardGrid } from "./dnd/DndCards";

export type ClassGrouping = "alpha" | "category";
export type ClassSortDir = "asc" | "desc";

interface Props {
  entries: CompendiumEntry[];
  grouping: ClassGrouping;
  sortDir?: ClassSortDir;
  sectionId: number;
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}

/** Плоский алфавитный каталог карт. Избранное и мешок находятся в профиле. */
export function ClassTileGrid({ entries, sortDir = "asc" }: Props) {
  const navigate = useNavigate();
  const options = useMemo(
    () => [...entries]
      .sort((a, b) => sortDir === "asc" ? a.name.localeCompare(b.name, "ru") : b.name.localeCompare(a.name, "ru"))
      .map((entry) => ({ id: entry.id, name: entry.name, card: entry.avatar_image_url ?? null })),
    [entries, sortDir]
  );
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  return (
    <CardGrid
      options={options}
      selectedId={null}
      onPick={(option) => {
        const entry = byId.get(option.id);
        if (entry) navigate(`/systems/${entry.system_id}/entries/${entry.id}`);
      }}
    />
  );
}
