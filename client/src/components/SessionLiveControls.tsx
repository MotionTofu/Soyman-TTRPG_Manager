import { errorText, useAction, useResource, write } from "../data/hooks";
import { sessionMoneyAffects, sessionPaths } from "../data/sessions";
import { useConfirm } from "../hooks/useConfirm";
import type { LiveSession, SessionDetail, SessionLiveMode } from "../types";
import "./SessionNotesChat.css";
import { showSaveError } from "../data/notices";
import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { useCombat } from "../combat/useCombat";
import { setCombatModeOpen } from "../combat/combatModeStore";
import { useSoundEngineOptional } from "../sound/engine";

// «Начать» / «Завершить» (гриллинг 2026-09-28, Q38, Q45, Q46). Идёт одна
// сессия на всё приложение: по ней правая панель знает, куда писать ленту.
// «Завершить» — бывшее «Сохранить и завершить сессию» из карточки «Основных
// событий»: сессия становится проведённой, окно итога — по настройке Пульта.

export function SessionLiveControls({
  session,
  onFinished,
  pult,
}: {
  session: SessionDetail;
  onFinished?: () => void;
  /** Кнопка пульта в шапке сессии: встаёт перед «Начать», чтобы главная
   *  кнопка была последней (макет Roll-Prep, Q2). Кнопки — вида «Д». */
  pult?: ReactNode;
}) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  const combat = useCombat(session.id);
  const sound = useSoundEngineOptional();
  // «Завершить» посреди боя (Q24, Q74): закончить бой или продолжить его в следующей сессии.
  const [battleAsk, setBattleAsk] = useState(false);
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
    if (session.live_mode !== "rehearsal" && session.combat_active) {
      setBattleAsk(true);
      return;
    }
    await finishSession();
  }

  async function endBattleThenFinish() {
    setBattleAsk(false);
    await combat.stopCombat();
    await finishSession();
  }

  async function carryThenFinish() {
    setBattleAsk(false);
    const carried = await run(() => write.post(`/sessions/${session.id}/combat/carry`, {}), {
      affects: [{ kind: "session" }, { path: "/initiative-entries" }],
    });
    if (carried === undefined) return;
    setCombatModeOpen(session.id, false);
    sound?.exitCombat();
    await finishSession();
  }

  async function finishSession() {
    const rehearsal = session.live_mode === "rehearsal";
    const done = await run(() => write.post(`/sessions/${session.id}/live`, { mode: null }), {
      affects: rehearsal ? [] : affects,
    });
    if (done !== undefined && !rehearsal) onFinished?.();
  }

  // Проведённую или отменённую не начинают: кнопка на странице такой сессии
  // была бы лишним органом управления.
  if (!session.live_mode && session.status !== "planned") return pult ? <>{pult}</> : null;
  // Кнопки «Д»: малые; главная (кислота) — только «Начать» в шапке сессии.
  // На Пульте «идёт» говорят часы, значок там лишний.
  const sm = "d-btn d-btn--sm";

  return (
    <div className="row session-live-controls">
      {dialog}
      {battleAsk && (
        <Modal onClose={() => setBattleAsk(false)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Бой не закончен</h3>
            <p style={{ margin: 0 }}>
              Идёт {combat.battle ? <b>«{combat.battle.name}»</b> : "бой"}: раунд {session.combat_round || 1}, в строю{" "}
              {combat.aliveSorted.filter((e) => e.kind === "creature").length}.
            </p>
            <p style={{ margin: 0 }}>
              {combat.battle?.carry_target
                ? `Продолжить — бойцы со всеми хитами, эффектами и счётчиками переедут в сессию ${combat.battle.carry_target.number} (${new Date(`${combat.battle.carry_target.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}); её пульт откроется в боевом режиме.`
                : "Следующей сессии кампании ещё нет — бой встанет в первую, которую заведёте, и её пульт откроется в боевом режиме."}
            </p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setBattleAsk(false)}>
                Отмена
              </button>
              <button type="button" onClick={() => void endBattleThenFinish()}>
                Завершить бой
              </button>
              <button type="button" className="primary" autoFocus onClick={() => void carryThenFinish()}>
                {combat.battle?.carry_target ? `Продолжить в сессии ${combat.battle.carry_target.number}` : "Продолжить в следующей"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {session.live_mode === "rehearsal" ? (
        <>
          {pult && <span className="session-live-controls__badge">Прогон</span>}
          <button type="button" className={sm} onClick={() => void finish()}>
            Закончить прогон
          </button>
          {pult}
        </>
      ) : session.live_mode ? (
        <>
          {pult && <span className="session-live-controls__badge">Идёт</span>}
          <button type="button" className={sm} onClick={() => void finish()}>
            Завершить
          </button>
          {pult}
        </>
      ) : pult ? (
        <>
          <button
            type="button"
            className={sm}
            title="Всё как в игре, но игроки ничего не видят, а после «Закончить прогон» вечер возвращается как был"
            onClick={() => void start("rehearsal")}
          >
            Тестовый прогон
          </button>
          {pult}
          <button type="button" className="d-btn d-btn--primary" onClick={() => void start("live")}>
            Начать
          </button>
        </>
      ) : (
        <>
          <button type="button" className={sm} onClick={() => void start("live")}>
            Начать
          </button>
          <button
            type="button"
            className={sm}
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
