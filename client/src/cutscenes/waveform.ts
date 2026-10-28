import type { CutsceneMediaRef } from "@shared/cutscenes/types";
import { loadCutsceneAudioBlob } from "../sound/cutsceneAudioMedia";

export interface CutsceneWaveformData { duration: number; peaks: readonly number[] }
/** Decode the independent audio asset, never a decorative/random waveform. No sound is started. */
export async function readCutsceneWaveform(id: number, ref: CutsceneMediaRef<"audio">, signal: AbortSignal): Promise<CutsceneWaveformData> {
  const blob = await loadCutsceneAudioBlob(id, ref, signal);
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (signal.aborted) throw new DOMException("Подготовка волнограммы отменена", "AbortError");
    const count = Math.min(2400, audio.length), peaks = Array.from({ length: count }, () => 0);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const samples = audio.getChannelData(channel);
      for (let i = 0; i < count; i++) {
        const from = Math.floor(i * samples.length / count), to = Math.floor((i + 1) * samples.length / count);
        let peak = peaks[i];
        for (let j = from; j < to; j++) peak = Math.max(peak, Math.abs(samples[j]));
        peaks[i] = peak;
      }
    }
    return { duration: audio.duration, peaks };
  } finally { await context.close().catch(() => {}); }
}
