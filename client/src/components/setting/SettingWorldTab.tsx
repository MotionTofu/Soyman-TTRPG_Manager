import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { useConfirm } from "../../hooks/useConfirm";
import { syncMentionLinks } from "../../mentions";
import { atlasStatusLabel, ENTRY_TYPE, ENTRY_TYPES, worldAffects, worldPath, STRICTNESS_OPTIONS, entryLine, strictnessLabel, type EntryType } from "../../settingWorld";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { AtlasEntryEditor, AtlasEntryRead, type AtlasDraft, type AtlasListSection, type AtlasSection } from "./AtlasEntry";
import { SettingWorldReading, WorldEntryGroup } from "./SettingWorldReading";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import type { SettingEntry } from "../../types";

// Вкладка «Мир» в «Д» (макет Set-World, блок «Сеттинги» 2026-10-30): слева
// колонка видов со счётчиками (как «Мир» кампании), справа записи группами;
// запись раскрывается прямо в списке — вариант с карточкой справа владелец
// отверг. «Задумки» — бывший раздел «Заметки»: только для Мастера, «в мир ›»
// превращает задумку в запись нужного вида.

const NO_ENTRIES: SettingEntry[] = [];
type Patch = Partial<Pick<SettingEntry, "title" | "content" | "fields" | "category" | "related_entry_ids">> & { visible_to_players?: boolean };
type ViewMode = "list" | "read";
type ReadingSettings = Record<AtlasSection, { all: boolean; overrides: ReadonlyMap<number, boolean> }>;
const READING_SWITCHES = [
  { section: "context", label: "Контексты" },
  { section: "details", label: "Подробности" },
] as const;

function mentionText(e: Pick<SettingEntry, "content" | "fields">): string {
  return [e.content, ...Object.values(e.fields ?? {})].join("\n");
}

export function SettingWorldTab({ settingId, categories }: { settingId: number; categories?: readonly string[] }) {
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const { data, loading, error } = useResource<SettingEntry[]>(worldPath(settingId));
  const allEntries = data ?? NO_ENTRIES;
  const entries = useMemo(() => (categories ? allEntries.filter((e) => categories.includes(e.category)) : allEntries), [allEntries, categories]);
  const types = ENTRY_TYPES.filter((t) => !categories || categories.includes(t.key));
  // Колонка: вид записи, «видно игрокам» или все.
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[]; footer?: string } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("list");
  const [listSections, setListSections] = useState<Partial<Record<number, ReadonlySet<AtlasListSection>>>>({});
  const [reading, setReading] = useState<ReadingSettings>(() => ({
    context: { all: false, overrides: new Map() },
    details: { all: false, overrides: new Map() },
  }));
  const [readingEditor, setReadingEditor] = useState<{ type: EntryType; entry?: SettingEntry } | null>(null);
  const readingMode = !categories && mode === "read";
  const rowId = useId();
  const regionId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<ViewMode, number>>({ list: 0, read: 0 });
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLElement>(null);

  const qq = q.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      // «Все» и «Видно игрокам» — без задумок: они только в своём пункте.
      (kind === "all" ? categories || e.category !== "notes" : kind === "visible" ? !!e.visible_to_players && e.category !== "notes" : e.category === kind) &&
      (!qq || e.title.toLowerCase().includes(qq) || mentionText(e).toLowerCase().includes(qq))
  );
  const groups = types.map((type) => ({ type, items: shown.filter((e) => e.category === type.key) })).filter(
    ({ type, items }) => items.length > 0 || creating === type.key ||
      (!qq && (kind === type.key || (kind === "all" && !loading && !error && entries.length === 0 && type.atlas))),
  );
  const count = (key: string) => entries.filter((e) => e.category === key).length;
  const emptyText = qq ? "Ничего не найдено." : kind === "visible" ? "Пока ни одна запись не видна игрокам." : "Записей пока нет.";
  const readingEntry = readingEditor?.entry;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current[mode];
  }, [mode]);

  function changeMode(next: ViewMode) {
    if (next === mode) return;
    scrollPositions.current[mode] = scrollRef.current?.scrollTop ?? 0;
    setMenu(null);
    setMode(next);
  }

  function sectionOpen(id: number, section: AtlasSection) {
    const { all, overrides } = reading[section];
    return overrides.get(id) ?? all;
  }

  function toggleSection(id: number, section: AtlasSection) {
    setReading((current) => {
      const { all, overrides } = current[section];
      const next = new Map(overrides);
      if (next.has(id)) next.delete(id);
      else next.set(id, !all);
      return { ...current, [section]: { all, overrides: next } };
    });
  }

  function setAllSections(section: AtlasSection, all: boolean) {
    setReading((current) => {
      const overrides = new Map(current[section].overrides);
      for (const entry of shown) overrides.delete(entry.id);
      return { ...current, [section]: { all, overrides } };
    });
  }

  function toggleListSection(id: number, section: AtlasListSection) {
    setListSections((current) => {
      const next = new Set(current[id]);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return { ...current, [id]: next };
    });
  }

  function resetScroll() {
    scrollPositions.current = { list: 0, read: 0 };
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }

  function selectKind(key: string) {
    if (key !== kind) resetScroll();
    setCreating(null);
    setKind(key);
  }

  function selectEntry(entry: SettingEntry) {
    setCreating(null);
    setQ("");
    setKind((current) => current === "all" && entry.category !== "notes" ? current : entry.category);
    setOpenId(entry.id);
    setEditingId(null);
  }

  function jumpToEntry(entry: SettingEntry) {
    if (readingMode) {
      setQ("");
      setKind((current) => current === "all" && entry.category !== "notes" ? current : entry.category);
    } else {
      selectEntry(entry);
    }
    requestAnimationFrame(() => {
      const row = document.getElementById(rowId + (readingMode ? "read-" : "") + entry.id);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  }

  async function saveNew(type: EntryType, draft?: AtlasDraft) {
    const created = await run(
      () => write.post<SettingEntry>("/setting-entries", {
        setting_id: settingId,
        category: type.key,
        title: type.one,
        ...draft,
      }),
      { affects: worldAffects(settingId), retry: false }
    );
    if (created) {
      if (readingMode) {
        setReadingEditor(draft ? null : { type, entry: created });
      } else {
        selectEntry(created);
        if (!draft) setEditingId(created.id);
      }
      if (draft) {
        await run(() => syncMentionLinks("setting", settingId, "", mentionText(created)), { affects: worldAffects(settingId), retry: false });
      }
    }
  }

  function startCreate(type: EntryType) {
    setMenu(null);
    if (readingMode) {
      editorTrigger.current = addButtonRef.current;
      if (type.atlas) setReadingEditor({ type });
      else void saveNew(type);
      return;
    }
    if (!type.atlas) {
      void saveNew(type);
      return;
    }
    setKind(type.key);
    setQ("");
    setOpenId(null);
    setEditingId(null);
    setCreating(type.key);
  }

  async function patch(entry: SettingEntry, body: Patch) {
    return run(
      async () => {
        const saved = await write.put<SettingEntry>(`/setting-entries/${entry.id}`, body);
        if (body.content !== undefined || body.fields !== undefined) await syncMentionLinks("setting", settingId, mentionText(entry), mentionText(saved));
        return true;
      },
      { affects: worldAffects(settingId) }
    );
  }

  async function remove(entry: SettingEntry) {
    if (!(await confirm({ message: `Удалить запись «${entry.title || "без названия"}»?`, confirmLabel: "Удалить", danger: true }))) return;
    await run(
      async () => {
        await write.del(`/setting-entries/${entry.id}`);
        await syncMentionLinks("setting", settingId, mentionText(entry), "");
        return true;
      },
      { affects: worldAffects(settingId) }
    );
  }

  function openAddMenu(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.right, y: r.bottom, items: types.map((t) => ({ label: t.one, onClick: () => startCreate(t) })) });
  }

  function toWorldMenu(entry: SettingEntry, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setMenu({
      x: r.right,
      y: r.bottom,
      items: ENTRY_TYPES.filter((t) => t.key !== "notes").map((t) => ({ label: t.one, onClick: () => void patch(entry, { category: t.key }) })),
    });
  }

  function rowMenu(entry: SettingEntry, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const isNote = entry.category === "notes";
    setMenu({
      x: r.right,
      y: r.bottom,
      footer: readingMode && !isNote ? [
        atlasStatusLabel(entry.fields.status) || strictnessLabel(entry.fields.strictness),
        entry.category === "activity" && entry.fields.promised === "1" && "Обещано",
        entry.visible_to_players ? "Видно игрокам" : "Только Мастеру",
      ].filter(Boolean).join(" · ") : undefined,
      items: [
        {
          label: "Править",
          onClick: () => {
            const type = ENTRY_TYPE.get(entry.category);
            if (readingMode && type) {
              editorTrigger.current = el;
              setReadingEditor({ type, entry });
              return;
            }
            setCreating(null);
            setOpenId(entry.id);
            setEditingId(entry.id);
          },
        },
        ...(isNote
          ? ENTRY_TYPES.filter((t) => t.key !== "notes").map((t) => ({ label: `В мир › ${t.one}`, onClick: () => void patch(entry, { category: t.key }) }))
          : [{ label: entry.visible_to_players ? "Скрыть от игроков" : "Показать игрокам", onClick: () => void patch(entry, { visible_to_players: !entry.visible_to_players }) }]),
        { label: "Удалить", danger: true, onClick: () => void remove(entry) },
      ],
    });
  }

  const addButton = (
    <button ref={addButtonRef} type="button" className={categories ? "d-btn d-btn--sm" : "d-btn d-btn--primary d-btn--sm"} onClick={(e) => openAddMenu(e.currentTarget)}>
      + Запись ▾
    </button>
  );

  const searchField = (
    <label className="set-field set-world__search">
      <NavIcon name="search" />
      <input
        value={q}
        onChange={(e) => {
          resetScroll();
          setQ(e.target.value);
        }}
        placeholder="Поиск по записям…"
        aria-label="Поиск по записям"
      />
    </label>
  );

  return (
    <div className={categories ? "set-world" : "set-world set-world--full"}>
      {confirmDialog}
      {categories ? (
        <div className="set-world__bar">{addButton}</div>
      ) : (
        <div className="d-head">
          <h2>Мир</h2>
          <div className="set-world__toolbar">
            {searchField}
            {readingMode && (
              <div className="set-world__switches" role="group" aria-label="Настройки чтения">
                {READING_SWITCHES.map(({ section, label }) => (
                  <label key={section}>
                    <input type="checkbox" role="switch" aria-controls={regionId} checked={reading[section].all} onChange={(event) => setAllSections(section, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            <div className="d-head__acts">
              <div className="d-seg set-world__modes" role="group" aria-label="Режим просмотра">
                <button type="button" className={readingMode ? undefined : "active"} aria-pressed={!readingMode} onClick={() => changeMode("list")}>Список</button>
                <button type="button" className={readingMode ? "active" : undefined} aria-pressed={readingMode} onClick={() => changeMode("read")}>Чтение</button>
              </div>
              {addButton}
            </div>
          </div>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} footer={menu.footer} ariaLabel={readingMode ? "Действия с записью" : undefined} onClose={() => setMenu(null)} />}
      {readingEditor && (
        <Modal
          wide
          className="set-world-editor"
          ariaLabel={readingEntry ? "Править запись" : `Новая запись · ${readingEditor.type.one}`}
          closeOnBackdropClick={false}
          returnFocusTo={editorTrigger}
          onClose={() => setReadingEditor(null)}
        >
          {readingEditor.type.atlas ? (
            <AtlasEntryEditor
              type={{ ...readingEditor.type, atlas: readingEditor.type.atlas }}
              entry={readingEntry}
              settingId={settingId}
              peers={allEntries.filter((peer) => peer.id !== readingEntry?.id && peer.category !== "notes")}
              onSave={async (draft) => {
                if (!readingEntry) await saveNew(readingEditor.type, draft);
                else if (await patch(readingEntry, draft)) setReadingEditor(null);
              }}
              onCancel={() => setReadingEditor(null)}
            />
          ) : readingEntry && (
            <EntryOpen
              entry={readingEntry}
              settingId={settingId}
              editing
              onEdit={() => setReadingEditor(null)}
              onPatch={(body) => patch(readingEntry, body)}
              onToWorld={(el) => toWorldMenu(readingEntry, el)}
            />
          )}
        </Modal>
      )}

      <div className={categories ? undefined : "set-cols"}>
        {!categories && (
          <nav className="set-lc" aria-label="Виды записей">
            <h2 className="d-plate">Виды</h2>
            <button type="button" className={kind === "all" ? "is-on" : ""} aria-pressed={kind === "all"} onClick={() => selectKind("all")}>
              Все<span className="set-lc__n">{entries.filter((e) => e.category !== "notes").length}</span>
            </button>
            {types
              .filter((t) => t.key !== "notes")
              .map((t) => (
                <button key={t.key} type="button" className={`${kind === t.key ? "is-on" : ""}${count(t.key) ? "" : " is-pale"}`} aria-pressed={kind === t.key} onClick={() => selectKind(t.key)}>
                  {t.group}
                  <span className="set-lc__n">{count(t.key) || ""}</span>
                </button>
              ))}
            <hr />
            <button type="button" className={kind === "visible" ? "is-on" : ""} aria-pressed={kind === "visible"} onClick={() => selectKind("visible")}>
              <NavIcon name="eye" />
              Видно игрокам<span className="set-lc__n">{entries.filter((e) => e.visible_to_players && e.category !== "notes").length}</span>
            </button>
            <button type="button" className={`is-pale${kind === "notes" ? " is-on" : ""}`} aria-pressed={kind === "notes"} onClick={() => selectKind("notes")}>
              <NavIcon name="lock" />
              Задумки<span className="set-lc__n">{count("notes") || ""}</span>
            </button>
          </nav>
        )}
        <div className="set-world__main">
          {categories && searchField}
          <div className="set-world__records" ref={categories ? undefined : scrollRef}>
            {loading && <p className="muted" role="status">Загрузка записей…</p>}
            {error && <p className="muted" role="alert">{error}</p>}
            <div hidden={readingMode}>
              {groups.map(({ type, items }) => (
                <WorldEntryGroup key={type.key} type={type} count={items.length}>
                  {creating === type.key && type.atlas ? (
                    <AtlasEntryEditor
                      key={type.key}
                      type={{ ...type, atlas: type.atlas }}
                      settingId={settingId}
                      peers={allEntries.filter((entry) => entry.category !== "notes")}
                      onSave={(draft) => saveNew(type, draft)}
                      onCancel={() => setCreating(null)}
                    />
                  ) : !loading && !error && items.length === 0 && kind === type.key && (
                    <div className="set-world__empty">
                      <p className="muted">Записей пока нет.</p>
                      <button type="button" className="d-btn d-btn--sm" onClick={() => startCreate(type)}>+ {type.one}</button>
                    </div>
                  )}
                  {items.map((e) => {
                    const open = openId === e.id;
                    const status = type.atlas ? atlasStatusLabel(e.fields.status) : "";
                    return (
                      <div key={e.id} className={open ? "set-er-open" : undefined}>
                        <div className={`set-er${open ? " is-open" : ""}${type.atlas ? " set-er--atlas" : ""}`}>
                          <button
                            type="button"
                            className="set-er__main"
                            id={rowId + e.id}
                            aria-expanded={open}
                            onClick={() => {
                              setCreating(null);
                              setOpenId(open ? null : e.id);
                              setEditingId(null);
                            }}
                          >
                            <b>{e.title || "Без названия"}</b>
                            {!(open && type.atlas) && <span className="set-er__ln">{entryLine(type, e.fields, e.content)}</span>}
                          </button>
                          <span className="set-er__tags">
                            {status && <span className="set-str" data-status={e.fields.status}>{status}</span>}
                            {!status && e.category === "world_truth" && e.fields.strictness && (
                              <span className={`set-str${e.fields.strictness === "soft" ? " is-soft" : ""}`}>{strictnessLabel(e.fields.strictness)}</span>
                            )}
                            {e.category === "activity" && e.fields.promised === "1" && <span className="set-str">обещано</span>}
                          </span>
                          <VisibilityMark entry={e} onToggle={() => void patch(e, { visible_to_players: !e.visible_to_players })} />
                          <button type="button" className="set-dots" aria-label="Действия с записью" onClick={(ev) => rowMenu(e, ev.currentTarget)}>
                            ⋯
                          </button>
                        </div>
                        {open && (type.atlas ? editingId === e.id ? (
                          <AtlasEntryEditor
                            type={{ ...type, atlas: type.atlas }}
                            entry={e}
                            settingId={settingId}
                            peers={allEntries.filter((peer) => peer.id !== e.id && peer.category !== "notes")}
                            onSave={async (draft) => { if (await patch(e, draft)) setEditingId(null); }}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <AtlasEntryRead
                            type={{ ...type, atlas: type.atlas }}
                            entry={e}
                            peers={entries}
                            onJump={jumpToEntry}
                            onEdit={() => setEditingId(e.id)}
                            isOpen={categories ? undefined : (section) => listSections[e.id]?.has(section) ?? false}
                            onToggle={categories ? undefined : (section) => toggleListSection(e.id, section)}
                          />
                        ) : (
                          <EntryOpen
                            key={`${e.id}-${editingId === e.id}`}
                            entry={e}
                            settingId={settingId}
                            editing={editingId === e.id}
                            onEdit={(v) => setEditingId(v ? e.id : null)}
                            onPatch={(body) => patch(e, body)}
                            onToWorld={(el) => toWorldMenu(e, el)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </WorldEntryGroup>
              ))}
            </div>
            {readingMode && (
              <div id={regionId}>
                <SettingWorldReading
                  groups={groups}
                  peers={entries}
                  rowId={rowId + "read-"}
                  isOpen={sectionOpen}
                  onToggle={toggleSection}
                  onJump={jumpToEntry}
                  onMenu={rowMenu}
                />
              </div>
            )}
            {!loading && !error && (readingMode ? !shown.length : !groups.length) && <p className="muted">{emptyText}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function VisibilityMark({ entry, onToggle }: { entry: SettingEntry; onToggle: () => void }) {
  // У задумок знака нет: вся группа «только для меня» (Q19).
  if (entry.category === "notes") return <span />;
  const on = !!entry.visible_to_players;
  const label = on ? "Видно игрокам — скрыть" : "Скрыто от игроков — показать";
  return (
    <button type="button" className={`set-er__vis${on ? "" : " is-hidden"}`} title={label} aria-label={label} aria-pressed={on} onClick={onToggle}>
      <NavIcon name="eye" />
    </button>
  );
}

function EntryOpen({
  entry,
  settingId,
  editing,
  onEdit,
  onPatch,
  onToWorld,
}: {
  entry: SettingEntry;
  settingId: number;
  editing: boolean;
  onEdit: (v: boolean) => void;
  onPatch: (body: Patch) => Promise<boolean | undefined>;
  onToWorld: (el: HTMLElement) => void;
}) {
  const type = ENTRY_TYPE.get(entry.category);
  // Черновик берётся в момент входа в правку (key у родителя), а не на каждой
  // перечитке: иначе фоновое обновление списка стирало бы набранное.
  const [draft, setDraft] = useState({ title: entry.title, content: entry.content, fields: { ...entry.fields } });
  const isNote = entry.category === "notes";

  async function save() {
    if (await onPatch({ title: draft.title.trim() || entry.title, content: draft.content, fields: draft.fields })) onEdit(false);
  }

  const fields = type?.fields ?? [];
  const filled = fields.filter((f) => entry.fields[f.key]?.trim());
  const emptyCount = fields.length - filled.length;

  if (editing) {
    return (
      <div className="set-open">
        <div className="setting-world__form">
          <label>
            <span className="paper-label">Название</span>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          {fields.map((f) => (
            <label key={f.key}>
              <span className="paper-label">{f.label}</span>
              {f.key === "strictness" ? (
                <select value={draft.fields.strictness ?? ""} onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, strictness: e.target.value } })}>
                  <option value="">—</option>
                  {STRICTNESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <MentionTextarea value={draft.fields[f.key] ?? ""} onChange={(v) => setDraft({ ...draft, fields: { ...draft.fields, [f.key]: v } })} rows={2} defaultSettingId={settingId} />
              )}
            </label>
          ))}
          <label>
            <span className="paper-label">{isNote ? "Текст" : "Заметка"}</span>
            <MentionTextarea value={draft.content} onChange={(v) => setDraft({ ...draft, content: v })} rows={isNote ? 6 : 3} defaultSettingId={settingId} />
          </label>
          <div className="row">
            <button type="button" className="d-btn d-btn--sm" onClick={save}>
              Сохранить
            </button>
            <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => onEdit(false)}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="set-open">
      {filled.length > 0 || entry.content.trim() ? (
        <dl>
          {filled.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{f.key === "strictness" ? strictnessLabel(entry.fields.strictness) : <MentionText text={entry.fields[f.key]} />}</dd>
            </div>
          ))}
          {entry.content.trim() && (
            <div>
              <dt>{isNote ? "Текст" : "Заметка"}</dt>
              <dd>
                <MentionText text={entry.content} />
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="muted">Пусто.</p>
      )}
      <div className="set-open__ft">
        <button type="button" className="d-btn d-btn--sm" onClick={() => onEdit(true)}>
          Править
        </button>
        {isNote ? (
          <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={(e) => onToWorld(e.currentTarget)}>
            В мир ›
          </button>
        ) : (
          <button type="button" className="d-btn d-btn--sm d-btn--quiet" aria-pressed={!!entry.visible_to_players} onClick={() => void onPatch({ visible_to_players: !entry.visible_to_players })}>
            {entry.visible_to_players ? "Скрыть от игроков" : "Показать игрокам"}
          </button>
        )}
        {emptyCount > 0 && <span className="d-note">ещё {emptyCount} {emptyCount === 1 ? "поле" : emptyCount < 5 ? "поля" : "полей"} пусто</span>}
      </div>
    </div>
  );
}
