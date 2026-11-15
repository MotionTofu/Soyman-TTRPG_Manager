import { useMemo } from "react";
import { compendiumPaths } from "../../../data/compendiumEntries";
import { useResource } from "../../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../../types";
import { useRules } from "../useRules";
import { litmCatalogOf } from "../litmBookText";
import { searchGrimoire } from "../litmGrimoire";
import { searchRules } from "../litmRules";
import { useGrimoireBook } from "../useGrimoire";

export interface LitmArticleTarget {
  sectionId: number;
  entryId: number;
  anchor?: string;
}

const NO_ENTRIES: CompendiumEntry[] = [];

export function useLitmCompendium(systemId: number | null, query: string) {
  const sections = useResource<SystemSection[]>(systemId == null ? null : compendiumPaths.sections(systemId));
  const rulesSection = sections.data?.find((s) => litmCatalogOf("litm", s) === "rules");
  const grimoireSection = sections.data?.find((s) => litmCatalogOf("litm", s) === "grimoire");
  const rulesId = rulesSection?.id;
  const grimoireId = grimoireSection?.id;
  const ruleEntries = useResource<CompendiumEntry[]>(systemId != null && rulesId != null ? compendiumPaths.sectionEntries(systemId, rulesId) : null);
  const grimoireEntries = useResource<CompendiumEntry[]>(systemId != null && grimoireId != null ? compendiumPaths.sectionEntries(systemId, grimoireId) : null);
  const rules = useRules(systemId ?? 0, rulesId ?? 0, ruleEntries.data ?? NO_ENTRIES);
  const grimoire = useGrimoireBook(systemId ?? 0, grimoireId ?? 0, grimoireEntries.data ?? NO_ENTRIES, rulesId, ruleEntries.data ?? NO_ENTRIES);
  const hits = useMemo(() => [
    ...(rulesSection ? searchRules(rules.articles, query, 12).map(({ article, phrase, rank }) => ({
      entry: article.entry, source: rulesSection.name, phrase, rank,
    })) : []),
    ...(grimoireSection ? searchGrimoire(grimoire.articles, query, 12).map(({ article, phrase, rank }) => ({
      entry: article.entry, source: grimoireSection.name, phrase, rank,
    })) : []),
  ].sort((a, b) => a.rank - b.rank), [query, rules.articles, grimoire.articles, rulesSection, grimoireSection]);

  // Глобальный поиск также возвращает главы и примеры статусов. Открываем
  // их в книге, если для записи есть страница в одном из двух разделов.
  const bookEntryIds = useMemo(() => new Set([
    ...rules.groups.flatMap((g) => [g.entry.id, ...g.articles.map((a) => a.entry.id),
      ...g.catalog.flatMap((c) => [c.entry.id, ...c.items.map((item) => item.id)])]),
    ...grimoire.chapters.flatMap((c) => [c.entry.id, ...c.articles.map((a) => a.entry.id)]),
  ]), [rules.groups, grimoire.chapters]);

  const error = [sections, ruleEntries, grimoireEntries].find((source) => source.error);
  return {
    rules, grimoire, rulesId, grimoireId, hits, bookEntryIds, sections: [rulesSection, grimoireSection],
    loading: sections.loading || ruleEntries.loading || grimoireEntries.loading,
    error: error?.error, reload: error?.reload,
  };
}
