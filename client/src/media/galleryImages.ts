import { RESOURCE_CATEGORIES, guessResourceCategory } from "../resourceCategories";
import type { Resource } from "../types";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { isSafeImageUrl } from "../utils/safeUrl";

export const DRAG_IMAGE = "application/x-soyman-gallery-image";
export const DRAG_ALBUM = "application/x-soyman-gallery-album";

export function galleryImageCategory(r: Resource): string {
  if (r.category && RESOURCE_CATEGORIES.some((c) => c.key === r.category)) return r.category;
  return guessResourceCategory(r.file_url || r.link_url || r.name);
}

export function useGalleryImage(url: string | null | undefined): string | null {
  const safe = url && isSafeImageUrl(url) ? url : null;
  const auth = useAuthenticatedFileUrl(safe);
  return safe?.startsWith("/files/") ? auth : safe;
}

export function isGalleryResource(resource: Resource): boolean {
  const category = galleryImageCategory(resource);
  return resource.type !== "statblock_template" && (category === "image" || category === "map");
}
