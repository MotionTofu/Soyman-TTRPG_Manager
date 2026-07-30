import type { DragEvent } from "react";
import { useLocation } from "react-router-dom";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { useBag, addToBag, removeFromBag } from "../bag";
import { detectCurrentEntity, resolveCurrentEntityDetails } from "../currentEntity";
import type { SearchResult } from "../types";

// A small grid of slots between search and pinned pages. Empty slots show a
// "+" that grabs whatever entity the current page is about (see
// currentEntity.ts) and drops it into the bag; filled slots are draggable
// with the same SEARCH_DRAG_MIME payload a search result carries, so they
// work on every existing drop target (session Локации/Противники,
// LinkDropZone, playlists, …) with no changes needed there.
export function BagWidget() {
  const location = useLocation();
  const { items, size } = useBag();

  async function handleAddCurrent() {
    const current = detectCurrentEntity(location.pathname, location.search);
    if (!current) return;
    const details = await resolveCurrentEntityDetails(current.type, current.id);
    if (!details) return;
    const item: SearchResult = { type: current.type, id: current.id, ...details };
    addToBag(item);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, item: SearchResult) {
    e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "link";
  }

  const cells = Array.from({ length: size }, (_, i) => items[i] ?? null);

  return (
    <div className="bag-widget">
      <div className="search-heading">
        <strong>Мешок</strong>
      </div>
      <div className="bag-grid">
        {cells.map((item, i) =>
          item ? (
            <div
              key={i}
              className="bag-cell bag-cell-filled"
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              title={item.title}
            >
              <span className="bag-cell-label">{item.title}</span>
              <button
                type="button"
                className="bag-cell-remove"
                onClick={() => removeFromBag(i)}
                title="Убрать из мешка"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              key={i}
              type="button"
              className="bag-cell bag-cell-empty"
              onClick={handleAddCurrent}
              title="Добавить текущую страницу в мешок"
            >
              +
            </button>
          )
        )}
      </div>
    </div>
  );
}
