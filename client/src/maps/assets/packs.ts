import type { MapKind } from "../mapTypes";
import type { SettingGenre } from "../../types";
import type { MapDocumentV6 } from "@shared/maps/core";
import { CARTOGRAPHY_PACK } from "./cartography";
import { CRYPT_PACK } from "./crypt";
import { crossingChoices } from "../crossings";
import { liquidPackOf, ownPackOf, ownPacks, ownScatterPack } from "./ownPacks";
import { ARTWORK_SCATTER, MAP_SYMBOL_PACK, ownSurfaceAssetId } from "./registry";
import { VILLAGE_PACK, VILLAGE_SURFACE_KEYS } from "./village";

/** Набор — тема места: что можно поставить на карту. Оформление (как карта нарисована) — отдельная настройка.
 * Метки нужны, чтобы находить набор в библиотеке, когда их станут десятки: жанр, место, вид карты. */
export interface MapPack { id: string; name: string; genre: string; place: string; kinds: readonly MapKind[]; genres: readonly SettingGenre[] }
const FANTASY: readonly SettingGenre[] = [{ genre: "Фэнтези" }];
export const genreLabel = (genres: readonly SettingGenre[]) => genres.map((entry) => entry.subgenre ?? entry.genre).join(", ");
/** Близость набора к жанрам (гриллинг Q25): совпавший жанр и совпавший поджанр весят одинаково. */
export function genreScore(pack: readonly SettingGenre[], wanted: readonly SettingGenre[]): number {
  const sub = (entry: SettingGenre) => entry.subgenre ? `${entry.genre}/${entry.subgenre}` : null;
  const genres = new Set(wanted.map((entry) => entry.genre)), subs = new Set(wanted.map(sub));
  return new Set(pack.filter((entry) => genres.has(entry.genre)).map((entry) => entry.genre)).size + new Set(pack.map(sub).filter((key) => key && subs.has(key))).size;
}
/** Подбор по близости (Q25, Q31): больше совпадений — выше, без совпадений не показывается, наборы без жанра — всегда, в конце.
 * Без жанров в фильтре — все наборы как есть. */
export function rankPacks<T extends { genres: readonly SettingGenre[] }>(packs: readonly T[], wanted: readonly SettingGenre[]): T[] {
  if (!wanted.length) return [...packs];
  const scored = packs.filter((pack) => pack.genres.length).map((pack) => ({ pack, score: genreScore(pack.genres, wanted) })).filter((entry) => entry.score > 0);
  return [...scored.sort((a, b) => b.score - a.score).map((entry) => entry.pack), ...packs.filter((pack) => !pack.genres.length)];
}

/** Библиотека встроенных наборов. Свои наборы придут сюда же с экрана «Наборы». */
export const MAP_PACKS: readonly MapPack[] = [
  // ponytail: «Деревня» значится городской и обзорной, пока нет своих наборов «Город» и «Мир» — иначе этим картам нечем красить землю.
  { id: "village", name: "Деревня у реки", genre: "Фэнтези", place: "Поселение", kinds: ["tactical", "city", "overview"], genres: FANTASY },
  { id: "crypt", name: "Склеп", genre: "Фэнтези", place: "Подземелье", kinds: ["tactical"], genres: FANTASY },
  { id: "world", name: "Мир", genre: "Фэнтези", place: "Обзорная карта", kinds: ["overview"], genres: FANTASY },
  { id: "ink", name: "Бумага и тушь", genre: "Любой жанр", place: "Знаки и мир", kinds: ["tactical", "city", "overview"], genres: [] },
];
/** Встроенные наборы и свои наборы Мастера (не из архива) одним списком. Свой набор зовётся по uid. */
export const allPacks = (): MapPack[] => [...MAP_PACKS, ...ownPacks().filter((pack) => !pack.archived).map((pack): MapPack =>
  ({ id: pack.uid, name: pack.name, genre: genreLabel(pack.genres) || "Свой, без жанра", place: `вещей: ${pack.items.filter((item) => !item.archived).length}`, kinds: pack.kinds, genres: pack.genres }))];
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
 * Готовые жидкости набором не считаются: у них свой инструмент, и от подключения «Деревни» они не зависят. Жидкость своего набора — считается. */
export function usedPacks(document: MapDocumentV6): string[] {
  const ids = new Set<string>();
  const add = (assetId: string) => { const pack = packOfAsset(assetId); if (pack) ids.add(pack); };
  for (const recipe of document.appearance?.liquids ?? []) { const pack = recipe.ref ? liquidPackOf(recipe.ref) : null; if (pack) ids.add(pack.uid); }
  for (const layer of document.layers) {
    if (layer.kind === "object") for (const item of layer.items) if (item.visual.type === "asset") add(item.visual.assetId);
    if (layer.kind === "path") for (const path of layer.paths) {
      if (path.styleRef.type === "asset") add(path.styleRef.assetId);
      for (const choice of crossingChoices(path.properties?.crossings)) if (choice.art) add(choice.art);
    }
    if (layer.kind === "gameplay") for (const item of layer.items) if (item.kind === "door" && item.style) add(item.style);
    if (layer.kind === "scatter") for (const area of layer.areas) {
      const key = area.profileRef.type === "builtin" ? area.profileRef.key : "", own = ownScatterPack(key);
      if (own) ids.add(own); else if (key) ids.add(ARTWORK_SCATTER.find((profile) => profile.key === key)?.pack.id === VILLAGE_PACK.id ? "village" : "ink");
    }
    if (layer.kind === "terrain") for (const material of [layer.defaultMaterial, ...(layer.representation === "mask" ? layer.mask.materials : layer.cells.map((cell) => cell.material))]) {
      const code = material.type === "builtin" ? material.key.replace(/^terrain\//, "") : "", own = ownSurfaceAssetId(code);
      if (own) add(own); else if (code.startsWith("village-") && VILLAGE_SURFACE_KEYS.includes(code.slice(8))) ids.add("village");
    }
  }
  return [...ids];
}
