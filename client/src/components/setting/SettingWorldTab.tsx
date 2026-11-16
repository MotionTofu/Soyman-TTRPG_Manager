import { useId, useMemo, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { useConfirm } from "../../hooks/useConfirm";
import { syncMentionLinks } from "../../mentions";
import { atlasStatusLabel, ENTRY_TYPE, ENTRY_TYPES, worldAffects, worldPath, STRICTNESS_OPTIONS, entryLine, strictnessLabel, type EntryType } from "../../settingWorld";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { AtlasEntryEditor, AtlasEntryRead, type AtlasDraft } from "./AtlasEntry";
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
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const rowId = useId();

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

  function selectKind(key: string) {
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
    selectEntry(entry);
    requestAnimationFrame(() => {
      const row = document.getElementById(rowId + entry.id);
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
      selectEntry(created);
      if (draft) {
        await run(() => syncMentionLinks("setting", settingId, "", mentionText(created)), { affects: worldAffects(settingId), retry: false });
      } else {
        setEditingId(created.id);
      }
    }
  }

  function startCreate(type: EntryType) {
    setMenu(null);
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
      items: [
        {
          label: "Править",
          onClick: () => {
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
    <button type="button" className={categories ? "d-btn d-btn--sm" : "d-btn d-btn--primary"} onClick={(e) => openAddMenu(e.currentTarget)}>
      + Запись ▾
    </button>
  );

  return (
    <div className="set-world">
      {confirmDialog}
      {categories ? (
        <div className="set-world__bar">{addButton}</div>
      ) : (
        <div className="d-head">
          <div>
            <h2>Мир</h2>
            <div className="d-head__sub">Игрокам доступны записи, отмеченные глазом.</div>
          </div>
          <div className="d-head__acts">{addButton}</div>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

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
          <label className="set-field">
            <NavIcon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по записям…" aria-label="Поиск по записям" />
          </label>
          {loading && <p className="muted" role="status">Загрузка записей…</p>}
          {error && <p className="muted" role="alert">{error}</p>}
          {groups.map(({ type, items }) => (
            <section key={type.key} aria-label={type.group}>
              <div className="set-gh">
                <h3 className="d-plate">{type.group}</h3>
                <span className="d-note">{items.length}</span>
                {type.key === "notes" && <span className="d-note set-gh__end">только для меня</span>}
              </div>
              {type.atlas && (
                <details className="set-atlas__help">
                  <summary>Что это?</summary>
                  <p>{type.atlas.help}</p>
                </details>
              )}
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
            </section>
          ))}
          {!loading && !error && groups.length === 0 && (
            <p className="muted">
              {qq ? "Ничего не найдено." : kind === "visible" ? "Пока ни одна запись не видна игрокам." : "Записей пока нет."}
            </p>
          )}
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
