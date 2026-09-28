import { errorText, useAction, useResource, write } from "../data/hooks";
import { sessionMoneyAffects, sessionPaths } from "../data/sessions";
import { useConfirm } from "../hooks/useConfirm";
import type { LiveSession, SessionDetail, SessionLiveMode } from "../types";
import "./SessionNotesChat.css";
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

  async function start(mode: SessionLiveMode) {
    const post = (replace: boolean) => write.post(`/sessions/${session.id}/live`, { mode, replace });
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
      const otherRehearsal = other.live_mode === "rehearsal";
      const ok = await confirm({
        title: otherRehearsal ? "Идёт тестовый прогон" : "Другая сессия ещё идёт",
        message: otherRehearsal
          ? `Прогон сессии №${other.session_number} кампании «${other.campaign_name}» не закончен. Откатить его и начать эту?`
          : `Сессия №${other.session_number} кампании «${other.campaign_name}» не завершена. Завершить её и начать эту?`,
        confirmLabel: otherRehearsal ? "Откатить и начать" : "Завершить и начать",
        danger: false,
      });
      if (!ok) return;
      // Откат прогона задевает кампанию той сессии целиком — перечитать всё.
      await run(() => post(true), { affects: otherRehearsal ? [] : [...affects, { kind: "session", id: other.id }] });
    }
  }

  async function finish() {
    const rehearsal = session.live_mode === "rehearsal";
    const done = await run(() => write.post(`/sessions/${session.id}/live`, { mode: null }), {
      affects: rehearsal ? [] : affects,
    });
    if (done !== undefined && !rehearsal) onFinished?.();
  }

  // Проведённую или отменённую не начинают: кнопка на странице такой сессии
  // была бы лишним органом управления.
  if (!session.live_mode && session.status !== "planned") return null;

  return (
    <div className="row session-live-controls">
      {dialog}
      {session.live_mode === "rehearsal" ? (
        <>
          <span className="session-live-controls__badge">Прогон</span>
          <button type="button" onClick={() => void finish()}>
            Закончить прогон
          </button>
        </>
      ) : session.live_mode ? (
        <>
          <span className="session-live-controls__badge">Идёт</span>
          <button type="button" onClick={() => void finish()}>
            Завершить
          </button>
        </>
      ) : (
        <>
          <button type="button" className="primary" onClick={() => void start("live")}>
            Начать
          </button>
          <button
            type="button"
            title="Всё как в игре, но игроки ничего не видят, а после «Закончить прогон» вечер возвращается как был"
            onClick={() => void start("rehearsal")}
          >
            Тестовый прогон
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Полоса прогона над любой страницей (Q43, Q47): напоминает, что правки
 * карточек сохранятся, а вечер — нет, и даёт закончить прогон откуда угодно.
 * Незакрытый прогон после перезапуска виден тут же — молча он не висит.
 */
export function RehearsalStrip() {
  const live = useResource<LiveSession | null>(sessionPaths.live()).data ?? null;
  const run = useAction();
  if (live?.live_mode !== "rehearsal") return null;
  return (
    <div className="rehearsal-strip" role="status">
      <span>
        Тестовый прогон · сессия №{live.session_number}, «{live.campaign_name}» · игроки не видят, правки карточек
        сохраняются
      </span>
      <button
        type="button"
        className="comp-mini"
        onClick={() => void run(() => write.post(`/sessions/${live.id}/live`, { mode: null }), { affects: [] })}
      >
        Закончить прогон
      </button>
    </div>
  );
}
