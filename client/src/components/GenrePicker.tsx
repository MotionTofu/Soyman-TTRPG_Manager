import { useState } from "react";
import { Modal } from "./Modal";
import { ZineGraphic } from "./ZineGraphics";
import { GENRE_CATEGORIES, MAX_GENRES } from "../genreData";
import type { SettingGenre } from "../types";

export function GenrePicker({
  selected,
  onSave,
  onClose,
}: {
  selected: SettingGenre[];
  onSave: (genres: SettingGenre[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SettingGenre[]>(selected);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggle(genre: string, subgenre?: string) {
    const idx = draft.findIndex(
      (g) => g.genre === genre && g.subgenre === (subgenre ?? undefined),
    );
    if (idx >= 0) {
      setDraft(draft.filter((_, i) => i !== idx));
    } else if (draft.length < MAX_GENRES) {
      setDraft([...draft, { genre, subgenre: subgenre ?? undefined }]);
    }
  }

  function isSelected(genre: string, subgenre?: string) {
    return draft.some(
      (g) => g.genre === genre && g.subgenre === (subgenre ?? undefined),
    );
  }

  function isCategoryOnlySelected(genre: string) {
    return draft.some((g) => g.genre === genre && !g.subgenre);
  }

  function categoryCount(genre: string) {
    return draft.filter((g) => g.genre === genre).length;
  }

  const atLimit = draft.length >= MAX_GENRES;

  return (
    <Modal onClose={onClose}>
      <div className="genre-picker">
        <h2>Жанры сеттинга</h2>
        <p className="muted genre-picker-hint">
          Выберите до трёх основных жанров вашего сеттинга.
        </p>

        {GENRE_CATEGORIES.map((cat) => {
          const isExpanded = expanded.has(cat.name);
          const cnt = categoryCount(cat.name);
          return (
            <div key={cat.name} className="genre-category">
              <div className="genre-category-row">
                <button
                  className="genre-category-toggle"
                  onClick={() => toggleExpand(cat.name)}
                  aria-label={isExpanded ? "Свернуть" : "Развернуть"}
                >
                  <span className={`genre-category-triangle${isExpanded ? " genre-category-triangle--open" : ""}`} />
                </button>
                <button
                  className={`genre-chip genre-category-header${isCategoryOnlySelected(cat.name) ? " genre-chip--selected" : ""}`}
                  style={{ "--genre-color": cat.color } as React.CSSProperties}
                  onClick={() => toggle(cat.name)}
                  disabled={atLimit && !isCategoryOnlySelected(cat.name)}
                  title={atLimit && !isCategoryOnlySelected(cat.name) ? "Лимит 3 жанра — снимите один перед добавлением" : undefined}
                >
                  <ZineGraphic name={cat.icon} className="genre-chip-icon" />
                  <span>{cat.name}</span>
                  {cnt > 0 && (
                    <span className="genre-category-count">{cnt}/{MAX_GENRES}</span>
                  )}
                </button>
              </div>

              {isExpanded && (
                <div className="genre-subgenres">
                  {cat.subgenres.map((sub) => (
                    <button
                      key={sub}
                      className={`genre-chip${isSelected(cat.name, sub) ? " genre-chip--selected" : ""}`}
                      style={{ "--genre-color": cat.color } as React.CSSProperties}
                      onClick={() => toggle(cat.name, sub)}
                      disabled={atLimit && !isSelected(cat.name, sub)}
                      title={atLimit && !isSelected(cat.name, sub) ? "Лимит 3 жанра" : undefined}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="genre-picker-footer">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="muted">{draft.length} / {MAX_GENRES}</span>
            {draft.length > 0 && (
              <button
                onClick={() => setDraft([])}
                style={{ fontSize: "var(--fs-meta)", padding: "2px 8px", height: 26 }}
              >
                Сбросить все
              </button>
            )}
          </div>
          <button className="primary" onClick={() => onSave(draft)}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
