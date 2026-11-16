import { isGalleryResource as hasImageCategory } from "@shared/resourceCategories";
import type { Resource } from "../types";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { isSafeImageUrl } from "../utils/safeUrl";

export const DRAG_IMAGE = "application/x-soyman-gallery-image";
export const DRAG_ALBUM = "application/x-soyman-gallery-album";

export function useGalleryImage(url: string | null | undefined): string | null {
  const safe = url && isSafeImageUrl(url) ? url : null;
  const auth = useAuthenticatedFileUrl(safe);
  return safe?.startsWith("/files/") ? auth : safe;
}

export function isGalleryResource(resource: Resource): boolean {
  return resource.type !== "statblock_template" &&
    hasImageCategory(resource.category, resource.file_url || resource.link_url || resource.name);
}
