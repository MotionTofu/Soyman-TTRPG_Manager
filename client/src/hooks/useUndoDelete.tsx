import { useCallback, useRef, useState } from "react";

interface UndoToast {
  msg: string;
  onUndo: () => void;
}

/**
 * Хук для удаления сущностей с toast-отменой.
 * Оборачивает api.del() — после удаления показывает toast с кнопкой «Отменить».
 * Если пользователь не нажал «Отменить» за 8 секунд — сущность остаётся удалённой.
 */
export function useUndoDelete() {
  const [toast, setToast] = useState<UndoToast | null>(null);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setToast(null);
  }, []);

  const deleteWithUndo = useCallback(
    async (opts: {
      entityName: string;
      deleteFn: () => Promise<void>;
      restoreFn: () => Promise<void>;
      ms?: number;
    }) => {
      await opts.deleteFn();
      dismiss();
      const msg = `«${opts.entityName}» удалено`;
      setToast({ msg, onUndo: opts.restoreFn });
      timerRef.current = window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), opts.ms ?? 8000);
    },
    [dismiss]
  );

  return { toast, deleteWithUndo, dismiss } as const;
}
