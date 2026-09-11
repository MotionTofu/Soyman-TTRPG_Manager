import { useResource } from "../data/hooks";
import { sessionPaths } from "../data/sessions";

// Лента вечера под «Основными событиями сессии»: что запускали и в каком
// порядке. Дубли — это возвраты, и их видно: «таверна → подземелье →
// таверна» рассказывает про сессию больше, чем список посещённого.
//
// Сам в текст ничего не дописывает. «Основные события» читают игроки — у
// поля есть галочка видимости, — и автоматическая дописка посреди сессии
// правит то, что Мастер уже сформулировал. Кнопка даёт всю пользу и ноль
// риска.

interface JournalRow {
  id: number;
  scene_id: number;
  name: string;
}

const NO_JOURNAL: JournalRow[] = [];

export function SceneJournal({
  sessionId,
  onInsert,
}: {
  sessionId: number;
  onInsert: (text: string) => void;
}) {
  // Лента — из кэша слоя данных: запуск сцены задевает сессию
  // (data/sessions.ts), и лента перечитывается сама, без счётчика запусков.
  const journal = useResource<JournalRow[]>(sessionPaths.journal(sessionId)).data ?? NO_JOURNAL;

  if (journal.length === 0) return null;

  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span className="muted">Прошли за вечер: {journal.map((j) => j.name).join(" → ")}</span>
      <button
        type="button"
        className="comp-mini"
        onClick={() => onInsert(journal.map((j) => `— ${j.name}`).join("\n"))}
      >
        Вставить списком
      </button>
    </div>
  );
}
