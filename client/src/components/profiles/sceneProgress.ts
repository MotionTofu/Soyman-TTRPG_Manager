import type { ArcClueNode, CampaignTreeScene, SceneSession, StoryScene } from "../../types";
import { clueNeed, plural } from "../../sceneKinds";

/** То же правило для «Сюжета» и профиля: последняя сыгранная, иначе план. */
export function plannedSession(scene: { sessions: SceneSession[] }, today = new Date().toLocaleDateString("sv")) {
  return scene.sessions.find((s) => !s.played && s.date >= today) ?? null;
}

export function sceneSession(scene: { sessions: SceneSession[] }) {
  const played = scene.sessions.filter((s) => s.played);
  const lastPlayed = played[played.length - 1] ?? null;
  const planned = lastPlayed ? null : plannedSession(scene);
  return { lastPlayed, planned, label: lastPlayed ? `Сессия №${lastPlayed.number}` : planned ? `в сессии №${planned.number}` : null };
}

export const isAhead = (s: CampaignTreeScene) => (s.state?.status ?? "pending") === "pending" && !s.sessions.some((x) => x.played);
export function countHoles(list: CampaignTreeScene[], nodeBy: Map<number, ArcClueNode>) {
  return list.filter((s) => {
    const n = nodeBy.get(s.id);
    return isAhead(s) && !!n && clueNeed(n.role, n.clue_in, n.passage_in) === "missing";
  }).length;
}
export const holesLabel = (n: number) => `⚠ ${n} ${plural(n, "узел", "узла", "узлов")} без трёх улик`;
export const originalSceneHref = (s: Pick<StoryScene, "source_scene_id" | "id">) => `/scenes/${s.source_scene_id ?? s.id}`;
