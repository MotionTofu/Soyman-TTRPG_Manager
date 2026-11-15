import type { BookFormat, SearchFragment } from "@shared/searchText";
import { DETAIL_ROUTES, ENTITY_TYPES } from "../entityTypes";
import type { SearchResult } from "../types";

export const GROUPS = [
  ["all", "Всё"], ["game", "Игра"], ["world", "Мир"],
  ["creatures", "Существа"], ["rules", "Правила"], ["files", "Материалы"],
] as const;

type Group = typeof GROUPS[number][0];
export type CreatureSource = "all" | "setting" | "bestiary";
export type Format = "all" | BookFormat;
export type NamedId = { id: number; name: string };
export type SearchScope = NamedId & { kind: "campaign" | "setting" };
export type SearchFilterState = {
  scope: SearchScope | null;
  group: Group;
  creatures: CreatureSource;
  system: string;
  section: string;
  textOnly: boolean;
  format: Format;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilterState = {
  scope: null, group: "all", creatures: "all", system: "", section: "", textOnly: false, format: "all",
};

const GAME = ["campaign", "adventure", "scene", "session", "character", "player"];
const WORLD = ["setting", "location", "being", "community", "artifact", "setting_event"];
const ALL = ENTITY_TYPES.map(type => type.key);
export const FORMAT_LABELS = { all: "PDF и Markdown", pdf: "PDF", md: "Markdown (.md)" };
export const CREATURE_LABELS = { all: "Оба источника", setting: "Существа сеттингов", bestiary: "Бестиарии систем" };

export function panelSearchPaths(query: string, filters: SearchFilterState) {
  if (!query.trim()) return { entities: null, books: null };
  const params = new URLSearchParams({ q: query.trim(), panel: "1" });
  if (filters.scope) params.set(`${filters.scope.kind}_id`, String(filters.scope.id));
  let types = ALL;
  switch (filters.group) {
    case "game": types = GAME; break;
    case "world": types = WORLD; break;
    case "creatures":
      types = filters.creatures === "all" ? ["being", "compendium_entry"]
        : [filters.creatures === "setting" ? "being" : "compendium_entry"];
      params.set("kind", "monster");
      break;
    case "rules":
      types = ["compendium_entry"];
      if (filters.system) params.set("system_id", filters.system);
      if (filters.section) params.set("section_id", filters.section);
      break;
    case "files": types = ["resource"]; break;
  }
  const books = filters.group === "all" || filters.group === "files" ? new URLSearchParams(params) : null;
  if (books) {
    books.set("book_text", "1");
    if (filters.group === "files" && filters.textOnly && filters.format !== "all") books.set("format", filters.format);
  }
  params.set("types", types.join(","));
  return {
    entities: filters.group === "files" && filters.textOnly ? null : `/search?${params}`,
    books: books ? `/search?${books}` : null,
  };
}

export function scopeLabel(scope: SearchScope | null) {
  if (!scope) return "Везде";
  return scope.kind === "campaign" ? "Эта кампания" : "Этот сеттинг";
}

export function searchFilterCount(value: SearchFilterState) {
  return Number(value.scope != null) + Number(value.group !== "all")
    + Number(value.group === "creatures" && value.creatures !== "all")
    + (value.group === "rules" ? Number(!!value.system) + Number(!!value.section) : 0)
    + (value.group === "files" && value.textOnly ? 1 + Number(value.format !== "all") : 0);
}

export function searchResultLink(result: SearchResult, fragment?: SearchFragment): string | null {
  if (result.type === "compendium_entry") {
    return result.system_id != null ? `/systems/${result.system_id}?section=${result.section_id}&entry=${result.id}` : null;
  }
  if (result.type === "location" && result.spot_id != null) {
    return `/locations/${result.id}?tab=${encodeURIComponent("Вложенность")}&spot=${result.spot_id}`;
  }
  const params = new URLSearchParams();
  if (result.campaign_id != null) params.set("campaign", String(result.campaign_id));
  const target = fragment?.target;
  if (target) {
    params.set("find", fragment.match);
    params.set("occurrence", String(target.occurrence));
    params.set("before", fragment.before);
    params.set("after", fragment.after);
    if ("page" in target) params.set("page", String(target.page));
    if ("field" in target) params.set("field", target.field);
  }
  const base = result.book_format
    ? `/resources/${result.id}/${result.book_format === "pdf" ? "read" : "markdown-file"}`
    : DETAIL_ROUTES[result.type] ? `${DETAIL_ROUTES[result.type]}/${result.id}` : null;
  return base && (params.size ? `${base}?${params}` : base);
}
