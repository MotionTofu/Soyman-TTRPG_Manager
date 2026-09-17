import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useAfterWrite, useResource, write } from "../../data/hooks";
import { dataKeys } from "../../data/entities";
import { journalAffects, playerCampaignPaths } from "../../data/playerCampaign";
import { labelled } from "../../data/notices";
import { EmptyState } from "../EmptyState";
import { LoadErrorCard } from "../Loadable";
import { useConfirm, usePrompt } from "../../hooks/useConfirm";
import { useUndoDelete } from "../../hooks/useUndoDelete";
import type {
  PlayerCampaignCharacter,
  SessionScheduleEntry,
  WorldExplorationEntry,
  WorldExplorationTag,
} from "../../types";

// Дневник кампании (Кабинет игрока, 2026-09-12, шаг 4): один на кампанию, а
// не на персонажа. Персонаж внутри — метка: погибший персонаж не уносит
// половину истории в архив, записи идут подряд. Вкладки — это папки записей
// (folder_path): NULL — Лента, непустое — именная вкладка. Разделители
// «после сессии …» считаются из расписания и внутри папок сохраняются.

const TAGS: { value: WorldExplorationTag; label: string }[] = [
  { value: "", label: "Без метки" },
  { value: "being", label: "Существа" },
  { value: "location", label: "Локации" },
  { value: "item", label: "Предметы" },
  { value: "event", label: "События" },
];

const NO_CHARACTERS: PlayerCampaignCharacter[] = [];
const NO_ENTRIES: WorldExplorationEntry[] = [];

const TAG_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.value, t.label]));

// Имена, занятые постоянными вкладками дневника: папку так не назвать,
// иначе вкладка и папка склеятся в одну.
const RESERVED_FOLDERS = ["лента", "мир", "от мастера", "группа"];

function isReservedFolder(name: string): boolean {
  return RESERVED_FOLDERS.includes(name.trim().toLowerCase());
}

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

export function CampaignJournal({
  campaignId,
  schedule,
  activeFolder,
  folders,
  onFoldersKnown,
  onOpenFolder,
  writingCharacterId,
  onWritingCharacterChange,
}: {
  campaignId: number;
  schedule: SessionScheduleEntry[];
  /** NULL — Лента, строка — именная вкладка. */
  activeFolder: string | null;
  folders: string[];
  onFoldersKnown: (folders: string[]) => void;
  onOpenFolder: (folder: string | null) => void;
  /** Чьим именем пишется новое и куда падает «+ В журнал» со статей. */
  writingCharacterId: number | null;
  onWritingCharacterChange: (id: number | null) => void;
}) {
  const client = useQueryClient();
  const run = useAction();
  const charactersState = useResource<PlayerCampaignCharacter[]>(playerCampaignPaths.myCharacters(campaignId));
  const entriesPath = playerCampaignPaths.worldEntries(campaignId);
  const entriesState = useResource<WorldExplorationEntry[]>(entriesPath);
  const characters = charactersState.data ?? NO_CHARACTERS;
  const entries = entriesState.data ?? NO_ENTRIES;
  const error = charactersState.error ?? entriesState.error;
  // Отказ записи показывает плашка; здесь — только подсказка про запретное имя
  // вкладки. Раньше и то и другое шло в «Заметки не загрузились: …».
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<WorldExplorationTag | "all">("all");
  const [charFilter, setCharFilter] = useState<number | "all" | "none">("all");
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTag, setDraftTag] = useState<WorldExplorationTag>("");
  const [saving, setSaving] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();

  const reloadCharacters = charactersState.reload;
  const reloadEntries = entriesState.reload;
  const load = useCallback(() => {
    reloadCharacters();
    reloadEntries();
  }, [reloadCharacters, reloadEntries]);

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const aliveChars = useMemo(() => characters.filter((c) => !c.archived), [characters]);

  // Папки — в порядке заведения (первые записи раньше): вкладки не прыгают
  // при переименовании, в отличие от алфавита.
  useEffect(() => {
    const firstSeen = new Map<string, number>();
    for (const e of entries) {
      if (e.folder_path && !firstSeen.has(e.folder_path)) firstSeen.set(e.folder_path, e.id);
    }
    const next = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
    onFoldersKnown(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Пишущий персонаж по умолчанию — первый живой; выбор человека не
  // перебивается перезагрузкой списка.
  useEffect(() => {
    if (writingCharacterId != null && charById.has(writingCharacterId)) return;
    if (aliveChars.length > 0) onWritingCharacterChange(aliveChars[0].id);
    else onWritingCharacterChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters]);

  // Сессии для разделителей — не отменённые, свежие сверху: поиск «последней
  // не позже даты» идёт по этому же порядку первым совпадением.
  const dividerSessions = useMemo(
    () => schedule.filter((s) => s.status !== "cancelled").sort((a, b) => b.date.localeCompare(a.date)),
    [schedule]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (e.folder_path ?? null) === activeFolder)
      .filter((e) => (charFilter === "all" ? true : charFilter === "none" ? e.character_id == null : e.character_id === charFilter))
      .filter((e) => (tagFilter === "all" ? true : e.kind === tagFilter))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
  }, [entries, activeFolder, charFilter, tagFilter, query]);

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

  // Соседи для ↑↓ — по всей вкладке без фильтров, иначе кнопки двигали бы
  // через скрытые записи.
  const folderOrder = useMemo(
    () => entries.filter((e) => (e.folder_path ?? null) === activeFolder).map((e) => e.id),
    [entries, activeFolder]
  );

  const add = useCallback(async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      // Черновик очищается только после записи: при отказе текст остаётся в поле.
      const created = await run(
        labelled("Запись в дневник", () =>
          write
            .post(`/player/campaigns/${campaignId}/world-entries`, {
              character_id: writingCharacterId,
              kind: draftTag,
              name: draftTitle.trim(),
              description: text,
              folder_path: activeFolder,
            })
            .then(() => true)
        ),
        { affects: journalAffects(campaignId), retry: false }
      );
      if (created) {
        setDraft("");
        setDraftTitle("");
      }
    } finally {
      setSaving(false);
    }
  }, [draft, draftTitle, draftTag, writingCharacterId, activeFolder, campaignId, run, saving]);

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

  async function moveEntry(entryId: number, folder: string | null) {
    await run(labelled("Запись во вкладку", () => write.put(`/player/world-entries/${entryId}`, { folder_path: folder })), {
      affects: journalAffects(campaignId),
    });
  }

  async function moveToNewFolder(entryId: number) {
    const name = await prompt({ title: "Новая вкладка", message: "Название вкладки", confirmLabel: "Создать" });
    if (name == null) return;
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    if (isReservedFolder(trimmed)) {
      setHint(`«${trimmed}» — постоянная вкладка дневника, так назвать нельзя.`);
      return;
    }
    setHint(null);
    await moveEntry(entryId, trimmed);
    onOpenFolder(trimmed);
  }

  // Порядок правится по всей вкладке, а не по отфильтрованному виду: иначе
  // скрытые фильтром записи получили бы чужие позиции.
  const filtersActive = query.trim() !== "" || tagFilter !== "all" || charFilter !== "all";

  async function moveEntryBy(entryId: number, dir: -1 | 1) {
    const ids = entries.filter((e) => (e.folder_path ?? null) === activeFolder).map((e) => e.id);
    const from = ids.indexOf(entryId);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    const key = dataKeys.resource(entriesPath);
    const previous = client.getQueryData<WorldExplorationEntry[]>(key);
    if (previous) {
      const order = new Map(next.map((id, i) => [id, i]));
      client.setQueryData(
        key,
        [...previous].sort((a, b) => {
          const ao = order.get(a.id);
          const bo = order.get(b.id);
          if (ao !== undefined && bo !== undefined) return ao - bo;
          if (ao !== undefined) return -1;
          if (bo !== undefined) return 1;
          return 0;
        })
      );
    }
    const moved = await run(labelled("Порядок записей", () => write.put("/player/world-entries/reorder", { ids: next })), {
      affects: journalAffects(campaignId),
    });
    if (moved === undefined && previous) client.setQueryData(key, previous);
  }

  async function renameFolder() {
    if (activeFolder == null) return;
    const name = await prompt({ title: "Переименовать вкладку", message: "Новое название", defaultValue: activeFolder, confirmLabel: "Переименовать" });
    if (name == null) return;
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || trimmed === activeFolder) return;
    if (isReservedFolder(trimmed)) {
      setHint(`«${trimmed}» — постоянная вкладка дневника, так назвать нельзя.`);
      return;
    }
    setHint(null);
    if (folders.includes(trimmed)) {
      const ok = await confirm({ title: "Слить вкладки?", message: `Записи переедут во вкладку «${trimmed}».`, confirmLabel: "Слить", danger: false });
      if (!ok) return;
    }
    const inFolder = entries.filter((e) => e.folder_path === activeFolder);
    const done = await run(
      labelled("Переименование вкладки", async () => {
        for (const e of inFolder) await write.put(`/player/world-entries/${e.id}`, { folder_path: trimmed });
        return true;
      }),
      { affects: journalAffects(campaignId) }
    );
    if (done) onOpenFolder(trimmed);
  }

  async function deleteFolder() {
    if (activeFolder == null) return;
    const count = entries.filter((e) => e.folder_path === activeFolder).length;
    const ok = await confirm({
      title: "Убрать вкладку?",
      message: count > 0 ? `Записей во вкладке: ${count}. Они вернутся в Ленту, ничего не удалится.` : "Вкладка пуста и просто исчезнет.",
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    const inFolder = entries.filter((e) => e.folder_path === activeFolder);
    const done = await run(
      labelled("Вкладка дневника", async () => {
        for (const e of inFolder) await write.put(`/player/world-entries/${e.id}`, { folder_path: null });
        return true;
      }),
      { affects: journalAffects(campaignId) }
    );
    if (done) onOpenFolder(null);
  }

  const writingChar = writingCharacterId != null ? charById.get(writingCharacterId) ?? null : null;
  const writingArchived = writingChar?.archived ?? false;

  return (
    <div className="stack">
      {error && (
        <LoadErrorCard
          message={<>Заметки не загрузились: {error}</>}
          onRetry={load}
        />
      )}
      {hint && <p className="muted" style={{ margin: 0, color: "var(--status-cancelled)" }}>{hint}</p>}

      {activeFolder != null && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Вкладка «{activeFolder}» · {visible.length}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => void renameFolder()} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px" }}>Переименовать</button>
          <button className="danger" onClick={() => void deleteFolder()} style={{ fontSize: "var(--fs-meta)", padding: "2px 8px" }}>Убрать вкладку</button>
        </div>
      )}

      {!writingArchived && (
        <div className="card stack" style={{ gap: 8 }}>
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={writingChar ? `Что узнал ${writingChar.character_name}?` : "Что случилось?"}
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
            <select
              value={writingCharacterId ?? ""}
              onChange={(e) => onWritingCharacterChange(e.target.value === "" ? null : Number(e.target.value))}
              aria-label="Чей это дневник"
              title="Чья это запись"
            >
              {aliveChars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.character_name}
                </option>
              ))}
              <option value="">Без персонажа</option>
            </select>
            <button className="primary" onClick={() => void add()} disabled={saving || !draft.trim()}>
              {saving ? "Записываю…" : "Записать"}
            </button>
          </div>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            Мастер видит заметки на чтение — по ним он понимает, как вы трактуете сюжет.
          </span>
        </div>
      )}

      {writingArchived && (
        <p className="muted" style={{ margin: 0 }}>
          «{writingChar?.character_name}» выбыл — новые записи ему не пишутся, старые открыты на чтение.
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
          <select
            value={charFilter === "all" ? "all" : charFilter === "none" ? "none" : String(charFilter)}
            onChange={(e) => setCharFilter(e.target.value === "all" ? "all" : e.target.value === "none" ? "none" : Number(e.target.value))}
            aria-label="Фильтр по персонажу"
          >
            <option value="all">Все персонажи</option>
            {characters.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.character_name}{c.archived ? " · выбыл" : ""}
              </option>
            ))}
            <option value="none">Без персонажа</option>
          </select>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
            {visible.length}
          </span>
        </div>
      )}

      {visible.length === 0 && (
        <EmptyState
          title={activeFolder == null ? "Дневник ещё не начат" : `Во вкладке «${activeFolder}» пусто`}
          hint={
            query.trim() || tagFilter !== "all" || charFilter !== "all"
              ? "По этому запросу записей нет — снимите фильтр."
              : activeFolder == null
                ? "Здесь только то, что знает ваша партия. Первая запись — в поле выше."
                : "Переместите сюда записи кнопкой «Во вкладку» на записи в Ленте."
          }
        />
      )}

      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 8 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
            {g.label}
          </span>
          {g.items.map((entry) => {
            const pos = folderOrder.indexOf(entry.id);
            const canReorder = !filtersActive && pos !== -1;
            return (
              <JournalNote
                key={entry.id}
                entry={entry}
                character={entry.character_id != null ? charById.get(entry.character_id) ?? null : null}
                folders={folders}
                activeFolder={activeFolder}
                onMove={(folder) => moveEntry(entry.id, folder)}
                onMoveNew={() => moveToNewFolder(entry.id)}
                onMoveUp={canReorder && pos > 0 ? () => moveEntryBy(entry.id, -1) : undefined}
                onMoveDown={canReorder && pos < folderOrder.length - 1 ? () => moveEntryBy(entry.id, 1) : undefined}
                characters={characters}
                campaignId={campaignId}
                confirm={confirm}
                deleteWithUndo={deleteWithUndo}
              />
            );
          })}
        </div>
      ))}

      {confirmDialog}
      {promptDialog}
    </div>
  );
}

function JournalNote({
  entry,
  character,
  folders,
  activeFolder,
  onMove,
  onMoveNew,
  onMoveUp,
  onMoveDown,
  characters,
  campaignId,
  confirm,
  deleteWithUndo,
}: {
  entry: WorldExplorationEntry;
  character: PlayerCampaignCharacter | null;
  folders: string[];
  activeFolder: string | null;
  onMove: (folder: string | null) => void;
  onMoveNew: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  characters: PlayerCampaignCharacter[];
  campaignId: number;
  confirm: ReturnType<typeof useConfirm>[1];
  deleteWithUndo: ReturnType<typeof useUndoDelete>["deleteWithUndo"];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.description);
  const [title, setTitle] = useState(entry.name);
  const [tag, setTag] = useState<WorldExplorationTag>(entry.kind);
  const [charId, setCharId] = useState<number | null>(entry.character_id);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Ошибку правки заметка показывает сама, рядом с текстом, — не плашкой.
  const afterWrite = useAfterWrite();
  // Заметка выбывшего персонажа — чтение: его знание после смерти не растёт.
  const readOnly = character?.archived ?? false;

  useEffect(() => {
    if (editing) return;
    setText(entry.description);
    setTitle(entry.name);
    setTag(entry.kind);
    setCharId(entry.character_id);
  }, [entry.description, entry.name, entry.kind, entry.character_id, editing]);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      await write.put(`/player/world-entries/${entry.id}`, {
        name: title.trim(),
        description: text.trim(),
        kind: tag,
        character_id: charId,
      });
      setEditing(false);
      afterWrite(journalAffects(campaignId));
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
          await write.del(`/player/world-entries/${entry.id}`);
          afterWrite(journalAffects(campaignId));
        },
        restoreFn: async () => {
          await write.post(`/player/world-entries/${entry.id}/restore`);
          afterWrite(journalAffects(campaignId));
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
          {character ? (
            <span className="badge tag" title="Чья это запись">
              {character.character_name}{character.archived ? " · выбыл" : ""}
            </span>
          ) : (
            <span className="badge tag" title="Запись без персонажа">Без персонажа</span>
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
                {onMoveUp && (
                  <button onClick={onMoveUp} disabled={busy} title="Выше" aria-label="Переместить выше" style={{ padding: "6px 8px" }}>↑</button>
                )}
                {onMoveDown && (
                  <button onClick={onMoveDown} disabled={busy} title="Ниже" aria-label="Переместить ниже" style={{ padding: "6px 8px" }}>↓</button>
                )}
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
            <select
              value={charId ?? ""}
              onChange={(e) => setCharId(e.target.value === "" ? null : Number(e.target.value))}
              aria-label="Чья это запись"
              disabled={busy}
            >
              {characters
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.character_name}
                  </option>
                ))}
              <option value="">Без персонажа</option>
            </select>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{entry.description}</p>
      )}

      {!readOnly && !editing && (
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <label className="muted" style={{ fontSize: "var(--fs-meta)" }} htmlFor={`folder-${entry.id}`}>
            Во вкладку:
          </label>
          <select
            id={`folder-${entry.id}`}
            value={entry.folder_path ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__new__") void onMoveNew();
              else onMove(v === "" ? null : v);
            }}
            disabled={busy}
            style={{ fontSize: "var(--fs-meta)", maxWidth: 220 }}
          >
            <option value="">Лента</option>
            {folders.filter((f) => f !== activeFolder).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            {activeFolder != null && <option value={activeFolder}>{activeFolder} (здесь)</option>}
            <option value="__new__">Новая вкладка…</option>
          </select>
        </div>
      )}

      {saveError && <span style={{ color: "var(--status-cancelled)" }}>Не сохранилось: {saveError}</span>}
    </div>
  );
}
