import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";

interface SettingSummary {
  id: number;
  name: string;
  description: string | null;
  thumbnail_image_url: string | null;
  background_image_url: string | null;
}

function SettingTile({ s }: { s: SettingSummary }) {
  const rawUrl = s.thumbnail_image_url ?? s.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/settings/${s.id}`} className="card campaign-tile" style={{ textDecoration: "none" }}>
      {bg && (
        <div className="campaign-tile-cover cover-halftone">
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
          <div className="campaign-tile-scrim" />
        </div>
      )}
      <div className="campaign-tile-meta">
        <strong>{s.name}</strong>
        {s.description && (
          <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            <MentionText text={s.description} />
          </div>
        )}
      </div>
    </Link>
  );
}

// Player-role replacement for the GM's SettingsListPage — just the settings
// used by campaigns this player is actually in (see /api/player/settings).
export function PlayerSettingsListPage() {
  const [settings, setSettings] = useState<SettingSummary[] | null>(null);

  useEffect(() => {
    api.get<SettingSummary[]>("/player/settings").then(setSettings);
  }, []);

  if (!settings) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Сеттинги" }]} />
      <h1>Сеттинги</h1>
      {settings.length === 0 && <p className="muted">Ваши кампании пока не привязаны к сеттингу.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {settings.map((s) => (
          <SettingTile key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}
