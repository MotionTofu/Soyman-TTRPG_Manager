import { useEffect, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { LinkNoteList } from "./LinkNoteList";
import { DETAIL_ROUTES } from "../entityTypes";
import type { SearchResult } from "../types";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface Entry {
  linkId: number;
  type: string;
  id: number;
  label: string;
}

interface Props {
  entityType: string;
  entityId: number;
  title: string;
  section: string;
  acceptTypes: string[] | "any";
  placeholder: string;
}

export function LoreSection({ entityType, entityId, title, section, acceptTypes, placeholder }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);

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
        return { linkId: l.id, type: other.type, id: other.id, label };
      })
    );
    setEntries(resolved);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, section]);

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (acceptTypes !== "any" && !acceptTypes.includes(result.type)) return;
    await api.post("/links", {
      from_type: entityType,
      from_id: entityId,
      to_type: result.type,
      to_id: result.id,
      section,
    });
    load();
  }

  async function remove(linkId: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/links/${linkId}`);
    load();
  }

  return (
    <details className="card">
      <summary>
        {title} ({entries.length})
      </summary>
      <div className="stack">
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="muted">{placeholder}</span>
        </div>

        {entries.map((entry) => (
          <details key={entry.linkId} className="card">
            <summary>
              {DETAIL_ROUTES[entry.type] ? (
                <Link to={`${DETAIL_ROUTES[entry.type]}/${entry.id}`}>{entry.label}</Link>
              ) : (
                entry.label
              )}
              <button
                className="danger"
                style={{ float: "right" }}
                onClick={(e) => {
                  e.preventDefault();
                  remove(entry.linkId);
                }}
              >
                ✕
              </button>
            </summary>
            <LinkNoteList linkId={entry.linkId} entityType={entityType} entityId={entityId} />
          </details>
        ))}
      </div>
    </details>
  );
}
