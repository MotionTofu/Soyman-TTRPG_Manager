import type { CSSProperties } from "react";

// Visual treatment for a thumbnail image on a list card, chosen per section
// in Внешний вид → Тамбнейлы. Independent of the app theme — a display
// preference, persisted the same way as theme/radius (localStorage).
export type ThumbnailStyle = "banner" | "background" | "none";

export const THUMBNAIL_STYLE_OPTIONS: { key: ThumbnailStyle; label: string }[] = [
  { key: "banner", label: "Тамбнейл шапкой" },
  { key: "background", label: "Тамбнейл фоном" },
  { key: "none", label: "Без тамбнейлов" },
];

export const THUMBNAIL_SECTIONS = [
  { key: "campaigns", label: "Кампании" },
  { key: "settings", label: "Сеттинги" },
  { key: "systems", label: "Системы" },
  { key: "beings", label: "Существа (Население)" },
  { key: "roster", label: "Персонажи (состав кампании)" },
  { key: "communities", label: "Сообщества и культуры" },
  { key: "locations", label: "Локации (география)" },
] as const;

export type ThumbnailSectionKey = (typeof THUMBNAIL_SECTIONS)[number]["key"];

const DEFAULTS: Record<ThumbnailSectionKey, ThumbnailStyle> = {
  campaigns: "banner",
  settings: "background",
  systems: "none",
  beings: "banner",
  roster: "none",
  communities: "none",
  locations: "banner",
};

const STORAGE_KEY = "rpgManagerThumbnailStyles";

export function loadThumbnailStyles(): Record<ThumbnailSectionKey, ThumbnailStyle> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveThumbnailStyles(styles: Record<ThumbnailSectionKey, ThumbnailStyle>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
  } catch {
    /* ignore */
  }
}

// Composes the className/style a list card needs for a given style+url
// combination, so every list page renders the same 3 treatments instead of
// re-implementing banner/background markup each time.
//
// `showBanner`/`bannerUrl` tell the caller whether (and with what src) to
// render its own <img className="campaign-thumb" /> (or the themed
// ".campaign-card-band" placeholder when bannerUrl is null) — kept as plain
// data here since this module has no JSX.
export function cardThumbnailProps(
  mode: ThumbnailStyle,
  url: string | null | undefined
): { className: string; style?: CSSProperties; showBanner: boolean; bannerUrl: string | null } {
  if (mode === "background" && url) {
    return { className: "setting-card-bg", style: { backgroundImage: `url("${url}")` }, showBanner: false, bannerUrl: null };
  }
  if (mode === "banner") {
    return { className: "", style: undefined, showBanner: true, bannerUrl: url ?? null };
  }
  return { className: "", style: undefined, showBanner: false, bannerUrl: null };
}
