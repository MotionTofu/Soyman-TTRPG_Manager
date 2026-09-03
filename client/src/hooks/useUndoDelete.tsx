import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface UndoToast {
  msg: string;
  onUndo: () => Promise<void>;
  // Восстановление идёт в сеть, и оно может не получиться. Раньше тост
  // закрывался до вызова `restoreFn`, и упавшее восстановление выглядело
  // ровно как удавшееся: мастер уходил с уверенностью, что сущность
  // вернулась, а она оставалась в архиве.
  busy?: boolean;
  error?: string | null;
}

interface UndoDeleteApi {
  deleteWithUndo: (opts: {
    entityName: string;
    deleteFn: () => Promise<void>;
    restoreFn: () => Promise<void>;
    ms?: number;
  }) => Promise<void>;
  /**
   * Предложить отмену для уже случившегося удаления.
   *
   * Нужно там, где само удаление идёт не одним вызовом: в галерее между
   * нажатием и удалением встают два диалога выбора («в архив» или
   * «навсегда»), и после «навсегда» отменять нечего — тост показывать нельзя.
   * Заворачивать такой путь в `deleteWithUndo` пришлось бы пустым `deleteFn`,
   * то есть враньём в имени.
   */
  offerUndo: (opts: { entityName: string; restoreFn: () => Promise<void>; ms?: number }) => void;
  dismiss: () => void;
}

const UndoDeleteContext = createContext<UndoDeleteApi | null>(null);

/**
 * Держит toast-отмену удаления на уровне оболочки приложения.
 *
 * Раньше состояние жило на самой странице, а тост рисовался её же разметкой —
 * и там, где после удаления страница уходит (`navigate` из карточки сессии,
 * кампании, персонажа), тост размонтировался вместе с ней. Мастер видел
 * вспышку или не видел ничего, а нажать «Отменить» было физически негде.
 * Провайдер переживает переход: тост висит поверх новой страницы все 8 секунд.
 */
export function UndoDeleteProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<UndoToast | null>(null);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setToast(null);
  }, []);

  const offerUndo = useCallback<UndoDeleteApi["offerUndo"]>(
    (opts) => {
      dismiss();
      const msg = `«${opts.entityName}» удалено`;
      setToast({ msg, onUndo: opts.restoreFn });
      timerRef.current = window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), opts.ms ?? 8000);
    },
    [dismiss]
  );

  const deleteWithUndo = useCallback<UndoDeleteApi["deleteWithUndo"]>(
    async (opts) => {
      await opts.deleteFn();
      offerUndo(opts);
    },
    [offerUndo]
  );

  // Восстановление ждёт ответа сервера, и тост живёт до него: восьмисекундный
  // таймер снимается на время попытки, чтобы тост не исчез посреди неё.
  // Тост берётся аргументом, а не читается из функционального сеттера:
  // updater у `setState` выполняется отложенно, и попытка вытащить оттуда
  // `onUndo` срабатывала только на первом нажатии — на втором очередь была
  // не пуста, колбэк не доставался, и тост навсегда застревал на
  // «Возвращаю…». Поймано живой проверкой, а не рассуждением.
  const runUndo = useCallback(async (t: UndoToast) => {
    if (t.busy) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setToast({ ...t, busy: true, error: null });
    try {
      await t.onUndo();
      setToast(null);
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "неизвестная ошибка";
      setToast({ ...t, busy: false, error: message });
    }
  }, []);

  const api = useMemo(() => ({ deleteWithUndo, offerUndo, dismiss }), [deleteWithUndo, offerUndo, dismiss]);

  return (
    <UndoDeleteContext.Provider value={api}>
      {children}
      {toast && (
        <div
          className={`archive-toast${toast.error ? " archive-toast--error" : ""}`}
          role={toast.error ? "alert" : "status"}
          aria-live={toast.error ? "assertive" : "polite"}
        >
          <span className="archive-toast__msg">
            {toast.error ? `Не удалось вернуть: ${toast.error}` : toast.msg}
          </span>
          <div className="archive-toast__actions">
            <button className="archive-toast__undo" onClick={() => runUndo(toast)} disabled={toast.busy}>
              {toast.busy ? "Возвращаю…" : toast.error ? "Ещё раз" : "Отменить"}
            </button>
            <button className="archive-toast__close" onClick={dismiss} aria-label="Закрыть">
              ×
            </button>
          </div>
        </div>
      )}
    </UndoDeleteContext.Provider>
  );
}

/**
 * Удаление сущности с toast-отменой. Оборачивает `api.del()` — после удаления
 * показывает toast с кнопкой «Отменить». Если Мастер не нажал её за 8 секунд,
 * сущность остаётся удалённой.
 *
 * `restoreFn` — это всегда `PUT /<раздел>/:id/restore`, а не повторный
 * `DELETE`: удаление ставит `archived_at = now`, поэтому второй `DELETE`
 * просто переписывает дату и сущность остаётся в архиве.
 */
export function useUndoDelete(): UndoDeleteApi {
  const ctx = useContext(UndoDeleteContext);
  if (!ctx) throw new Error("useUndoDelete вызван вне UndoDeleteProvider");
  return ctx;
}
