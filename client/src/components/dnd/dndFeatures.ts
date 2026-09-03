import type { CompendiumEntry, DndActionTiming, DndFeature } from "../../types";
import type { DndCheck, DndCost, DndEffect } from "./effects";

// Выделено из DndCharacterForm: раздача особенностей нужна и форме, и
// визарду, а в визарде до этого жила своя усечённая копия — без entryId,
// без сортировки и без времени накладывания, из-за чего созданный визардом
// персонаж получал особенности, которые не попадали во вкладку «Действия».
// Одна реализация на оба входа, отдельным модулем, чтобы визард не тянул
// компонентный файл ради одной функции.

export const TIMING_LABEL_TO_KEY: Record<string, DndActionTiming> = {
  "Действие": "action",
  "Бонусное действие": "bonus",
  "Реакция": "reaction",
  "Иное": "other",
};

export const TIMING_KEY_TO_LABEL: Record<DndActionTiming, string> = {
  action: "Действие",
  bonus: "Бонусное действие",
  reaction: "Реакция",
  other: "Иное",
};

// Best-effort classification for spells that predate casting_timing (only
// the free-text casting_time field exists) — matched by keyword so old
// compendium content still buckets sensibly into the new Бой tab sections
// instead of silently disappearing.
export function inferTimingFromLegacyText(text: string): { timing: DndActionTiming; other?: string } {
  const t = text.toLowerCase();
  if (t.includes("бонус")) return { timing: "bonus" };
  if (t.includes("реакц")) return { timing: "reaction" };
  if (t.includes("действ")) return { timing: "action" };
  return { timing: "other", other: text };
}

export function spellTimingFromData(
  data: Record<string, unknown>
): { castingTiming?: DndActionTiming; castingTimingOther?: string } {
  const label = typeof data.casting_timing === "string" ? data.casting_timing : "";
  if (label && TIMING_LABEL_TO_KEY[label]) {
    return {
      castingTiming: TIMING_LABEL_TO_KEY[label],
      castingTimingOther: typeof data.casting_timing_other === "string" ? data.casting_timing_other : undefined,
    };
  }
  const legacy = typeof data.casting_time === "string" ? data.casting_time : "";
  if (legacy) {
    const inferred = inferTimingFromLegacyText(legacy);
    return { castingTiming: inferred.timing, castingTimingOther: inferred.other };
  }
  return {};
}

// Converts class/subclass/species feature entries into DndFeature rows,
// tagged with sourceParentId so a later pick can find-and-replace just
// these (requirement: features stay in sync with the picked class/species).
// maxLevel filters to features unlocked at or below the class's current
// level; omit it (species has no level) to include everything.
export function featuresFromEntries(
  entries: CompendiumEntry[],
  parentId: number,
  maxLevel?: number
): DndFeature[] {
  return entries
    .filter((e) => maxLevel == null || (e.level ?? 0) <= maxLevel)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.position - b.position)
    .map((e) => ({
      name: e.name,
      description: e.description,
      entryId: e.id,
      sourceParentId: parentId,
      level: e.level,
      // Снимаем то же, что и у заклинаний: без времени накладывания умение не
      // попадёт во вкладку «Действия», а без эффектов там нечего показать.
      ...spellTimingFromData(e.data),
      checks: (e.data.checks as DndCheck[] | undefined) ?? [],
      effects: (e.data.effects as DndEffect[] | undefined) ?? [],
      cost: e.data.cost as DndCost | undefined,
    }));
}
