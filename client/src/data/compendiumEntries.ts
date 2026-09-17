import type { CompendiumEntry } from "../types";
import type { Affect } from "./entities";

/**
 * Записи компендиума со своей страницей — существо бестиария и транспорт
 * (docs/adr/0001, группа «сущности сеттинга»).
 *
 * Разделы системы и записи раздела читают и страница записи (крошки, посты
 * судна, типы существ), и сама система — под одним ключом.
 */

export const compendiumPaths = {
  sections: (systemId: number) => `/systems/${systemId}/sections`,
  sectionEntries: (systemId: number, sectionId: number) => `/systems/${systemId}/entries?section_id=${sectionId}`,
};

/**
 * Правка записи: её карточка и записи системы — в них она строкой раздела,
 * а у поста экипажа ещё и строкой в списке постов судна.
 */
export function compendiumAffects(entry: Pick<CompendiumEntry, "id" | "system_id">): Affect[] {
  return [{ kind: "compendium_entry", id: entry.id }, { path: `/systems/${entry.system_id}/entries` }];
}

/**
 * Запись появилась или удалена в разделе системы: записи разделов (в том числе
 * опции механик и пикеры листа — они читают те же ключи) и счётчики «Обзора».
 * Удалённая запись задевает ещё и свою карточку — лист узнает, что ссылка мертва.
 */
export function compendiumMembershipAffects(systemId: number, entryId?: number): Affect[] {
  return [
    { path: `/systems/${systemId}/entries` },
    { path: `/systems/${systemId}/entry-counts` },
    ...(entryId != null ? [{ kind: "compendium_entry" as const, id: entryId }] : []),
  ];
}
