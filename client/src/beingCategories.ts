import type { BeingCategory } from "./types";

export const BEING_CATEGORIES: { key: BeingCategory | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "bestiary", label: "Бестиарий" },
  { key: "key_figure", label: "Ключевые фигуры" },
  { key: "influential", label: "Влиятельные личности" },
  { key: "notable", label: "Занимательные личности" },
];

// "Бестиарий" generic creatures now live in the system-level compendium
// (see CompendiumSection's monster kind) instead of being recreated per
// setting, so it's excluded from new-being creation — kept in BEING_CATEGORIES
// above only so existing bestiary-category rows still filter/display.
export const CREATABLE_BEING_CATEGORIES = BEING_CATEGORIES.filter(
  (c) => c.key !== "all" && c.key !== "bestiary"
);
