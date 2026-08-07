import { useState, type DragEvent } from "react";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import { addPreviewDockCard, removePreviewDockCard, usePreviewDockCards } from "../previewDockStore";
import type { SearchResult } from "../types";

// Same types EntityPreviewContent knows how to render — anything else
// dropped here is silently ignored, same as the other search-drop targets.
// Exported so SearchPanel's touch "add" button can apply the same filter.
export const ACCEPT_TYPES = ["being", "character", "location", "artifact", "resource", "compendium_entry"];

// Replaces the main nav sidebar while on /sessions/:id/live (see AppShell) —
// a GM running a session can drag creatures/locations/etc. out of search and
// keep their statblock/description visible in a column instead of popping a
// modal every time. State is local/ephemeral: it resets when you navigate
// away from the pult, same as the rest of the live-session UI.
//
// `open` mirrors AppShell's navOpen state and toggles the same mobile
// off-canvas ".open" class the regular <nav class="app-nav"> gets — without
// it, this nav's own hamburger button on mobile is a dead button (the drawer
// stays translated off-screen since nothing ever adds "open" to it).
export function PreviewDock({ open }: { open?: boolean }) {
  const cards = usePreviewDockCards();
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!ACCEPT_TYPES.includes(result.type)) return;
    addPreviewDockCard({ type: result.type, id: result.id });
  }

  return (
    <nav
      className={`app-nav preview-dock${open ? " open" : ""}${dragOver ? " drag-over" : ""}`}
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
          Перетащите сюда существо, персонажа или локацию из поиска — либо нажмите «+» на
          результате поиска.
        </span>
      )}
      <div className="stack preview-dock-list">
        {cards.map((c) => (
          <div key={`${c.type}-${c.id}`} className="card preview-dock-card">
            <EntityPreviewContent
              type={c.type}
              id={c.id}
              onClose={() => removePreviewDockCard(c.type, c.id)}
            />
          </div>
        ))}
      </div>
    </nav>
  );
}
