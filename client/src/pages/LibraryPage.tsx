import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { formatNearestDate } from "../nearestDate";
import type { Campaign, Setting, System } from "../types";

// Mobile-first browsing surface combining the three "library" entity lists
// (Кампании/Сеттинги/Системы) into one screen reachable from the bottom
// nav's "Библиотека" button — a full create/manage UI already exists on
// each entity's own list page (/campaigns, /settings, /systems), so this
// view is read/navigate-only by design.
export function LibraryPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const thumbnailStyles = loadThumbnailStyles();

  useEffect(() => {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
    api.get<Setting[]>("/settings").then(setSettings);
    api.get<System[]>("/systems").then(setSystems);
  }, []);

  // Server already sorts campaigns by next_planned_date (see campaigns.ts).
  const upcoming = campaigns.filter((c) => c.next_planned_date);

  return (
    <div className="stack">
      <SectionHeading>Библиотека</SectionHeading>

      {upcoming.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="player-list-letter">Ближайшая сессия</div>
          <div className="card stack" style={{ gap: 0 }}>
            {upcoming.map((c) => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="row player-list-row player-list-row-upcoming"
              >
                {c.thumbnail_image_url ? (
                  <img src={c.thumbnail_image_url} alt="" className="player-list-avatar" />
                ) : (
                  <div className="player-list-avatar player-list-avatar-placeholder" />
                )}
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{c.name}</strong>
                  <div className="muted player-list-notes-preview">{formatNearestDate(c.next_planned_date!)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="player-list-letter">Кампании</div>
          <Link to="/campaigns" className="muted">
            все →
          </Link>
        </div>
        <div className="card stack" style={{ gap: 0 }}>
          {campaigns.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="row player-list-row">
              {c.thumbnail_image_url ? (
                <img src={c.thumbnail_image_url} alt="" className="player-list-avatar" />
              ) : (
                <div className="player-list-avatar player-list-avatar-placeholder" />
              )}
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{c.name}</strong>
                <div className="muted player-list-notes-preview">
                  {c.system_name ?? "система не выбрана"} · {c.setting_name ?? "без сеттинга"}
                </div>
              </div>
            </Link>
          ))}
          {campaigns.length === 0 && <p className="muted">Пока нет кампаний.</p>}
        </div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="player-list-letter">Сеттинги</div>
          <Link to="/settings" className="muted">
            все →
          </Link>
        </div>
        <div className="card stack" style={{ gap: 0 }}>
          {settings.map((s) => {
            const thumb = cardThumbnailProps(thumbnailStyles.settings, s.thumbnail_image_url ?? s.background_image_url);
            return (
              <Link key={s.id} to={`/settings/${s.id}`} className="row player-list-row">
                {thumb.bannerUrl ? (
                  <img src={thumb.bannerUrl} alt="" className="player-list-avatar" />
                ) : (
                  <div className="player-list-avatar player-list-avatar-placeholder" />
                )}
                <strong>{s.name}</strong>
              </Link>
            );
          })}
          {settings.length === 0 && <p className="muted">Пока нет сеттингов.</p>}
        </div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="player-list-letter">Системы</div>
          <Link to="/systems" className="muted">
            все →
          </Link>
        </div>
        <div className="card stack" style={{ gap: 0 }}>
          {systems.map((s) => (
            <Link key={s.id} to={`/systems/${s.id}`} className="row player-list-row">
              <strong>{s.name}</strong>
            </Link>
          ))}
          {systems.length === 0 && <p className="muted">Пока нет систем.</p>}
        </div>
      </div>
    </div>
  );
}
