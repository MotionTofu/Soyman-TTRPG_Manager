import type { NavIconName } from "./components/NavIcons";
import type { ResourceCategory } from "@shared/resourceCategories";

export { guessResourceCategory, type ResourceCategory } from "@shared/resourceCategories";

export const RESOURCE_CATEGORIES: { key: ResourceCategory; label: string; icon: NavIconName }[] = [
  { key: "folder", label: "Папки", icon: "folder" },
  { key: "pdf", label: "PDF", icon: "document" },
  { key: "markdown", label: "Markdown", icon: "document" },
  { key: "map", label: "Карты", icon: "map" },
  { key: "image", label: "Изображения", icon: "image" },
  { key: "audio", label: "Звуки", icon: "volume" },
  { key: "link", label: "Внешние ссылки", icon: "link" },
  { key: "other", label: "Прочее", icon: "document" },
];

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = Object.fromEntries(
  RESOURCE_CATEGORIES.map((c) => [c.key, c.label])
) as Record<ResourceCategory, string>;
