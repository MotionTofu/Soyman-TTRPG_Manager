import type { MapKind } from "../mapTypes";

/** Набор — тема места: что можно поставить на карту. Оформление (как карта нарисована) — отдельная настройка.
 * Метки нужны, чтобы находить набор в библиотеке, когда их станут десятки: жанр, место, вид карты. */
export interface MapPack { id: string; name: string; genre: string; place: string; kinds: readonly MapKind[] }

/** Библиотека встроенных наборов. Свои наборы придут сюда же с экрана «Наборы». */
export const MAP_PACKS: readonly MapPack[] = [
  // ponytail: «Деревня» значится и обзорной, пока нет набора «Мир» — иначе обзорной карте нечем красить землю.
  { id: "village", name: "Деревня у реки", genre: "Фэнтези", place: "Поселение", kinds: ["tactical", "overview"] },
  { id: "crypt", name: "Склеп", genre: "Фэнтези", place: "Подземелье", kinds: ["tactical"] },
  { id: "ink", name: "Бумага и тушь", genre: "Любой жанр", place: "Знаки и мир", kinds: ["tactical", "overview"] },
];
export const packName = (id: string) => MAP_PACKS.find((pack) => pack.id === id)?.name ?? id;
/** Наборы, которые подходят виду карты: обзорные на тактической не предлагаются, и наоборот. */
export const packsFor = (kind: MapKind) => MAP_PACKS.filter((pack) => pack.kinds.includes(kind));
/** Подключённые наборы карты. У карты без списка подключено всё подходящее — так старые карты ничего не теряют. */
export function connectedPacks(stored: readonly string[] | undefined, kind: MapKind): string[] {
  const fit = packsFor(kind).map((pack) => pack.id), mine = stored?.filter((id) => fit.includes(id));
  return mine?.length ? mine : fit;
}
