import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ReaderEntry {
  key: string;
  section: string;
  title: string;
  body: ReactNode;
}

interface Props {
  entries: ReaderEntry[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

// Full-screen "book" reader for Для игроков content: one entry per screen,
// small section label above a large title, left/right edge tap zones (plus
// swipe and arrow keys) move through the flat entry list across every
// section — no separate section-title interstitial, just the label above
// the title changing as you cross a section boundary.
export function PlayerContentReader({ entries, index, onNavigate, onClose }: Props) {
  const entry = entries[index];
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < entries.length - 1) onNavigate(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, entries.length, onNavigate, onClose]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx > 0 && index > 0) onNavigate(index - 1);
    else if (dx < 0 && index < entries.length - 1) onNavigate(index + 1);
  }

  if (!entry) return null;

  return createPortal(
    <div className="player-reader-overlay" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} role="dialog" aria-modal="true" aria-label={`${entry.section}: ${entry.title}`}>
      <div className="player-reader-topbar">
        <span className="player-reader-section muted">{entry.section}</span>
        <button type="button" className="player-reader-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <div className="player-reader-body">
        <h2 className="player-reader-title">{entry.title}</h2>
        {entry.body}
      </div>
      {index > 0 && (
        <button
          type="button"
          className="player-reader-tapzone player-reader-tapzone-left"
          onClick={() => onNavigate(index - 1)}
          aria-label="Предыдущая статья"
        >
          ‹
        </button>
      )}
      {index < entries.length - 1 && (
        <button
          type="button"
          className="player-reader-tapzone player-reader-tapzone-right"
          onClick={() => onNavigate(index + 1)}
          aria-label="Следующая статья"
        >
          ›
        </button>
      )}
      <div className="player-reader-progress muted" aria-live="polite" aria-atomic="true">
        {index + 1} / {entries.length}
      </div>
    </div>,
    document.body
  );
}
