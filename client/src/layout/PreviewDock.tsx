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
// modal every time. Состав дока переживает перезагрузку (previewDockStore
// хранит его в localStorage): Мастер набирает участников боя один раз.
//
// `open` mirrors AppShell's navOpen state and toggles the same mobile
// off-canvas ".open" class the regular <nav class="app-nav"> gets — without
// it, this nav's own hamburger button on mobile is a dead button (the drawer
// stays translated off-screen since nothing ever adds "open" to it).
export function PreviewDock({ open }: { open?: boolean }) {
  const cards = usePreviewDockCards();
  const [dragOver, setDragOver] = useState(false);
  // Свёрнутые карточки. Колонка одна, а карточек Мастер держит несколько:
  // свёрнутая оставляет плашку с именем и обе кнопки — этого хватает, чтобы
  // держать в доке пятерых участников боя и разворачивать того, чей ход.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const keyOf = (type: string, id: number) => `${type}-${id}`;
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const allCollapsed = cards.length > 0 && cards.every((c) => collapsed.includes(keyOf(c.type, c.id)));

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as SearchResult;
      if (!result || typeof result.type !== "string" || typeof result.id !== "number" || !Number.isFinite(result.id)) return;
      if (!ACCEPT_TYPES.includes(result.type)) return;
      addPreviewDockCard({ type: result.type, id: result.id });
    } catch {}
  }

  return (
    <nav
      className={`app-nav preview-dock${open ? " open" : ""}${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // relatedTarget null = ушли за окно, содержит = ушли на ребёнка — не гасим
        const rt = e.relatedTarget as Node | null;
        if (rt && e.currentTarget.contains(rt)) return;
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="preview-dock-header">
        <span>Докстанция превью</span>
        {/* Одна кнопка, а не две: когда всё свёрнуто, она разворачивает
            обратно. Отдельная «Развернуть всё» рядом половину времени была бы
            бесполезной, а орган управления, которому нечего делать, система
            не показывает. Нет карточек — нет и кнопки. */}
        {cards.length > 0 && (
          <button
            type="button"
            className="comp-mini"
            onClick={() => setCollapsed(allCollapsed ? [] : cards.map((c) => keyOf(c.type, c.id)))}
          >
            {allCollapsed ? "Развернуть всё" : "Свернуть всё"}
          </button>
        )}
      </div>
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
              // Уход в профиль сбрасывает док вместе с живой сессией —
              // поэтому отсюда профиль открывается новым окном (шаг 4).
              profileInNewWindow
              collapsed={collapsed.includes(keyOf(c.type, c.id))}
              onToggleCollapse={() => toggleCollapsed(keyOf(c.type, c.id))}
              onClose={() => removePreviewDockCard(c.type, c.id)}
            />
          </div>
        ))}
      </div>
    </nav>
  );
}
