import { useMemo } from "react";
import { useResource } from "../../data/hooks";
import { compendiumPaths } from "../../data/compendiumEntries";
import { oraclePath } from "./litmOracles";
import type { CompendiumEntry, SystemSection } from "../../types";
import type { GrimLinks } from "./LitmBook";
import { ruleEntry, rulesOf } from "./litmRules";
import { grimoireHref } from "./useGrimoire";

/** Группы, статьи и ссылки Справочника для каталога и пульта. */
export function useRules(systemId: number, sectionId: number, entries: CompendiumEntry[]) {
  const groups = useMemo(() => rulesOf(entries), [entries]);
  const articles = useMemo(() => groups.flatMap((g) => g.articles), [groups]);
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data;
  const oraclesId = sections?.find((s) => s.kind === "oracle")?.id;
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  const grim = useMemo<GrimLinks>(() => ({
    article: () => null,
    rule: (name, page) => {
      if (oraclesId && name === "Оракулы") return oraclePath(systemId, oraclesId);
      const entry = ruleEntry(entries, name, page);
      return entry ? grimoireHref(systemId, sectionId, entry.id) : null;
    },
  }), [entries, systemId, sectionId, oraclesId]);
  return { groups, articles, link, grim };
}
