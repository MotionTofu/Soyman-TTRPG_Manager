import { cutsceneRuns } from "../data/cutsceneRuns";
import type { CutsceneAudioController } from "../sound/cutsceneAudio";
import type { CutsceneAudioRunner } from "../sound/cutsceneAudioRunner";
import { CutscenePlaybackController } from "./controller";
import { browserCutsceneOutput } from "./display";

export function createCutscenePlayback(audio: CutsceneAudioController, music: CutsceneAudioRunner): CutscenePlaybackController {
  return new CutscenePlaybackController({ repository: cutsceneRuns, audio, music, output: browserCutsceneOutput });
}
