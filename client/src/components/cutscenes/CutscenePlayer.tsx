import { useEffect, useMemo, useRef, useState } from "react";
import type { CutsceneStep } from "@shared/cutscenes/types";
import { cutsceneStepLabel, resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutscenePlaybackController } from "../../cutscenes/controller";
import type { CutscenePlaybackState } from "../../cutscenes/ports";
import { useCutscenePlayback } from "../../cutscenes/useCutscenePlayback";
import { useCutsceneKeyboard } from "../../cutscenes/useCutsceneKeyboard";
import { useCurrentUser } from "../../api/currentUser";
import { useAudioOwnership } from "../../sound/audioOwnership";
import { useResource } from "../../data/hooks";
import type { CutsceneRunState } from "@shared/cutscenes/runApi";
import { useIsMobile } from "../../hooks/useIsMobile";
import "./cutscene-readiness.css";
import { Modal } from "../Modal";
import { CutsceneTeleprompter } from "./CutsceneTeleprompter";
import { CutscenePreview } from "./CutscenePreview";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";
import { MentionText } from "../mentions/MentionText";
import "./cutscene-player.css";

/** "Шаг 3" or "3 · Берез": the number stays visible next to a name. */
function stepTitle(step: CutsceneStep, index: number): string {
  const label = cutsceneStepLabel(step, index);
  return label === `Шаг ${index + 1}` ? label : `${index + 1} · ${label}`;
}

/** The full-window GM controls. Playback belongs to the existing host, including during focus changes. */
export function CutscenePlayerView({ controller, state }: { controller: CutscenePlaybackController; state: CutscenePlaybackState }) {
  const [menu, setMenu] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const version = state.run?.snapshot.version, document = version?.document;
  const index = state.step?.stepIndex ?? -1, total = document?.steps.length ?? 0;
  const frames = useMemo(() => document?.steps.map(step => resolveCutsceneStep(document, step.id)?.image.composition ?? null) ?? [], [document]);
  const navigable = state.phase === "playing" && !state.busy;
  const canPause = state.phase === "playing" || state.phase === "preparing" || state.phase === "paused";
  const active = !!state.run && !state.run.endedAt;
  const canFinish = !state.busy && active && !!state.step;
  const canInterrupt = active && state.phase !== "finishing";
  const next = document && index >= 0 && index < total - 1 ? document.steps[index + 1] : null;
  const openMenu = () => {
    if (!canPause) return;
    setMenu(true);
    if (state.phase !== "paused") void controller.pause();
  };
  const resume = () => { void controller.resume().then(ok => { if (ok) setMenu(false); }); };
  const togglePause = () => { if (state.phase === "paused") resume(); else if (canPause) void controller.pause(); };
  useCutsceneKeyboard(command => {
    if (command === "next" && navigable && index >= 0 && index < total - 1) void controller.next();
    else if (command === "previous" && navigable && index > 0) void controller.previous();
    else if (command === "pause") togglePause();
    else if (command === "text" && state.narration.text && !state.run?.endedAt) void controller.setTextPaused(!state.narration.locallyPaused);
    else if (command === "menu") openMenu();
  });
  useEffect(() => { if (menu && !state.busy) continueButton.current?.focus(); }, [menu, state.busy]);
  const thumb = (i: number) => version && <span className="cutscene-player__thumb" aria-hidden="true"><CutsceneDraftFrame id={version.cutsceneId} composition={frames[i] ?? null} /></span>;
  return <Modal ariaLabel="Показ катсцены" className="cutscene-player" autoFocus={false} closeOnBackdropClick={false} onClose={openMenu}>
    <header className="cutscene-player__header">
      <div className="cutscene-player__title"><span>{state.run?.snapshot.mode === "rehearsal" ? "Репетиция" : "Показ игрокам"}</span>
        <h1>{document?.name ?? state.original?.document.name}</h1></div>
      <span className="cutscene-player__step" aria-live="polite">{index < 0 ? "Подготовка показа…" : `Шаг ${index + 1} из ${total}`}</span>
      <div className="cutscene-player__actions">
        <button type="button" className="btn btn-secondary" disabled={!canPause || state.busy && state.phase === "paused"} onClick={togglePause}>
          {state.phase === "paused" ? "Продолжить катсцену" : "Пауза катсцены"} <kbd>P</kbd>
        </button>
        <button type="button" className="btn btn-secondary" disabled={!canFinish} onClick={() => { void controller.complete(); }}>Завершить</button>
      </div>
    </header>
    <div className="cutscene-player__body">
      <div className="cutscene-player__reader"><CutsceneTeleprompter hideNotes /></div>
      <aside className="cutscene-player__side" aria-label="Управление шагами">
        <CutscenePreview state={state} /><section className="cutscene-player__notes"><h2>Заметки шага</h2><span className="muted">Только ведущему</span><div className="reading-text">{state.notes.trim() ? <MentionText text={state.notes} mentionsAsBold /> : <p className="muted">Заметок нет.</p>}</div></section>
        <nav className="cutscene-player__steps" aria-label="Шаги катсцены"><ol>
          {document?.steps.map((step, i) => <li key={step.id}><button type="button" aria-current={i === index ? "step" : undefined} disabled={!navigable || i === index}
            className={i < index ? "is-past" : undefined} onClick={() => { void controller.goTo(step.id); }}>{thumb(i)}<span>{stepTitle(step, i)}</span></button></li>)}
        </ol></nav>
        <div className="cutscene-player__navigation">
          <button type="button" className="primary cutscene-player__next" disabled={!navigable || !next} onClick={() => { void controller.next(); }}>
            {next ? <>{thumb(index + 1)}<span><b>Далее <kbd>Пробел</kbd></b><span>{stepTitle(next, index + 1)}</span></span></>
              : index < 0 ? <span><b>Далее <kbd>Пробел</kbd></b><span>Подготовка первого шага…</span></span>
              : <span><b>Последний шаг</b><span>Дальше — «Завершить»</span></span>}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!navigable || index <= 0} onClick={() => { void controller.previous(); }}>Назад <kbd>←</kbd></button>
        </div>
        {(state.phase === "paused" || state.busy) && <p className="muted">{state.phase === "paused" ? "Показ на паузе. Продолжите, чтобы переключать шаги." : "Подготовка…"}</p>}
        <p className="cutscene-player__help"><kbd>T</kbd> пауза текста · <kbd>Esc</kbd> меню: продолжить, завершить, прервать</p>
        {state.error && <div role="alert" className="cutscene-player__error"><p>{state.error.message}</p>
          <button type="button" className="btn btn-secondary" disabled={state.busy} onClick={() => { void controller.retry(); }}>Повторить</button></div>}
      </aside>
    </div>
    {menu && <Modal className="cutscene-player__pause" ariaLabel="Меню паузы" autoFocus={false} closeOnBackdropClick={false} onClose={openMenu}>
        <h2>Пауза катсцены</h2>
        <p>{state.run?.snapshot.mode === "rehearsal" ? "Репетиция на паузе." : "Изображение остаётся на экране игроков."}</p>
        <button ref={continueButton} type="button" className="primary" disabled={state.phase !== "paused" || state.busy} onClick={resume}>Продолжить</button>
        <button type="button" className="btn btn-secondary" disabled={!canFinish} onClick={() => { void controller.complete(); }}>Завершить</button>
        <hr />
        <button type="button" className="btn btn-secondary danger" disabled={!canInterrupt} onClick={() => { void controller.interrupt(); }}>Прервать и вернуться</button>
    </Modal>}
  </Modal>;
}

export function CutscenePlayer() {
  const { controller, state } = useCutscenePlayback(), { user } = useCurrentUser();
  const mobile = useIsMobile();
  const activeRun = useResource<CutsceneRunState | null>(user?.role === "gm" && !mobile ? "/cutscene-runs/active" : null, { pollMs: 2000 });
  useEffect(() => { if (user?.role === "gm" && !mobile && activeRun.data !== undefined) void controller.discover(); }, [controller, user?.role, mobile, activeRun.data]);
  const lease = useAudioOwnership(), owner = state.run?.snapshot.ownership;
  const owned = !!lease && !!owner && lease.owner.runId === owner.runId && lease.owner.controllerId === owner.controllerId;
  if (user?.role !== "gm" || mobile) return null;
  if (state.phase === "recoverable") return <aside className="cs-recovery" aria-label="Восстановление катсцены">
    <p>{state.run?.snapshot.mode === "rehearsal" ? "Незавершённая репетиция" : "Незавершённый показ"}: <strong>{state.run?.snapshot.version.document.name}</strong>. Восстановление откроет сохранённый шаг на паузе.</p>
    <button type="button" disabled={state.busy} onClick={() => void controller.recover()}>Восстановить на паузе</button>
    {state.error && <p role="alert">{state.error.message}</p>}
  </aside>;
  if (!owned || !["ready", "playing", "paused", "preparing", "error", "finishing"].includes(state.phase)) return null;
  return <CutscenePlayerView key={state.run!.snapshot.runId} controller={controller} state={state} />;
}

import "./cutscene-studio.css";
