import type { DndCharacterData } from "../../types";

// Имена мёртвых ссылок для сводки внизу листа (этап 8). Лист рисует
// сохранённое имя, а считает по мёртвому id — без имён сводка не чинится:
// «3 ссылки» не говорят, что перепривязывать. Имена берутся из тех же
// списков, что кормят лист (правило «имя рядом с id»).

/** Пары id → сохранённое имя для всех ссылок листа на компендиум. */
export function deadLinkNames(value: DndCharacterData, deadIds: ReadonlySet<number>): string[] {
  const names: string[] = [];
  const take = (id: number | null | undefined, name: string | undefined) => {
    if (typeof id === "number" && deadIds.has(id) && name && !names.includes(name)) names.push(name);
  };
  for (const c of value.classes ?? []) {
    take(c.classId, c.className);
    take(c.subclassId, c.subclassName);
  }
  take(value.raceId, value.raceName);
  take(value.backgroundId, value.backgroundName);
  for (const s of [...(value.cantrips ?? []), ...(value.spellsByLevel ?? []).flat()]) take(s.entryId, s.name);
  for (const f of [
    ...(value.speciesFeatures ?? []),
    ...(value.classFeatures ?? []),
    ...(value.feats ?? []),
    ...(value.specialAbilities ?? []),
  ]) {
    take(f.entryId, f.name);
  }
  for (const sec of value.equipmentSections ?? []) for (const it of sec.items ?? []) take(it.entryId, it.name);
  for (const c of value.companions ?? []) take(c.entryId, c.name);
  for (const p of value.pinnedActions ?? []) take(p.entryId, p.name);
  return names;
}
