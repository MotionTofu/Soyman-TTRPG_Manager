import type { CutsceneMediaAccess, CutsceneMediaRef } from "@shared/cutscenes/types";
import { readOnce } from "../data/imperative";

export interface CutsceneAudioAsset {
  readonly duration: number;
  /** Both voices are ready at the fragment start before commit; playback has not begun. */
  readonly voices: readonly [HTMLAudioElement, HTMLAudioElement];
  dispose(): void;
}
export type PrepareCutsceneAudioAsset = (cutsceneId: number, audio: CutsceneMediaRef<"audio">,
  startSeconds: number, signal: AbortSignal) => Promise<CutsceneAudioAsset>;

export function abortAudioPreparation(): DOMException { return new DOMException("Подготовка звука отменена", "AbortError"); }

function ready(audio: HTMLAudioElement, position: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let positioned = false;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      for (const event of ["loadedmetadata", "loadeddata", "canplay", "seeked"]) audio.removeEventListener(event, check);
      audio.removeEventListener("error", failed); signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      if (signal.aborted) return aborted();
      if (audio.readyState < 1) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0 || position >= audio.duration) {
        finish(new Error("Начало фрагмента выходит за границы аудиофайла")); return;
      }
      if (!positioned) { positioned = true; audio.currentTime = position; }
      if (audio.readyState >= 3 && !audio.seeking && Math.abs(audio.currentTime - position) < 0.05) finish();
    };
    const failed = () => finish(new Error("Не удалось подготовить аудиофайл катсцены"));
    const aborted = () => finish(abortAudioPreparation());
    const timeout = setTimeout(() => finish(new Error("Аудиофайл катсцены не готов к воспроизведению")), 30000);
    for (const event of ["loadedmetadata", "loadeddata", "canplay", "seeked"]) audio.addEventListener(event, check);
    audio.addEventListener("error", failed); signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted(); else { audio.load(); check(); }
  });
}

/** Keep compressed bytes in a runtime Blob. Range reads, seeks and long repeats cannot reuse an expired signature. */
export async function loadCutsceneAudioBlob(cutsceneId: number, ref: CutsceneMediaRef<"audio">, signal: AbortSignal): Promise<Blob> {
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await readOnce<CutsceneMediaAccess>(`/cutscenes/${cutsceneId}/media/${encodeURIComponent(ref.id)}/access`, { signal });
    if (signal.aborted) throw abortAudioPreparation();
    const response = await fetch(access.url, { signal, cache: "no-store" });
    if (!response.ok) {
      if (attempt === 0 && (response.status === 401 || response.status === 403)) continue;
      throw new Error(`Аудиофайл катсцены недоступен (${response.status})`);
    }
    blob = await response.blob(); break;
  }
  if (!blob?.size) throw new Error("Аудиофайл катсцены пуст");
  if (signal.aborted) throw abortAudioPreparation();
  return blob;
}

export const prepareCutsceneAudioAsset: PrepareCutsceneAudioAsset = async (cutsceneId, ref, startSeconds, signal) => {
  const blob = await loadCutsceneAudioBlob(cutsceneId, ref, signal);
  const url = URL.createObjectURL(blob);
  const voices = [document.createElement("audio"), document.createElement("audio")] as const;
  const dispose = () => {
    for (const audio of voices) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio.remove(); }
    URL.revokeObjectURL(url);
  };
  try {
    for (const [index, audio] of voices.entries()) {
      audio.dataset.audioChannel = "background"; audio.dataset.cutsceneVoice = String(index);
      audio.hidden = true; audio.preload = "auto"; audio.volume = 0; audio.src = url;
      document.body.append(audio);
    }
    await Promise.all(voices.map(audio => ready(audio, startSeconds, signal)));
    return { duration: voices[0].duration, voices, dispose };
  } catch (error) { dispose(); throw error; }
};
