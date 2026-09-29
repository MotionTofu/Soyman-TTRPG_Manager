import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { MentionText } from "./mentions/MentionText";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { NavIcon } from "./NavIcons";
import "./SessionNotesChat.css";

// Лента-чат заметок (гриллинг 2026-09-28): новое внизу, Enter — отправить,
// Shift+Enter — строка, ↑ в пустом поле — правка последнего, карандаш и
// крестик у сообщения. Откуда записи и куда уходят — дело обёртки: ленты
// сессии у Мастера (SessionNotesChat) и колонки листа у игрока
// (SheetNotesColumn). Разделители (сцена, день в мире, сессия) обёртка
// вставляет сама.

export type FeedItem =
  | { kind: "divider"; key: string; label: string; accent?: boolean }
  | { kind: "note"; key: string; id: number; text: string; created_at: string };

/** SQLite пишет UTC без пояса: "2026-09-28 21:47:00". */
function clock(sqlUtc: string): string {
  const d = new Date(`${sqlUtc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function NotesFeed({
  items,
  loaded,
  readOnly = false,
  settingId,
  emptyText,
  placeholder = "Что произошло…",
  onSend,
  onEdit,
  onDelete,
  plain = false,
}: {
  items: FeedItem[];
  loaded: boolean;
  readOnly?: boolean;
  settingId?: number | null;
  emptyText: string;
  placeholder?: string;
  /** true — ушло, поле очищается; false — осталось набранным. */
  onSend: (text: string) => Promise<boolean>;
  onEdit: (id: number, text: string) => Promise<boolean>;
  /** label — начало текста без разметки, для тоста «удалено». */
  onDelete: (id: number, label: string) => void;
  /** Простое поле без «@» — там, где нет базы мира (OneShot, Q33). */
  plain?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Как в мессенджере: новое внизу, и лента стоит на нём.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setDraft("");
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    if (await onEdit(editing.id, text)) setEditing(null);
  }

  function onDraftKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void send();
    } else if (e.key === "ArrowUp" && !draft) {
      // Как в Telegram: ↑ в пустом поле — правка последнего.
      const last = [...items].reverse().find((i) => i.kind === "note");
      if (last?.kind !== "note") return;
      e.preventDefault();
      setEditing({ id: last.id, text: last.text });
    }
  }

  function onEditKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    }
  }

  return (
    <div className="session-chat">
      <div className="session-chat__list" ref={listRef}>
        {loaded && items.length === 0 && <span className="muted session-chat__empty">{emptyText}</span>}
        {items.map((it) => {
          if (it.kind === "divider") {
            return (
              <div key={it.key} className={`session-chat__divider${it.accent ? " session-chat__divider--day" : ""}`}>
                {it.label}
              </div>
            );
          }
          if (editing?.id === it.id) {
            return (
              <div key={it.key} className="session-chat__msg session-chat__msg--editing">
                <Field
                  plain={plain}
                  value={editing.text}
                  onChange={(text) => setEditing({ id: it.id, text })}
                  onKeyDown={onEditKey}
                  settingId={settingId}
                />
                <div className="row session-chat__edit-actions">
                  <button type="button" className="comp-mini" onClick={() => void saveEdit()}>
                    Сохранить
                  </button>
                  <button type="button" className="comp-mini" onClick={() => setEditing(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={it.key} className="session-chat__msg">
              <span className="session-chat__time">{clock(it.created_at)}</span>
              <div className="session-chat__text">
                <MentionText text={it.text} />
              </div>
              {!readOnly && (
                <span className="session-chat__actions">
                  <button
                    type="button"
                    title="Править"
                    aria-label="Править сообщение"
                    onClick={() => setEditing({ id: it.id, text: it.text })}
                  >
                    <NavIcon name="edit" />
                  </button>
                  <button type="button" title="Удалить" aria-label="Удалить сообщение" onClick={() => onDelete(it.id, noteLabel(it.text))}>
                    <NavIcon name="close" />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="session-chat__input">
          <Field
            plain={plain}
            value={draft}
            onChange={setDraft}
            onKeyDown={onDraftKey}
            placeholder={placeholder}
            settingId={settingId}
          />
          <button
            type="button"
            className="session-chat__send"
            title="Отправить (Enter)"
            aria-label="Отправить"
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
          >
            <NavIcon name="arrowRight" />
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  plain,
  value,
  onChange,
  onKeyDown,
  placeholder,
  settingId,
}: {
  plain: boolean;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  settingId?: number | null;
}) {
  if (plain) {
    return (
      <textarea
        className="session-chat__plain"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <MentionTextarea
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      rows={1}
      placeholder={placeholder}
      defaultSettingId={settingId ?? undefined}
    />
  );
}

/** Подпись сообщения для тоста «удалено»: текст без разметки упоминаний. */
function noteLabel(text: string): string {
  return text.replace(/\[\[[^\]]*\|([^|\]]*)\]\]/g, "$1").trim().slice(0, 30) || "Сообщение";
}
