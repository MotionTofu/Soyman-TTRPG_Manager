import { useEffect, useState } from "react";
import type { MapKind } from "../mapTypes";
import { getMapImageAsset, loadMapImageAsset, markMapImageMissing, registerMapImageResources, resourceImageAssetId, setMapImageViews, subscribeMapImageAssets } from "./registry";

/** Наборы ассетов Мастера с сервера (`/map-packs`). Картинки идут в общий реестр изображений карты:
 * на карте лежит id картинки, как у вещей из галереи, поэтому формат карты не меняется. */
export interface OwnPackImage { id: number; uid: string; role: string; width: number; height: number; archived: boolean; file_url: string }
export interface OwnPackItem { id: number; uid: string; kind: string; name: string; section: string; tags: string; archived: boolean;
  /** Размер в клетках. */ w: number; h: number; blocks_sight: boolean; /** Радиус света в клетках. */ light: number | null; images: OwnPackImage[] }
export interface OwnPack { id: number; uid: string; name: string; kinds: MapKind[]; genres: unknown[]; native_style: string; archived: boolean; updated_at: string; items: OwnPackItem[] }

/** Точек на клетку у картинок набора; мельче — предупреждаем. */
export const PACK_CELL_PX = 256;
const RANDOM = "soyman-pack-item:";
let current: readonly OwnPack[] = [];
const sizes = new Map<string, number>();
const variants = new Map<string, string[]>();
const owners = new Map<string, string>();
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
  current = packs; sizes.clear(); variants.clear(); owners.clear();
  for (const pack of packs) for (const item of pack.items) for (const image of item.images) {
    owners.set(ownImageId(image), pack.uid);
    if (pack.archived) markMapImageMissing(image.uid, `«${pack.name}» в архиве`);
  }
  for (const pack of packs) if (!pack.archived) for (const item of pack.items) {
    registerMapImageResources(item.images.map((image) => ({ uid: image.uid, name: item.name, file_url: image.file_url, tags: item.tags })));
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
