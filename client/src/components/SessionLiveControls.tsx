import { errorText, useAction, write } from "../data/hooks";
import { sessionMoneyAffects, sessionPaths } from "../data/sessions";
import { useConfirm } from "../hooks/useConfirm";
import type { LiveSession, SessionDetail } from "../types";
import { showSaveError } from "../data/notices";

// «Начать» / «Завершить» (гриллинг 2026-09-28, Q38, Q45, Q46). Идёт одна
// сессия на всё приложение: по ней правая панель знает, куда писать ленту.
// «Завершить» — бывшее «Сохранить и завершить сессию» из карточки «Основных
// событий»: сессия становится проведённой, окно итога — по настройке Пульта.

export function SessionLiveControls({
  session,
  onFinished,
}: {
  session: SessionDetail;
  onFinished?: () => void;
}) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  const affects = [...sessionMoneyAffects(session.id, session.campaign_id), { path: sessionPaths.live() }];

  async function start() {
    const post = (replace: boolean) => write.post(`/sessions/${session.id}/live`, { mode: "live", replace });
    try {
      await post(false);
      await run(async () => true, { affects });
    } catch (e) {
      const err = e as { status?: number; payload?: { live?: LiveSession } };
      const other = err.payload?.live;
      if (err.status !== 409 || !other) {
        showSaveError(`Сессия не началась: ${errorText(e)}`);
        return;
      }
      const ok = await confirm({
        title: "Другая сессия ещё идёт",
        message: `Сессия №${other.session_number} кампании «${other.campaign_name}» не завершена. Завершить её и начать эту?`,
        confirmLabel: "Завершить и начать",
        danger: false,
      });
      if (!ok) return;
      await run(() => post(true), { affects: [...affects, { kind: "session", id: other.id }] });
    }
  }

  async function finish() {
    const done = await run(() => write.post(`/sessions/${session.id}/live`, { mode: null }), { affects });
    if (done !== undefined) onFinished?.();
  }

  // Проведённую или отменённую не начинают: кнопка на странице такой сессии
  // была бы лишним органом управления.
  if (!session.live_mode && session.status !== "planned") return null;

  return (
    <div className="row session-live-controls">
      {dialog}
      {session.live_mode ? (
        <>
          <span className="session-live-controls__badge">Идёт</span>
          <button type="button" onClick={() => void finish()}>
            Завершить
          </button>
        </>
      ) : (
        <button type="button" className="primary" onClick={() => void start()}>
          Начать
        </button>
      )}
    </div>
  );
}
