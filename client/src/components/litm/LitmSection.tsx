import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { LitmChallengesView } from "./LitmChallengesView";
import { LitmGrimoireView } from "./LitmGrimoireView";
import { LitmRulesView } from "./LitmRulesView";
import { LitmWaysView } from "./LitmWaysView";
import { LitmStoreView } from "./LitmStoreView";
import { LitmTreasuryView } from "./LitmTreasuryView";
import { LitmJourneysView } from "./LitmJourneysView";
import { LitmThemesView } from "./LitmThemesView";
import { LitmTropesView } from "./LitmTropesView";
import "./litm-book.css";
import { litmCatalogOf } from "./litmBookText";

const NO_ENTRIES: CompendiumEntry[] = [];

export function LitmSection({ systemCode, systemId, section, focusEntryId, children }: {
  systemCode: string | null | undefined;
  systemId: number;
  section: SystemSection;
  focusEntryId: number | undefined;
  children: ReactNode;
}) {
  const catalog = litmCatalogOf(systemCode, section);
  const [, setParams] = useSearchParams();
  const entries = useResource<CompendiumEntry[]>(catalog ? compendiumPaths.sectionEntries(systemId, section.id) : null).data ?? NO_ENTRIES;
  if (!catalog) return <>{children}</>;
  const select = (id: number | undefined) => setParams((p) => {
    if (id === undefined) p.delete("entry"); else p.set("entry", String(id));
    return p;
  }, { replace: true });
  return (
    <section className="litm-book litm-book--section">
      {catalog === "challenges" && <LitmChallengesView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} onSelect={select} />}
      {catalog === "themes" && <LitmThemesView systemId={systemId} entries={entries} selectedId={focusEntryId} onSelect={select} />}
      {catalog === "tropes" && <LitmTropesView systemId={systemId} entries={entries} selectedId={focusEntryId} onSelect={select} />}
      {catalog === "grimoire" && <LitmGrimoireView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
      {catalog === "rules" && <LitmRulesView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
      {catalog === "ways" && <LitmWaysView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
      {catalog === "store" && <LitmStoreView systemId={systemId} entries={entries} selectedId={focusEntryId} />}
      {catalog === "treasury" && <LitmTreasuryView systemId={systemId} entries={entries} selectedId={focusEntryId} />}
      {catalog === "journeys" && <LitmJourneysView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
    </section>
  );
}
