import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { onDataChangedElsewhere } from "../dataSync";
import { SESSION_PANEL_CONTENT, SESSION_PANEL_TITLES, type SessionPanelKey } from "./sessionLivePanels";
import type { CampaignDetail, Character, SessionDetail } from "../types";

// Rendered outside <AppShell> (see App.tsx) — no sidebar/search/audio-bar
// chrome, just the one panel's content, meant to live in its own small
// window on a second monitor. index.css is loaded globally via main.tsx, so
// .card/.stack utility classes still work without the shell around them.
export function SessionPanelPopoutPage() {
  const { id, panelKey } = useParams<{ id: string; panelKey: SessionPanelKey }>();
  const sessionId = Number(id);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);

  const refresh = useCallback(() => {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then((s) => {
      setSession(s);
      api.get<CampaignDetail>(`/campaigns/${s.campaign_id}`).then(setCampaign);
      api.get<Character[]>(`/characters?campaign_id=${s.campaign_id}`).then(setCharacters);
    });
  }, [sessionId]);

  useEffect(refresh, [refresh]);

  // Вынесенная панель живёт в своём окне и про запуск сцены в главном не
  // знает. Правки объявляются между окнами (dataSync.ts) — этого хватает:
  // отдельного канала под пульт заводить незачем.
  const [launches, setLaunches] = useState(0);
  useEffect(() => onDataChangedElsewhere(() => setLaunches((n) => n + 1)), []);

  if (!session || !campaign || !panelKey || !(panelKey in SESSION_PANEL_CONTENT)) return null;

  const Content = SESSION_PANEL_CONTENT[panelKey];

  return (
    <div className="stack" style={{ padding: 16 }}>
      <h2>{SESSION_PANEL_TITLES[panelKey]}</h2>
      <Content
        sessionId={sessionId}
        session={session}
        campaign={campaign}
        characters={characters}
        launches={launches}
      />
    </div>
  );
}
