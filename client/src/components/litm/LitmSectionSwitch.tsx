import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { DSeg } from "../DSeg";
import { LitmChallengesView } from "./LitmChallengesView";
import { LitmGrimoireView } from "./LitmGrimoireView";
import { LitmRulesView } from "./LitmRulesView";
import { LitmWaysView } from "./LitmWaysView";
import { LitmStoreView } from "./LitmStoreView";
import { LitmTreasuryView } from "./LitmTreasuryView";
import { LitmThemesView } from "./LitmThemesView";
import { LitmTropesView } from "./LitmTropesView";
import "./litm-book.css";
import { litmCatalogOf } from "./litmBookText";

const NO_ENTRIES: CompendiumEntry[] = [];

/** Раздел LitM с принятой доской (Вызовы, Темы, Тропы, Гримуар, Справочник, Пути магии, Общая лавка, Сокровищница) показывается каталогом;
 *  у Тем и Тропов «Список» — прежний раздел целиком, со всей правкой. Остальные
 *  разделы и системы проходят насквозь. */
export function LitmSectionSwitch({ systemCode, systemId, section, focusEntryId, children }: {
  systemCode: string | null | undefined;
  systemId: number;
  section: SystemSection;
  focusEntryId: number | undefined;
  children: ReactNode;
}) {
  const catalog = litmCatalogOf(systemCode, section);
  const [params, setParams] = useSearchParams();
  const entries = useResource<CompendiumEntry[]>(catalog ? compendiumPaths.sectionEntries(systemId, section.id) : null).data ?? NO_ENTRIES;
  if (!catalog) return <>{children}</>;
  const view = params.get("view") === "list" ? "list" : "catalog";
  const setView = (v: "catalog" | "list") => setParams((p) => {
    if (v === "list") p.set("view", "list"); else p.delete("view");
    return p;
  }, { replace: true });
  const select = (id: number | undefined) => setParams((p) => {
    if (id === undefined) p.delete("entry"); else p.set("entry", String(id));
    return p;
  }, { replace: true });
  const toggle = (
    <div className="lb-viewbar">
      <DSeg label="Вид раздела" value={view} onChange={setView}
        items={[{ id: "catalog", label: "Каталог" }, { id: "list", label: "Список" }]} />
      {view === "list" && <span className="d-mono">правка, добавление и порядок записей</span>}
    </div>
  );
  // У вызовов «Списка» нет (решение 2026-11-06, Q1): прежний вид — бестиарий D&D,
  // а правка, «+ Вызов» и «⋯» живут в самом каталоге.
  const withList = catalog !== "challenges";
  if (withList && view === "list") return <>{toggle}{children}</>;
  return (
    <>
      {withList && toggle}
      <section className="litm-book">
        {catalog === "challenges" && <LitmChallengesView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} onSelect={select} />}
        {catalog === "themes" && <LitmThemesView systemId={systemId} entries={entries} selectedId={focusEntryId} onSelect={select} />}
        {catalog === "tropes" && <LitmTropesView systemId={systemId} entries={entries} selectedId={focusEntryId} onSelect={select} />}
        {catalog === "grimoire" && <LitmGrimoireView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
        {catalog === "rules" && <LitmRulesView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
        {catalog === "ways" && <LitmWaysView systemId={systemId} sectionId={section.id} entries={entries} selectedId={focusEntryId} />}
        {catalog === "store" && <LitmStoreView systemId={systemId} entries={entries} selectedId={focusEntryId} />}
        {catalog === "treasury" && <LitmTreasuryView systemId={systemId} entries={entries} selectedId={focusEntryId} />}
      </section>
    </>
  );
}
