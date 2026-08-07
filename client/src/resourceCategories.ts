import type { NavIconName } from "./components/NavIcons";

export type ResourceCategory = "folder" | "pdf" | "map" | "image" | "audio" | "link" | "other";

export const RESOURCE_CATEGORIES: { key: ResourceCategory; label: string; icon: NavIconName }[] = [
  { key: "folder", label: "Папки", icon: "folder" },
  { key: "pdf", label: "PDF", icon: "document" },
  { key: "map", label: "Карты", icon: "map" },
  { key: "image", label: "Изображения", icon: "image" },
  { key: "audio", label: "Звуки", icon: "volume" },
  { key: "link", label: "Внешние ссылки", icon: "link" },
  { key: "other", label: "Прочее", icon: "document" },
];

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = Object.fromEntries(
  RESOURCE_CATEGORIES.map((c) => [c.key, c.label])
) as Record<ResourceCategory, string>;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const PDF_EXT = /\.pdf$/i;
// Windows drive path ("C:\..."), UNC share ("\\server\...") or a file://
// URL — the closest thing to "a folder on this computer" a plain text
// field can express (there's no real folder-picker in a browser/webview).
const FOLDER_LIKE = /^[a-zA-Z]:[\\/]|^\\\\|^file:\/\//i;

// Best-effort guess so the create dialog opens with a sensible default —
// the user can always override it before saving.
export function guessResourceCategory(nameOrUrl: string): ResourceCategory {
  if (FOLDER_LIKE.test(nameOrUrl)) return "folder";
  const withoutQuery = nameOrUrl.split(/[?#]/)[0];
  if (PDF_EXT.test(withoutQuery)) return "pdf";
  if (IMAGE_EXT.test(withoutQuery)) return "image";
  if (AUDIO_EXT.test(withoutQuery)) return "audio";
  if (/^https?:\/\//i.test(nameOrUrl)) return "link";
  return "other";
}
