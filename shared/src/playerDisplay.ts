import type { CutscenePresentationSnapshot, CutsceneVisualTransition } from "./cutscenes/types";
import type { PresentationData, ShowDisplay } from "./presentation";
import type { CutsceneVisualPlayback } from "./cutscenes/previewApi";

/** Ownership is explicit, persistent and never expires on a renderer reload. */
export interface PlayerDisplayOwner {
  readonly runId: string;
  readonly controllerId: string;
}

/** GM control/return state. null distinguishes absence of a show from intentional black. */
export interface PlayerDisplayState {
  readonly revision: number;
  readonly snapshot: CutscenePresentationSnapshot | null;
  readonly owner: PlayerDisplayOwner | null;
  /** One publication can override a source's entrance, e.g. instant interruption/return. */
  readonly transition: CutsceneVisualTransition | null;
}

/** The display window reads only this projection, never a document or audio state. */
export interface PlayerDisplayFrame {
  readonly visualPlayback?: CutsceneVisualPlayback;
  readonly revision: number;
  readonly playKey: string;
  readonly display: ShowDisplay;
  readonly transition: CutsceneVisualTransition;
  readonly content:
    | { readonly kind: "black" }
    | { readonly kind: "map"; readonly mapId: number }
    | { readonly kind: "composition"; readonly data: PresentationData; readonly visibleLayerIds: number[] };
}

export type PlayerDisplayOpenResult =
  | { readonly ok: true; readonly wasOpen: boolean; readonly openedByCall: boolean;
      readonly windowId: string; readonly screenId: string | null }
  | { readonly ok: false; readonly reason: string };
