import { useSyncExternalStore } from "react";

/**
 * Плашки «Не сохранилось» (docs/adr/0001, п. 3).
 *
 * Раньше ошибка сохранения в 110 местах открывала модальное окно, которое надо
 * закрыть, прежде чем продолжить. Мастер смотрит на экран урывками: окно
 * посреди сцены мешает, а введённое под ним легко потерять. Плашка встаёт сбоку,
 * экран не перекрывает и держит кнопку «Повторить» до тех пор, пока у Мастера
 * не найдётся минута.
 *
 * Плашка не гаснет сама: ошибка, исчезнувшая до того, как на неё посмотрели, —
 * это та самая «правка выглядела сохранённой». Одинаковые ошибки не множатся:
 * повторная заменяет прежнюю и получает свежую кнопку «Повторить».
 */

export interface SaveNotice {
  id: number;
  message: string;
  /** Что сделать по «Повторить»; без него кнопки нет. */
  retry?: () => Promise<unknown> | unknown;
  /** Идёт повтор — кнопка заблокирована. */
  retrying: boolean;
}

/** Больше этого плашек разом не показывается: старые уступают место. */
export const MAX_NOTICES = 3;

let notices: SaveNotice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SaveNotice[] {
  return notices;
}

/** Текущие плашки без подписки — для кода вне React и для тестов. */
export function getSaveNotices(): readonly SaveNotice[] {
  return notices;
}

/** Показать плашку ошибки сохранения; возвращает её id. */
export function showSaveError(message: string, retry?: SaveNotice["retry"]): number {
  const text = message.trim() || "Неизвестная ошибка";
  const same = notices.find((n) => n.message === text);
  const id = same ? same.id : nextId++;
  const notice: SaveNotice = { id, message: text, retry, retrying: false };
  notices = [...notices.filter((n) => n.id !== id), notice].slice(-MAX_NOTICES);
  emit();
  return id;
}

export function dismissNotice(id: number): void {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  notices = next;
  emit();
}

/** «Повторить»: удалось — плашка уходит, нет — остаётся с новым текстом. */
export async function retryNotice(id: number): Promise<void> {
  const notice = notices.find((n) => n.id === id);
  if (!notice?.retry || notice.retrying) return;
  notices = notices.map((n) => (n.id === id ? { ...n, retrying: true } : n));
  emit();
  try {
    await notice.retry();
    dismissNotice(id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    notices = notices.map((n) => (n.id === id ? { ...n, message: message || n.message, retrying: false } : n));
    emit();
  }
}

export function useSaveNotices(): SaveNotice[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Только для тестов. */
export function resetNoticesForTests(): void {
  notices = [];
  nextId = 1;
  emit();
}
