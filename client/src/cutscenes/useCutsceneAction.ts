import { useCallback, useEffect, useRef } from "react";
import { dismissNotice, labelled, showSaveError } from "../data/notices";

/** Existing save notices, scoped to this control. Repeating the form uses its current draft. */
export function useCutsceneAction() {
  const notice = useRef<number | null>(null);
  useEffect(() => () => { if (notice.current !== null) dismissNotice(notice.current); }, []);
  return useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await labelled(label, action)();
      if (notice.current !== null) dismissNotice(notice.current); notice.current = null;
      return result;
    } catch (error) {
      if (notice.current !== null) dismissNotice(notice.current);
      notice.current = showSaveError(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, []);
}
