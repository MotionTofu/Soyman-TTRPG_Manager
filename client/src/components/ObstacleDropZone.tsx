import { memo, useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { DETAIL_ROUTES } from "../entityTypes";
import type { SearchResult, SettingBeing } from "../types";

// "Препятствия" — broader than the old "Противники" (enemies-only, beings-only)
// block: any existing entity can represent an obstacle (a creature, an NPC,
// a location, a dangerous artifact, a hostile community), not just bestiary
// creatures. Kept the `section: "enemies"` link key so existing session data
// isn't orphaned by the rename.
// compendium_entry is accepted too, but only for kind "monster" (checked in
// handleDrop) — a system Бестиарий template dropped straight in, without
// needing a per-setting being row.
const ACCEPT_TYPES = ["being", "character", "location", "artifact", "community", "compendium_entry"];

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  origin: string;
}

interface Entry {
  linkId: number;
  type: string;
  id: number;
  label: string;
  statblockShort?: string;
  origin: string;
}

interface Props {
  sessionId: number;
  // Passed as "live" when rendered inside the session pult, so drops made
  // during a running session are tagged distinctly from ones planned ahead
  // of time via the session profile page (same drop zone, different caller).
  origin?: string;
}

// Memoized so an unrelated setState elsewhere on the session page (e.g.
// typing in the Игровая дата fields) doesn't force this drop zone — and its
// own fetch-on-mount effect — to re-render along with everything else.
export const ObstacleDropZone = memo(function ObstacleDropZone({ sessionId, origin }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);

  async function load() {
    const links = await api.get<GenericLink[]>(
      `/links?type=session&id=${sessionId}&section=enemies`
    );
    const resolved = await Promise.all(
      links.map(async (l) => {
        const other =
          l.from_type === "session" && l.from_id === sessionId
            ? { type: l.to_type, id: l.to_id }
            : { type: l.from_type, id: l.from_id };
        try {
          if (other.type === "being") {
            const being = await api.get<SettingBeing>(`/setting-beings/${other.id}`);
            return { linkId: l.id, type: other.type, id: other.id, label: being.name, statblockShort: being.statblock_short, origin: l.origin };
          }
          const label = await resolveEntityLabel(other.type, other.id);
          return { linkId: l.id, type: other.type, id: other.id, label, origin: l.origin };
        } catch {
          return null;
        }
      })
    );
    setEntries(resolved.filter((e): e is Entry => e !== null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!ACCEPT_TYPES.includes(result.type)) return;
    if (result.type === "compendium_entry" && result.kind !== "monster") return;
    await api.post("/links", {
      from_type: "session",
      from_id: sessionId,
      to_type: result.type,
      to_id: result.id,
      section: "enemies",
      origin,
    });
    load();
  }

  async function remove(linkId: number) {
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
      {entries.length === 0 && (
        <span className="muted">
          Перетащите сюда из поиска — существо, персонажа, локацию, артефакт, сообщество…
        </span>
      )}
      <div className="stack" style={{ gap: 0 }}>
        {entries.map((entry) => (
          <div
            key={entry.linkId}
            className="resource-row stack"
            style={{
              background: entry.origin === "live" ? "color-mix(in srgb, #c0392b 12%, transparent)" : undefined,
            }}
            title={entry.origin === "live" ? "Добавлено на ходу во время сессии" : undefined}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
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
              <button onClick={() => remove(entry.linkId)}>✕</button>
            </div>
            {entry.statblockShort && (
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }} className="muted">
                {entry.statblockShort}
              </p>
            )}
          </div>
        ))}
      </div>
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
    </div>
  );
});
