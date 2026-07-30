import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { Campaign, SessionSummary } from "../types";

interface Props {
  locationId: number;
  // The map's own setting — campaigns belonging to it are listed first in
  // the campaign picker (still shows every other campaign below).
  settingId: number | null;
  onClose: () => void;
}

function sessionDateTime(s: SessionSummary): Date {
  return new Date(`${s.date}T${s.start_time ?? "00:00"}:00`);
}

// Two-step "send this map to a session" picker: campaign first (own setting's
// campaigns first), then that campaign's sessions — future by default, with a
// toggle to browse past (held) sessions instead. Mirrors the drill-down shape
// of AddTracksModal (list → detail-with-back-button) but for campaign→session
// instead of setting→resource.
export function SendMapToSessionModal({ locationId, settingId, onClose }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [sending, setSending] = useState(false);
  const [doneLabel, setDoneLabel] = useState<string | null>(null);

  useEffect(() => {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  useEffect(() => {
    if (!campaign) {
      setSessions([]);
      return;
    }
    api.get<SessionSummary[]>(`/campaigns/${campaign.id}/sessions`).then(setSessions);
  }, [campaign]);

  const ownSetting = campaigns.filter((c) => settingId != null && c.setting_id === settingId);
  const otherCampaigns = campaigns.filter((c) => !(settingId != null && c.setting_id === settingId));

  const now = new Date();
  const future = sessions
    .filter((s) => s.status === "planned" && sessionDateTime(s).getTime() >= now.getTime())
    .sort((a, b) => sessionDateTime(a).getTime() - sessionDateTime(b).getTime());
  const past = sessions
    .filter((s) => s.status === "held")
    .sort((a, b) => sessionDateTime(b).getTime() - sessionDateTime(a).getTime());
  const shown = showPast ? past : future;

  async function send(session: SessionSummary) {
    setSending(true);
    try {
      await api.post("/resources/from-location-map", { location_id: locationId, session_id: session.id });
      setDoneLabel(`${session.campaign_name ?? campaign?.name ?? ""} — ${session.date}${session.title ? ` (${session.title})` : ""}`);
    } finally {
      setSending(false);
    }
  }

  if (doneLabel) {
    return (
      <Modal onClose={onClose}>
        <div className="stack">
          <p>
            Карта добавлена в ресурсы сессии «{doneLabel}».
          </p>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </Modal>
    );
  }

  if (!campaign) {
    return (
      <Modal onClose={onClose}>
        <h3>Отправить карту в сессию</h3>
        <div className="stack">
          <p className="muted">Выберите кампанию.</p>
          {ownSetting.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <strong className="muted">Кампании этого сеттинга</strong>
              {ownSetting.map((c) => (
                <button key={c.id} type="button" onClick={() => setCampaign(c)} style={{ textAlign: "left" }}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {otherCampaigns.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              {ownSetting.length > 0 && <strong className="muted">Остальные кампании</strong>}
              {otherCampaigns.map((c) => (
                <button key={c.id} type="button" onClick={() => setCampaign(c)} style={{ textAlign: "left" }}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {campaigns.length === 0 && <p className="muted">Кампаний пока нет.</p>}
          <button onClick={onClose}>Отмена</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h3>Отправить карту в сессию</h3>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={() => setCampaign(null)}>
            ← Назад
          </button>
          <strong>{campaign.name}</strong>
        </div>
        <div className="row">
          <button type="button" disabled={!showPast} onClick={() => setShowPast(false)}>
            Будущие сессии
          </button>
          <button type="button" disabled={showPast} onClick={() => setShowPast(true)}>
            Прошлые сессии
          </button>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={sending}
              onClick={() => send(s)}
              style={{ textAlign: "left" }}
            >
              {s.date}
              {s.title ? ` — ${s.title}` : ""}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="muted">{showPast ? "Прошедших сессий нет." : "Будущих сессий нет."}</p>
          )}
        </div>
        <button onClick={onClose}>Отмена</button>
      </div>
    </Modal>
  );
}
