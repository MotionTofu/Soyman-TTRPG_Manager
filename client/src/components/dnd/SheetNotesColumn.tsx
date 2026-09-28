import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useAfterWrite, useResource, write } from "../../data/hooks";
import { journalAffects } from "../../data/playerCampaign";
import { useUndoDelete } from "../../hooks/useUndoDelete";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Sheet } from "./wizardUi";
import { NotesFeed, type FeedItem } from "../NotesFeed";
import "./SheetNotesColumn.css";

// Заметки игрока в колонке листа (гриллинг 2026-09-28, Q8–Q11, Q20–Q26).
// Это записи его дневника от персонажа, каждая встаёт к сессии: идущей,
// иначе к сегодняшней запланированной, иначе к последней проведённой — это
// решает сервер. Мастер видит колонку только на чтение.
//
// Колонкой — где ей хватает места (порог в SheetNotesColumn.css). Уже —
// плашкой внизу экрана, которая открывает ту же ленту шторкой поверх
// текущей вкладки (Q22): записать мысль посреди боя, не уходя с «Действий».

interface NoteSession {
  id: number;
  session_number: number;
  title: string | null;
  date: string;
  live?: boolean;
}

interface SheetNotes {
  campaign_id: number;
  target: NoteSession | null;
  sessions: NoteSession[];
  entries: { id: number; session_id: number | null; name: string; description: string; created_at: string }[];
}

// Тот же порог, что в SheetNotesColumn.css: шире — колонка, уже — плашка.
const WIDE = "(min-width: 1600px)";

const sessionLabel = (s: NoteSession) =>
  `Сессия №${s.session_number}${s.title ? ` · ${s.title}` : ""} · ${s.date.split("-").reverse().join(".")}`;

export function SheetNotesColumn({ characterId, readOnly }: { characterId: number; readOnly: boolean }) {
  const path = `/characters/${characterId}/notes`;
  const data = useResource<SheetNotes | null>(path).data;
  const run = useAction();
  const afterWrite = useAfterWrite();
  const wide = useMediaQuery(WIDE);
  const [open, setOpen] = useState(false);
  const { deleteWithUndo } = useUndoDelete();

  const items = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const byId = new Map(data.sessions.map((s) => [s.id, s]));
    const out: FeedItem[] = [];
    let current: number | null = null;
    for (const e of data.entries) {
      if (e.session_id !== current) {
        const s = e.session_id != null ? byId.get(e.session_id) : undefined;
        if (s) out.push({ kind: "divider", key: `s${s.id}-${e.id}`, label: sessionLabel(s), accent: true });
        current = e.session_id;
      }
      const text = e.name ? `**${e.name}** ${e.description}` : e.description;
      out.push({ kind: "note", key: `n${e.id}`, id: e.id, text, created_at: e.created_at });
    }
    return out;
  }, [data]);

  // Персонаж без кампании — колонки нет (Q25), вкладки на всю ширину.
  if (data === null) return null;
  if (!data) return wide ? <aside className="sheet-notes" /> : null;

  const affects = [{ path }, ...journalAffects(data.campaign_id)];
  const target = data.target;

  const targetLabel = target ? `${target.live ? "Идёт" : "К сессии"} №${target.session_number}` : "Сессий ещё не было";
  const allLink = !readOnly && (
    <Link to={`/campaigns/${data.campaign_id}`} className="sheet-notes__all">
      Весь дневник
    </Link>
  );
  const feed = (
      <NotesFeed
        items={items}
        loaded
        readOnly={readOnly || !target}
        emptyText={
          readOnly
            ? "Игрок ещё ничего не записал."
            : target
              ? "Что узнал персонаж — пишите по ходу игры. Enter — отправить."
              : "Заметки встают к сессиям — появится первая, и можно писать."
        }
        placeholder="Что узнал персонаж…"
        onSend={async (text) =>
          (await run(
            () =>
              write.post(`/player/campaigns/${data.campaign_id}/world-entries`, {
                kind: "",
                description: text,
                character_id: characterId,
                to_session: true,
              }),
            { affects, retry: false }
          )) !== undefined
        }
        onEdit={async (id, text) =>
          (await run(() => write.put(`/player/world-entries/${id}`, { name: "", description: text }), { affects })) !==
          undefined
        }
        onDelete={(id, label) =>
          void run(
            () =>
              deleteWithUndo({
                entityName: label,
                deleteFn: async () => {
                  await write.del(`/player/world-entries/${id}`);
                },
                restoreFn: async () => {
                  await write.post(`/player/world-entries/${id}/restore`);
                  afterWrite(affects);
                },
              }),
            { affects, retry: false }
          )
        }
      />
  );

  if (!wide) {
    return (
      <>
        <button type="button" className="sheet-notes-bar" onClick={() => setOpen(true)}>
          <strong>Заметки</strong>
          <span className="muted">{targetLabel}</span>
        </button>
        {open && (
          <Sheet title="Заметки" onClose={() => setOpen(false)} actions={allLink || undefined}>
            <span className="muted sheet-notes__target">{targetLabel}</span>
            <div className="sheet-notes__sheet-feed">{feed}</div>
          </Sheet>
        )}
      </>
    );
  }

  return (
    <aside className="sheet-notes" aria-label="Заметки">
      <div className="sheet-notes__head">
        <strong>Заметки</strong>
        <span className="muted sheet-notes__target">{targetLabel}</span>
        {allLink}
      </div>
      {feed}
    </aside>
  );
}
