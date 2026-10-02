import { subscribeTokenTape, prepareTokenTape } from "./tokenTape";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SCATTER, CARTOGRAPHY_PACK, cartographyId, cartographyUrl } from "./cartography";
import { CRYPT_OBJECTS, CRYPT_PACK, CRYPT_SIDES, CRYPT_STYLE_KEYS, cryptId, cryptUrl, type CryptSide } from "./crypt";
import type { MapDocumentV6 } from "@shared/maps/core";
import type { VisualRef } from "../core/refs";
import type { MapDocumentV5 } from "../core/types";

// First local pack. IDs and version are document data; drawing and names stay
// in the installed registry, so a map never stores an image URL or artwork.
export const MAP_SYMBOL_PACK = { id: "soyman-symbols", version: "1" } as const;
export const MAP_RESOURCE_IMAGE_PACK = { id: "soyman-resource-images", version: "1" } as const;

export interface MapImageResource {
  uid: string;
  name: string;
  file_url: string;
  tags?: string;
}

export interface MapImageAsset {
  id: string;
  name: string;
  tags: readonly string[];
  kind: "image";
  image: HTMLImageElement | null;
  ready: Promise<void>;
  failed?: boolean;
  /** Поворотный предмет: свой рисунок на каждую сторону вместо поворота картинки. */
  views?: Readonly<Record<CryptSide, MapImageAsset>>;
}

export interface MapSymbolAsset {
  id: string;
  name: string;
  tags: readonly string[];
  glyph: "tree" | "tower" | "camp" | "mountain";
}

export type MapVisualAsset = MapSymbolAsset | MapImageAsset;

export const MAP_SYMBOL_ASSETS: readonly MapSymbolAsset[] = [
  { id: "soyman-symbols:mountain", name: "Гора", tags: ["природа", "местность"], glyph: "mountain" },
  { id: "soyman-symbols:tree", name: "Дерево", tags: ["природа", "местность"], glyph: "tree" },
  { id: "soyman-symbols:tower", name: "Башня", tags: ["постройки", "ориентир"], glyph: "tower" },
  { id: "soyman-symbols:camp", name: "Лагерь", tags: ["поселение", "ориентир"], glyph: "camp" },
];

export const MAP_CARTOGRAPHY_ASSETS: readonly MapImageAsset[] = CARTOGRAPHY_OBJECTS.map(item => ({
  id: cartographyId(item.key), name: item.name, tags: [item.group, "картография"], kind: "image", image: null, ready: Promise.resolve(),
}));
const localAsset = (id: string, name: string, tags: readonly string[] = []): MapImageAsset => ({ id, name, tags, kind: "image", image: null, ready: Promise.resolve() });
export const MAP_CRYPT_ASSETS: readonly MapImageAsset[] = CRYPT_OBJECTS.map(item => {
  const asset = localAsset(cryptId(item.key), item.name, [item.category, "склеп"]);
  if (item.directional) asset.views = Object.fromEntries(CRYPT_SIDES.map(side => [side, localAsset(cryptId(`${item.key}-${side}`), item.name)])) as Record<CryptSide, MapImageAsset>;
  return asset;
});
const localImages = new Map<string, MapImageAsset>([...MAP_CARTOGRAPHY_ASSETS, ...["stone-floor", "earth", "water"].map(key => localAsset(cartographyId(key), key)),
  ...MAP_CRYPT_ASSETS, ...MAP_CRYPT_ASSETS.flatMap(asset => asset.views ? Object.values(asset.views) : []),
  ...CRYPT_STYLE_KEYS.map(key => localAsset(cryptId(key), key))].map(asset => [asset.id, asset]));
const cryptPrefix = `${CRYPT_PACK.id}:`;
const localUrl = (id: string) => id.startsWith(cryptPrefix) ? cryptUrl(id.slice(cryptPrefix.length)) : cartographyUrl(id.slice(CARTOGRAPHY_PACK.id.length + 1));
const localLoads = new Map<string, Promise<void>>();

const byId = new Map(MAP_SYMBOL_ASSETS.map((asset) => [asset.id, asset]));
const imageAssets = new Map<string, MapImageAsset>();
const imageUrls = new Map<string, string>();
const blobUrls = new Map<string, string>();
const listeners = new Set<() => void>();
subscribeTokenTape(() => { for (const listener of listeners) listener(); });
const settledReady: Promise<void> = Promise.resolve();

export function resourceImageAssetId(uid: string): string {
  return `soyman-resource-images:${uid.toLowerCase()}`;
}

export function mapAssetPackForId(assetId: string): { id: string; version: string } | null {
  if (localImages.has(assetId)) return assetId.startsWith(cryptPrefix) ? CRYPT_PACK : CARTOGRAPHY_PACK;
  if (byId.has(assetId)) return MAP_SYMBOL_PACK;
  if (imageAssets.has(assetId)) return MAP_RESOURCE_IMAGE_PACK;
  return null;
}

export function subscribeMapImageAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function announceImageChange(): void {
  for (const listener of listeners) listener();
}

/** Register metadata, then decode only referenced or selected images. */
export function registerMapImageResources(resources: readonly MapImageResource[]): void {
  for (const resource of resources) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resource.uid)) continue;
    if (!resource.file_url.startsWith("/files/")) continue;
    const id = resourceImageAssetId(resource.uid);
    const signed = new URL(resource.file_url, "http://local.invalid");
    signed.searchParams.delete("sig");
    signed.searchParams.delete("exp");
    const url = signed.pathname + signed.search;
    const existing = imageAssets.get(id);
    if (existing && imageUrls.get(id) === url) continue;
    const oldBlobUrl = blobUrls.get(id);
    if (oldBlobUrl) URL.revokeObjectURL(oldBlobUrl);
    blobUrls.delete(id);
    const asset: MapImageAsset = existing ?? {
      id, name: resource.name, tags: [], kind: "image", image: null, ready: settledReady,
    };
    asset.name = resource.name;
    asset.tags = resource.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
    asset.image = null;
    asset.ready = settledReady;
    imageAssets.set(id, asset);
    imageUrls.set(id, url);
    announceImageChange();
  }
}

export function getMapImageAsset(id: string): MapImageAsset | null {
  return localImages.get(id) ?? imageAssets.get(id) ?? null;
}

export function loadMapImageAsset(id: string): Promise<void> {
  const local = localImages.get(id);
  if (local) {
    const existing = localLoads.get(id);
    if (existing) return existing;
    const load = local.views
      ? Promise.all(Object.values(local.views).map(view => loadMapImageAsset(view.id))).then(() => { local.image = local.views!.s.image; local.failed = false; announceImageChange(); })
      : (async () => {
        const image = new Image();
        image.src = localUrl(id);
        await image.decode();
        local.image = image;
        local.failed = false;
        announceImageChange();
      })();
    local.ready = load;
    localLoads.set(id, load);
    // A failed local file keeps its stable catalog identity and placeholder.
    // Cache the failure to avoid a request/redraw loop; reloading the app retries it.
    void load.catch(() => { local.failed = true; announceImageChange(); });
    return load;
  }
  const asset = imageAssets.get(id);
  const url = imageUrls.get(id);
  if (!asset || !url) return Promise.reject(new Error(`Ресурс карты ${id} не найден`));
  if (asset.image) return Promise.resolve();
  if (asset.ready !== settledReady) return asset.ready;
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("rpgManagerAuthToken") : null;
  if (!token) return Promise.reject(new Error("Требуется вход в приложение"));
  asset.ready = fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      if (!response.ok) throw new Error(`Изображение ${asset.name}: ${response.status}`);
      return response.blob();
    })
    .then(async (blob) => {
      const blobUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = blobUrl;
        await image.decode();
        if (imageUrls.get(id) !== url) return;
        asset.image = image;
        blobUrls.set(id, blobUrl);
        announceImageChange();
      } finally {
        if (blobUrls.get(id) !== blobUrl) URL.revokeObjectURL(blobUrl);
      }
    })
    .catch((error) => {
      if (imageUrls.get(id) === url) asset.ready = settledReady;
      announceImageChange();
      throw error;
    });
  return asset.ready;
}

export async function prepareMapImageAssets(doc: MapDocumentV5 | MapDocumentV6): Promise<void> {
  if (doc.layers.some(layer => layer.kind === "gameplay" && layer.items.some(item => item.kind === "token"))) prepareTokenTape();
  const ids = new Set(doc.layers.flatMap((layer) => layer.kind === "object"
    ? layer.items.flatMap((item) => item.visual.type === "asset" && (item.visual.assetId.startsWith(`${MAP_RESOURCE_IMAGE_PACK.id}:`) || localImages.has(item.visual.assetId))
      ? [item.visual.assetId] : []) : []));
  for (const layer of doc.layers) if (layer.kind === "scatter") for (const area of layer.areas) {
    const profile = area.profileRef.type === "builtin" ? CARTOGRAPHY_SCATTER.find(item => item.key === (area.profileRef.type === "builtin" ? area.profileRef.key : null)) : null;
    if (profile) ids.add(profile.assetId);
  }
  if (doc.layers.some(layer => layer.kind === "path" && layer.paths.some(path => path.kind === "wall"))) {
    for (const key of ["wall-masonry", "wall-masonry-end"]) ids.add(cryptId(key));
  }
  await Promise.all([...ids].map(loadMapImageAsset));
}

export function resolveMapSymbol(visual: VisualRef): MapVisualAsset | null {
  return visual.type === "asset" ? byId.get(visual.assetId) ?? localImages.get(visual.assetId) ?? imageAssets.get(visual.assetId) ?? null : null;
}

/** Built-in decoration is installed with the app and never needs a login. */
const STYLE_IMAGES = ["stone-floor", "earth", "water", "stone-wall", "wood-door"].map(cartographyId);
const PUNK_IMAGES = CRYPT_STYLE_KEYS.map(cryptId);
const styleImages = (style: "paper-ink" | "comic-punk") => style === "comic-punk" ? PUNK_IMAGES : STYLE_IMAGES;
export function cartographyStyleUnavailable(style: "paper-ink" | "comic-punk" = "paper-ink"): boolean {
  return styleImages(style).some(id => getMapImageAsset(id)?.failed);
}
export async function prepareCartographyStyle(style: "paper-ink" | "comic-punk" = "paper-ink"): Promise<void> {
  await Promise.allSettled(styleImages(style).map(id => loadMapImageAsset(id)));
}

/** Retry failed local artwork without modifying any map entities. */
export function retryMapArtwork() {
  const ids: string[] = [];
  for (const [id, asset] of localImages) {
    if (asset.failed) { ids.push(id); localLoads.delete(id); asset.failed = false; }
  }
  return Promise.allSettled(ids.map(loadMapImageAsset));
}
