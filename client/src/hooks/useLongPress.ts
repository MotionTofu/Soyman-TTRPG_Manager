import { useCallback, useEffect, useRef } from "react";

interface Options {
  /** Сколько держать до срабатывания. 500 мс — порог, привычный по мобильным ОС. */
  ms?: number;
  /** На сколько пикселей палец может сместиться, прежде чем это считается прокруткой. */
  moveTolerance?: number;
}

/**
 * Долгое зажатие как замена правой кнопке на планшете.
 *
 * Правая кнопка на тач-экране недоступна, а контекстные меню — единственное
 * место, где живут «Переименовать», «В мешок» и «Архивировать» для строки
 * списка. Долгое зажатие открывает то же меню тем же кодом: обработчику
 * приходят координаты касания, как пришли бы координаты щелчка.
 *
 * Палец за столом почти всегда немного едет, поэтому одного таймера мало:
 * без допуска на смещение меню выскакивало бы при каждой прокрутке списка.
 * Отмена идёт по первому же движению дальше `moveTolerance`.
 *
 * Возвращает готовый набор обработчиков — их разворачивают в элемент рядом с
 * `onContextMenu`, который остаётся для мыши:
 *
 *     <div onContextMenu={openMenu} {...useLongPress(openMenu)}>
 */
export function useLongPress(
  onLongPress: (position: { clientX: number; clientY: number }) => void,
  { ms = 500, moveTolerance = 10 }: Options = {}
) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Колбэк живёт в ref: обработчики не должны пересоздаваться на каждый рендер
  // строки списка, иначе они станут новыми пропсами и сломают мемоизацию.
  const handler = useRef(onLongPress);
  handler.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // Сброс предыдущего касания идёт ДО записи новой точки: `cancel`
      // обнуляет и её тоже, и в обратном порядке таймер просыпался с пустым
      // `start` и молча ничего не делал.
      cancel();
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const from = start.current;
        start.current = null;
        if (!from) return;
        // Короткая отдача — единственный способ сказать «меню сейчас
        // откроется», пока палец ещё на экране. Есть не везде, поэтому
        // проверка, а не расчёт на неё.
        navigator.vibrate?.(10);
        handler.current({ clientX: from.x, clientY: from.y });
      }, ms);
    },
    [cancel, ms]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const from = start.current;
      const t = e.touches[0];
      if (!from || !t) return;
      if (Math.abs(t.clientX - from.x) > moveTolerance || Math.abs(t.clientY - from.y) > moveTolerance) {
        cancel();
      }
    },
    [cancel, moveTolerance]
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  } as const;
}
