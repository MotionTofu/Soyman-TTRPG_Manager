import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { SectionDropZone } from "../components/SectionDropZone";
import { ObstacleDropZone } from "../components/ObstacleDropZone";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { LazyDetails } from "../components/LazyDetails";
import { SecretsTracker } from "../components/SecretsTracker";
import { RemindersWidget } from "../components/RemindersWidget";
import { PlaylistsSection } from "../components/PlaylistsSection";
import type { CampaignDetail, Character, SessionDetail } from "../types";

// Same module-level constants as SessionDetailPage.tsx — SectionDropZone is
// React.memo'd, so an inline array literal here would be a new reference
// every render, defeating the memo on every unrelated keystroke.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact"];

export type SessionPanelKey =
  | "locations"
  | "plotCharacters"
  | "obstacles"
  | "loot"
  | "roster"
  | "secrets"
  | "reminders"
  | "playlist"
  | "compendium";

export const SESSION_PANEL_TITLES: Record<SessionPanelKey, string> = {
  locations: "Локации",
  plotCharacters: "Сюжетные персонажи",
  obstacles: "Препятствия",
  loot: "Потенциальный лут",
  roster: "Состав кампании",
  secrets: "Тайны и зацепки",
  reminders: "Напоминания",
  playlist: "Плейлист",
  compendium: "Компендиум",
};

interface PanelProps {
  sessionId: number;
  session: SessionDetail;
  campaign: CampaignDetail;
  characters: Character[];
}

// Popped-out panel windows are opened by name, so re-clicking the same
// button focuses the existing window instead of spawning duplicates.
function PopoutButton({ sessionId, panelKey }: { sessionId: number; panelKey: SessionPanelKey }) {
  return (
    <button
      type="button"
      className="comp-mini"
      title="Открыть в отдельном окне"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(
          `/sessions/${sessionId}/live/panel/${panelKey}`,
          `panel-${panelKey}-${sessionId}`,
          "width=420,height=640"
        );
      }}
    >
      ⇱
    </button>
  );
}

function LocationsContent({ sessionId, session }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="locations"
      acceptTypes={LOCATION_TYPES}
      placeholder="Перетащите сюда локацию из поиска"
      mentionText={session.idea_notes}
      mentionTypes={LOCATION_TYPES}
    />
  );
}

function PlotCharactersContent({ sessionId, session }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="plot_characters"
      acceptTypes={PLOT_CHARACTER_TYPES}
      placeholder="Перетащите сюда существо или персонажа из поиска"
      mentionText={session.idea_notes}
      mentionTypes={PLOT_CHARACTER_TYPES}
    />
  );
}

function ObstaclesContent({ sessionId }: PanelProps) {
  return <ObstacleDropZone sessionId={sessionId} />;
}

function LootContent({ sessionId }: PanelProps) {
  return (
    <SectionDropZone
      entityType="session"
      entityId={sessionId}
      section="loot"
      acceptTypes={LOOT_TYPES}
      placeholder="Перетащите сюда ресурс или артефакт из поиска"
    />
  );
}

function RosterContent({ campaign, characters }: PanelProps) {
  return (
    <>
      {campaign.roster.length === 0 && <span className="muted">Состав кампании пуст.</span>}
      {campaign.roster.map((p) => {
        const playerCharacters = characters.filter((c) => c.player_id === p.id);
        const avatar = p.thumbnail_image_url ?? p.avatar_image_url;
        return (
          <div key={p.id} className="row" style={{ alignItems: "center", gap: 8 }}>
            {avatar ? (
              <img src={avatar} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-panel)" }} />
            )}
            <span>{p.name}</span>
            {playerCharacters.length === 0 ? (
              <Link to={`/players/${p.id}`} className="muted">
                профиль игрока
              </Link>
            ) : (
              playerCharacters.map((c) => (
                <Link
                  key={c.id}
                  to={`/characters/${c.id}`}
                  className="badge planned"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      SEARCH_DRAG_MIME,
                      JSON.stringify({ type: "character", id: c.id, title: c.character_name })
                    );
                    e.dataTransfer.effectAllowed = "link";
                  }}
                >
                  {c.character_name}
                </Link>
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

function SecretsContent({ campaign }: PanelProps) {
  return <SecretsTracker campaignId={campaign.id} />;
}

function RemindersContent({ campaign }: PanelProps) {
  return <RemindersWidget targetType="campaign" targetId={campaign.id} />;
}

function PlaylistContent({ sessionId, campaign }: PanelProps) {
  return <PlaylistsSection scope="session" entityId={sessionId} settingId={campaign.setting_id} />;
}

function CompendiumContent({ campaign }: PanelProps) {
  return campaign.system_id ? (
    <Link to={`/systems/${campaign.system_id}`}>Компендиум системы «{campaign.system_name}» →</Link>
  ) : (
    <span className="muted">Система не выбрана.</span>
  );
}

// Keyed lookup used by the standalone pop-out page (SessionPanelPopoutPage)
// to render just one panel's content, bare, without any of the embedded
// wrappers below.
export const SESSION_PANEL_CONTENT: Record<SessionPanelKey, (props: PanelProps) => ReactElement> = {
  locations: LocationsContent,
  plotCharacters: PlotCharactersContent,
  obstacles: ObstaclesContent,
  loot: LootContent,
  roster: RosterContent,
  secrets: SecretsContent,
  reminders: RemindersContent,
  playlist: PlaylistContent,
  compendium: CompendiumContent,
};

// Embedded versions below — each keeps the exact look it had inline in
// SessionLivePage before this file existed, just with a pop-out button added.

export function LocationsPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.locations} defaultOpen actions={<PopoutButton sessionId={props.sessionId} panelKey="locations" />}>
      <LocationsContent {...props} />
    </LazyDetails>
  );
}

export function PlotCharactersPanel(props: PanelProps) {
  return (
    <LazyDetails
      title={SESSION_PANEL_TITLES.plotCharacters}
      defaultOpen
      actions={<PopoutButton sessionId={props.sessionId} panelKey="plotCharacters" />}
    >
      <PlotCharactersContent {...props} />
    </LazyDetails>
  );
}

export function ObstaclesPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.obstacles} actions={<PopoutButton sessionId={props.sessionId} panelKey="obstacles" />}>
      <ObstaclesContent {...props} />
    </LazyDetails>
  );
}

export function LootPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.loot} actions={<PopoutButton sessionId={props.sessionId} panelKey="loot" />}>
      <LootContent {...props} />
    </LazyDetails>
  );
}

export function RosterPanel(props: PanelProps) {
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong className="entry-title">{SESSION_PANEL_TITLES.roster}</strong>
        <PopoutButton sessionId={props.sessionId} panelKey="roster" />
      </div>
      <RosterContent {...props} />
    </div>
  );
}

export function SecretsPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.secrets} defaultOpen actions={<PopoutButton sessionId={props.sessionId} panelKey="secrets" />}>
      <SecretsContent {...props} />
    </LazyDetails>
  );
}

export function RemindersPanel(props: PanelProps) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 12, right: 12 }}>
        <PopoutButton sessionId={props.sessionId} panelKey="reminders" />
      </div>
      <RemindersContent {...props} />
    </div>
  );
}

export function PlaylistPanel(props: PanelProps) {
  return (
    <LazyDetails title={SESSION_PANEL_TITLES.playlist} defaultOpen actions={<PopoutButton sessionId={props.sessionId} panelKey="playlist" />}>
      <PlaylistContent {...props} />
    </LazyDetails>
  );
}

export function CompendiumPanel(props: PanelProps) {
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong className="entry-title">{SESSION_PANEL_TITLES.compendium}</strong>
        <PopoutButton sessionId={props.sessionId} panelKey="compendium" />
      </div>
      <CompendiumContent {...props} />
    </div>
  );
}
