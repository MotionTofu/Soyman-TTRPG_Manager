import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { useConfirm } from "../../hooks/useConfirm";
import { syncMentionLinks } from "../../mentions";
import { ENTRY_TYPE, ENTRY_TYPES, worldAffects, worldPath, STRICTNESS_OPTIONS, entryLine, strictnessLabel, type EntryType } from "../../settingWorld";
import { ContextMenu } from "../ContextMenu";
import { EmptyState } from "../EmptyState";
import { NavIcon } from "../NavIcons";
import { MentionText } from "../mentions/MentionText";
import { MentionTextarea } from "../mentions/MentionTextarea";
import type { SettingEntry } from "../../types";

// Вкладка «Мир» (разбор профиля сеттинга, Q3/Q4/Q9/Q10/Q11/Q19; макет —
// доска 13): лёгкие записи по группам вида, пустые группы скрыты. Строка —
// название и главная строка, карточка справа — просмотр и правка на месте.
// «Задумки» — бывший раздел «Заметки»: только для Мастера, «в мир ›»
// превращает задумку в запись нужного вида.


const NO_ENTRIES: SettingEntry[] = [];

function mentionText(e: Pick<SettingEntry, "content" | "fields">): string {
  return [e.content, ...Object.values(e.fields ?? {})].join("\n");
}

export function SettingWorldTab({ settingId }: { settingId: number }) {
  const run = useAction();
  const [confirmDialog, confirm] = useConfirm();
  const entries = useResource<SettingEntry[]>(worldPath(settingId)).data ?? NO_ENTRIES;
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [selId, setSelId] = useState<number | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const shown = onlyVisible ? entries.filter((e) => e.visible_to_players) : entries;
  const groups = useMemo(
    () => ENTRY_TYPES.map((t) => ({ type: t, items: shown.filter((e) => e.category === t.key) })).filter((g) => g.items.length > 0),
    [shown]
  );
  const selected = entries.find((e) => e.id === selId) ?? null;

  // Выбор пережил удаление и перечитку: нет выбранной — первая по порядку групп.
  // Только что созданная ещё может не прийти в список — её не сбрасываем.
  const justCreated = useRef<number | null>(null);
  useEffect(() => {
    if (selected) {
      if (selected.id === justCreated.current) justCreated.current = null;
      return;
    }
    if (selId != null && selId === justCreated.current) return;
    const first = groups[0]?.items[0];
    setSelId(first ? first.id : null);
    setEditing(false);
  }, [selected, groups, selId]);

  async function create(type: EntryType) {
    setAddMenu(null);
    const created = await run(
      () =>
        write.post<SettingEntry>("/setting-entries", {
          setting_id: settingId,
          category: type.key,
          title: type.key === "notes" ? "Задумка" : type.one,
        }),
      { affects: worldAffects(settingId), retry: false }
    );
    if (created?.id) {
      justCreated.current = created.id;
      setSelId(created.id);
      setEditing(true);
    }
  }

  async function patch(entry: SettingEntry, body: Partial<Pick<SettingEntry, "title" | "content" | "fields" | "category">> & { visible_to_players?: boolean }) {
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

  return (
    <div className="setting-world">
      {confirmDialog}
      <div className="population__toolbar">
        <div className="population__seg" role="group" aria-label="Отбор записей">
          <button type="button" aria-pressed={!onlyVisible} onClick={() => setOnlyVisible(false)}>
            Все
          </button>
          <button type="button" aria-pressed={onlyVisible} onClick={() => setOnlyVisible(true)}>
            Видно игрокам
          </button>
        </div>
        <span className="population__spacer" />
        <button
          type="button"
          className="population__create"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAddMenu({ x: r.right, y: r.bottom });
          }}
        >
          + Запись
        </button>
      </div>
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} items={ENTRY_TYPES.map((t) => ({ label: t.one, onClick: () => void create(t) }))} onClose={() => setAddMenu(null)} />}

      {entries.length === 0 ? (
        <EmptyState
          title="Мир пока пуст"
          hint="Правила мира, традиции, нормы, напряжения, деятельность — короткие записи, из которых складывается мир."
          action={
            <button type="button" className="primary" onClick={() => void create(ENTRY_TYPE.get("world_truth")!)}>
              + Первое правило мира
            </button>
          }
        />
      ) : (
        <div className="population__split">
          <div className="population__list">
            {groups.map(({ type, items }) => (
              <section key={type.key} aria-label={type.group}>
                <h2 className="pop-group__head">
                  {type.group} <span className="pop-group__count">{items.length}</span>
                  {type.key === "notes" && <span className="setting-world__private">только для меня</span>}
                </h2>
                <ul className="pop-rows">
                  {items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`pop-row setting-world__row${e.id === selId ? " is-selected" : ""}`}
                        onClick={() => {
                          setSelId(e.id);
                          setEditing(false);
                        }}
                      >
                        <VisibilityMark entry={e} />
                        <span className="setting-world__title">{e.title || "Без названия"}</span>
                        <span className="pop-row__muted setting-world__line">{entryLine(type, e.fields, e.content)}</span>
                        {e.category === "world_truth" && e.fields.strictness && <span className="pop-item__chip">{strictnessLabel(e.fields.strictness)}</span>}
                        {e.category === "activity" && e.fields.promised === "1" && <span className="pop-item__chip is-dark">обещано</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="pop-more-note">Пустые группы скрыты — остальные виды в «+ Запись».</p>
          </div>
          <aside className="population__aside">
            {selected && (
              <EntryCard
                key={selected.id}
                entry={selected}
                settingId={settingId}
                editing={editing}
                onEdit={setEditing}
                onPatch={(body) => patch(selected, body)}
                onRemove={() => remove(selected)}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function VisibilityMark({ entry }: { entry: SettingEntry }) {
  // У задумок знака нет: вся группа «только для меня» (Q19).
  if (entry.category === "notes") return <span className="setting-world__vis" />;
  const on = !!entry.visible_to_players;
  return (
    <span className={`setting-world__vis${on ? "" : " is-hidden"}`} title={on ? "Видно игрокам" : "Скрыто от игроков"} aria-label={on ? "Видно игрокам" : "Скрыто от игроков"}>
      <NavIcon name="eye" />
    </span>
  );
}

function EntryCard({
  entry,
  settingId,
  editing,
  onEdit,
  onPatch,
  onRemove,
}: {
  entry: SettingEntry;
  settingId: number;
  editing: boolean;
  onEdit: (v: boolean) => void;
  onPatch: (body: Partial<Pick<SettingEntry, "title" | "content" | "fields" | "category">> & { visible_to_players?: boolean }) => Promise<boolean | undefined>;
  onRemove: () => void;
}) {
  const type = ENTRY_TYPE.get(entry.category);
  const [draft, setDraft] = useState({ title: entry.title, content: entry.content, fields: { ...entry.fields } });
  const [toWorld, setToWorld] = useState<{ x: number; y: number } | null>(null);
  const isNote = entry.category === "notes";

  // Черновик берётся в момент входа в правку, а не на каждой перечитке: иначе
  // фоновое обновление списка стирало бы набранное.
  useEffect(() => {
    if (editing) setDraft({ title: entry.title, content: entry.content, fields: { ...entry.fields } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function save() {
    if (await onPatch({ title: draft.title.trim() || entry.title, content: draft.content, fields: draft.fields })) onEdit(false);
  }

  const filled = (type?.fields ?? []).filter((f) => entry.fields[f.key]?.trim());

  return (
    <article className="card setting-world__card" aria-label={`Запись «${entry.title}»`}>
      <header className="setting-world__card-head">
        <span className="paper-label">{type?.one ?? entry.category}</span>
        {editing ? (
          <input className="setting-world__title-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Название записи" />
        ) : (
          <h3>{entry.title || "Без названия"}</h3>
        )}
        <div className="row setting-world__card-actions">
          {!isNote && (
            <label className="setting-world__toggle">
              <input type="checkbox" checked={!!entry.visible_to_players} onChange={(e) => void onPatch({ visible_to_players: e.target.checked })} />
              Видно игрокам
            </label>
          )}
          {isNote && (
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setToWorld({ x: r.right, y: r.bottom });
              }}
            >
              В мир ›
            </button>
          )}
          {!editing && (
            <button type="button" onClick={() => onEdit(true)}>
              Править
            </button>
          )}
          <button type="button" className="danger" onClick={onRemove} aria-label="Удалить запись">
            ✕
          </button>
        </div>
      </header>
      {toWorld && (
        <ContextMenu
          x={toWorld.x}
          y={toWorld.y}
          items={ENTRY_TYPES.filter((t) => t.key !== "notes").map((t) => ({ label: t.one, onClick: () => void onPatch({ category: t.key }) }))}
          onClose={() => setToWorld(null)}
        />
      )}

      {editing ? (
        <div className="setting-world__form">
          {(type?.fields ?? []).map((f) => (
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
                <MentionTextarea
                  value={draft.fields[f.key] ?? ""}
                  onChange={(v) => setDraft({ ...draft, fields: { ...draft.fields, [f.key]: v } })}
                  rows={2}
                  defaultSettingId={settingId}
                />
              )}
            </label>
          ))}
          {entry.category === "activity" && (
            <label className="setting-world__toggle">
              <input
                type="checkbox"
                checked={draft.fields.promised === "1"}
                onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, promised: e.target.checked ? "1" : "" } })}
              />
              Обещано — показывать в паспорте
            </label>
          )}
          <label>
            <span className="paper-label">{isNote ? "Текст" : "Заметка"}</span>
            <MentionTextarea value={draft.content} onChange={(v) => setDraft({ ...draft, content: v })} rows={isNote ? 6 : 3} defaultSettingId={settingId} />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={save}>
              Сохранить
            </button>
            <button type="button" onClick={() => onEdit(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <dl className="paper-facts setting-world__fields">
          {filled.map((f) => (
            <div key={f.key}>
              <dt className="paper-label">{f.label}</dt>
              <dd>{f.key === "strictness" ? strictnessLabel(entry.fields.strictness) : <MentionText text={entry.fields[f.key]} />}</dd>
            </div>
          ))}
          {entry.content.trim() && (
            <div>
              {!isNote && <dt className="paper-label">Заметка</dt>}
              <dd>
                <MentionText text={entry.content} />
              </dd>
            </div>
          )}
          {!filled.length && !entry.content.trim() && (
            <p className="muted">
              Пусто.{" "}
              <button type="button" className="setting-passport__empty" onClick={() => onEdit(true)}>
                Заполнить
              </button>
            </p>
          )}
          {filled.length > 0 && filled.length < (type?.fields.length ?? 0) && <p className="pop-more-note">Пустые поля скрыты — они появятся при правке.</p>}
        </dl>
      )}
    </article>
  );
}
