import type { SessionStatus } from "./types";

/**
 * Как зовётся сессия там, где нужно её назвать.
 *
 * Номер — запасное имя: если Мастер дал игре название, побеждает оно. Так это
 * работало и раньше (`title || "Сессия №N"`), просто было переписано в дюжине
 * мест; здесь одно.
 *
 * Отменённые считаются отдельно от сыгранных (см. SESSION_NUMBER_SQL на
 * сервере) и называются «Отменённая №N». Вариант «Сессия №7 (отменена)»
 * отклонён: он читается как седьмая игра, которую заодно отменили, — то есть
 * смешивает две нумерации, которые мы как раз развели.
 */
export function sessionLabel(session: {
  title?: string | null;
  session_number?: number | null;
  status?: SessionStatus | string | null;
}): string {
  const title = session.title?.trim();
  if (title) return title;
  const n = session.session_number ?? "";
  return session.status === "cancelled" ? `Отменённая №${n}` : `Сессия №${n}`;
}
