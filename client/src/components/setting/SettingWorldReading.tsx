import type { ReactNode } from "react";
import type { EntryType } from "../../settingWorld";
import type { SettingEntry } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { AtlasReadingSections, type AtlasSection } from "./AtlasEntry";

export function WorldEntryGroup({ type, count, children }: { type: EntryType; count: number; children: ReactNode }) {
  return (
    <section aria-label={type.group}>
      <div className="set-gh">
        <h3 className="d-plate">{type.group}</h3>
        <span className="d-note">{count}</span>
        {type.key === "notes" && <span className="d-note set-gh__end">только для меня</span>}
      </div>
      {type.atlas && (
        <details className="set-atlas__help">
          <summary>Что это?</summary>
          <p>{type.atlas.help}</p>
        </details>
      )}
      {children}
    </section>
  );
}

export function SettingWorldReading({
  groups, peers, rowId, isOpen, onToggle, onJump, onMenu,
}: {
  groups: { type: EntryType; items: SettingEntry[] }[];
  peers: SettingEntry[];
  rowId: string;
  isOpen: (id: number, section: AtlasSection) => boolean;
  onToggle: (id: number, section: AtlasSection) => void;
  onJump: (entry: SettingEntry) => void;
  onMenu: (entry: SettingEntry, trigger: HTMLElement) => void;
}) {
  return groups.filter(({ items }) => items.length > 0).map(({ type, items }) => (
    <WorldEntryGroup key={type.key} type={type} count={items.length}>
      <div className="set-reading__document">
        {items.map((entry) => (
          <article key={entry.id} className="set-reading__entry">
            <header>
              <h4>{entry.title || "Без названия"}</h4>
              <button
                type="button"
                id={rowId + entry.id}
                className="set-dots"
                aria-label={`Действия с записью «${entry.title || "Без названия"}»`}
                aria-haspopup="menu"
                onClick={(event) => onMenu(entry, event.currentTarget)}
              >
                ⋯
              </button>
            </header>
            {entry.content.trim() && <div className="set-atlas__content"><MentionText text={entry.content} /></div>}
            {type.atlas && (
              <AtlasReadingSections
                type={{ ...type, atlas: type.atlas }}
                entry={entry}
                peers={peers}
                onJump={onJump}
                isOpen={(section) => isOpen(entry.id, section)}
                onToggle={(section) => onToggle(entry.id, section)}
              />
            )}
          </article>
        ))}
      </div>
    </WorldEntryGroup>
  ));
}
