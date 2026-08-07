import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { loadListViewMode, saveListViewMode, type ListViewMode } from "../listViewMode";
import { ViewModeToggle } from "../components/ViewModeToggle";
import type { Setting } from "../types";

export function SettingsListPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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

  async function create() {
    if (!name.trim()) return;
    const created = await api.post<Setting>("/settings", { name, description });
    syncMentionLinks("setting", created.id, "", description);
    setCreating(false);
    setName("");
    setDescription("");
    refresh();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading>Сеттинги</SectionHeading>
        <div className="row">
          <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
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

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новый сеттинг</h2>
          <div className="stack">
            <label>
              Название
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Описание
              <MentionTextarea value={description} onChange={setDescription} />
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setCreating(false)}>Отмена</button>
              <button className="primary" onClick={create}>
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
