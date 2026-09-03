import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface UndoToast {
  msg: string;
  onUndo: () => void;
}

interface UndoDeleteApi {
  deleteWithUndo: (opts: {
    entityName: string;
    deleteFn: () => Promise<void>;
    restoreFn: () => Promise<void>;
    ms?: number;
  }) => Promise<void>;
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

  const deleteWithUndo = useCallback<UndoDeleteApi["deleteWithUndo"]>(
    async (opts) => {
      await opts.deleteFn();
      dismiss();
      const msg = `«${opts.entityName}» удалено`;
      setToast({ msg, onUndo: opts.restoreFn });
      timerRef.current = window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), opts.ms ?? 8000);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ deleteWithUndo, dismiss }), [deleteWithUndo, dismiss]);

  return (
    <UndoDeleteContext.Provider value={api}>
      {children}
      {toast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{toast.msg}</span>
          <div className="archive-toast__actions">
            <button
              className="archive-toast__undo"
              onClick={() => { const cb = toast.onUndo; dismiss(); cb(); }}
            >
              Отменить
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
