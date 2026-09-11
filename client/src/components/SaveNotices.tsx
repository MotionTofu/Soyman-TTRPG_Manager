import { dismissNotice, retryNotice, useSaveNotices } from "../data/notices";

/**
 * Стопка плашек «Не сохранилось» в углу экрана (docs/adr/0001, п. 3).
 *
 * Монтируется один раз в корне приложения. Экран не перекрывает и фокус не
 * забирает: Мастер может дописать то, что писал, и нажать «Повторить», когда
 * будет минута. `role="status"` без `aria-live="assertive"` — ошибка
 * объявляется, но не перебивает то, что сейчас читается.
 */
export function SaveNotices() {
  const notices = useSaveNotices();
  if (notices.length === 0) return null;
  return (
    <div className="save-notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className="save-notice">
          <span className="save-notice__msg">
            <strong>Не сохранилось:</strong> {n.message}
          </span>
          <span className="save-notice__actions">
            {n.retry && (
              <button
                type="button"
                className="save-notice__retry"
                disabled={n.retrying}
                onClick={() => void retryNotice(n.id)}
              >
                {n.retrying ? "Повторяю…" : "Повторить"}
              </button>
            )}
            <button
              type="button"
              className="save-notice__close"
              aria-label="Скрыть сообщение"
              onClick={() => dismissNotice(n.id)}
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
