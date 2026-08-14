import { useEffect, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { NavIcon } from "./NavIcons";
import { RelationLabelInput } from "./RelationLabelInput";
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

// Reusable "Отношения" tab for Beings/Characters/Communities: directional,
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
  // Адресатов может быть сразу несколько: тон и название у них общие, а лор —
  // свой у каждой связи, поэтому он спрашивается только когда адресат один.
  const [targets, setTargets] = useState<SearchResult[]>([]);
  const [direction, setDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [mirror, setMirror] = useState(false);
  const [draftTone, setDraftTone] = useState<RelationTone>("neutral");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [settingOptions, setSettingOptions] = useState<SearchResult[] | null>(null);
  const [listQuery, setListQuery] = useState("");
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

  // Список сущностей сеттинга для выбора галочками — грузится только когда
  // список раскрыли: на профиле он нужен не каждый раз.
  useEffect(() => {
    if (!listOpen || settingOptions || !defaultSettingId) return;
    Promise.all([
      api.get<{ id: number; name: string; category: string }[]>(
        `/setting-beings?setting_id=${defaultSettingId}`
      ),
      api.get<{ id: number; name: string }[]>(`/setting-communities?setting_id=${defaultSettingId}`),
    ]).then(([beings, communities]) =>
      setSettingOptions([
        ...beings.map((b) => ({ type: "being", id: b.id, title: b.name } as SearchResult)),
        ...communities.map((c) => ({ type: "community", id: c.id, title: c.name } as SearchResult)),
      ])
    );
  }, [listOpen, settingOptions, defaultSettingId]);

  function isSelf(result: SearchResult) {
    return result.type === entityType && result.id === entityId;
  }

  function toggleTarget(result: SearchResult) {
    if (isSelf(result)) return;
    setResultNote("");
    setTargets((prev) =>
      prev.some((t) => t.type === result.type && t.id === result.id)
        ? prev.filter((t) => !(t.type === result.type && t.id === result.id))
        : [...prev, result]
    );
  }

  function pickResult(found: SearchResult) {
    toggleTarget(found);
    setQuery("");
    setSearchResults([]);
  }

  function resetDraft() {
    setTargets([]);
    setDraftTone("neutral");
    setDraftLabel("");
    setDraftDescription("");
    setMirror(false);
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
    if (targets.length === 0) return;
    const created = await api.post<{ created: number; skipped: number }>("/entity-relations/batch", {
      entity_type: entityType,
      entity_id: entityId,
      targets: targets.map((t) => ({ type: t.type, id: t.id })),
      direction,
      tone: draftTone,
      label: draftLabel,
      // Лор уходит только когда связь одна: копировать один текст в десять
      // связей хуже, чем оставить их пустыми и дописать где нужно.
      description: targets.length === 1 ? draftDescription : "",
      mirror,
    });
    setResultNote(
      created.skipped > 0
        ? `Создано связей: ${created.created}. Пропущено как уже существующие: ${created.skipped}.`
        : `Создано связей: ${created.created}.`
    );
    resetDraft();
    load();
  }

  // Зеркало уже существующей связи: та же пара в обратную сторону, тот же тон
  // и название, лор пустой — он у каждой стороны свой.
  async function mirrorRelation(r: EntityRelation, side: "out" | "in") {
    const self = { type: entityType, id: entityId };
    const other = { type: r.other_type, id: r.other_id };
    const author = side === "out" ? other : self;
    const recipient = side === "out" ? self : other;
    await api.post("/entity-relations", {
      from_type: author.type,
      from_id: author.id,
      to_type: recipient.type,
      to_id: recipient.id,
      tone: r.tone,
      label: r.label,
    });
    load();
  }

  // Обратная связь уже есть? Сверяем по паре и названию: «друзья» в обе
  // стороны — одно и то же, а «покровитель» и «должник» — разные вещи, и
  // предлагать зеркало для второй по-прежнему уместно.
  function hasReverse(r: EntityRelation, side: "out" | "in"): boolean {
    const list = side === "out" ? data?.incoming : data?.outgoing;
    return !!list?.some(
      (x) => x.other_type === r.other_type && x.other_id === r.other_id && x.label === r.label
    );
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

  function renderRelation(r: EntityRelation, side: "out" | "in") {
    // Сущности на том конце может уже не быть: связи полиморфные, каскад по
    // ним не проходит, и до ближайшей уборки сирот такая строка живёт. Раньше
    // она выглядела как «? ⟶ Имя» — теперь честно названа, а ссылка на
    // несуществующую страницу не предлагается.
    const otherName = r.other_name ?? "удалённая сущность";
    const otherRoute = r.other_name ? DETAIL_ROUTES[r.other_type] : undefined;
    // Always read as "author ⟶ recipient", regardless of whether this
    // entity is the author (outgoing) or the recipient (incoming) — a plain
    // arrow-then-name-then-name reads ambiguously once the arrow flips.
    const fromLabel = side === "out" ? entityName : otherName;
    const toLabel = side === "out" ? otherName : entityName;
    return (
      <details key={r.id} className="card">
        <summary className="chevron-summary">
          <NavIcon name="chevron" className="chevron-icon" />
          <ToneDot tone={r.tone} />
          {fromLabel} ⟶ {toLabel} {r.label && <span className="muted">— {r.label}</span>}
          <button
            className="danger"
            style={{ float: "right" }}
            title="Удалить"
            onClick={(e) => {
              e.preventDefault();
              removeRelation(r.id);
            }}
          >
            <NavIcon name="delete" />
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
              <label className="stack editable-card-field">
                <span>Название отношения</span>
                <RelationLabelInput value={editLabel} onChange={setEditLabel} />
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
              {otherRoute ? (
                <Link to={`${otherRoute}/${r.other_id}`}>Открыть {r.other_name} →</Link>
              ) : (
                !r.other_name && (
                  <span className="muted">Сущность удалена — связь можно только убрать.</span>
                )
              )}
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={r.description} />
              </div>
              <div className="row">
                <button onClick={() => startEdit(r)}>Изменить</button>
                {!hasReverse(r, side) && (
                  <button
                    onClick={() => mirrorRelation(r, side)}
                    title="Завести такую же связь в обратную сторону — отдельной записью, её можно будет править отдельно"
                  >
                    Зеркалить
                  </button>
                )}
              </div>
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
          Или перетащите сюда существо, персонажа или фракцию из поиска — они добавятся к выбранным
        </span>
      </div>

      {defaultSettingId && (
        <details className="card" open={listOpen} onToggle={(e) => setListOpen(e.currentTarget.open)}>
          <summary>Выбрать из сеттинга списком</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {settingOptions === null ? (
              <span className="muted">Загрузка…</span>
            ) : (
              <>
                <input
                  placeholder="Поиск по списку…"
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                />
                <div className="relation-pick-list">
                  {settingOptions
                    .filter((o) => !isSelf(o))
                    .filter((o) =>
                      listQuery.trim()
                        ? o.title.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase())
                        : true
                    )
                    .map((o) => (
                      <label key={`${o.type}:${o.id}`} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={targets.some((t) => t.type === o.type && t.id === o.id)}
                          onChange={() => toggleTarget(o)}
                        />
                        <span className={`entity-type-chip ${o.type}`}>
                          {ENTITY_TYPE_SINGULAR[o.type] ?? o.type}
                        </span>
                        {o.title}
                      </label>
                    ))}
                </div>
              </>
            )}
          </div>
        </details>
      )}

      {targets.length > 0 && (
        <div className="card stack">
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {targets.map((t) => (
              <span key={`${t.type}:${t.id}`} className="relation-target-chip">
                {t.title}
                <button title="Убрать" onClick={() => toggleTarget(t)}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <label className="stack editable-card-field">
            <span>Кто кому</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "outgoing" | "incoming")}
            >
              <option value="outgoing">
                {entityName} ⟶ выбранные (отношение {entityName} к ним)
              </option>
              <option value="incoming">
                выбранные ⟶ {entityName} (их отношение к {entityName})
              </option>
            </select>
          </label>
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
          <label className="stack editable-card-field">
            <span>Название отношения</span>
            <RelationLabelInput value={draftLabel} onChange={setDraftLabel} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            И в обратную сторону — такая же связь навстречу
          </label>
          {targets.length === 1 ? (
            <label>
              Подробности (лор)
              <MentionTextarea
                value={draftDescription}
                onChange={setDraftDescription}
                rows={3}
                defaultSettingId={defaultSettingId}
              />
            </label>
          ) : (
            <span className="muted">
              Подробности у каждой связи свои — впишутся потом, в самих связях.
            </span>
          )}
          <div className="row">
            <button className="primary" onClick={confirmAdd}>
              {targets.length > 1 ? `Добавить связи (${targets.length})` : "Добавить связь"}
            </button>
            <button onClick={resetDraft}>Отмена</button>
          </div>
        </div>
      )}

      {resultNote && <p className="muted">{resultNote}</p>}

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
