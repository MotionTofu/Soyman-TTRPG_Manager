import { useResource, write } from "./data/hooks";

// Верстак — один сохраняемый черновик печати на сервере (гриллинг 2026-11-11,
// В1–В18; .scratch/web-sources/extension-decisions.md).

export interface WorkbenchBlock {
  id: string;
  position: number;
  kind: "fragment" | "card" | "text" | "page_break";
  width: "full" | "half";
  title: string;
  text: string;
  url: string | null;
  page_title: string | null;
  captured_at: string | null;
  show_source: number;
  entry_id: number | null;
  card_mode: "description" | "card" | null;
  client_id: string | null;
  revision: number;
}

export const WORKBENCH_PATH = "/workbench/blocks";
export const WORKBENCH_AFFECTS = [{ path: WORKBENCH_PATH }] as const;

/**
 * Черновик. Опрос — потому что фрагменты кладёт и расширение браузера, из
 * другого приложения: правки окон SoyMan долетают и без него.
 */
export function useWorkbench(options?: { pollMs?: number; enabled?: boolean }) {
  return useResource<WorkbenchBlock[]>(options?.enabled === false ? null : WORKBENCH_PATH, { pollMs: options?.pollMs });
}

/** Карточки компендиума — в конец черновика; уже лежащие не повторяются (В10). */
export function addCardsToWorkbench(entryIds: number[]) {
  return write.post<{ added: number; count: number }>("/workbench/cards", { entry_ids: entryIds });
}
