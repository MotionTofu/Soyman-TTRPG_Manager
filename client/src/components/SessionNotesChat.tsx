import { useMemo } from "react";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { formatInworldDate } from "../inworldCalendar";
import type { SessionNote } from "../types";
import { NotesFeed, type FeedItem } from "./NotesFeed";

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

  const items = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const timeline = [
      ...data.scenes.map((s) => ({ at: s.launched_at, order: 0, scene: s, note: null })),
      ...data.notes.map((n) => ({ at: n.created_at, order: 1, scene: null, note: n })),
    ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
    const out: FeedItem[] = [];
    let day: string | null = null;
    for (const t of timeline) {
      if (t.scene) {
        out.push({ kind: "divider", key: `s${t.scene.id}`, label: t.scene.name });
        continue;
      }
      const n = t.note!;
      if (n.inworld_date && n.inworld_date !== day) {
        const [y, m, d] = n.inworld_date.split("-").map(Number);
        const label = formatInworldDate(y, m, d, calendar?.months ?? [], calendar?.era ?? "");
        if (label) out.push({ kind: "divider", key: `d${n.id}`, label, accent: true });
        day = n.inworld_date;
      }
      out.push({ kind: "note", key: `n${n.id}`, id: n.id, text: n.text, created_at: n.created_at });
    }
    return out;
  }, [data, calendar]);

  // Удаление без вопроса, с «Отменить» в тосте (Q15). Тост показывается,
  // только если сервер удаление принял.
  function remove(id: number, label: string) {
    const note = data?.notes.find((n) => n.id === id);
    if (!note) return;
    void run(
      () =>
        deleteWithUndo({
          entityName: label,
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

  return (
    <NotesFeed
      items={items}
      loaded={!!data}
      readOnly={readOnly}
      settingId={settingId}
      emptyText={readOnly ? "Записей нет." : "Пишите по ходу игры: Enter — отправить, Shift+Enter — новая строка."}
      onSend={async (text) =>
        (await run(() => write.post(sessionPaths.notes(sessionId), { text }), { affects, retry: false })) !== undefined
      }
      onEdit={async (id, text) => (await run(() => write.put(`/sessions/notes/${id}`, { text }), { affects })) !== undefined}
      onDelete={remove}
    />
  );
}
