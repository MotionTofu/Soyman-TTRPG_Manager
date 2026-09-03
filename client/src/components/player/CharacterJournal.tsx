import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { EmptyState } from "../EmptyState";
import { useConfirm } from "../../hooks/useConfirm";
import { useUndoDelete } from "../../hooks/useUndoDelete";
import type {
  PlayerCampaignCharacter,
  SessionScheduleEntry,
  WorldExplorationEntry,
  WorldExplorationTag,
} from "../../types";

// «Путевые заметки» — личный дневник персонажа: то, что знает ОН, а не
// партия (разбор —
// SideWorks/Профиль_Кампании_Игрок.md, 2026-09-02). Прежняя вкладка была
// картотекой мира на четыре типа с обязательным именем и алфавитной
// сортировкой; вспомнить по ней «что было в прошлый раз» было нельзя. Теперь
// это лента: обязателен только текст, заголовок и метка — по желанию, а
// разделители «после сессии …» приложение считает само из расписания
// кампании, чтобы игрок ничего не датировал руками.

const TAGS: { value: WorldExplorationTag; label: string }[] = [
  { value: "", label: "Без метки" },
  { value: "being", label: "Существа" },
  { value: "location", label: "Локации" },
  { value: "item", label: "Предметы" },
  { value: "event", label: "События" },
];

const TAG_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.value, t.label]));

function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

// Ключ «после какой сессии» для заметки: последняя не отменённая сессия, чья
// дата не позже даты заметки. Заметки, написанные до первой сессии, собираются
// в свою группу — иначе они висели бы без заголовка.
function sessionDividerFor(
  createdAt: string,
  sessions: SessionScheduleEntry[]
): { key: string; label: string } {
  const day = createdAt.slice(0, 10);
  const hit = sessions.find((s) => s.date <= day);
  if (!hit) return { key: "before", label: "До первой сессии" };
  return {
    key: `session-${hit.id}`,
    label: hit.title ? `После сессии ${formatIsoDate(hit.date)} — ${hit.title}` : `После сессии ${formatIsoDate(hit.date)}`,
  };
}

export function CharacterJournal({
  campaignId,
  schedule,
  refreshKey,
  onActiveCharacterChange,
}: {
  campaignId: number;
  schedule: SessionScheduleEntry[];
  refreshKey: number;
  /** Наружу — чтобы «+ В журнал» со страницы писал в тот же дневник. */
  onActiveCharacterChange: (id: number | null) => void;
}) {
  const [characters, setCharacters] = useState<PlayerCampaignCharacter[]>([]);
  const [entries, setEntries] = useState<WorldExplorationEntry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeTouched, setActiveTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<WorldExplorationTag | "all">("all");
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTag, setDraftTag] = useState<WorldExplorationTag>("");
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const { deleteWithUndo } = useUndoDelete();
  const acRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setError(null);
    try {
      const [chars, rows] = await Promise.all([
        api.get<PlayerCampaignCharacter[]>(`/player/campaigns/${campaignId}/my-characters`, {
          signal: ac.signal,
        } as RequestInit),
        api.get<WorldExplorationEntry[]>(`/player/campaigns/${campaignId}/world-entries`, {
          signal: ac.signal,
        } as RequestInit),
      ]);
      setCharacters(chars);
      setEntries(rows);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    return () => acRef.current?.abort();
  }, [load, refreshKey]);

  // Дневник по умолчанию — первого живого персонажа; если живых нет, но есть
  // ничьи записи, открывается их группа. Выбор человека не перебивается
  // перезагрузкой списка (activeTouched).
  useEffect(() => {
    if (activeTouched) return;
    const alive = characters.find((c) => !c.archived);
    if (alive) setActiveId(alive.id);
    else if (characters.length > 0) setActiveId(characters[0].id);
    else setActiveId(null);
  }, [characters, activeTouched]);

  useEffect(() => {
    onActiveCharacterChange(activeId);
  }, [activeId, onActiveCharacterChange]);

  const unassigned = useMemo(() => entries.filter((e) => e.character_id == null), [entries]);
  const activeCharacter = characters.find((c) => c.id === activeId) ?? null;
  const readOnly = activeCharacter?.archived ?? false;

  // Сессии для разделителей — не отменённые, свежие сверху: поиск «последней
  // не позже даты» идёт по этому же порядку первым совпадением.
  const dividerSessions = useMemo(
    () => schedule.filter((s) => s.status !== "cancelled").sort((a, b) => b.date.localeCompare(a.date)),
    [schedule]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (activeId == null ? e.character_id == null : e.character_id === activeId))
      .filter((e) => (tagFilter === "all" ? true : e.kind === tagFilter))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
  }, [entries, activeId, tagFilter, query]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: WorldExplorationEntry[] }[] = [];
    for (const e of visible) {
      const d = sessionDividerFor(e.created_at, dividerSessions);
      const last = out[out.length - 1];
      if (last && last.key === d.key) last.items.push(e);
      else out.push({ key: d.key, label: d.label, items: [e] });
    }
    return out;
  }, [visible, dividerSessions]);

  const add = useCallback(async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await api.post(`/player/campaigns/${campaignId}/world-entries`, {
        character_id: activeId,
        kind: draftTag,
        name: draftTitle.trim(),
        description: text,
      });
      setDraft("");
      setDraftTitle("");
      await load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }, [draft, draftTitle, draftTag, activeId, campaignId, load, saving]);

  // Черновик заметки — единственное, что здесь можно потерять безвозвратно.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draft.trim()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft]);

  const switcherNeeded = characters.length > 1 || unassigned.length > 0;

  return (
    <div className="stack">
      {error && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Заметки не загрузились: {error}</span>
          <button className="primary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {switcherNeeded && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="Чьи заметки">
          {characters.map((c) => (
            <button
              key={c.id}
              className={activeId === c.id ? "primary" : ""}
              aria-pressed={activeId === c.id}
              onClick={() => {
                setActiveTouched(true);
                setActiveId(c.id);
              }}
            >
              {c.character_name}
              {c.archived && <span className="muted"> · выбыл</span>}
            </button>
          ))}
          {unassigned.length > 0 && (
            <button
              className={activeId == null ? "primary" : ""}
              aria-pressed={activeId == null}
              onClick={() => {
                setActiveTouched(true);
                setActiveId(null);
              }}
            >
              Без персонажа
              <span className="muted" style={{ fontFamily: "var(--font-mono)" }}> {unassigned.length}</span>
            </button>
          )}
        </div>
      )}

      {activeId == null && unassigned.length > 0 && characters.some((c) => !c.archived) && (
        <div className="card stack" style={{ gap: 8 }}>
          <span>Эти заметки написаны до того, как выбрали персонажа. Чей это дневник?</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {characters
              .filter((c) => !c.archived)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={async () => {
                    for (const e of unassigned) {
                      await api.put(`/player/world-entries/${e.id}`, { character_id: c.id });
                    }
                    setActiveTouched(true);
                    setActiveId(c.id);
                    await load();
                  }}
                >
                  Отдать «{c.character_name}»
                </button>
              ))}
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="card stack" style={{ gap: 8 }}>
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={activeCharacter ? `Что узнал ${activeCharacter.character_name}?` : "Что случилось?"}
            maxLength={5000}
            aria-label="Текст заметки"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Заголовок — если нужен"
              maxLength={80}
              aria-label="Заголовок заметки"
              style={{ flex: "1 1 200px", minWidth: 160 }}
            />
            <select value={draftTag} onChange={(e) => setDraftTag(e.target.value as WorldExplorationTag)} aria-label="Метка">
              {TAGS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => void add()} disabled={saving || !draft.trim()}>
              {saving ? "Записываю…" : "Записать"}
            </button>
          </div>
        </div>
      )}

      {readOnly && (
        <p className="muted" style={{ margin: 0 }}>
          «{activeCharacter?.character_name}» выбыл — его заметки открыты только для чтения.
        </p>
      )}

      {entries.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="res-toolbar__search"
            placeholder="Поиск по заметкам…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск по заметкам"
            style={{ flex: "1 1 200px", minWidth: 160 }}
          />
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value as WorldExplorationTag | "all")}
            aria-label="Фильтр по метке"
          >
            <option value="all">Все метки</option>
            {TAGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
            {visible.length}
          </span>
        </div>
      )}

      {visible.length === 0 && (
        <EmptyState
          icon="skullDie"
          title="ЗАМЕТОК ПОКА НЕТ"
          hint={
            query.trim() || tagFilter !== "all"
              ? "По этому запросу записей нет — снимите фильтр."
              : "Здесь только то, что знает ваш персонаж. Первая запись — в поле выше."
          }
        />
      )}

      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 8 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
            {g.label}
          </span>
          {g.items.map((entry) => (
            <JournalNote
              key={entry.id}
              entry={entry}
              readOnly={readOnly}
              onChanged={load}
              confirm={confirm}
              deleteWithUndo={deleteWithUndo}
            />
          ))}
        </div>
      ))}

      {confirmDialog}
    </div>
  );
}

function JournalNote({
  entry,
  readOnly,
  onChanged,
  confirm,
  deleteWithUndo,
}: {
  entry: WorldExplorationEntry;
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
  confirm: ReturnType<typeof useConfirm>[1];
  deleteWithUndo: ReturnType<typeof useUndoDelete>["deleteWithUndo"];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.description);
  const [title, setTitle] = useState(entry.name);
  const [tag, setTag] = useState<WorldExplorationTag>(entry.kind);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setText(entry.description);
    setTitle(entry.name);
    setTag(entry.kind);
  }, [entry.description, entry.name, entry.kind, editing]);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.put(`/player/world-entries/${entry.id}`, {
        name: title.trim(),
        description: text.trim(),
        kind: tag,
      });
      setEditing(false);
      await onChanged();
    } catch (e) {
      // Молчаливое падение сохранения — худшее, что может случиться с
      // дневником: человек уверен, что записал.
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Удалить запись?",
      message: title.trim() ? `Удалить «${title.trim()}»?` : "Удалить эту заметку?",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteWithUndo({
        entityName: title.trim() || text.trim().slice(0, 40) || "Заметка",
        deleteFn: async () => {
          await api.del(`/player/world-entries/${entry.id}`);
          await onChanged();
        },
        restoreFn: async () => {
          await api.post(`/player/world-entries/${entry.id}/restore`);
          await onChanged();
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap", minWidth: 0 }}>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
            {formatIsoDate(entry.created_at)}
          </span>
          {entry.kind && (
            <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {TAG_LABEL[entry.kind]}
            </span>
          )}
          {!editing && entry.name && <strong>{entry.name}</strong>}
        </div>
        {!readOnly && (
          <div className="row" style={{ flexShrink: 0, gap: 4 }}>
            {editing ? (
              <>
                <button className="primary" onClick={() => void save()} disabled={busy || !text.trim()}>
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
                <button onClick={() => setEditing(false)} disabled={busy}>
                  Отмена
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} disabled={busy}>
                  Править
                </button>
                <button className="danger" onClick={() => void remove()} disabled={busy}>
                  Удалить
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} aria-label="Текст заметки" disabled={busy} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок — если нужен"
              maxLength={80}
              aria-label="Заголовок заметки"
              style={{ flex: "1 1 200px", minWidth: 160 }}
              disabled={busy}
            />
            <select value={tag} onChange={(e) => setTag(e.target.value as WorldExplorationTag)} aria-label="Метка" disabled={busy}>
              {TAGS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{entry.description}</p>
      )}

      {saveError && <span style={{ color: "var(--status-cancelled)" }}>Не сохранилось: {saveError}</span>}
    </div>
  );
}
