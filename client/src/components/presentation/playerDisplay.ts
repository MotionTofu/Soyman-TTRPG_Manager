import type { PlayerDisplayOwner, PlayerDisplayState } from "@shared/playerDisplay";
import type { CutscenePresentationSnapshot, CutsceneVisualTransition } from "@shared/cutscenes/types";
import { afterWriteAnywhere, readResource } from "../../data/imperative";
import { write } from "../../data/hooks";

export const PLAYER_DISPLAY_PATH = "/presentation/state";
export const PLAYER_FRAME_PATH = "/presentation/frame";
export function playerDisplayChanged(): void {
  afterWriteAnywhere([{ path: PLAYER_DISPLAY_PATH }, { path: PLAYER_FRAME_PATH }]);
}
export const readPlayerDisplay = () => readResource<PlayerDisplayState>(PLAYER_DISPLAY_PATH, { fresh: true });
export async function publishPlayerDisplay(snapshot: CutscenePresentationSnapshot | null, owner?: PlayerDisplayOwner,
  transition?: CutsceneVisualTransition): Promise<PlayerDisplayState> {
  const state = await write.put<PlayerDisplayState>(PLAYER_DISPLAY_PATH, { snapshot, owner, transition });
  playerDisplayChanged();
  return state;
}
export async function selectSessionDisplay(sessionId: number, ifEmpty = false): Promise<void> {
  await write.post(`/presentation/session/${sessionId}`, { ifEmpty });
  playerDisplayChanged();
}
export async function claimPlayerDisplay(owner: PlayerDisplayOwner): Promise<PlayerDisplayState> {
  const state = await write.put<PlayerDisplayState>("/presentation/ownership", { owner });
  playerDisplayChanged(); return state;
}
export async function releasePlayerDisplay(owner: PlayerDisplayOwner): Promise<PlayerDisplayState> {
  // PUT supports a release flag because the existing data transport has no DELETE body.
  const state = await write.put<PlayerDisplayState>("/presentation/ownership", { owner, release: true });
  playerDisplayChanged(); return state;
}
