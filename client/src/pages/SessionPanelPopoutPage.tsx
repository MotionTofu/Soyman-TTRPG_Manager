import { useParams } from "react-router-dom";
import { useEntity, useResource } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { SESSION_PANEL_CONTENT, SESSION_PANEL_TITLES, type SessionPanelKey } from "./sessionLivePanels";
import "../session.css";
import type { CampaignDetail, Character, SessionDetail, SessionUnionRow } from "../types";

const NO_CHARACTERS: Character[] = [];

// Rendered outside <AppShell> (see App.tsx) — no sidebar/search/audio-bar
// chrome, just the one panel's content, meant to live in its own small
// window on a second monitor. index.css is loaded globally via main.tsx, so
// .card/.stack utility classes still work without the shell around them.
export function SessionPanelPopoutPage() {
  const { id, panelKey } = useParams<{ id: string; panelKey: SessionPanelKey }>();
  const sessionId = Number(id);

  // Вынесенная панель живёт в своём окне и про запуск сцены в главном не
  // знает. Правка из главного окна приходит сюда адресным сигналом (dataSync.ts
  // → data/DataLayerSync.tsx), и перечитывается ровно задетое — тот же кэш и те
  // же ключи, что у пульта.
  const session = useEntity<SessionDetail>("session", sessionId).data ?? null;
  const campaign = useEntity<CampaignDetail>("campaign", session?.campaign_id).data ?? null;
  const characters =
    useResource<Character[]>(session ? sessionPaths.campaignCharacters(session.campaign_id) : null).data ??
    NO_CHARACTERS;
  const union = useResource<SessionUnionRow[]>(sessionPaths.castUnion(sessionId)).data;

  if (!session || !campaign || !panelKey || !(panelKey in SESSION_PANEL_CONTENT)) return null;

  const Content = SESSION_PANEL_CONTENT[panelKey];

  return (
    <div className="stack" style={{ padding: 16 }}>
      <h2>{SESSION_PANEL_TITLES[panelKey]}</h2>
      <Content sessionId={sessionId} session={session} campaign={campaign} characters={characters} union={union} />
    </div>
  );
}
