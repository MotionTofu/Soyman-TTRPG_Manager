import type { SceneKind, SceneStatus } from "./types";

export const SCENE_KINDS: { key: SceneKind; label: string }[] = [
  { key: "scene", label: "Сцена" },
  { key: "encounter", label: "Столкновение" },
  { key: "branch", label: "Развилка" },
  { key: "ending", label: "Концовка" },
];

export const SCENE_KIND_LABELS: Record<string, string> = Object.fromEntries(
  SCENE_KINDS.map((k) => [k.key, k.label])
);

// Playthrough progress, tracked per campaign in campaign_scene_state — never
// on the scene row itself, which would spawn a copy-on-write override.
export const SCENE_STATUSES: { key: SceneStatus; label: string }[] = [
  { key: "pending", label: "Не начата" },
  { key: "done", label: "Пройдена" },
  { key: "skipped", label: "Пропущена" },
];
