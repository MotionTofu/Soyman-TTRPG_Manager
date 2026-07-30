import { useState } from "react";

interface Props {
  tags: string[];
  onChange?: (tags: string[]) => void;
}

// Free-form tag capsules (requirement 4) using the app's existing
// `.badge.tag` pill style. Read-only when onChange is omitted.
export function TagChips({ tags, onChange }: Props) {
  const [draft, setDraft] = useState("");

  function add() {
    if (!draft.trim()) return;
    onChange?.([...tags, draft.trim()]);
    setDraft("");
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
      {onChange && (
        <span className="badge tag tag-chip-add" onClick={(e) => e.stopPropagation()}>
          <input
            value={draft}
            placeholder="+ тег"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
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
