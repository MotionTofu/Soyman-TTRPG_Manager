import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Черновик поля поверх значения из кэша (docs/adr/0001, п. 5).
 *
 * Поле сохраняется по уходу из него, а значение под ним может смениться извне:
 * правка из другого окна, перечитывание после соседней правки. Пока Мастер в
 * поле, пришедшее значение не подставляется — иначе оно затёрло бы набранное.
 * Когда он уходит:
 * - поле правили — набранное остаётся и уходит на сохранение;
 * - не правили — подставляется то, что пришло, пока он в нём стоял.
 *
 * `hold` — на фокус, `release` — на уход, до сохранения.
 */
export function useFieldDraft(value: string): {
  draft: string;
  setDraft: (next: string) => void;
  hold: () => void;
  release: () => void;
} {
  const [draft, setDraftState] = useState(value);
  const draftRef = useRef(value);
  const heldRef = useRef(false);
  const heldFromRef = useRef(value);
  const latestRef = useRef(value);

  const setDraft = useCallback((next: string) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  useEffect(() => {
    latestRef.current = value;
    if (!heldRef.current) setDraft(value);
  }, [value, setDraft]);

  const hold = useCallback(() => {
    heldRef.current = true;
    heldFromRef.current = draftRef.current;
  }, []);

  const release = useCallback(() => {
    heldRef.current = false;
    if (draftRef.current === heldFromRef.current && latestRef.current !== draftRef.current) {
      setDraft(latestRef.current);
    }
  }, [setDraft]);

  return { draft, setDraft, hold, release };
}
