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
  /** Число подклассов по id класса. Есть — под картой строка-досье. */
  subclassCounts?: Record<number, number>;
}

const ABILITY_ABBR: Record<string, string> = {
  "Сила": "СИЛ", "Ловкость": "ЛОВ", "Телосложение": "ТЕЛ",
  "Интеллект": "ИНТ", "Мудрость": "МДР", "Харизма": "ХАР",
};

function subclassWord(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return "подклассов";
  if (n % 10 === 1) return "подкласс";
  if (n % 10 >= 2 && n % 10 <= 4) return "подкласса";
  return "подклассов";
}

/** «К8 · ИНТ · 4 подкласса» (макет «Д» Roll-Classes). Пустые части пропускаются. */
export function classCaption(entry: CompendiumEntry, subclasses: number): string | undefined {
  const raw = entry.data.hit_die ?? entry.data.hitDie;
  const die = typeof raw === "string" ? /\d+/.exec(raw)?.[0] : undefined;
  const abilities = Array.isArray(entry.data.primary_abilities)
    ? (entry.data.primary_abilities as string[]).map((a) => ABILITY_ABBR[a] ?? a.slice(0, 3).toUpperCase()).join("/")
    : "";
  const parts = [die ? `К${die}` : "", abilities, subclasses > 0 ? `${subclasses} ${subclassWord(subclasses)}` : ""];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** Плоский алфавитный каталог карт. Избранное и мешок находятся в профиле. */
export function ClassTileGrid({ entries, sortDir = "asc", subclassCounts }: Props) {
  const navigate = useNavigate();
  const options = useMemo(
    () => [...entries]
      .sort((a, b) => sortDir === "asc" ? a.name.localeCompare(b.name, "ru") : b.name.localeCompare(a.name, "ru"))
      .map((entry) => ({ id: entry.id, name: entry.name, card: entry.avatar_image_url ?? null })),
    [entries, sortDir]
  );
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  return (
    <div className="class-catalog">
      <CardGrid
        options={options}
        selectedId={null}
        captionFor={subclassCounts && ((option) => {
          const entry = byId.get(option.id);
          return entry && classCaption(entry, subclassCounts[entry.id] ?? 0);
        })}
        onPick={(option) => {
          const entry = byId.get(option.id);
          if (entry) navigate(`/systems/${entry.system_id}/entries/${entry.id}`);
        }}
      />
    </div>
  );
}
