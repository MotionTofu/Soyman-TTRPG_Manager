import type { MapKind } from "../mapTypes";
import type { MapDocumentV6 } from "@shared/maps/core";
import { CARTOGRAPHY_PACK } from "./cartography";
import { CRYPT_PACK } from "./crypt";
import { ownPackOf, ownPacks } from "./ownPacks";
import { MAP_SYMBOL_PACK } from "./registry";
import { VILLAGE_PACK } from "./village";

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
/** Набор библиотеки, из которого взята вещь; картинка из галереи ни к какому набору не относится. */
export function packOfAsset(assetId: string): string | null {
  const prefix = assetId.slice(0, assetId.indexOf(":"));
  return prefix === VILLAGE_PACK.id ? "village" : prefix === CRYPT_PACK.id ? "crypt" : prefix === CARTOGRAPHY_PACK.id || prefix === MAP_SYMBOL_PACK.id ? "ink" : ownPackOf(assetId);
}
/** Наборы, вещи которых стоят на карте.
 * ponytail: смотрим объекты и рисованные линии; поверхности и россыпи добавятся вместе со своими в наборах (срезы 2–3). */
export function usedPacks(document: MapDocumentV6): string[] {
  const ids = new Set<string>();
  const add = (assetId: string) => { const pack = packOfAsset(assetId); if (pack) ids.add(pack); };
  for (const layer of document.layers) {
    if (layer.kind === "object") for (const item of layer.items) if (item.visual.type === "asset") add(item.visual.assetId);
    if (layer.kind === "path") for (const path of layer.paths) if (path.styleRef.type === "asset") add(path.styleRef.assetId);
  }
  return [...ids];
}
