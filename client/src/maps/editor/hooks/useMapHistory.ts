import { useRef, useState } from "react";

// История правок (Фаза 1, Этап 2): тот же snapshot-подход, что раньше жил
// инлайном в MapEditorPage. Без command pattern и патчей: прошлое/будущее —
// снимки целиком, мазок целиком — один шаг. Camera/view state сюда не входит.
export const MAP_HISTORY_DEFAULT_DEPTH = 50;

interface UseMapHistoryArgs<T> {
  value: T;
  onChange: (next: T) => void;
  clone: (v: T) => T;
  depth?: number;
  getValue?: () => T;
}

export function useMapHistory<T>({ value, onChange, clone, depth = MAP_HISTORY_DEFAULT_DEPTH, getValue }: UseMapHistoryArgs<T>) {
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const strokeRef = useRef<{ before: T; changed: boolean } | null>(null);
  const paintingRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Новое изменение поверх текущего: будущее (redo) сгорает.
  function push(before: T) {
    pastRef.current.push(before);
    if (pastRef.current.length > depth) pastRef.current.shift();
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function undo() {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(clone(getValue ? getValue() : valueRef.current));
    onChange(prev);
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(true);
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(clone(getValue ? getValue() : valueRef.current));
    onChange(next);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }

  function clear() {
    pastRef.current = [];
    futureRef.current = [];
    strokeRef.current = null;
    paintingRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
  }

  // Мазок: snapshot до первого изменения, коммит — один шаг, если красило.
  function beginStroke() {
    strokeRef.current = { before: clone(getValue ? getValue() : valueRef.current), changed: false };
    paintingRef.current = true;
  }

  // Вызывать, когда paintAt вернул true. Вне мазка — no-op, как раньше
  // (там стоял гард `&& strokeRef.current`).
  function markStrokeChanged() {
    if (strokeRef.current) strokeRef.current.changed = true;
  }

  function commitStroke() {
    const s = strokeRef.current;
    strokeRef.current = null;
    paintingRef.current = false;
    if (s && s.changed) push(s.before);
  }

  function isPainting() {
    return paintingRef.current;
  }

  function cancelStroke() {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    paintingRef.current = false;
    if (stroke?.changed) onChange(stroke.before);
  }

  return {
    push,
    undo,
    redo,
    clear,
    beginStroke,
    markStrokeChanged,
    commitStroke,
    cancelStroke,
    isPainting,
    canUndo,
    canRedo,
  };
}
