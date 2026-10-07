import type { ReactNode } from "react";
import "./issuance-columns.css";

export interface IssuanceColumnEntry { id: string; label: string; count?: number; hint?: string }
export function IssuanceColumns({ sections, selectedSection, onSection, items, selectedItem, onItem, title, loading, children }: {
  sections: IssuanceColumnEntry[]; selectedSection: string; onSection: (id: string) => void;
  items: IssuanceColumnEntry[]; selectedItem?: string; onItem: (id: string) => void;
  title: string; loading?: boolean; children: ReactNode;
}) {
  return <div className="issuance-columns">
    <nav className="issuance-columns__nav" aria-label="Разделы выдачи">
      <h3 className="issuance-columns__heading">Разделы</h3>
      {sections.map(s => <button type="button" key={s.id} className={`issuance-columns__row${s.id === selectedSection ? " is-selected" : ""}`} aria-pressed={s.id === selectedSection} onClick={() => onSection(s.id)}>
        <span>{s.label}</span><small>{s.count ?? ""} ›</small>
      </button>)}
    </nav>
    <nav className="issuance-columns__nav" aria-label="Содержимое раздела">
      <h3 className="issuance-columns__heading">{title} <small>{items.length}</small></h3>
      {loading ? <p className="muted">Загрузка…</p> : items.length === 0 ? <p className="muted">Пока пусто</p> : items.map(i => <button type="button" key={i.id} title={i.label} className={`issuance-columns__row${i.id === selectedItem ? " is-selected" : ""}`} aria-pressed={i.id === selectedItem} onClick={() => onItem(i.id)}>
        <span>{i.label}</span>{i.hint && <small>{i.hint}</small>}
      </button>)}
    </nav>
    <div className="issuance-columns__preview">{children}</div>
  </div>;
}
