import type { CutsceneAudioCommand, CutsceneAudioScope, CutsceneAudioTransition, CutsceneDocument,
  CutsceneMediaRef, CutsceneOwnedAudioChannel, CutsceneSettings, CutsceneStep, CutsceneVisualTransition } from "./types";

/** Approved defaults (spec §12). Durations are milliseconds, audio positions seconds. */
export const CUTSCENE_DEFAULTS = Object.freeze({
  visualTransitionKind: "fade" as const,
  visualTransitionMs: 500,
  audioTransitionMode: "crossfade" as const,
  audioFadeOutMs: 2000,
  audioFadeInMs: 2000,
  loopEnabled: false,
  loopTransitionMode: "crossfade" as const,
  loopCrossfadeMs: 1000,
  endFadeOutMs: 1000,
  fontSizePx: 32,
  wordsPerMinute: 120,
  audioScope: "all" as const,
  finishImage: "restore" as const,
  finishAudio: "restore" as const,
  finishImageTransitionMs: 500,
  finishAudioFadeOutMs: 2000,
  finishAudioFadeInMs: 2000,
});

export function createCutsceneVisualTransition(): CutsceneVisualTransition {
  return { kind: CUTSCENE_DEFAULTS.visualTransitionKind, durationMs: CUTSCENE_DEFAULTS.visualTransitionMs };
}

export function createCutsceneAudioTransition(): CutsceneAudioTransition {
  return { mode: CUTSCENE_DEFAULTS.audioTransitionMode,
    fadeOutMs: CUTSCENE_DEFAULTS.audioFadeOutMs, fadeInMs: CUTSCENE_DEFAULTS.audioFadeInMs };
}

export function createCutsceneSettings(): CutsceneSettings {
  return {
    audioScope: CUTSCENE_DEFAULTS.audioScope,
    wordsPerMinute: CUTSCENE_DEFAULTS.wordsPerMinute,
    finish: {
      image: CUTSCENE_DEFAULTS.finishImage, audio: CUTSCENE_DEFAULTS.finishAudio,
      imageTransition: { kind: CUTSCENE_DEFAULTS.visualTransitionKind, durationMs: CUTSCENE_DEFAULTS.finishImageTransitionMs },
      audioTransition: { mode: CUTSCENE_DEFAULTS.audioTransitionMode,
        fadeOutMs: CUTSCENE_DEFAULTS.finishAudioFadeOutMs, fadeInMs: CUTSCENE_DEFAULTS.finishAudioFadeInMs },
    },
  };
}

export function createCutsceneDocument(name: string): CutsceneDocument {
  return { version: 1, name, description: "", settings: createCutsceneSettings(), steps: [] };
}

export function createCutsceneStep(id: string): CutsceneStep {
  return { id, image: { action: "keep" }, audio: { action: "keep" }, text: { action: "keep" }, notes: "" };
}

export function createCutsceneAudioCommand(id: string, audio: CutsceneMediaRef<"audio">): CutsceneAudioCommand {
  return {
    id, audio: { kind: audio.kind, id: audio.id }, startSeconds: 0, endSeconds: null, volume: 1,
    transition: createCutsceneAudioTransition(),
    loop: { enabled: CUTSCENE_DEFAULTS.loopEnabled,
      transition: { mode: CUTSCENE_DEFAULTS.loopTransitionMode, durationMs: CUTSCENE_DEFAULTS.loopCrossfadeMs } },
    endFadeOutMs: CUTSCENE_DEFAULTS.endFadeOutMs,
  };
}

const MUSIC_CHANNELS: readonly CutsceneOwnedAudioChannel[] = Object.freeze(["background"]);
const ALL_CHANNELS: readonly CutsceneOwnedAudioChannel[] = Object.freeze(["background", "ambient", "weather", "stinger"]);

export function cutsceneOwnedAudioChannels(scope: CutsceneAudioScope): readonly CutsceneOwnedAudioChannel[] {
  return scope === "all" ? ALL_CHANNELS : MUSIC_CHANNELS;
}
