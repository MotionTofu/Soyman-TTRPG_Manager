import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "error";

/**
 * Очередь сохранения для правок «на месте» — там, где каждое действие
 * пользователя (пипс, галочка, цифра в поле) обязано сохраниться само, без
 * кнопки «Сохранить».
 *
 * Зачем очередь, а не `await api.put(...)` на каждое действие:
 *
 * 1. **Дебаунс.** Раньше каждый клик по пипсу и каждое нажатие клавиши в поле
 *    хитов слали PUT со всем чарником целиком. Набрать «15» — два запроса.
 * 2. **Порядок.** Два PUT-а, ушедшие подряд, могут прийти на сервер в обратном
 *    порядке, и последним записанным окажется предпоследнее состояние. Здесь
 *    в полёте всегда ровно один запрос, а копится только самое свежее
 *    состояние — промежуточные просто не отправляются.
 * 3. **Ошибка видна.** Раньше `await api.put(...)` без `catch` при отвале сети
 *    давал unhandled rejection, а на экране правка выглядела сохранённой.
 *    Теперь статус переходит в `error`, неотправленное остаётся в очереди, и
 *    `flush()` отправляет его повторно.
 *
 * `payload` — уже готовая строка (обычно JSON): очередь не знает, что внутри,
 * и хранит только последнюю.
 */
export function useQueuedSave(save: (payload: string) => Promise<void>, delayMs = 400) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Ref обновляется в эффекте, а не в теле компонента: запись в ref во время
  // рендера ломается при двойном рендере StrictMode и в конкурентном режиме.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const pendingRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const pump = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current != null) {
        const payload = pendingRef.current;
        pendingRef.current = null;
        try {
          await saveRef.current(payload);
        } catch {
          // Пока запрос летел, пользователь мог успеть ещё что-то поправить —
          // тогда в очереди уже лежит более свежее состояние, и возвращать
          // туда старое нельзя.
          pendingRef.current = pendingRef.current ?? payload;
          if (mountedRef.current) setStatus("error");
          return;
        }
      }
      if (mountedRef.current) setStatus("idle");
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Флаг поднимается на каждом монтировании, а не только на первом:
    // StrictMode в разработке прогоняет эффект «монтирование → очистка →
    // монтирование», и без этой строки флаг после первой же очистки навсегда
    // оставался снятым — статус «сохраняю…» больше никогда не гас.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Уход со страницы не должен съедать последние 400 мс правок: то, что
      // не успело уйти по дебаунсу, отправляется вдогонку. Ответ уже некому
      // показывать, поэтому ошибка здесь глушится.
      const leftover = pendingRef.current;
      if (leftover != null && !inFlightRef.current) void saveRef.current(leftover).catch(() => {});
    };
  }, []);

  const schedule = useCallback(
    (payload: string) => {
      pendingRef.current = payload;
      setStatus("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void pump();
      }, delayMs);
    },
    [delayMs, pump]
  );

  /** Отправить немедленно — повтор после ошибки и сохранение перед удалением. */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return pump();
  }, [pump]);

  /** Есть ли неотправленное — по этому признаку внешнее обновление не принимается. */
  const hasPending = useCallback(() => pendingRef.current != null || inFlightRef.current, []);

  return { status, schedule, flush, hasPending } as const;
}
