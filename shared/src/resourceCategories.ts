const CATEGORIES = ["folder", "pdf", "markdown", "map", "image", "audio", "link", "other"] as const;
export type ResourceCategory = (typeof CATEGORIES)[number];

export function guessResourceCategory(nameOrUrl: string): ResourceCategory {
  // Windows drive path, UNC share, or file URL.
  if (/^[a-zA-Z]:[\\/]|^\\\\|^file:\/\//i.test(nameOrUrl)) return "folder";
  const withoutQuery = nameOrUrl.split(/[?#]/)[0];
  if (/\.pdf$/i.test(withoutQuery)) return "pdf";
  if (/\.md$/i.test(withoutQuery)) return "markdown";
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(withoutQuery)) return "image";
  if (/\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i.test(withoutQuery)) return "audio";
  if (/^https?:\/\//i.test(nameOrUrl)) return "link";
  return "other";
}

export function isGalleryResource(category: string | null | undefined, nameOrUrl: string): boolean {
  return category === "image" || category === "map" ||
    (!CATEGORIES.some((known) => known === category) && guessResourceCategory(nameOrUrl) === "image");
}
