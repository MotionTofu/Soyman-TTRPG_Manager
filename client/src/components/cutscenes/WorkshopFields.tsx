import { useContext, useId, useState, type ReactNode } from "react";
import { WorkshopValidityContext } from "../../cutscenes/workshopValidity";
import type { CutsceneAudioTransition, CutsceneVisualTransition } from "@shared/cutscenes/types";

export function WorkshopNumber({ label, value, onChange, min = 0, max, step = "any", nullable = false, path }: {
  label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; step?: number | "any"; nullable?: boolean; path?: readonly string[];
}) {
  const context = useContext(WorkshopValidityContext), key = JSON.stringify(path ?? [label]), errorId = useId();
  const [raw, setRaw] = useState<string | null>(() => context?.read(key) ?? null);
  const text = raw ?? (value === null ? "" : String(value));
  const number = Number(text.replace(",", "."));
  const valid = text.trim() === "" ? nullable : Number.isFinite(number) && number >= min && (max === undefined || number <= max);
  return <label>{label}<input data-draft-path={path ? key : undefined} type="text" inputMode="decimal" aria-invalid={!valid}
    aria-describedby={!valid ? errorId : undefined} value={text} placeholder={nullable ? "До конца файла" : undefined}
    onBlur={() => { if (valid) setRaw(null); }} onChange={event => {
      const nextText = event.target.value, next = Number(nextText.replace(",", ".")); setRaw(nextText);
      const ok = nextText.trim() === "" ? nullable : Number.isFinite(next) && next >= min && (max === undefined || next <= max);
      context?.report(key, nextText, !ok);
      if (ok) onChange(nextText.trim() === "" ? null : next);
    }} data-number-step={step} />
    {!valid && <span id={errorId} className="cs-number-error">Правка не применена. Введите число{Number.isFinite(min) ? ` от ${min}` : ""}{max !== undefined ? ` до ${max}` : ""}.</span>}
  </label>;
}
export function WorkshopSeconds({ label, ms, onChange, path }: { label: string; ms: number; onChange: (ms: number) => void; path?: readonly string[] }) {
  return <WorkshopNumber path={path} label={`${label}, с`} value={ms / 1000} onChange={value => onChange((value ?? 0) * 1000)} />;
}
export function VisualTransitionFields({ value, onChange, path }: { value: CutsceneVisualTransition; onChange: (value: CutsceneVisualTransition) => void; path?: readonly string[] }) {
  return <div className="cs-fields"><label>Переход изображения<select data-draft-path={path ? JSON.stringify([...path,'kind']) : undefined} value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as CutsceneVisualTransition["kind"] })}>
    <option value="cut">Резко</option><option value="fade">Растворение</option><option value="black">Через чёрный экран</option>
  </select></label>{value.kind !== "cut" && <WorkshopSeconds path={path && [...path,'durationMs']} label="Длительность перехода" ms={value.durationMs} onChange={durationMs => onChange({ ...value, durationMs })} />}
    {value.kind === "black" && <p className="muted">Общее время: половина на уход в чёрное, половина на появление.</p>}</div>;
}
export function AudioTransitionFields({ value, onChange, path }: { value: CutsceneAudioTransition; onChange: (value: CutsceneAudioTransition) => void; path?: readonly string[] }) {
  return <div className="cs-fields"><label>Способ смены звука<select data-draft-path={path ? JSON.stringify([...path,'mode']) : undefined} value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as CutsceneAudioTransition["mode"] })}>
    <option value="crossfade">Перекрёстный</option><option value="sequential">Последовательный</option>
  </select></label><WorkshopSeconds path={path && [...path,'fadeOutMs']} label="Затухание предыдущего" ms={value.fadeOutMs} onChange={fadeOutMs => onChange({ ...value, fadeOutMs })} />
    <WorkshopSeconds path={path && [...path,'fadeInMs']} label="Нарастание нового" ms={value.fadeInMs} onChange={fadeInMs => onChange({ ...value, fadeInMs })} /></div>;
}
export function WorkshopFieldGroup({ path, children, className = "" }: { path: readonly string[]; children: ReactNode; className?: string }) {
  return <div className={className} data-draft-path={JSON.stringify(path)}>{children}</div>;
}
