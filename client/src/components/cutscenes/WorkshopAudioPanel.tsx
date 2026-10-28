import { useContext, useEffect, useState } from "react";
import type { CutsceneAudioCommand, CutsceneLoopTransition } from "@shared/cutscenes/types";
import { CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";
import { useResource } from "../../data/hooks";
import { workshopMediaPath, type WorkshopMedia } from "../../data/cutsceneMedia";
import { useWorkshopPreview } from "../../cutscenes/useWorkshopPreview";
import { WorkshopValidityContext } from "../../cutscenes/workshopValidity";
import { CutsceneMediaPicker } from "./CutsceneMediaPicker";
import { AudioTransitionFields, WorkshopNumber, WorkshopSeconds } from "./WorkshopFields";
import { WorkshopWaveform } from "./WorkshopWaveform";

export function WorkshopAudio({ id, stepId, value, onChange, readOnly = false }: {
  id: number; stepId: string; value: CutsceneAudioCommand; onChange: (value: CutsceneAudioCommand) => void; readOnly?: boolean;
}) {
  const [picker, setPicker] = useState(false), [decodedDuration, setDuration] = useState<number | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const media = useResource<WorkshopMedia[]>(workshopMediaPath(id)), { controller, state } = useWorkshopPreview();
  const context = useContext(WorkshopValidityContext);
  const info = media.data?.find(item => item.ref.id === value.audio.id), loop = value.loop.transition;
  const duration = decodedDuration ?? info?.durationSeconds ?? null, end = value.endSeconds ?? duration;
  const path = ["steps", stepId, "audio", "command"], invalidKey = JSON.stringify([...path, "fragment"]);
  const rangeInvalid = value.startSeconds < 0 || (end !== null && (end <= value.startSeconds || (duration !== null && end > duration)));
  useEffect(() => { setDuration(null); setRange(null); }, [value.audio.id]);
  useEffect(() => { context?.report(invalidKey, `${value.startSeconds}/${value.endSeconds}`, rangeInvalid); }, [context, invalidKey, rangeInvalid, value.startSeconds, value.endSeconds]);
  const blocked = rangeInvalid || !!context?.invalid(JSON.stringify(["steps", stepId, "audio"]));
  const busy = state.phase === "preparing" || state.phase === "returning";
  const patchLoop = (transition: CutsceneLoopTransition) => onChange({ ...value, loop: { ...value.loop, transition } });
  const length = end !== null ? Math.max(0, (range?.end ?? end) - (range?.start ?? value.startSeconds)) : null;
  return <div className="cs-audio-panel">
    <div className="cs-audio-file"><div><strong>{info?.name ?? "Музыкальный фрагмент"}</strong><span className="muted">{duration === null ? "Длительность определяется" : `${duration.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} с`}{readOnly ? " · Продолжается из другого шага" : ""}</span></div>
      {!readOnly && <button onClick={() => setPicker(true)}>Заменить трек</button>}</div>
    <WorkshopWaveform id={id} value={value} readOnly={readOnly} onDuration={setDuration} onDraft={setRange} onChange={next => onChange({ ...value, startSeconds: next.start, endSeconds: next.end })} />
    <fieldset disabled={readOnly} className="cs-audio-bounds"><WorkshopNumber path={[...path, "startSeconds"]} label="Начало фрагмента, с" value={range?.start ?? value.startSeconds} onChange={number => onChange({ ...value, startSeconds: number ?? 0 })} />
      <WorkshopNumber path={[...path, "endSeconds"]} label="Конец фрагмента, с" nullable value={range?.end ?? value.endSeconds} onChange={endSeconds => onChange({ ...value, endSeconds })} />
      <WorkshopNumber path={[...path, "volume"]} label="Громкость, %" value={value.volume * 100} max={100} onChange={number => onChange({ ...value, volume: (number ?? 0) / 100 })} />
      <div className="cs-fragment-length"><span>Длина фрагмента</span><strong>{length === null ? "Определяется" : `${length.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} с`}</strong></div></fieldset>
    {rangeInvalid && <p className="cs-number-error" role="alert">Правка не применена. Конец должен быть больше начала и не выходить за длительность файла.</p>}
    <div className="cs-audition"><button className="primary" disabled={busy || blocked || !!state.foreign} onClick={() => void controller.play("audition")}>{state.mode === "audition" && state.phase === "playing" ? "Пауза прослушивания" : state.mode === "audition" && state.phase === "paused" ? "Продолжить прослушивание" : "Прослушать фрагмент"}</button>
      <button disabled={state.mode !== "audition"} onClick={() => void controller.stop()}>Стоп прослушивания</button>
      <label className="cs-checkbox"><input type="checkbox" checked={state.auditionLoop} onChange={event => controller.setAuditionLoop(event.target.checked)} />Зациклить прослушивание</label>
    </div><p className="cs-source">При перетаскивании звук приостанавливается. Отпускание границы возобновит уже игравшее прослушивание с нового начала.</p>
    <fieldset disabled={readOnly} className="cs-audio-settings"><section className="stack"><h3>Переход на этот трек</h3><AudioTransitionFields path={[...path, "transition"]} value={value.transition} onChange={transition => onChange({ ...value, transition })} /><p className="cs-source">Переход между треками проверяется в общем превью.</p></section>
      <section className="stack"><h3>Повтор в катсцене</h3><label className="cs-checkbox"><input data-draft-path={JSON.stringify([...path, "loop", "enabled"])} type="checkbox" checked={value.loop.enabled} onChange={event => onChange({ ...value, loop: { ...value.loop, enabled: event.target.checked } })} />Повторять фрагмент</label>
        <label>Способ повтора<select data-draft-path={JSON.stringify([...path, "loop", "transition"])} value={loop.mode} onChange={event => {
          const mode = event.target.value;
          patchLoop(mode === "cut" ? { mode: "cut" } : mode === "sequential" ? { mode: "sequential", fadeOutMs: CUTSCENE_DEFAULTS.audioFadeOutMs, fadeInMs: CUTSCENE_DEFAULTS.audioFadeInMs } : { mode: "crossfade", durationMs: CUTSCENE_DEFAULTS.loopCrossfadeMs });
        }}><option value="cut">Обычный, без плавности</option><option value="crossfade">Перекрытие конца и начала</option><option value="sequential">Затухание и нарастание</option></select></label>
        {loop.mode === "crossfade" && <WorkshopSeconds path={[...path, "loop", "transition", "durationMs"]} label="Склейка повтора" ms={loop.durationMs} onChange={durationMs => patchLoop({ ...loop, durationMs })} />}
        {loop.mode === "sequential" && <div className="cs-fields"><WorkshopSeconds path={[...path, "loop", "transition", "fadeOutMs"]} label="Затухание повтора" ms={loop.fadeOutMs} onChange={fadeOutMs => patchLoop({ ...loop, fadeOutMs })} /><WorkshopSeconds path={[...path, "loop", "transition", "fadeInMs"]} label="Нарастание повтора" ms={loop.fadeInMs} onChange={fadeInMs => patchLoop({ ...loop, fadeInMs })} /></div>}
        {!value.loop.enabled && <WorkshopSeconds path={[...path, "endFadeOutMs"]} label="Затухание перед естественным окончанием" ms={value.endFadeOutMs} onChange={endFadeOutMs => onChange({ ...value, endFadeOutMs })} />}
      </section></fieldset>
    <p className="cs-source">Пустой конец — до конца файла. Окончание звука не переключает шаг. Слишком длинная склейка сокращается до половины фрагмента; остальные нарастания и затухания — до его длины.</p>
    {picker && <CutsceneMediaPicker id={id} kind="audio" title="Музыка шага" onPick={items => onChange({ ...value, audio: { kind: "audio", id: items[0].ref.id } })} onClose={() => setPicker(false)} />}
  </div>;
}
export function WorkshopAudioSummary({ id, stepId, command }: { id: number; stepId?: string; command: CutsceneAudioCommand | null }) {
  return command ? <WorkshopAudio id={id} stepId={stepId ?? command.id} value={command} readOnly onChange={() => {}} /> : <p className="reading-text">Собственный трек не звучит.</p>;
}
