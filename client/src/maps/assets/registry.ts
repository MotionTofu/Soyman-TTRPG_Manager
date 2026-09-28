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
}

export interface MapSymbolAsset {
  id: string;
  name: string;
  tags: readonly string[];
  glyph: "tree" | "tower" | "camp";
}

export type MapVisualAsset = MapSymbolAsset | MapImageAsset;

export const MAP_SYMBOL_ASSETS: readonly MapSymbolAsset[] = [
  { id: "soyman-symbols:tree", name: "Дерево", tags: ["природа", "местность"], glyph: "tree" },
  { id: "soyman-symbols:tower", name: "Башня", tags: ["постройки", "ориентир"], glyph: "tower" },
  { id: "soyman-symbols:camp", name: "Лагерь", tags: ["поселение", "ориентир"], glyph: "camp" },
];

const byId = new Map(MAP_SYMBOL_ASSETS.map((asset) => [asset.id, asset]));
const imageAssets = new Map<string, MapImageAsset>();
const imageUrls = new Map<string, string>();
const blobUrls = new Map<string, string>();
const listeners = new Set<() => void>();
const settledReady: Promise<void> = Promise.resolve();

export function resourceImageAssetId(uid: string): string {
  return `soyman-resource-images:${uid.toLowerCase()}`;
}

export function mapAssetPackForId(assetId: string): { id: string; version: string } | null {
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
  return imageAssets.get(id) ?? null;
}

export function loadMapImageAsset(id: string): Promise<void> {
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

export async function prepareMapImageAssets(doc: MapDocumentV5): Promise<void> {
  const ids = new Set(doc.layers.flatMap((layer) => layer.kind === "object"
    ? layer.items.flatMap((item) => item.visual.type === "asset" && item.visual.assetId.startsWith(`${MAP_RESOURCE_IMAGE_PACK.id}:`)
      ? [item.visual.assetId] : []) : []));
  await Promise.all([...ids].map(loadMapImageAsset));
}

export function resolveMapSymbol(visual: VisualRef): MapVisualAsset | null {
  return visual.type === "asset" ? byId.get(visual.assetId) ?? imageAssets.get(visual.assetId) ?? null : null;
}
