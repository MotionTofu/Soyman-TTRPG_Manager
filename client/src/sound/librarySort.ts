import type { SoundButton } from "./types";

export const SOUND_SORTS = [
  { value: "name-asc", label: "Название: А → Я" },
  { value: "name-desc", label: "Название: Я → А" },
  { value: "duration-asc", label: "Длительность: сначала короткие" },
  { value: "duration-desc", label: "Длительность: сначала длинные" },
] as const;

export type SoundSort = typeof SOUND_SORTS[number]["value"];
export function isSoundSort(value: unknown): value is SoundSort {
  return SOUND_SORTS.some((sort) => sort.value === value);
}

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export function sortSounds(items: SoundButton[], sort: SoundSort, durations: Map<number, number>): SoundButton[] {
  const byName = (a: SoundButton, b: SoundButton) =>
    collator.compare(a.name, b.name) || a.resource_id - b.resource_id;
  return [...items].sort((a, b) => {
    if (sort === "name-asc") return byName(a, b);
    if (sort === "name-desc") return -byName(a, b);
    const aTime = a.missing ? undefined : durations.get(a.resource_id);
    const bTime = b.missing ? undefined : durations.get(b.resource_id);
    const aKnown = aTime !== undefined && Number.isFinite(aTime);
    const bKnown = bTime !== undefined && Number.isFinite(bTime);
    if (!aKnown || !bKnown) return aKnown ? -1 : bKnown ? 1 : byName(a, b);
    return (sort === "duration-asc" ? aTime - bTime : bTime - aTime) || byName(a, b);
  });
}
