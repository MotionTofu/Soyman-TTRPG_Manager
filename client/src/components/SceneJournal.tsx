import { useEffect, useState } from "react";
import { api } from "../api/client";

// Лента вечера под «Основными событиями сессии»: что запускали и в каком
// порядке. Дубли — это возвраты, и их видно: «таверна → подземелье →
// таверна» рассказывает про сессию больше, чем список посещённого.
//
// Сам в текст ничего не дописывает. «Основные события» читают игроки — у
// поля есть галочка видимости, — и автоматическая дописка посреди сессии
// правит то, что Мастер уже сформулировал. Кнопка даёт всю пользу и ноль
// риска.

export function SceneJournal({
  sessionId,
  version,
  onInsert,
}: {
  sessionId: number;
  /** Счётчик запусков сцен: лента живёт ниже переключателя и сама о них не знает. */
  version: number;
  onInsert: (text: string) => void;
}) {
  const [journal, setJournal] = useState<{ id: number; scene_id: number; name: string }[]>([]);

  useEffect(() => {
    api.get<typeof journal>(`/sessions/${sessionId}/journal`).then(setJournal);
  }, [sessionId, version]);

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
