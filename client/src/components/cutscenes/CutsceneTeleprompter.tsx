import { useId, useState, type CSSProperties } from "react";
import type { CutsceneNarration } from "../../cutscenes/ports";
import { useCutscenePlayback } from "../../cutscenes/useCutscenePlayback";
import { createTeleprompterCursor, type TeleprompterCursor } from "../../cutscenes/teleprompter";
import { useTeleprompterScroll } from "../../cutscenes/useTeleprompterScroll";
import { useTeleprompterFont } from "../../cutscenes/useTeleprompterFont";
import { useCurrentUser } from "../../api/currentUser";
import { MentionText } from "../mentions/MentionText";
import "../../rich-text.css";
import "./cutscene-teleprompter.css";

const cursors = new WeakMap<object, TeleprompterCursor>();
/** At the table: two buttons and the current value, no typing. */
function Stepper({ label, value, unit, step, min, max, less, more, disabled = false, onChange }: {
  label: string; value: number; unit: string; step: number; min: number; max: number; less: string; more: string; disabled?: boolean; onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return <div className="cutscene-teleprompter__stepper" role="group" aria-label={label}>
    <button type="button" disabled={disabled || value <= min} onClick={() => set(value - step)}>{less}</button>
    <output aria-live="polite">{value} {unit}</output>
    <button type="button" disabled={disabled || value >= max} onClick={() => set(value + step)}>{more}</button>
  </div>;
}

export interface TeleprompterViewProps {
  readonly hideNotes?: boolean;
  readonly identity: string;
  readonly narration: CutsceneNarration;
  readonly notes: string;
  readonly fontSize: number;
  readonly controlsEnabled: boolean;
  readonly onTextPaused: (paused: boolean) => void;
  readonly onWordsPerMinute: (value: number) => void;
  readonly onFontSize: (value: number) => void;
  readonly cursor?: TeleprompterCursor;
}

/** Layout shared by playback and rehearsal. No navigation, audio or global keyboard handlers live here. */
export function TeleprompterView({ identity, narration, notes, fontSize, controlsEnabled,
  onTextPaused, onWordsPerMinute, onFontSize, cursor, hideNotes = false }: TeleprompterViewProps) {
  const heading = useId(), notesHeading = useId();
  const [localCursor] = useState(createTeleprompterCursor);
  const hasText = !!narration.text?.trim();
  const { viewport, content, status } = useTeleprompterScroll({ identity, text: narration.text, paused: narration.paused || !hasText,
    wordsPerMinute: narration.wordsPerMinute, fontSize, cursor: cursor ?? localCursor, onManual: () => { if (hasText) onTextPaused(true); } });
  const label = !hasText ? "Текст скрыт" : narration.locallyPaused ? "Пауза текста" : narration.paused ? "Пауза катсцены"
    : !status.overflowing ? "Текст целиком на экране" : status.atEnd ? "Конец текста" : "Автопрокрутка";
  return <section className="cutscene-teleprompter" aria-label="Телесуфлёр">
    <header className="cutscene-teleprompter__toolbar">
      <div className="cutscene-teleprompter__heading">
        <h2 id={heading}>Текст ведущего</h2>
        <span className="cutscene-teleprompter__status" role="status">{label}</span>
      </div>
      <div className="cutscene-teleprompter__controls">
        <Stepper label="Размер текста" unit="px" value={fontSize} step={2} min={12} max={96} less="A−" more="A+" onChange={onFontSize} />
        <Stepper label="Темп чтения" unit="слов/мин" value={narration.wordsPerMinute} step={10} min={20} max={400}
          less="Медленнее" more="Быстрее" disabled={!controlsEnabled} onChange={onWordsPerMinute} />
        <button type="button" className="btn btn-secondary" disabled={!controlsEnabled || !hasText}
          aria-pressed={narration.locallyPaused} onClick={() => onTextPaused(!narration.locallyPaused)}>
          {narration.locallyPaused ? "Продолжить текст" : "Пауза текста"}
        </button>
      </div>
    </header>
    <div className={`cutscene-teleprompter__columns${hideNotes ? " cutscene-teleprompter__columns--reading-only" : ""}`}>
      <div ref={viewport} className="cutscene-teleprompter__viewport" role="region" aria-labelledby={heading} tabIndex={0}
        data-text-generation={identity} data-text-end={status.atEnd}>
        <div ref={content} className="cutscene-teleprompter__prose reading-text"
          style={{ "--cutscene-reading-font": `${fontSize}px` } as CSSProperties}>
          {hasText ? <MentionText text={narration.text!} mentionsAsBold />
            : <p className="cutscene-teleprompter__empty">На этом шаге нет текста для чтения.</p>}
        </div>
      </div>
      {!hideNotes && <aside className="cutscene-teleprompter__notes" aria-labelledby={notesHeading}>
        <h3 id={notesHeading}>Заметки шага</h3>
        <div className="cutscene-teleprompter__notes-body reading-text">
          {notes.trim() ? <MentionText text={notes} mentionsAsBold /> : <p className="muted">Заметок к шагу нет.</p>}
        </div>
      </aside>}
    </div>
  </section>;
}

export function CutsceneTeleprompter({ hideNotes = false }: { hideNotes?: boolean } = {}) {
  const { controller, state } = useCutscenePlayback();
  const { user } = useCurrentUser();
  const [fontSize, setFontSize] = useTeleprompterFont(user?.id ?? null);
  let cursor = cursors.get(controller);
  if (!cursor) { cursor = createTeleprompterCursor(); cursors.set(controller, cursor); }
  if (user?.role !== "gm") return null;
  const enabled = !!state.run && !state.run.endedAt && ["playing", "paused", "preparing", "error"].includes(state.phase);
  return <TeleprompterView hideNotes={hideNotes} identity={`${state.run?.snapshot.runId ?? "ready"}:${state.narration.generation}`}
    narration={state.narration} notes={state.notes} fontSize={fontSize} controlsEnabled={enabled} cursor={cursor}
    onTextPaused={paused => { void controller.setTextPaused(paused); }}
    onWordsPerMinute={value => controller.setWordsPerMinute(value)} onFontSize={setFontSize} />;
}
