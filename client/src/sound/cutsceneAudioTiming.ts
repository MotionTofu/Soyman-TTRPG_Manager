import type { CutsceneAudioCommand } from "@shared/cutscenes/types";

export interface FragmentTiming {
  start: number; end: number; length: number;
  fadeIn: number; endFade: number; loopCrossfade: number; loopOut: number; loopIn: number;
}
export function fragmentTiming(command: CutsceneAudioCommand, duration: number): FragmentTiming {
  const end = command.endSeconds ?? duration, start = command.startSeconds;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start) || !Number.isFinite(end) ||
    start < 0 || start >= end || end > duration) throw new Error("Фрагмент выходит за границы аудиофайла");
  const times = [command.transition.fadeInMs, command.transition.fadeOutMs, command.endFadeOutMs,
    ...(command.loop.transition.mode === "crossfade" ? [command.loop.transition.durationMs] :
      command.loop.transition.mode === "sequential" ? [command.loop.transition.fadeInMs, command.loop.transition.fadeOutMs] : [])];
  if (times.some(t => !Number.isFinite(t) || t < 0) || !Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1) {
    throw new Error("Некорректные настройки звука катсцены");
  }
  const length = end - start, fade = (ms: number) => Math.min(length, ms / 1000);
  // Owner decision, 2026-10-25: shorten at runtime; preserve the author's saved values.
  return { start, end, length, fadeIn: fade(command.transition.fadeInMs), endFade: fade(command.endFadeOutMs),
    loopCrossfade: command.loop.transition.mode === "crossfade" ? Math.min(length / 2, command.loop.transition.durationMs / 1000) : 0,
    loopOut: command.loop.transition.mode === "sequential" ? fade(command.loop.transition.fadeOutMs) : 0,
    loopIn: command.loop.transition.mode === "sequential" ? fade(command.loop.transition.fadeInMs) : 0 };
}
export const unitGain = (value: number): number => Math.max(0, Math.min(1, value));
export function fragmentGain(timing: FragmentTiming, command: CutsceneAudioCommand, position: number, repeated: boolean): number {
  const remaining = timing.end - position;
  if (!command.loop.enabled) return timing.endFade === 0 ? 1 : unitGain(remaining / timing.endFade);
  if (command.loop.transition.mode === "sequential") return Math.min(
    timing.loopOut === 0 ? 1 : unitGain(remaining / timing.loopOut),
    !repeated || timing.loopIn === 0 ? 1 : unitGain((position - timing.start) / timing.loopIn));
  if (command.loop.transition.mode === "crossfade" && timing.loopCrossfade > 0) return Math.min(
    unitGain(remaining / timing.loopCrossfade), repeated ? unitGain((position - timing.start) / timing.loopCrossfade) : 1);
  return 1;
}
