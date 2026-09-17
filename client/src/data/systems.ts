import type { Affect } from "./entities";
import { compendiumPaths } from "./compendiumEntries";

/**
 * Системы в слое данных (docs/adr/0001, группа «системы», часть 1): список,
 * профиль и группы систем.
 */
export const systemPaths = {
  list: () => "/systems",
  detail: (systemId: number) => `/systems/${systemId}`,
  sections: compendiumPaths.sections,
  entryCounts: (systemId: number) => `/systems/${systemId}/entry-counts`,
  campaigns: (systemId: number) => `/campaigns?system_id=${systemId}`,
  groups: () => "/system-groups",
  groupsOf: (systemId: number) => `/system-groups/by-system/${systemId}`,
  groupMembers: (groupId: number) => `/system-groups/${groupId}/members`,
};

/** Поля системы (описание, обложка): карточка и список систем. */
export function systemFieldsAffects(systemId: number): Affect[] {
  return [{ kind: "system", id: systemId, card: true }];
}

/** Название и код: кампании показывают систему по имени — их списки и карточки тоже. */
export function systemNameAffects(systemId: number): Affect[] {
  return [...systemFieldsAffects(systemId), { kind: "campaign", card: true }];
}

/** Членство системы в группах: её отметки, составы групп и вкладки списка. */
export function systemGroupAffects(): Affect[] {
  return [{ path: systemPaths.groups() }];
}

/**
 * Вся система разом — после «Привести справочник в порядок» (разбор, Q4):
 * разделы, счётчики, записи разделов и открытые страницы записей.
 */
export function wholeSystemAffects(systemId: number): Affect[] {
  return [{ kind: "system", id: systemId }, { kind: "compendium_entry" }];
}
