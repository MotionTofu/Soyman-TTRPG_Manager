import type { ContextMenuItem } from "./components/ContextMenu";

// Метки и вызов общего ПКМ (design-system.md §6.12); само меню — components/PageContextMenu.tsx.

export interface EntityRef {
  type: string;
  id: number;
  name: string;
}

export const APP_SEARCH_EVENT = "soyman:app-search";
export const ENTITY_MENU_EVENT = "soyman:entity-menu";

/** Метка объекта в разметке: по ней общая точка узнаёт сущность под курсором. */
export function entityMark(type: string, id: number, name: string) {
  return { "data-entity-type": type, "data-entity-id": id, "data-entity-name": name };
}

/** Местные действия фона дополняют общие действия страницы. */
export function openPageMenu(x: number, y: number, local: ContextMenuItem[]) {
  window.dispatchEvent(new CustomEvent(ENTITY_MENU_EVENT, { detail: { kind: "page", local, x, y } }));
}

/** Открыть меню сущности: из «⋯» или из своего onContextMenu страницы, с местным блоком. */
export function openEntityMenu(entity: EntityRef, x: number, y: number, local: ContextMenuItem[] = []) {
  window.dispatchEvent(new CustomEvent(ENTITY_MENU_EVENT, { detail: { kind: "entity", entity, local, x, y } }));
}
