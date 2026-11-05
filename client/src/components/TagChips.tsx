import { useState } from "react";

interface Props {
  tags: string[];
  profile?: boolean;
  onChange?: (tags: string[]) => void;
}

// Free-form tag capsules (requirement 4) using the app's existing
// `.badge.tag` pill style. Read-only when onChange is omitted.
export function TagChips({ tags, onChange, profile = false }: Props) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  function add() {
    if (!draft.trim()) return;
    onChange?.([...tags, draft.trim()]);
    setDraft("");
    setAdding(false);
  }
  function remove(i: number) {
    onChange?.(tags.filter((_, idx) => idx !== i));
  }

  if (!onChange && tags.length === 0) return null;

  return (
    <span className="tag-chip-row">
      {tags.map((t, i) => (
        <span key={i} className="badge tag">
          {t}
          {onChange && (
            <button
              type="button"
              className="tag-chip-remove"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                remove(i);
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {onChange && profile && !adding ? <button type="button" className="profile-tag-add" onClick={() => setAdding(true)}>+ ТЕГ</button> : onChange && (
        <span className="badge tag tag-chip-add" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus={profile}
            aria-label="Новый тег"
            value={draft}
            onBlur={() => { if (profile && !draft.trim()) setAdding(false); }}
            placeholder="+ тег"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </span>
      )}
    </span>
  );
}
