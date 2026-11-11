import { useMemo } from "react";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import type { GrimLinks } from "./LitmBook";
import { norm } from "./litmBookText";
import { grimoireOf, resolveBookRef } from "./litmGrimoire";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
export const grimoireHref = (systemId: number, sectionId: number, id: number) => `/systems/${systemId}?section=${sectionId}&entry=${id}`;

/** Главы, статьи, ссылки книги и подсказки эффектов — для раздела и шторки пульта. */
export function useGrimoire(systemId: number, sectionId: number, entries: CompendiumEntry[]) {
  const chapters = useMemo(() => grimoireOf(entries), [entries]);
  const articles = useMemo(() => chapters.flatMap((c) => c.articles), [chapters]);
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? NO_SECTIONS;
  const rulesSection = sections.find((s) => s.name === "Справочник");
  const ruleEntries = useResource<CompendiumEntry[]>(rulesSection ? compendiumPaths.sectionEntries(systemId, rulesSection.id) : null).data ?? NO_ENTRIES;
  const grim = useMemo<GrimLinks>(() => {
    const rules = new Map(ruleEntries.map((e) => [norm(e.name), e.id]));
    return {
      article: (name, page) => { const id = resolveBookRef(chapters, name, page); return id === null ? null : grimoireHref(systemId, sectionId, id); },
      rule: (name) => {
        const id = rules.get(norm(name));
        return id !== undefined && rulesSection ? grimoireHref(systemId, rulesSection.id, id) : null;
      },
    };
  }, [chapters, ruleEntries, rulesSection, systemId, sectionId]);
  const tips = useMemo(() => new Map(articles.flatMap((a) => a.effects).map((f) => [f.key, `${f.name} — ${f.text}`])), [articles]);
  const link = (id: number) => grimoireHref(systemId, sectionId, id);
  return { chapters, articles, grim, tips, link };
}
