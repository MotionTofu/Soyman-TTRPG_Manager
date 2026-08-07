import { memo, useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import type { CompendiumEntry, DndFeature, SearchResult } from "../../types";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { MentionText } from "../mentions/MentionText";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { api } from "../../api/client";
import { NavIcon } from "../NavIcons";

function readSearchDrop(e: DragEvent): SearchResult | null {
  const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SearchResult;
  } catch {
    return null;
  }
}

// One name+description row. Memoized and given stable per-row callbacks (see
// FeatureListEdit below) so editing one feature's description doesn't force
// every other feature in the same block to re-render — a block can hold
// several long auto-filled compendium descriptions, each with its own
// MentionTextarea toolbar, and without this a keystroke in row 1 used to
// re-diff rows 2-7 too.
const FeatureRow = memo(function FeatureRow({
  value,
  onChangeName,
  onChangeDescription,
  onRemove,
}: {
  value: DndFeature;
  onChangeName: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="dnd-feature-row">
      <div className="row">
        <input placeholder="Название" value={value.name} onChange={(e) => onChangeName(e.target.value)} />
        <button type="button" className="comp-mini" onClick={onRemove}>
          <NavIcon name="close" />
        </button>
      </div>
      <MentionTextarea value={value.description} onChange={onChangeDescription} rows={2} />
    </div>
  );
});

// Repeatable name+description entries — traits/actions/attacks/features,
// same shape used across every D&D card section. Memoized: these lists can
// now hold long auto-filled compendium descriptions, and the character
// sheet has many of them — without memo, typing in an unrelated field on
// the sheet forces React to re-diff every one of these on every keystroke.
export const FeatureListEdit = memo(function FeatureListEdit({
  title,
  values,
  onChange,
  headerColorClass,
}: {
  title: string;
  values: DndFeature[];
  onChange: (v: DndFeature[]) => void;
  headerColorClass?: string;
}) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const update = useCallback((i: number, patch: Partial<DndFeature>) => {
    const next = valuesRef.current.slice();
    next[i] = { ...next[i], ...patch };
    onChangeRef.current(next);
  }, []);
  const remove = useCallback((i: number) => {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChangeRef.current(valuesRef.current.filter((_, idx) => idx !== i));
  }, []);
  function add() {
    onChange([...values, { name: "", description: "" }]);
  }

  // Stable per-row callbacks — rebuilt only when the row count changes
  // (add/remove), not on every keystroke, so FeatureRow's memo actually
  // skips the rows the user isn't currently editing.
  const nameCallbacks = useMemo(
    () => values.map((_, i) => (v: string) => update(i, { name: v })),
    [values.length, update]
  );
  const descriptionCallbacks = useMemo(
    () => values.map((_, i) => (v: string) => update(i, { description: v })),
    [values.length, update]
  );
  const removeCallbacks = useMemo(() => values.map((_, i) => () => remove(i)), [values.length, remove]);

  return (
    <div className="dnd-feature-section">
      <div className={`dnd-feature-header ${headerColorClass ?? ""}`}>{title}</div>
      <div className="stack">
        {values.map((f, i) => (
          <FeatureRow
            key={i}
            value={f}
            onChangeName={nameCallbacks[i]}
            onChangeDescription={descriptionCallbacks[i]}
            onRemove={removeCallbacks[i]}
          />
        ))}
        <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
          + Добавить
        </button>
      </div>
    </div>
  );
});

// Species/class/subclass features are auto-filled verbatim from the
// compendium when the player picks a class/subclass/species — the text is
// canonical, not something typed per-character, so unlike FeatureListEdit
// (Черты/Особые умения/Атаки, which are hand-authored) these don't need a
// permanently-mounted MentionTextarea + full rich-text toolbar per row.
// Displayed the same way spells are in DndSpellLevelSection: a collapsed
// name that expands to read-only text on click. A rare hand-added entry
// still gets one full edit form, but only while actively being composed —
// it collapses to the same read-only row once confirmed.
export const AutoFeatureListEdit = memo(function AutoFeatureListEdit({
  title,
  values,
  onChange,
  headerColorClass,
  // Only "Черты" wires this up — dragging a "feat"-kind result from search
  // fetches its full compendium description and adds it as a row.
  allowSearchDrop,
}: {
  title: string;
  values: DndFeature[];
  onChange: (v: DndFeature[]) => void;
  headerColorClass?: string;
  allowSearchDrop?: boolean;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const remove = useCallback((i: number) => {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    onChangeRef.current(valuesRef.current.filter((_, idx) => idx !== i));
  }, []);

  const removeCallbacks = useMemo(() => values.map((_, i) => () => remove(i)), [values.length, remove]);
  const toggleCallbacks = useMemo(
    () => values.map((_, i) => () => setExpandedIndex((cur) => (cur === i ? null : i))),
    [values.length]
  );

  function confirmAdd() {
    if (!draftName.trim()) return;
    onChange([...values, { name: draftName.trim(), description: draftDescription }]);
    setDraftName("");
    setDraftDescription("");
    setAdding(false);
  }
  function cancelAdd() {
    setDraftName("");
    setDraftDescription("");
    setAdding(false);
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const result = readSearchDrop(e);
    if (!result || result.type !== "compendium_entry" || result.kind !== "feat") return;
    if (valuesRef.current.some((f) => f.name === result.title)) return;
    let description = "";
    try {
      const entry = await api.get<CompendiumEntry>(`/systems/entries/${result.id}`);
      description = entry.description || "";
    } catch {
      /* feat entry missing — leave description blank */
    }
    onChangeRef.current([...valuesRef.current, { name: result.title, description }]);
  }

  return (
    <div
      className={`dnd-feature-section${dragOver ? " drag-over" : ""}`}
      onDragOver={allowSearchDrop ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={allowSearchDrop ? () => setDragOver(false) : undefined}
      onDrop={allowSearchDrop ? handleDrop : undefined}
    >
      <div className={`dnd-feature-header ${headerColorClass ?? ""}`}>{title}</div>
      <div className="stack" style={{ gap: 4 }}>
        {values.map((f, i) => (
          <div key={i}>
            <div className="row dnd-feature-auto-row" style={{ justifyContent: "space-between" }}>
              <span className="dnd-spell-name-link" onClick={toggleCallbacks[i]}>
                {f.name || "Без названия"}
              </span>
              <button type="button" className="comp-mini danger" onClick={removeCallbacks[i]}>
                <NavIcon name="close" />
              </button>
            </div>
            {expandedIndex === i && (
              <div className="dnd-spell-description">
                <MentionText text={f.description} />
              </div>
            )}
          </div>
        ))}
        {adding ? (
          <div className="dnd-feature-row">
            <input autoFocus placeholder="Название" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <MentionTextarea value={draftDescription} onChange={setDraftDescription} rows={2} />
            <div className="row">
              <button type="button" className="primary" onClick={confirmAdd}>
                Добавить
              </button>
              <button type="button" onClick={cancelAdd}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="comp-mini" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
            + Добавить вручную
          </button>
        )}
      </div>
    </div>
  );
});

export function FeatureListView({
  title,
  values,
  headerColorClass,
}: {
  title: string;
  values: DndFeature[];
  headerColorClass?: string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="dnd-feature-section">
      <div className={`dnd-feature-header ${headerColorClass ?? ""}`}>{title}</div>
      <div className="stack">
        {values.map((f, i) => (
          <div key={i}>
            {f.name && <strong>{f.name}. </strong>}
            <span style={{ whiteSpace: "pre-wrap" }}>
              <MentionText text={f.description} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
