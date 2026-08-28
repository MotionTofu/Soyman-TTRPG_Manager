import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import { SettingWizard } from "../components/SettingWizard";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { loadListViewMode, saveListViewMode, type ListViewMode } from "../listViewMode";
import { ViewModeToggle } from "../components/ViewModeToggle";
import type { Setting } from "../types";

export function SettingsListPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<ListViewMode>(() => loadListViewMode("settings"));
  const thumbnailStyles = loadThumbnailStyles();

  function changeViewMode(m: ListViewMode) {
    setViewMode(m);
    saveListViewMode("settings", m);
  }

  function refresh() {
    api.get<Setting[]>("/settings").then(setSettings);
  }
  useEffect(refresh, []);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading section="settings">Сеттинги</SectionHeading>
        <div className="row">
          <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
          <button onClick={() => navigate("/import")}>Импорт приключения</button>
          <button className="primary" onClick={() => setCreating(true)}>
            + Новый сеттинг
          </button>
        </div>
      </div>
      <div className={`grid-cards mode-${viewMode}`}>
        {settings.map((s) => {
          const thumb = cardThumbnailProps(thumbnailStyles.settings, s.thumbnail_image_url ?? s.background_image_url);
          return (
          <Link
            key={s.id}
            to={`/settings/${s.id}`}
            className={`card ${thumb.className}`}
            style={thumb.style}
          >
            {thumb.showBanner && (
              thumb.bannerUrl ? (
                <img src={thumb.bannerUrl} alt="" className="campaign-thumb" />
              ) : (
                <div className="campaign-card-band zine-grain zine-torn-bottom-c" />
              )
            )}
            <h3>{s.name}</h3>
            {s.imported_at && <span className="badge tag">импортировано</span>}
            {s.description && (
              <div className="muted">
                <MentionText text={s.description} />
              </div>
            )}
          </Link>
          );
        })}
      </div>
      {settings.length === 0 && (
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
