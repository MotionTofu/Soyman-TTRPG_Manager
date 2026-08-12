import { memo, useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { DETAIL_ROUTES } from "../entityTypes";
import { parseMentions } from "../mentions";
import type { SearchResult } from "../types";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  origin: string;
}

interface Entry {
  linkId: number | null;
  type: string;
  id: number;
  label: string;
  origin: string;
}

interface Props {
  entityType: string;
  entityId: number;
  section: string;
  acceptTypes: string[];
  placeholder: string;
  // Optional: also surface entities @-mentioned in this text (filtered to
  // mentionTypes) as read-only rows alongside the real drag-drop links — e.g.
  // a being mentioned in a session's "Задумка" shows up in Сюжетные персонажи
  // without the GM having to drag it in separately. Mention-derived rows have
  // linkId: null and can't be removed here (edit the text instead).
  mentionText?: string;
  mentionTypes?: string[];
  // Passed as "live" by the session pult's panels so drops made during a
  // running session are tagged distinctly from ones planned ahead of time
  // via the session profile page (same drop zone, different call site).
  origin?: string;
  // When "compendium_entry" is in acceptTypes, further restricts drops to
  // entries whose own kind (equipment/magic_item/spell/…) is in this list —
  // e.g. Потенциальный лут accepts compendium items but not spells/monsters.
  // Ignored for other accepted types.
  acceptCompendiumKinds?: string[];
}

// Memoized — see ObstacleDropZone's comment. acceptTypes/mentionTypes are
// arrays, so callers must pass stable (module-level or memoized) references
// for this to actually skip re-rendering; a fresh literal each render would
// still break the memo.
export const SectionDropZone = memo(function SectionDropZone({
  entityType,
  entityId,
  section,
  acceptTypes,
  placeholder,
  mentionText,
  mentionTypes,
  origin,
  acceptCompendiumKinds,
}: Props) {
  const [linkEntries, setLinkEntries] = useState<Entry[]>([]);
  const [mentionEntries, setMentionEntries] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);

  async function load() {
    const links = await api.get<GenericLink[]>(
      `/links?type=${entityType}&id=${entityId}&section=${section}`
    );
    const resolved = await Promise.all(
      links.map(async (l) => {
        const other =
          l.from_type === entityType && l.from_id === entityId
            ? { type: l.to_type, id: l.to_id }
            : { type: l.from_type, id: l.from_id };
        const label = await resolveEntityLabel(other.type, other.id);
        return { linkId: l.id, type: other.type, id: other.id, label, origin: l.origin };
      })
    );
    setLinkEntries(resolved);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, section]);

  useEffect(() => {
    if (!mentionText || !mentionTypes || mentionTypes.length === 0) {
      setMentionEntries([]);
      return;
    }
    let cancelled = false;
    const tokens = parseMentions(mentionText).filter((m) => mentionTypes.includes(m.type));
    Promise.all(
      tokens.map(async (m) => ({
        linkId: null as number | null,
        type: m.type,
        id: m.id,
        label: await resolveEntityLabel(m.type, m.id),
        origin: "planned",
      }))
    ).then((rows) => {
      if (!cancelled) setMentionEntries(rows);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionText, mentionTypes?.join(",")]);

  const linkKeys = new Set(linkEntries.map((e) => `${e.type}:${e.id}`));
  const entries = [...linkEntries, ...mentionEntries.filter((e) => !linkKeys.has(`${e.type}:${e.id}`))];

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!acceptTypes.includes(result.type)) return;
    if (
      result.type === "compendium_entry" &&
      acceptCompendiumKinds &&
      !acceptCompendiumKinds.includes(result.kind ?? "")
    )
      return;
    await api.post("/links", {
      from_type: entityType,
      from_id: entityId,
      to_type: result.type,
      to_id: result.id,
      section,
      origin,
    });
    load();
  }

  async function remove(linkId: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/links/${linkId}`);
    load();
  }

  return (
    <div
      className={`drop-zone${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {entries.length === 0 && <span className="muted">{placeholder}</span>}
      <div className="stack" style={{ gap: 0 }}>
        {entries.map((entry) => (
          <div
            key={`${entry.type}-${entry.id}`}
            className="resource-row row"
            style={{
              justifyContent: "space-between",
              background: entry.origin === "live" ? "color-mix(in srgb, #c0392b 12%, transparent)" : undefined,
            }}
            title={entry.origin === "live" ? "Добавлено на ходу во время сессии" : undefined}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                SEARCH_DRAG_MIME,
                JSON.stringify({ type: entry.type, id: entry.id, title: entry.label })
              );
              e.dataTransfer.effectAllowed = "link";
            }}
          >
            <div className="row" style={{ minWidth: 0, flex: 1 }}>
              {DETAIL_ROUTES[entry.type] ? (
                <button
                  type="button"
                  onClick={() => setPreview({ type: entry.type, id: entry.id })}
                  style={{
                    fontWeight: 600,
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--accent)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {entry.label}
                </button>
              ) : (
                <span style={{ fontWeight: 600 }}>{entry.label}</span>
              )}
              {entry.linkId === null && <span className="muted">из задумки</span>}
            </div>
            {entry.linkId !== null && (
              <button className="comp-mini" onClick={() => remove(entry.linkId!)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
    </div>
  );
});
