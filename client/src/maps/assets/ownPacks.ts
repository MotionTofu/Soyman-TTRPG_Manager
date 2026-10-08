import { useEffect, useState } from "react";
import type { MapKind } from "../mapTypes";
import { getMapImageAsset, loadMapImageAsset, markMapImageMissing, ownSurfaceCode, registerMapImageResources, resourceImageAssetId, setMapImageViews, subscribeMapImageAssets } from "./registry";

/** Наборы ассетов Мастера с сервера (`/map-packs`). Картинки идут в общий реестр изображений карты:
 * на карте лежит id картинки, как у вещей из галереи, поэтому формат карты не меняется. */
export interface OwnPackImage { id: number; uid: string; role: string; width: number; height: number; archived: boolean; file_url: string }
export interface OwnPackItem { id: number; uid: string; kind: string; name: string; section: string; tags: string; archived: boolean;
  /** Размер в клетках. */ w: number; h: number; blocks_sight: boolean; /** Радиус света в клетках. */ light: number | null;
  /** Поверхность: сколько клеток покрывает один повтор образца и средний цвет. */ cells?: number; fill?: string;
  /** Линия: чем тянется (`road`, `river` — течёт, `wall` — преграждает путь) и ширина в клетках. Переправа: какой настил заменяет. */
  use?: string; width?: number; deck?: string;
  /** Россыпь: размер знака и густота по умолчанию. */ size?: number; density?: number;
  /** Проём: ширина в клетках и «потайной». */ span?: number; secret?: boolean; images: OwnPackImage[] }
export interface OwnPack { id: number; uid: string; name: string; kinds: MapKind[]; genres: unknown[]; native_style: string; archived: boolean; updated_at: string; items: OwnPackItem[] }

/** Точек на клетку у картинок набора; мельче — предупреждаем. */
export const PACK_CELL_PX = 256;
const RANDOM = "soyman-pack-item:";
let current: readonly OwnPack[] = [];
const sizes = new Map<string, number>();
const variants = new Map<string, string[]>();
const owners = new Map<string, string>();
const surfaces = new Map<string, { assetId: string; cells: number }>();
let surfaceFills: Readonly<Record<string, string>> = {};
const posts = new Map<string, string>(), decks = new Map<string, string>();
const scatters = new Map<string, { assetIds: string[]; size: number }>(), scatterOwners = new Map<string, string>();
/** Столб ограды своего набора по id её полосы. */
export const ownLinePost = (style: string) => posts.get(style) ?? null;
/** Настил переправы из того же набора, что и дорога; нет своего — рисуется общий. */
export const ownDeck = (style: string, deck: string) => decks.get(`${owners.get(style)}:${deck}`) ?? null;
/** Переправы наборов из списка — на выбор в свойствах дороги. */
export const ownCrossings = (packIds: readonly string[]) => current.filter((pack) => !pack.archived && packIds.includes(pack.uid)).flatMap((pack) =>
  pack.items.flatMap((item) => { const image = item.kind === "crossing" && !item.archived && liveImages(item)[0]; return image ? [{ art: ownImageId(image), kind: item.deck ?? "bridge-wood", name: `${item.name} · ${pack.name}` }] : []; }));
/** Россыпь своего набора: на карте лежит ключ `scatter/own-<uid вещи>`. */
export const ownScatterKey = (item: OwnPackItem) => `scatter/own-${item.uid}`;
export const ownScatter = (key: string) => scatters.get(key) ?? null;
export const ownScatterPack = (key: string) => scatterOwners.get(key) ?? null;
/** Поверхность своего набора по коду материала: какая картинка и на сколько клеток её повтор. */
export const ownSurface = (code: string) => surfaces.get(code) ?? null;
/** Цвет поверхностей своих наборов по коду материала: «Чертёж» и то, что ещё грузится или лежит в архиве. Объект меняется только с наборами. */
export const ownSurfaceFills = () => surfaceFills;
/** Стороны поворотного предмета сверх основной: каким он виден, повёрнутый на 90°, 180° и 270°. */
export const OWN_SIDES = [["w", "Повёрнут на 90°"], ["n", "Повёрнут на 180°"], ["e", "Повёрнут на 270°"]] as const;
export const sideImage = (item: OwnPackItem, side: string) => item.images.find((image) => !image.archived && image.role === side) ?? null;
/** uid своего набора, которому принадлежит картинка, — и для набора в архиве. */
export const ownPackOf = (assetId: string) => owners.get(assetId) ?? null;

export const ownImageId = (image: OwnPackImage) => resourceImageAssetId(image.uid);
/** «Случайный вариант» объекта своего набора: на карту всегда попадает конкретная картинка. */
export const ownRandomId = (item: OwnPackItem) => `${RANDOM}${item.uid}*`;
export const liveImages = (item: OwnPackItem) => item.images.filter((image) => !image.archived && image.role === "variant");
export const ownPacks = () => current;

/** Запомнить наборы и завести их картинки в реестр. У набора в архиве вместо картинок — заглушки с его названием.
 * Убранные объекты и варианты заводятся: карта, где они стоят, рисуется как раньше. */
export function registerOwnPacks(packs: readonly OwnPack[]): void {
  current = packs; sizes.clear(); variants.clear(); owners.clear(); surfaces.clear(); posts.clear(); decks.clear(); scatters.clear(); scatterOwners.clear();
  for (const pack of packs) for (const item of pack.items) if (item.kind === "scatter") scatterOwners.set(ownScatterKey(item), pack.uid);
  const fills: Record<string, string> = {};
  surfaceFills = fills;
  for (const pack of packs) for (const item of pack.items) for (const image of item.images) {
    owners.set(ownImageId(image), pack.uid);
    if (item.kind === "surface") {
      fills[ownSurfaceCode(image.uid)] = item.fill ?? "#8a8a80";
      if (!pack.archived) surfaces.set(ownSurfaceCode(image.uid), { assetId: ownImageId(image), cells: item.cells ?? 4 });
    }
    if (pack.archived) markMapImageMissing(image.uid, `«${pack.name}» в архиве`);
  }
  for (const pack of packs) if (!pack.archived) for (const item of pack.items) {
    registerMapImageResources(item.images.map((image) => ({ uid: image.uid, name: item.name, file_url: image.file_url, tags: item.tags })));
    const live = liveImages(item), post = sideImage(item, "post");
    if (item.kind === "line" && post) for (const image of item.images) if (image.role === "variant") posts.set(ownImageId(image), ownImageId(post));
    if (item.kind === "crossing" && !item.archived && live[0]) decks.set(`${pack.uid}:${item.deck}`, ownImageId(live[0]));
    // Россыпь, убранная из набора, на картах остаётся: берём её картинки, какие есть.
    if (item.kind === "scatter") scatters.set(ownScatterKey(item), { assetIds: (live.length ? live : item.images).map(ownImageId), size: item.size ?? 1 });
    const views = Object.fromEntries(OWN_SIDES.flatMap(([side]) => { const image = sideImage(item, side); return image ? [[side, ownImageId(image)]] : []; }));
    for (const image of item.images) {
      sizes.set(ownImageId(image), Math.max(item.w, item.h));
      if (image.role === "variant") setMapImageViews(ownImageId(image), views);
    }
    if (!item.archived) variants.set(ownRandomId(item), liveImages(item).map(ownImageId));
  }
}
/** Сторона квадрата, в который вписывается объект своего набора, клеток. */
export const ownObjectSize = (assetId: string) => sizes.get(assetId) ?? null;
export function pickOwnVariant(assetId: string, random: () => number = Math.random): string {
  const ids = variants.get(assetId);
  return ids?.length ? ids[Math.floor(random() * ids.length)] : assetId;
}
/** Адрес уже загруженной картинки для плитки; первая просьба запускает загрузку. */
export function ownImageSrc(assetId: string): string | null {
  const asset = getMapImageAsset(assetId);
  if (asset && !asset.image) void loadMapImageAsset(assetId).catch(() => {});
  return asset?.image?.src ?? null;
}
/** Перерисовать компонент, когда догрузилась картинка реестра. */
export function useMapImageRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeMapImageAssets(() => setRevision((n) => n + 1)), []);
  return revision;
}
