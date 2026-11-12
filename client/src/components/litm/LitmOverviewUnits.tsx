import { compendiumPaths } from "../../data/compendiumEntries";
import { useResource } from "../../data/hooks";
import type { CompendiumEntry, SystemSection } from "../../types";
import { litmCatalogOf, plural } from "./litmBookText";
import { bookUnits, UNIT_NOTES } from "./litmOverview";
import "./litm-book.css";

function Unit({ systemId, section, onOpen }: { systemId: number; section: SystemSection; onOpen: () => void }) {
  const catalog = litmCatalogOf("litm", section);
  const entries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, section.id)).data;
  return (
    <button type="button" className="lo-unit" title={`Перейти в раздел «${section.name}»`} onClick={onOpen}>
      <b>{section.name}</b>
      <em>{entries ? (catalog ? bookUnits(catalog, entries) : `${entries.length} ${plural(entries.length, "запись", "записи", "записей")}`) : "…"}</em>
      {catalog && <span>{UNIT_NOTES[catalog]}</span>}
    </button>
  );
}

/** «Состав справочника» LitM по доске Litm-Overview: разделы в единицах книги. */
export function LitmOverviewUnits({ systemId, sections, onOpen }: { systemId: number; sections: SystemSection[]; onOpen: (id: number) => void }) {
  return (
    <div className="lo-units">
      {sections.map((s) => <Unit key={s.id} systemId={systemId} section={s} onOpen={() => onOpen(s.id)} />)}
    </div>
  );
}
