import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import { api } from "../../api/client";
import { ENTITY_TYPE_SINGULAR } from "../../entityTypes";
import { knownSourceName } from "../../mentions";

// Ссылка, чья цель на этом устройстве не установлена.
//
// Подпись остаётся обычной читаемой прозой — «Мирт отправляет вас в Синий
// переулок» читается так же, как читалось, — но зачёркнута и не ведёт никуда.
// Клик объясняет, какого модуля не хватает, и предлагает единственное
// осмысленное действие, если ставить его не собираешься: снять ссылку,
// оставив текст.
//
// Оживает такая ссылка сама, без участия человека и без всякого прохода по
// базе: «жива ли» не записано в текст, а вычисляется — ключ появился в карте,
// значит ссылка ведёт куда надо (client/src/mentions.ts).
//
// В тексте лежит короткий код модуля («wdh»), потому что токен Мастер видит
// при каждой правке. Но здесь, в единственном месте, где источник показывается
// человеку, коротким быть незачем: код разворачивается в имя, которое Мастер
// найдёт в списке модулей, — сначала по своей базе, потом по каталогу.

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
  const [sourceName, setSourceName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCount(null);
    api
      .get<{ count: number }>(`/links/dangling?type=${encodeURIComponent(type)}&uid=${uid}`)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, [open, type, uid]);

  useEffect(() => {
    if (!open || !source) return;
    const local = knownSourceName(source);
    if (local) {
      setSourceName(local);
      return;
    }
    api
      .get<{ name: string | null }>(`/modules/source-name?code=${encodeURIComponent(source)}`)
      .then((r) => setSourceName(r.name))
      .catch(() => setSourceName(null));
  }, [open, source]);

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
                      Она из модуля <strong>{sourceName ?? source}</strong>
                      {sourceName && sourceName !== source ? (
                        <span className="muted"> ({source})</span>
                      ) : null}{" "}
                      — поставьте его, и ссылка заработает сама.
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
