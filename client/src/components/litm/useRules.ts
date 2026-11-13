import { useMemo } from "react";
import type { CompendiumEntry } from "../../types";
import type { GrimLinks } from "./LitmBook";
import { ruleEntry, rulesOf } from "./litmRules";
import { grimoireHref } from "./useGrimoire";

/** Группы, статьи и ссылки Справочника для каталога и пульта. */
export function useRules(systemId: number, sectionId: number, entries: CompendiumEntry[]) {
  const groups = useMemo(() => rulesOf(entries), [entries]);
  const articles = useMemo(() => groups.flatMap((g) => g.articles), [groups]);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const grim = useMemo<GrimLinks>(() => ({
    article: () => null,
    rule: (name, page) => {
      const entry = ruleEntry(entries, name, page);
      return entry ? grimoireHref(systemId, sectionId, entry.id) : null;
    },
  }), [entries, systemId, sectionId]);
  return { groups, articles, link, grim };
}
