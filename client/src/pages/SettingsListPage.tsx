import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { SettingWizard } from "../components/SettingWizard";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { ZineGraphic } from "../components/ZineGraphics";
import { GENRE_CATEGORIES } from "../genreData";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";

import type { Setting } from "../types";

function SettingCoverTile({ setting: s }: { setting: Setting }) {
  const rawUrl = s.thumbnail_image_url ?? s.background_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  const genres = s.genres ?? [];

  return (
    <Link to={`/settings/${s.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{s.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">
          {s.description ? <MentionText text={s.description} /> : "без описания"}
        </div>
        {genres.length > 0 && (
          <div className="genre-chips">
            {genres.map((g, i) => {
              const cat = GENRE_CATEGORIES.find((c) => c.name === g.genre);
              return (
                <span
                  key={i}
                  className="genre-chip"
                  style={{ "--genre-color": cat?.color ?? "#888" } as React.CSSProperties}
                >
                  {cat && <ZineGraphic name={cat.icon} className="genre-chip-icon" />}
                  {g.subgenre ?? g.genre}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

export function SettingsListPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadSettings(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<Setting[]>("/settings", signal ? { signal } : undefined);
      setSettings(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadSettings();
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  return (
    <div className="stack">
      <div className="page-header-row row">
        <SectionHeading section="settings" compact>Сеттинги</SectionHeading>
        <div className="row">
          <button onClick={() => navigate("/import")}>Импорт приключения</button>
          <button className="primary" onClick={() => setCreating(true)}>
            + Новый сеттинг
          </button>
        </div>
      </div>

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить сеттинги: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Загрузка сеттингов">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : (
        <div className="grid-cards">
          {settings.map((s) => (
            <SettingCoverTile key={s.id} setting={s} />
          ))}
        </div>
      )}

      {!loading && !loadError && settings.length === 0 && (
        <EmptyState
          icon="anarchyStar"
          title="Мир не начерчен"
          hint="Ни одного сеттинга ещё нет — создайте первый."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              + Новый сеттинг
            </button>
          }
        />
      )}

      {creating && <SettingWizard onClose={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}
