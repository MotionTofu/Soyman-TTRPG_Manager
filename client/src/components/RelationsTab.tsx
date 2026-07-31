import { useEffect, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { RELATION_TONES, RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "../relations";
import { DETAIL_ROUTES, ENTITY_TYPE_SINGULAR } from "../entityTypes";
import type { EntityRelation, EntityRelationsResponse, RelationEntityType, RelationTone, SearchResult } from "../types";

const PICK_TYPES = ["being", "character", "community", "compendium_entry"];

type SortMode = "tone" | "alpha" | "label";
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "tone", label: "По типу отношения" },
  { key: "alpha", label: "По алфавиту" },
  { key: "label", label: "По названию отношения" },
];

const TONE_ORDER: Record<RelationTone, number> = { positive: 0, mixed: 1, neutral: 2, negative: 3 };

function sortRelations(list: EntityRelation[], mode: SortMode): EntityRelation[] {
  const copy = [...list];
  if (mode === "tone") copy.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.other_name ?? "").localeCompare(b.other_name ?? ""));
  else if (mode === "alpha") copy.sort((a, b) => (a.other_name ?? "").localeCompare(b.other_name ?? ""));
  else copy.sort((a, b) => a.label.localeCompare(b.label) || (a.other_name ?? "").localeCompare(b.other_name ?? ""));
  return copy;
}

function ToneDot({ tone }: { tone: RelationTone }) {
  return (
    <span
      title={RELATION_TONE_LABELS[tone]}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: RELATION_TONE_COLORS[tone],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

interface Props {
  entityType: RelationEntityType;
  entityId: number;
  entityName: string;
  // Preselects the Сеттинг dropdown in the description's @-mention modal —
  // same convention as MentionTextarea elsewhere.
  defaultSettingId?: number;
}

// Reusable "Связи" tab for Beings/Characters/Communities: directional,
// tone-colored relations to any of the other two kinds. Each relation is
// authored from one side (from_* declares an attitude toward to_*) — the
// entity being viewed sees its own declared relations (outgoing) plus
// whatever others have declared about it (incoming), since those can
// legitimately disagree.
export function RelationsTab({ entityType, entityId, entityName, defaultSettingId }: Props) {
  const [data, setData] = useState<EntityRelationsResponse | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("tone");
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState<SearchResult | null>(null);
  const [draftTone, setDraftTone] = useState<RelationTone>("neutral");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTone, setEditTone] = useState<RelationTone>("neutral");
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");

  function load() {
    api
      .get<EntityRelationsResponse>(`/entity-relations?entity_type=${entityType}&entity_id=${entityId}`)
      .then(setData);
  }
  useEffect(load, [entityType, entityId]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await api.get<SearchResult[]>(
        `/search?q=${encodeURIComponent(query)}&types=${PICK_TYPES.join(",")}`
      );
      setSearchResults(res.filter((r) => !(r.type === entityType && r.id === entityId)));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, entityType, entityId]);

  function pickResult(result: SearchResult) {
    setPending(result);
    setDraftTone("neutral");
    setDraftLabel("");
    setDraftDescription("");
    setQuery("");
    setSearchResults([]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    const result: SearchResult = JSON.parse(raw);
    if (!PICK_TYPES.includes(result.type)) return;
    if (result.type === entityType && result.id === entityId) return;
    pickResult(result);
  }

  async function confirmAdd() {
    if (!pending) return;
    await api.post("/entity-relations", {
      from_type: entityType,
      from_id: entityId,
      to_type: pending.type,
      to_id: pending.id,
      tone: draftTone,
      label: draftLabel,
      description: draftDescription,
    });
    setPending(null);
    load();
  }

  function startEdit(r: EntityRelation) {
    setEditingId(r.id);
    setEditTone(r.tone);
    setEditLabel(r.label);
    setEditDescription(r.description);
  }

  async function saveEdit(id: number) {
    await api.put(`/entity-relations/${id}`, { tone: editTone, label: editLabel, description: editDescription });
    setEditingId(null);
    load();
  }

  async function removeRelation(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/entity-relations/${id}`);
    load();
  }

  function renderRelation(r: EntityRelation, direction: "out" | "in") {
    const otherRoute = DETAIL_ROUTES[r.other_type];
    // Always read as "author ⟶ recipient", regardless of whether this
    // entity is the author (outgoing) or the recipient (incoming) — a plain
    // arrow-then-name-then-name reads ambiguously once the arrow flips.
    const fromLabel = direction === "out" ? entityName : r.other_name ?? "?";
    const toLabel = direction === "out" ? r.other_name ?? "?" : entityName;
    return (
      <details key={r.id} className="card">
        <summary>
          <ToneDot tone={r.tone} />
          {fromLabel} ⟶ {toLabel} {r.label && <span className="muted">— {r.label}</span>}
          <button
            className="danger"
            style={{ float: "right" }}
            onClick={(e) => {
              e.preventDefault();
              removeRelation(r.id);
            }}
          >
            ✕
          </button>
        </summary>
        <div className="stack">
          {editingId === r.id ? (
            <>
              <div className="row">
                {RELATION_TONES.map((t) => (
                  <label key={t.key} className="row" style={{ gap: 4 }}>
                    <input
                      type="radio"
                      name={`tone-${r.id}`}
                      checked={editTone === t.key}
                      onChange={() => setEditTone(t.key)}
                    />
                    <ToneDot tone={t.key} />
                    {t.label}
                  </label>
                ))}
              </div>
              <label>
                Название отношения
                <input
                  placeholder="например: любит, ненавидит, должен денег"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
              </label>
              <label>
                Подробности
                <MentionTextarea
                  value={editDescription}
                  onChange={setEditDescription}
                  rows={3}
                  defaultSettingId={defaultSettingId}
                />
              </label>
              <div className="row">
                <button className="primary" onClick={() => saveEdit(r.id)}>
                  Сохранить
                </button>
                <button onClick={() => setEditingId(null)}>Отмена</button>
              </div>
            </>
          ) : (
            <>
              {otherRoute && <Link to={`${otherRoute}/${r.other_id}`}>Открыть {r.other_name} →</Link>}
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={r.description} />
              </div>
              <button style={{ alignSelf: "flex-start" }} onClick={() => startEdit(r)}>
                Изменить
              </button>
            </>
          )}
        </div>
      </details>
    );
  }

  if (!data) return <p className="muted">Загрузка…</p>;

  const outgoing = sortRelations(data.outgoing, sortMode);
  const incoming = sortRelations(data.incoming, sortMode);

  return (
    <div className="stack">
      <div className="row" style={{ position: "relative" }}>
        <input
          placeholder="Найти существо, персонажа или фракцию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchResults.length > 0 && (
          <div className="entity-search-results">
            {searchResults.map((r) => (
              <div key={`${r.type}:${r.id}`} className="entity-search-item" onClick={() => pickResult(r)}>
                <span className={`entity-type-chip ${r.type}`}>{ENTITY_TYPE_SINGULAR[r.type] ?? r.type}</span>
                {r.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className={`drop-zone${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="muted">
          Или перетащите сюда существо, персонажа или фракцию из поиска, чтобы указать отношение {entityName} к ним
        </span>
      </div>

      {pending && (
        <div className="card stack">
          <strong>
            {entityName} ⟶ {pending.title}
          </strong>
          <div className="row">
            {RELATION_TONES.map((t) => (
              <label key={t.key} className="row" style={{ gap: 4 }}>
                <input
                  type="radio"
                  name="new-tone"
                  checked={draftTone === t.key}
                  onChange={() => setDraftTone(t.key)}
                />
                <ToneDot tone={t.key} />
                {t.label}
              </label>
            ))}
          </div>
          <label>
            Название отношения
            <input
              placeholder="например: любит, ненавидит, должен денег"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
            />
          </label>
          <label>
            Подробности (лор)
            <MentionTextarea
              value={draftDescription}
              onChange={setDraftDescription}
              rows={3}
              defaultSettingId={defaultSettingId}
            />
          </label>
          <div className="row">
            <button className="primary" onClick={confirmAdd}>
              Добавить связь
            </button>
            <button onClick={() => setPending(null)}>Отмена</button>
          </div>
        </div>
      )}

      <div className="row">
        <span className="muted">Сортировка:</span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={sortMode === o.key ? "active-sort" : ""}
            onClick={() => setSortMode(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="stack">
        <strong>Отношение {entityName} к другим</strong>
        {outgoing.length === 0 && <p className="muted">Пока не указано.</p>}
        {outgoing.map((r) => renderRelation(r, "out"))}
      </div>

      <div className="stack">
        <strong>Отношение других к {entityName}</strong>
        {incoming.length === 0 && <p className="muted">Пока никто не указал отношение.</p>}
        {incoming.map((r) => renderRelation(r, "in"))}
      </div>
    </div>
  );
}
