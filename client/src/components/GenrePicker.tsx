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

  const atLimit = draft.length >= MAX_GENRES;

  return (
    <Modal onClose={onClose}>
      <div className="genre-picker">
        <h2>Жанры сеттинга</h2>
        <p className="muted genre-picker-hint">
          Выберите до трёх основных жанров вашего сеттинга.
        </p>

        {GENRE_CATEGORIES.map((cat) => (
          <div key={cat.name} className="genre-category">
            <button
              className={`genre-category-header${isCategoryOnlySelected(cat.name) ? " genre-category-header--selected" : ""}`}
              style={{ "--genre-color": cat.color } as React.CSSProperties}
              onClick={() => toggle(cat.name)}
              disabled={atLimit && !isCategoryOnlySelected(cat.name)}
            >
              <ZineGraphic name={cat.icon} className="genre-category-icon" />
              <span>{cat.name}</span>
            </button>

            <div className="genre-subgenres">
              {cat.subgenres.map((sub) => (
                <button
                  key={sub}
                  className={`genre-chip${isSelected(cat.name, sub) ? " genre-chip--selected" : ""}`}
                  style={{ "--genre-color": cat.color } as React.CSSProperties}
                  onClick={() => toggle(cat.name, sub)}
                  disabled={atLimit && !isSelected(cat.name, sub)}
                >
                  {sub}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="genre-picker-footer">
          <span className="muted">{draft.length} / {MAX_GENRES}</span>
          <button className="primary" onClick={() => onSave(draft)}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
