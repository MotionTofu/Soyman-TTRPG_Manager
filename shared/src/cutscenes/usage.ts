/** Named, persisted uses that prevent permanent deletion (Q72). */
export interface CutsceneUsagePlace {
  readonly key: string;
  readonly kind: "campaign" | "session" | "live" | "rehearsal" | "frame" | "music" | "snapshot" | "preparation";
  readonly label: string;
  readonly href: string | null;
}
export interface CutsceneUsage {
  readonly cutsceneId: number;
  readonly places: readonly CutsceneUsagePlace[];
  readonly canDelete: boolean;
}
