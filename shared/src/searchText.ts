export const SCENE_SEARCH_LABELS = {
  summary: "В двух словах",
  read_aloud: "Зачитать игрокам",
  frame_where: "Где",
  frame_when: "Когда",
  frame_who: "Кто",
  frame_why_now: "Почему сейчас",
  whats_happening: "Что происходит",
  twists: "Повороты",
  pressure: "Давление",
  cut_when: "Когда резать",
  entry_condition: "Условие входа",
  outcomes: "Возможные исходы",
} as const;

export type SceneSearchField = keyof typeof SCENE_SEARCH_LABELS;
export type BookFormat = "pdf" | "md";
export type SearchTarget =
  | { field: SceneSearchField; occurrence: number }
  | { page: number; occurrence: number }
  | { occurrence: number };

export interface SearchFragment {
  label: string;
  before: string;
  match: string;
  after: string;
  target: SearchTarget;
}

export interface SearchFragments {
  fragments: SearchFragment[];
  match_count: number;
}

export const SEARCH_FRAGMENT_LIMIT = 12;

export function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** The caller supplies normalized text so match offsets also locate the excerpt. */
export function searchTextPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

export function searchExcerpt(text: string, start: number, match: string) {
  const before = Math.max(0, start - 44);
  const end = start + match.length;
  const after = Math.min(text.length, end + 64);
  return {
    before: (before ? "…" : "") + text.slice(before, start),
    match,
    after: text.slice(end, after) + (after < text.length ? "…" : ""),
  };
}
