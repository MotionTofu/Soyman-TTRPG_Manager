import { memo, useState } from "react";

interface Props {
  tags: string[];
  variant: "power" | "weak";
  onChange: (tags: string[]) => void;
  leadingChip?: string;
}

// Chip list with an inline add box and a remove button per chip. Used both
// inside the full theme-card edit form and directly in the collapsed view,
// so tags can be added/removed without opening full statblock edit mode.
export const TagList = memo(function TagList({ tags, variant, onChange, leadingChip }: Props) {
  const [draft, setDraft] = useState("");
  const cls = variant === "power" ? "litm-tag-power" : "litm-tag-weak";
  const safeTags = tags ?? [];

  function add() {
    if (!draft.trim()) return;
    onChange([...safeTags, draft.trim()]);
    setDraft("");
  }
  function remove(i: number) {
    onChange(safeTags.filter((_, idx) => idx !== i));
  }

  return (
    <div className="litm-tag-row">
      {leadingChip && <span className={`litm-tag ${cls}`}>{leadingChip}</span>}
      {safeTags.map((t, i) => (
        <span key={i} className={`litm-tag ${cls}`}>
          {t}
          <button type="button" onClick={() => remove(i)}>
            −
          </button>
        </span>
      ))}
      <span className="litm-tag litm-tag-add">
        <input
          value={draft}
          placeholder="новый тэг"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add}>
          +
        </button>
      </span>
    </div>
  );
});
