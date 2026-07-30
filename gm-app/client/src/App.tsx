import { useEffect, useState } from "react";
import type { AppState, CalendarSession, Campaign } from "./types";
import { ConnectScreen } from "./ConnectScreen";
import { Dashboard } from "./Dashboard";
import { CampaignView } from "./CampaignView";
import { SessionView } from "./SessionView";
import { BeingsView } from "./BeingsView";
import { CompendiumView } from "./CompendiumView";
import { ImagePicker } from "./ImagePicker";

type View =
  | { type: "dashboard" }
  | { type: "campaign"; campaign: Campaign }
  | { type: "session"; session: CalendarSession; campaign: Campaign }
  | { type: "beings"; campaign: Campaign }
  | { type: "compendium"; campaign: Campaign }
  | { type: "images"; scope: "session" | "setting"; entityId: number; campaign: Campaign };

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>({ type: "dashboard" });
  const [showConnect, setShowConnect] = useState(false);

  async function refreshState() {
    const s = await window.gmApp.getState();
    setState(s);
    return s;
  }

  useEffect(() => {
    refreshState();
  }, []);

  async function handleConnected() {
    setShowConnect(false);
    await refreshState();
  }

  async function handleDisconnect() {
    await window.gmApp.disconnect();
    setView({ type: "dashboard" });
    await refreshState();
  }

  if (!state) {
    return (
      <div className="app-body">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (!state.connected || showConnect) {
    return (
      <div className="app-body" style={{ paddingTop: 60 }}>
        <ConnectScreen
          defaultServerUrl={state.serverUrl}
          defaultUsername={state.username}
          defaultPassword={state.savedPassword}
          onConnected={handleConnected}
        />
        {state.connected && (
          <button onClick={() => setShowConnect(false)} style={{ marginTop: 8 }}>
            Отмена
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <header className="app-header">
        <strong>RPG Manager — Мастер</strong>
        <div className="row">
          <span className="status-dot online" />
          <span className="muted">{state.username}</span>
          {view.type !== "dashboard" && <button onClick={() => setView({ type: "dashboard" })}>← Назад</button>}
          <button onClick={handleDisconnect}>Отключиться</button>
        </div>
      </header>
      <div className="app-body stack">
        {view.type === "dashboard" && <Dashboard onOpenCampaign={(campaign) => setView({ type: "campaign", campaign })} />}
        {view.type === "campaign" && (
          <CampaignView
            campaign={view.campaign}
            onOpenSession={(session) => setView({ type: "session", session, campaign: view.campaign })}
            onOpenCompendium={() => setView({ type: "compendium", campaign: view.campaign })}
            onOpenBeings={() => setView({ type: "beings", campaign: view.campaign })}
            onOpenImages={() =>
              setView({ type: "images", scope: "setting", entityId: view.campaign.setting_id!, campaign: view.campaign })
            }
          />
        )}
        {view.type === "session" && (
          <SessionView
            session={view.session}
            serverUrl={state.serverUrl}
            token={state.token}
            onOpenImages={() => setView({ type: "images", scope: "session", entityId: view.session.id, campaign: view.campaign })}
          />
        )}
        {view.type === "beings" && (
          <BeingsView settingId={view.campaign.setting_id!} settingName={view.campaign.setting_name || ""} />
        )}
        {view.type === "compendium" && (
          <CompendiumView systemId={view.campaign.system_id!} systemName={view.campaign.system_name || ""} />
        )}
        {view.type === "images" && (
          <ImagePicker
            scope={view.scope}
            entityId={view.entityId}
            campaignId={view.campaign.id}
            serverUrl={state.serverUrl}
            token={state.token}
          />
        )}
      </div>
    </>
  );
}
