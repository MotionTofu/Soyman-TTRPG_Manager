import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { formatNearestDate } from "../nearestDate";
import { isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { Campaign, Setting, System } from "../types";

// Mobile-first browsing surface combining the three "library" entity lists
// (Кампании/Сеттинги/Системы) into one screen reachable from the bottom
// nav's "Библиотека" button — a full create/manage UI already exists on
// each entity's own list page (/campaigns, /settings, /systems), so this
// view is read/navigate-only by design: every section carries a "все →" link
// there, and an empty section offers that link as its one action instead of
// dead-ending on «Пока нет …» (design_revision.md §1.11a).

// Обложки хранилища лежат за авторизацией (/files отдаётся только по токену
// или подписанному URL), поэтому сырой <img src> на них молча не грузится.
// Тот же приём, что в SettingsListPage/CampaignsListPage: путь /files/*
// подменяется blob-ссылкой, всё остальное отдаётся как есть.
function ListAvatar({ url }: { url: string | null | undefined }) {
  const safeUrl = url && isSafeImageUrl(url) ? url : null;
  const authBlob = useAuthenticatedFileUrl(safeUrl);
  const src = safeUrl?.startsWith("/files/") ? authBlob : safeUrl;
  return src ? (
    <img src={src} alt="" className="player-list-avatar" />
  ) : (
    <div className="player-list-avatar player-list-avatar-placeholder" />
  );
}

export function LibraryPage() {
  const navigate = useNavigate();
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
                <ListAvatar url={c.thumbnail_image_url} />
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
              <ListAvatar url={c.thumbnail_image_url} />
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{c.name}</strong>
                <div className="muted player-list-notes-preview">
                  {c.system_name ?? "система не выбрана"} · {c.setting_name ?? "без сеттинга"}
                </div>
              </div>
            </Link>
          ))}
          {campaigns.length === 0 && (
            <EmptyState
              title="Ни одной кампании"
              hint="История, игроки и расписание живут здесь."
              action={<button className="primary" onClick={() => navigate("/campaigns")}>Завести кампанию</button>}
            />
          )}
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
                <ListAvatar url={thumb.bannerUrl} />
                <strong>{s.name}</strong>
              </Link>
            );
          })}
          {settings.length === 0 && (
            <EmptyState
              title="Ни одного мира"
              hint="География, население и хроника — всё оттуда."
              action={<button className="primary" onClick={() => navigate("/settings")}>Создать сеттинг</button>}
            />
          )}
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
          {systems.length === 0 && (
            <EmptyState
              title="Ни одной системы"
              hint="Правила, по которым считаются статблоки."
              action={<button className="primary" onClick={() => navigate("/systems")}>Добавить систему</button>}
            />
          )}
        </div>
      </div>
    </div>
  );
}
