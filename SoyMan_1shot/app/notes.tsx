import { useMemo, useRef } from 'react';
import { NotesFeed, type FeedItem } from '../../client/src/components/NotesFeed';
import { NotesDock } from '../../client/src/components/dnd/NotesDock';
import { useUndoDelete } from '../../client/src/hooks/useUndoDelete';
import type { PortableNote } from '../../shared/src/portable/parse';

// Заметки листа в OneShot (гриллинг 2026-09-28, Q29–Q33). Сессий здесь нет —
// лента делится по дням игры. Хранятся в записи персонажа (sessionNotes) и
// живут вместе с ним: уходят в портативный HTML и Мастеру. Упоминаний нет —
// базы мира в OneShot нет, а «Щит» заклинанием в заметке только мешает.

/** Сейчас в UTC, как пишет SQLite: так время читает NotesFeed. */
function sqlNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function dayLabel(sqlUtc: string): string {
  const d = new Date(`${sqlUtc.replace(' ', 'T')}Z`);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function OneShotNotes({
  notes,
  onChange,
}: {
  notes: PortableNote[];
  /** Нет — только чтение (автономная копия у Мастера). */
  onChange?: (next: PortableNote[]) => void;
}) {
  // Отмена удаления возвращает запись в текущий список, а не в тот, что был
  // при удалении: за восемь секунд тоста могли дописать новое.
  const latest = useRef(notes);
  latest.current = notes;
  const readOnly = !onChange;

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    let day = '';
    for (const n of [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)) {
      const label = dayLabel(n.created_at);
      if (label !== day) {
        out.push({ kind: 'divider', key: `d${n.id}`, label, accent: true });
        day = label;
      }
      out.push({ kind: 'note', key: `n${n.id}`, id: n.id, text: n.text, created_at: n.created_at });
    }
    return out;
  }, [notes]);

  return (
    <NotesDock>
      {readOnly ? (
        <Feed items={items} />
      ) : (
        <EditableFeed items={items} latest={latest} onChange={onChange} />
      )}
    </NotesDock>
  );
}

function Feed({ items }: { items: FeedItem[] }) {
  return (
    <NotesFeed
      items={items}
      loaded
      readOnly
      plain
      emptyText="Игрок ничего не записал."
      onSend={async () => false}
      onEdit={async () => false}
      onDelete={() => {}}
    />
  );
}

// Отдельный компонент: useUndoDelete требует провайдера, а в автономной
// копии (только чтение) его нет и не нужно.
function EditableFeed({
  items,
  latest,
  onChange,
}: {
  items: FeedItem[];
  latest: { current: PortableNote[] };
  onChange: (next: PortableNote[]) => void;
}) {
  const { deleteWithUndo } = useUndoDelete();
  return (
    <NotesFeed
      items={items}
      loaded
      plain
      emptyText="Что узнал персонаж — пишите по ходу игры. Enter — отправить."
      placeholder="Что узнал персонаж…"
      onSend={async (text) => {
        const id = Math.max(0, ...latest.current.map((n) => n.id)) + 1;
        onChange([...latest.current, { id, text, created_at: sqlNow() }]);
        return true;
      }}
      onEdit={async (id, text) => {
        onChange(latest.current.map((n) => (n.id === id ? { ...n, text } : n)));
        return true;
      }}
      onDelete={(id, label) => {
        const note = latest.current.find((n) => n.id === id);
        if (!note) return;
        void deleteWithUndo({
          entityName: label,
          deleteFn: async () => onChange(latest.current.filter((n) => n.id !== id)),
          restoreFn: async () => onChange([...latest.current, note]),
        });
      }}
    />
  );
}
