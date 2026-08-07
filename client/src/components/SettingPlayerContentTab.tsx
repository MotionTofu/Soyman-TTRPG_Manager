import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import type {
  Campaign,
  CampaignDetail,
  RosterPlayer,
  SettingBeing,
  SettingCalendarEvent,
  SettingCommunity,
  SettingLocation,
} from "../types";

interface Props {
  settingId: number;
  campaigns: Campaign[];
}

// Fixed subsections (Локации/Личности и Фракции/Бестиарий/История), reusing
// the setting's existing entities as-is — no separate "added to this
// section" table. Visibility is per (campaign, player), same
// player_visibility_grants used by the campaign's own "Для игроков" tab, so
// the same setting content can be revealed differently to different
// campaigns sharing it.
export function SettingPlayerContentTab({ settingId, campaigns }: Props) {
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [beings, setBeings] = useState<SettingBeing[]>([]);
  const [communities, setCommunities] = useState<SettingCommunity[]>([]);
  const [chronicleEvents, setChronicleEvents] = useState<SettingCalendarEvent[]>([]);

  useEffect(() => {
    api.get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`).then(setLocations);
    api.get<SettingBeing[]>(`/setting-beings?setting_id=${settingId}`).then(setBeings);
    api.get<SettingCommunity[]>(`/setting-communities?setting_id=${settingId}`).then(setCommunities);
    api.get<SettingCalendarEvent[]>(`/settings/${settingId}/calendar-events`).then(setChronicleEvents);
  }, [settingId]);

  useEffect(() => {
    if (!campaignId) {
      setRoster([]);
      return;
    }
    api.get<CampaignDetail>(`/campaigns/${campaignId}`).then((c) => setRoster(c.roster));
  }, [campaignId]);

  const personalities = beings.filter((b) => b.category !== "bestiary");
  const bestiary = beings.filter((b) => b.category === "bestiary");

  return (
    <div className="stack">
      <p className="muted">
        Добавление сюда ничего не показывает игрокам само по себе — выберите кампанию, а затем
        отметьте кнопкой-глазом нужных игроков.
      </p>
      <label className="row">
        Кампания
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Выберите кампанию…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {!campaignId ? (
        <p className="muted">Выберите кампанию, чтобы настроить видимость.</p>
      ) : (
        <div className="stack">
          <Subsection title="Локации">
            {locations.map((l) => (
              <Row key={l.id} to={`/locations/${l.id}`} name={l.name} campaignId={campaignId} targetType="setting_location" targetId={l.id} roster={roster} />
            ))}
            {locations.length === 0 && <span className="muted">Локаций пока нет.</span>}
          </Subsection>

          <Subsection title="Личности и Фракции">
            {personalities.map((b) => (
              <Row key={`being-${b.id}`} to={`/beings/${b.id}`} name={b.name} campaignId={campaignId} targetType="setting_being" targetId={b.id} roster={roster} />
            ))}
            {communities.map((c) => (
              <Row key={`community-${c.id}`} to={`/communities/${c.id}`} name={c.name} campaignId={campaignId} targetType="setting_community" targetId={c.id} roster={roster} />
            ))}
            {personalities.length === 0 && communities.length === 0 && <span className="muted">Пока никого нет.</span>}
          </Subsection>

          <Subsection title="Бестиарий">
            {bestiary.map((b) => (
              <Row key={b.id} to={`/beings/${b.id}`} name={b.name} campaignId={campaignId} targetType="setting_being" targetId={b.id} roster={roster} />
            ))}
            {bestiary.length === 0 && <span className="muted">Бестиарий пуст.</span>}
          </Subsection>

          <Subsection title="История">
            {chronicleEvents.map((e) => (
              <Row key={e.id} name={e.title} campaignId={campaignId} targetType="setting_calendar_event" targetId={e.id} roster={roster} />
            ))}
            {chronicleEvents.length === 0 && <span className="muted">В хронике мира пока нет событий.</span>}
          </Subsection>
        </div>
      )}
    </div>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="card" open>
      <summary>{title}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {children}
      </div>
    </details>
  );
}

function Row({
  to,
  name,
  campaignId,
  targetType,
  targetId,
  roster,
}: {
  to?: string;
  name: string;
  campaignId: number;
  targetType: "setting_location" | "setting_being" | "setting_community" | "setting_calendar_event";
  targetId: number;
  roster: RosterPlayer[];
}) {
  return (
    <div className="row setting-player-row" style={{ justifyContent: "space-between" }}>
      {to ? <Link to={to}>{name}</Link> : <span>{name}</span>}
      <PlayerVisibilityPicker campaignId={campaignId} targetType={targetType} targetId={targetId} roster={roster} />
    </div>
  );
}
