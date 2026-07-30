import { useState, type DragEvent } from "react";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import type { SearchResult } from "../types";

// Same types EntityPreviewContent knows how to render — anything else
// dropped here is silently ignored, same as the other search-drop targets.
const ACCEPT_TYPES = ["being", "character", "location", "artifact", "resource"];

// Replaces the main nav sidebar while on /sessions/:id/live (see AppShell) —
// a GM running a session can drag creatures/locations/etc. out of search and
// keep their statblock/description visible in a column instead of popping a
// modal every time. State is local/ephemeral: it resets when you navigate
// away from the pult, same as the rest of the live-session UI.
export function PreviewDock() {
  const [cards, setCards] = useState<{ type: string; id: number }[]>([]);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!ACCEPT_TYPES.includes(result.type)) return;
    setCards((prev) =>
      prev.some((c) => c.type === result.type && c.id === result.id)
        ? prev
        : [...prev, { type: result.type, id: result.id }]
    );
  }

  function remove(type: string, id: number) {
    setCards((prev) => prev.filter((c) => !(c.type === type && c.id === id)));
  }

  return (
    <nav
      className={`app-nav preview-dock${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="preview-dock-header">Докстанция превью</div>
      {cards.length === 0 && (
        <span className="muted preview-dock-placeholder">
          Перетащите сюда существо, персонажа или локацию из поиска
        </span>
      )}
      <div className="stack preview-dock-list">
        {cards.map((c) => (
          <div key={`${c.type}-${c.id}`} className="card preview-dock-card">
            <EntityPreviewContent type={c.type} id={c.id} onClose={() => remove(c.type, c.id)} />
          </div>
        ))}
      </div>
    </nav>
  );
}
