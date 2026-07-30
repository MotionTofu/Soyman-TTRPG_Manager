import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { cardThumbnailProps, loadThumbnailStyles } from "../thumbnailStyles";
import { SectionHeading } from "../components/SectionHeading";
import { loadListViewMode, saveListViewMode, type ListViewMode } from "../listViewMode";
import { ViewModeToggle } from "../components/ViewModeToggle";
import type { System } from "../types";

export function SystemsListPage() {
  const [systems, setSystems] = useState<System[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [viewMode, setViewMode] = useState<ListViewMode>(() => loadListViewMode("systems"));
  const thumbnailStyles = loadThumbnailStyles();

  function changeViewMode(m: ListViewMode) {
    setViewMode(m);
    saveListViewMode("systems", m);
  }

  function refresh() {
    api.get<System[]>("/systems").then(setSystems);
  }
  useEffect(refresh, []);

  async function create() {
    if (!name.trim()) return;
    await api.post("/systems", { name, description });
    setCreating(false);
    setName("");
    setDescription("");
    refresh();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading>Системы</SectionHeading>
        <div className="row">
          <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
          <button className="primary" onClick={() => setCreating(true)}>
            + Новая система
          </button>
        </div>
      </div>
      <p className="muted page-subtitle">Правила игры: D&amp;D 5.5, Legend in the Mist и другие — описание, правила, заметки и шаблоны статблоков.</p>
      <div className={`grid-cards mode-${viewMode}`}>
        {systems.map((s) => {
          const thumb = cardThumbnailProps(thumbnailStyles.systems, s.thumbnail_image_url);
          return (
          <Link key={s.id} to={`/systems/${s.id}`} className={`card ${thumb.className}`} style={thumb.style}>
            {thumb.showBanner && (
              thumb.bannerUrl ? (
                <img src={thumb.bannerUrl} alt="" className="campaign-thumb" />
              ) : (
                <div className="campaign-card-band" />
              )
            )}
            <h3>{s.name}</h3>
            {s.description && <p className="muted">{s.description}</p>}
          </Link>
          );
        })}
        {systems.length === 0 && <p className="muted">Пока нет систем.</p>}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новая система</h2>
          <div className="stack">
            <label>
              Название
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Описание
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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
