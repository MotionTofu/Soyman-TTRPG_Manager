import { Link } from "react-router-dom";
import type { Campaign } from "../types";
import { PAYMENT_TYPE_LABELS } from "../paymentTypes";
import { loadHideFinance } from "../financePrivacy";

// Shared "плитка-обложка" card (design doc §6.3.1 / ticket 14): cover image
// (or, absent an upload, ticket 07's themed grain+torn-edge band as a
// stand-in) with a bottom scrim and the campaign name overlaid on it, and a
// compact meta panel below. Used by both CampaignsListPage's grid view and
// HomeCalendarPage's campaign tiles row so the two screens render the exact
// same card instead of two near-identical hand-rolled versions.
export function CampaignCoverTile({ campaign: c }: { campaign: Campaign }) {
  const imageUrl = c.thumbnail_image_url ?? c.background_image_url ?? null;

  return (
    <Link to={`/campaigns/${c.id}`} className="card campaign-tile">
      <div
        className={`campaign-tile-cover${imageUrl ? "" : " campaign-card-band zine-grain zine-torn-bottom"}`}
        style={imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined}
      >
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{c.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="muted">{c.system_name ?? "система не выбрана"}</div>
        <div className="muted">{c.setting_name ?? "без сеттинга"}</div>
        <div className="row">
          <span className="badge tag">{c.status}</span>
          {c.role === "player" ? (
            <span className="badge role-player-badge">Я игрок</span>
          ) : (
            !loadHideFinance() && (
              <span
                className={`badge ${c.payment_type === "paid" ? "held" : c.payment_type === "negotiable" ? "rescheduled" : "planned"}`}
              >
                {PAYMENT_TYPE_LABELS[c.payment_type]}
              </span>
            )
          )}
        </div>
        <div className="muted">
          Игроков: {c.player_count ?? 0} · Сессий состоялось: {c.held_sessions_count ?? 0}
        </div>
        {c.next_planned_date && (
          <div className="muted">Ближайшая сессия: {c.next_planned_date}</div>
        )}
      </div>
    </Link>
  );
}
