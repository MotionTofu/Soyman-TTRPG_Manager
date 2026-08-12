import type { BeingCategory } from "./types";

export const BEING_CATEGORIES: { key: BeingCategory | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "bestiary", label: "Бестиарий" },
  { key: "key_figure", label: "Ключевые фигуры" },
  { key: "influential", label: "Влиятельные личности" },
  { key: "notable", label: "Занимательные личности" },
];

// The setting's Население tab holds only *named* personalities, split by
// narrative weight; unnamed creature kinds live in their own Бестиарий
// subsection (category = 'bestiary'), so the two lists never mix and the
// category tabs shown above each list differ.
export const NAMED_BEING_CATEGORIES = BEING_CATEGORIES.filter(
  (c) => c.key !== "bestiary"
);

// Categories offered when creating a being from a generic place (mention
// picker, quick-create): бестиарий entries are created from the Бестиарий
// subsection itself, which passes the category explicitly.
export const CREATABLE_BEING_CATEGORIES = BEING_CATEGORIES.filter(
  (c) => c.key !== "all" && c.key !== "bestiary"
);
