import type { MapKind } from "../mapTypes";
import { ownPacks } from "./ownPacks";

/** Набор — тема места: что можно поставить на карту. Оформление (как карта нарисована) — отдельная настройка.
 * Метки нужны, чтобы находить набор в библиотеке, когда их станут десятки: жанр, место, вид карты. */
export interface MapPack { id: string; name: string; genre: string; place: string; kinds: readonly MapKind[] }

/** Библиотека встроенных наборов. Свои наборы придут сюда же с экрана «Наборы». */
export const MAP_PACKS: readonly MapPack[] = [
  // ponytail: «Деревня» значится городской и обзорной, пока нет своих наборов «Город» и «Мир» — иначе этим картам нечем красить землю.
  { id: "village", name: "Деревня у реки", genre: "Фэнтези", place: "Поселение", kinds: ["tactical", "city", "overview"] },
  { id: "crypt", name: "Склеп", genre: "Фэнтези", place: "Подземелье", kinds: ["tactical"] },
  { id: "ink", name: "Бумага и тушь", genre: "Любой жанр", place: "Знаки и мир", kinds: ["tactical", "city", "overview"] },
];
/** Встроенные наборы и свои наборы Мастера (не из архива) одним списком. Свой набор зовётся по uid. */
export const allPacks = (): MapPack[] => [...MAP_PACKS, ...ownPacks().filter((pack) => !pack.archived).map((pack): MapPack =>
  ({ id: pack.uid, name: pack.name, genre: "Свой набор", place: `вещей: ${pack.items.filter((item) => !item.archived).length}`, kinds: pack.kinds }))];
export const packName = (id: string) => allPacks().find((pack) => pack.id === id)?.name ?? ownPacks().find((pack) => pack.uid === id)?.name ?? id;
/** Наборы, которые подходят виду карты: обзорные на тактической не предлагаются, и наоборот. */
export const packsFor = (kind: MapKind) => allPacks().filter((pack) => pack.kinds.includes(kind));
/** Подключённые наборы карты. У карты без списка подключено всё подходящее — так старые карты ничего не теряют. */
export function connectedPacks(stored: readonly string[] | undefined, kind: MapKind): string[] {
  const fit = packsFor(kind).map((pack) => pack.id), mine = stored?.filter((id) => fit.includes(id));
  return mine?.length ? mine : fit;
}
