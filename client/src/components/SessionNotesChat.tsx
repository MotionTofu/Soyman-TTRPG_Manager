import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { formatInworldDate } from "../inworldCalendar";
import type { SessionNote } from "../types";
import { MentionText } from "./mentions/MentionText";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { NavIcon } from "./NavIcons";
import "./SessionNotesChat.css";

// Лента сессии чатом (гриллинг 2026-09-28). Заменила текст «Основных событий»:
// Мастер пишет по ходу игры короткими сообщениями, Enter — и ушло, со своим
// временем. Разбирать и расставлять упоминания — после игры.
//
// Смена сцены — не сообщение, а разделитель из журнала запусков: его никто не
// пишет и не правит. Дата в мире — тоже разделитель, и только когда она
// сменилась («прошёл день»), а не подписью у каждой строки.

interface SceneLaunch {
  id: number;
  launched_at: string;
  name: string;
}

interface NotesPayload {
  notes: SessionNote[];
  scenes: SceneLaunch[];
}

type Item =
  | { kind: "scene"; key: string; name: string }
  | { kind: "day"; key: string; label: string }
  | { kind: "note"; key: string; note: SessionNote };

/** SQLite пишет UTC без пояса: "2026-09-28 21:47:00". */
function clock(sqlUtc: string): string {
  const d = new Date(`${sqlUtc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function SessionNotesChat({
  sessionId,
  settingId,
  readOnly = false,
}: {
  sessionId: number;
  settingId?: number | null;
  readOnly?: boolean;
}) {
  const data = useResource<NotesPayload>(sessionPaths.notes(sessionId)).data;
  const calendar = useSettingCalendar(settingId);
  const run = useAction();
  const afterWrite = useAfterWrite();
  const { deleteWithUndo } = useUndoDelete();
  const affects = [{ kind: "session" as const, id: sessionId }];

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const notes = data?.notes;
  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    const timeline = [
      ...data.scenes.map((s) => ({ at: s.launched_at, order: 0, scene: s, note: null })),
      ...data.notes.map((n) => ({ at: n.created_at, order: 1, scene: null, note: n })),
    ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
    const out: Item[] = [];
    let day: string | null = null;
    for (const t of timeline) {
      if (t.scene) {
        out.push({ kind: "scene", key: `s${t.scene.id}`, name: t.scene.name });
        continue;
      }
      const n = t.note!;
      if (n.inworld_date && n.inworld_date !== day) {
        const [y, m, d] = n.inworld_date.split("-").map(Number);
        const label = formatInworldDate(y, m, d, calendar?.months ?? [], calendar?.era ?? "");
        if (label) out.push({ kind: "day", key: `d${n.id}`, label });
        day = n.inworld_date;
      }
      out.push({ kind: "note", key: `n${n.id}`, note: n });
    }
    return out;
  }, [data, calendar]);

  // Как в мессенджере: новое внизу, и лента стоит на нём.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await run(() => write.post(sessionPaths.notes(sessionId), { text }), { affects, retry: false });
    setSending(false);
    if (ok !== undefined) setDraft("");
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    const ok = await run(() => write.put(`/sessions/notes/${editing.id}`, { text }), { affects });
    if (ok !== undefined) setEditing(null);
  }

  // Удаление без вопроса, с «Отменить» в тосте (Q15). Тост показывается,
  // только если сервер удаление принял.
  function remove(note: SessionNote) {
    void run(
      () =>
        deleteWithUndo({
          entityName: note.text.replace(/\[\[[^\]]*\|([^|\]]*)\]\]/g, "$1").trim().slice(0, 30) || "Сообщение",
          deleteFn: async () => {
            await write.del(`/sessions/notes/${note.id}`);
          },
          restoreFn: async () => {
            await write.post(sessionPaths.notes(sessionId), {
              text: note.text,
              created_at: note.created_at,
              inworld_date: note.inworld_date,
            });
            afterWrite(affects);
          },
        }),
      { affects, retry: false }
    );
  }

  function onDraftKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void send();
    } else if (e.key === "ArrowUp" && !draft && notes?.length) {
      // Как в Telegram: ↑ в пустом поле — правка последнего.
      e.preventDefault();
      const last = notes[notes.length - 1];
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
        {data && items.length === 0 && (
          <span className="muted session-chat__empty">
            {readOnly ? "Записей нет." : "Пишите по ходу игры: Enter — отправить, Shift+Enter — новая строка."}
          </span>
        )}
        {items.map((it) => {
          if (it.kind === "scene") return <div key={it.key} className="session-chat__divider">{it.name}</div>;
          if (it.kind === "day") return <div key={it.key} className="session-chat__divider session-chat__divider--day">{it.label}</div>;
          const n = it.note;
          if (editing?.id === n.id) {
            return (
              <div key={it.key} className="session-chat__msg session-chat__msg--editing">
                <MentionTextarea
                  value={editing.text}
                  onChange={(text) => setEditing({ id: n.id, text })}
                  onKeyDown={onEditKey}
                  rows={1}
                  defaultSettingId={settingId ?? undefined}
                />
                <div className="row session-chat__edit-actions">
                  <button type="button" className="comp-mini" onClick={() => void saveEdit()}>Сохранить</button>
                  <button type="button" className="comp-mini" onClick={() => setEditing(null)}>Отмена</button>
                </div>
              </div>
            );
          }
          return (
            <div key={it.key} className="session-chat__msg">
              <span className="session-chat__time">{clock(n.created_at)}</span>
              <div className="session-chat__text"><MentionText text={n.text} /></div>
              {!readOnly && (
                <span className="session-chat__actions">
                  <button type="button" title="Править" aria-label="Править сообщение" onClick={() => setEditing({ id: n.id, text: n.text })}>
                    <NavIcon name="edit" />
                  </button>
                  <button type="button" title="Удалить" aria-label="Удалить сообщение" onClick={() => remove(n)}>
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
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            onKeyDown={onDraftKey}
            rows={1}
            placeholder="Что произошло…"
            defaultSettingId={settingId ?? undefined}
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
