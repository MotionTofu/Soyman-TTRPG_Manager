import { useSyncExternalStore, type CSSProperties } from "react";
import type { PlayerDisplayFrame } from "@shared/playerDisplay";
import type { CutscenePlaybackState } from "../../cutscenes/ports";
import { readRehearsalFrame, rehearsalFramesRevision, subscribeRehearsalFrames } from "../../cutscenes/rehearsalFrames";
import { useResource } from "../../data/hooks";
import { PLAYER_FRAME_PATH } from "../presentation/playerDisplay";
import { PlayerDisplaySurface } from "../presentation/PlayerDisplaySurface";

export function CutscenePreview({ state }: { state: CutscenePlaybackState }) {
  const run = state.run, rehearsal = run?.snapshot.mode === "rehearsal";
  const actual = useResource<PlayerDisplayFrame>(rehearsal ? null : PLAYER_FRAME_PATH, { pollMs: 2000 }).data;
  useSyncExternalStore(subscribeRehearsalFrames, rehearsalFramesRevision, rehearsalFramesRevision);
  const frame = rehearsal ? run && state.step ? readRehearsalFrame(run, state.step) : null : actual ?? null;
  const ratio = frame?.display.screen_w && frame?.display.screen_h ? frame.display.screen_w / frame.display.screen_h : 16 / 9;
  return <figure className="cutscene-player__preview">
    <figcaption>{rehearsal ? "Превью репетиции" : "Экран игроков"}</figcaption>
    <div className="cutscene-player__preview-stage" aria-label="Превью изображения"
      style={{ "--cutscene-preview-ratio": ratio } as CSSProperties}>
      <PlayerDisplaySurface frame={frame} />
    </div>
  </figure>;
}
