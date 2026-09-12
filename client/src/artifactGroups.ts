import { ITEM_CLASSES, MAGIC_ITEM_RARITIES } from "./compendium";
import type { Artifact } from "./types";

// Группировка плиток сокровищницы: общий модуль для грида и для навигации
// Master–Detail (отдельный файл — react fast-refresh требует, чтобы рядом с
// компонентами не лежали обычные экспорты).
export type ArtifactGrouping = "alpha" | "item_class" | "rarity";

export const artifactClassLabels: Record<string, string> = Object.fromEntries(
  ITEM_CLASSES.map((c) => [c.value, c.label])
);

export function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

const rarityOrder: Record<string, number> = Object.fromEntries(
  MAGIC_ITEM_RARITIES.map((r, i) => [r, i])
);

export function groupArtifacts(
  list: Artifact[],
  grouping: ArtifactGrouping,
  dir: "asc" | "desc" = "asc"
): [string, Artifact[]][] {
  const collator = (a: string, b: string) =>
    dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru");

  if (grouping === "alpha") {
    const map = new Map<string, Artifact[]>();
    for (const a of list) {
      const k = monogramLetter(a.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    const keys = [...map.keys()].sort(collator);
    return keys.map((k) => [k, map.get(k)!]);
  }

  if (grouping === "rarity") {
    const map = new Map<string, Artifact[]>();
    for (const a of list) {
      const k = a.rarity || "Без редкости";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    const keys = [...map.keys()].sort((a, b) => {
      const ai = rarityOrder[a] ?? 999;
      const bi = rarityOrder[b] ?? 999;
      return dir === "asc" ? ai - bi : bi - ai;
    });
    return keys.map((k) => [k, map.get(k)!]);
  }

  const map = new Map<string, Artifact[]>();
  for (const a of list) {
    const k = artifactClassLabels[a.item_class ?? ""] ?? "Без типа";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  const keys = [...map.keys()].sort(collator);
  return keys.map((k) => [k, map.get(k)!]);
}
