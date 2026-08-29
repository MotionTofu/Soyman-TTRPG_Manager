import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { MentionText } from "../components/mentions/MentionText";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";

import type { System } from "../types";

function SystemCoverTile({ system: s }: { system: System }) {
  const rawUrl = s.thumbnail_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/systems/${s.id}`} className="card campaign-tile">
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
        {s.imported_at && (
          <div className="campaign-tile-next">
            <span className="campaign-tile-next-mark" aria-hidden="true" />
            <span>импортировано</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export function SystemsListPage() {
  const [systems, setSystems] = useState<System[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function loadSystems(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<System[]>("/systems", signal ? { signal } : undefined);
      setSystems(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadSystems(controller.signal);
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadSystems();
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  async function create() {
    if (!name.trim()) return;
    try {
      await api.post("/systems", { name, description });
      setCreating(false);
      setName("");
      setDescription("");
      refresh();
    } catch {
      // Modal stays open — user can retry
    }
  }

  return (
    <div className="stack">
      <div className="page-header-row row">
        <SectionHeading section="systems" compact>Системы</SectionHeading>
        <div className="row">
          <button onClick={() => navigate("/import-system")}>Импорт книги правил</button>
          <button className="primary" onClick={() => setCreating(true)}>
            + Новая система
          </button>
        </div>
      </div>

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить системы: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Загрузка систем">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : (
        <div className="grid-cards">
          {systems.map((s) => (
            <SystemCoverTile key={s.id} system={s} />
          ))}
        </div>
      )}

      {!loading && !loadError && systems.length === 0 && (
        <EmptyState
          icon="issueStamp"
          title="Правил ещё нет"
          hint="Ни одной системы не заведено — добавьте первую."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              + Новая система
            </button>
          }
        />
      )}

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
            <div className="modal-footer row">
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
