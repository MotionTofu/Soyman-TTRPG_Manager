import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { api } from "../../api/client";
import { ENTITY_TYPE_SINGULAR } from "../../entityTypes";

// Ссылка, чья цель на этом устройстве не установлена.
//
// Подпись остаётся обычной читаемой прозой — «Мирт отправляет вас в Синий
// переулок» читается так же, как читалось, — но зачёркнута и не ведёт никуда.
// Клик объясняет, какого модуля не хватает, и предлагает единственное
// осмысленное действие, если ставить его не собираешься: снять ссылку,
// оставив текст.
//
// Оживает такая ссылка сама, без участия человека: установка модуля запускает
// проход исцеления (server/src/services/mentions.ts).

interface Props {
  type: string;
  uid: string;
  source: string;
  label: string;
}

export function DeadMention({ type, uid, source, label }: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setCount(null);
    api
      .get<{ count: number }>(`/links/dangling?type=${encodeURIComponent(type)}&uid=${uid}`)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, [open, type, uid]);

  async function strip() {
    setBusy(true);
    try {
      const r = await api.post<{ removed: number }>("/links/dangling/strip", { type, uid });
      setDone(r.removed);
    } finally {
      setBusy(false);
    }
  }

  const kind = ENTITY_TYPE_SINGULAR[type] ?? "запись";

  return (
    <>
      <button type="button" className="mention-dead" onClick={() => setOpen(true)} title="Ссылка не работает">
        {label}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="stack">
            <strong>Ссылка не работает</strong>
            {done == null ? (
              <>
                {/* Тип вынесен отдельной строкой, а не вставлен в фразу: род у
                    пятнадцати типов разный («существо», «локация», «игрок»), и
                    согласовать его одним предложением не выйдет. */}
                <span className="muted">
                  {kind} · «{label}»
                </span>
                <div>
                  На этом устройстве такой записи нет.
                  {source ? (
                    <>
                      {" "}
                      Она из модуля <strong>{source}</strong> — поставьте его, и ссылка заработает
                      сама.
                    </>
                  ) : (
                    " Модуль, из которого она родом, в ссылке не записан."
                  )}
                </div>
                <span className="muted">
                  {count == null
                    ? "Считаю, сколько таких ссылок…"
                    : count === 1
                      ? "Такая ссылка в базе одна."
                      : `Таких ссылок в базе ${count}.`}
                </span>
                <div className="row">
                  <button className="primary" onClick={() => setOpen(false)}>
                    Закрыть
                  </button>
                  <button className="danger" disabled={busy} onClick={() => void strip()}>
                    {count != null && count > 1
                      ? `Убрать все ${count}, оставить текст`
                      : "Убрать ссылку, оставить текст"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>Снято ссылок: {done}. Подписи остались обычным текстом.</div>
                <div className="row">
                  <button className="primary" onClick={() => window.location.reload()}>
                    Обновить страницу
                  </button>
                  <button onClick={() => setOpen(false)}>Закрыть</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
