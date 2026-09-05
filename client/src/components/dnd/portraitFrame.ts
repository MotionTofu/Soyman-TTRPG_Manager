import { useCallback, useRef, useState } from "react";

// Кадрирование портрета перетаскиванием (этап 9): точка фокуса в долях,
// применяется через object-position. Один хук на лист и карточку существа.
// Черновик живёт локально и коммитится по отпусканию: гонять сохранение на
// каждый pointermove — значит долбить очередь сохранений.

export interface PortraitFocus {
  x: number;
  y: number;
}

/** Дефолт листа: чуть выше центра — на портретах в полный рост лицо сидит
 *  в верхней трети, и обрезка ровно по центру промахивается по нему. */
export const DEFAULT_PORTRAIT_FOCUS: PortraitFocus = { x: 0.5, y: 0.35 };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function useFrameDrag(
  enabled: boolean,
  focus: PortraitFocus | undefined,
  onCommit: (focus: PortraitFocus) => void
): {
  /** Показываемая точка: черновик в полёте, иначе сохранённая, иначе дефолт. */
  shown: PortraitFocus;
  /** Идёт ли перетаскивание прямо сейчас (курсор, подсказка). */
  dragging: boolean;
  /** Флаг для соседних tap-жестов: был ли жест перетаскиванием, а не тапом.
   *  Читается и сбрасывается тем же касанием (порядок touchend/pointerup
   *  на платформах разный, а флаг ставится ещё в pointermove — раньше обоих). */
  draggedRef: { current: boolean };
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
} {
  const [draft, setDraft] = useState<PortraitFocus | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  const draftRef = useRef<PortraitFocus | null>(null);
  // Живые значения через рефы: обработчики стабильны и не переподписываются
  // на каждое движение (иначе pointer capture слетал бы mid-drag).
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const shown = draft ?? focus ?? DEFAULT_PORTRAIT_FOCUS;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggedRef.current = false;
    if (!enabledRef.current) return;
    if (e.button !== undefined && e.button !== 0) return;
    const base = focusRef.current ?? DEFAULT_PORTRAIT_FOCUS;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: base.x, oy: base.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const st = drag.current;
    if (!st) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!st.moved && Math.hypot(e.clientX - st.sx, e.clientY - st.sy) < 4) return;
    st.moved = true;
    draggedRef.current = true;
    const next = {
      x: clamp01(st.ox + (e.clientX - st.sx) / rect.width),
      y: clamp01(st.oy + (e.clientY - st.sy) / rect.height),
    };
    draftRef.current = next;
    setDraft(next);
  }, []);

  const finish = useCallback((commit: boolean) => {
    const st = drag.current;
    drag.current = null;
    if (!st) return;
    if (commit && st.moved && draftRef.current) commitRef.current(draftRef.current);
    draftRef.current = null;
    setDraft(null);
  }, []);

  const onPointerUp = useCallback(() => finish(true), [finish]);
  const onPointerCancel = useCallback(() => finish(false), [finish]);

  // Клик после перетаскивания — не клик: давит открытие загрузки аватара
  // (label существа) и прочие tap-жесты под пальцем.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { shown, dragging: draft !== null, draggedRef, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } };
}
