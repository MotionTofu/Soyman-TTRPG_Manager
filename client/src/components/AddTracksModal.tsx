import { useEffect, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import type { Resource } from "../types";

type Scope = "session" | "setting";
type Mode = "upload" | "search";

interface SettingSummary {
  id: number;
  name: string;
}

interface Props {
  playlistId: number;
  scope: Scope;
  entityId: number;
  onClose: () => void;
  onAdded: () => void;
}

// Opened from a playlist's "+ Добавить треки" button. Two ways in:
// - upload files from the computer, which also lands them in this scope's
//   own "Звуки" resources (so they're not playlist-only orphans);
// - search audio resources across every setting and add one by reference,
//   without copying the file (same "attach" spirit as session resources).
export function AddTracksModal({ playlistId, scope, entityId, onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>("upload");
  const [uploading, setUploading] = useState(false);
  const [settings, setSettings] = useState<SettingSummary[]>([]);
  const [openSetting, setOpenSetting] = useState<SettingSummary | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Resource[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (mode === "search") api.get<SettingSummary[]>("/settings").then(setSettings);
  }, [mode]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("name", file.name);
        form.append("type", "link");
        form.append("scope", scope);
        form.append(scope === "session" ? "session_id" : "setting_id", String(entityId));
        form.append("category", "audio");
        form.append("file", file);
        const resource = await api.post<Resource>("/resources", form);
        await api.post(`/playlists/${playlistId}/items`, { resource_id: resource.id });
      }
      onAdded();
    } finally {
      setUploading(false);
    }
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    uploadFiles(files);
  }

  async function openFolder(setting: SettingSummary) {
    setOpenSetting(setting);
    setQuery("");
    setSearching(true);
    try {
      const rows = await api.get<Resource[]>(
        `/resources?scope=setting&category=audio&setting_id=${setting.id}`
      );
      setResults(rows);
    } finally {
      setSearching(false);
    }
  }

  function closeFolder() {
    setOpenSetting(null);
    setResults([]);
    setQuery("");
  }

  const visibleResults = query.trim()
    ? results.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    : results;

  async function addExisting(resourceId: number) {
    await api.post(`/playlists/${playlistId}/items`, { resource_id: resourceId });
    setAddedIds((prev) => new Set(prev).add(resourceId));
    onAdded();
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack" style={{ width: "min(380px, 100%)" }}>
        <h3 style={{ margin: 0 }}>Добавить треки</h3>
        <div className="row">
          <button
            type="button"
            className={mode === "upload" ? "primary" : ""}
            onClick={() => setMode("upload")}
          >
            С компьютера
          </button>
          <button
            type="button"
            className={mode === "search" ? "primary" : ""}
            onClick={() => setMode("search")}
          >
            Из ресурсов сеттингов
          </button>
        </div>

        {mode === "upload" ? (
          <div className="stack">
            <p className="muted">
              Файлы загрузятся в «Звуки» {scope === "session" ? "этой сессии" : "этого сеттинга"} и сразу
              добавятся в плейлист.
            </p>
            <label className="character-avatar-upload" style={{ alignSelf: "flex-start" }}>
              {uploading ? "Загрузка…" : "Выбрать файлы"}
              <input type="file" multiple accept="audio/*" style={{ display: "none" }} onChange={handleFilePick} disabled={uploading} />
            </label>
          </div>
        ) : openSetting == null ? (
          <div className="stack" style={{ gap: 0, maxHeight: 320, overflowY: "auto" }}>
            <p className="muted" style={{ marginTop: 0 }}>Выберите сеттинг, чтобы посмотреть его «Звуки».</p>
            {settings.map((s) => (
              <button
                key={s.id}
                type="button"
                className="row"
                style={{ justifyContent: "flex-start", gap: 8, padding: "6px 4px", background: "none", border: "none", cursor: "pointer" }}
                onClick={() => openFolder(s)}
              >
                <NavIcon name="folder" /> {s.name}
              </button>
            ))}
            {settings.length === 0 && <span className="muted">Сеттингов пока нет.</span>}
          </div>
        ) : (
          <div className="stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button type="button" onClick={closeFolder}>
                ← Назад
              </button>
              <strong className="row" style={{ gap: 4, display: "inline-flex", alignItems: "center" }}>
                <NavIcon name="folder" /> {openSetting.name}
              </strong>
            </div>
            <input
              placeholder="Фильтр по названию…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="stack" style={{ gap: 0, maxHeight: 280, overflowY: "auto" }}>
              {searching && <span className="muted">Загрузка…</span>}
              {!searching &&
                visibleResults.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                    <span>{r.name}</span>
                    <button
                      type="button"
                      onClick={() => addExisting(r.id)}
                      disabled={addedIds.has(r.id)}
                    >
                      {addedIds.has(r.id) ? "Добавлено" : "+ Добавить"}
                    </button>
                  </div>
                ))}
              {!searching && visibleResults.length === 0 && (
                <span className="muted">{query.trim() ? "Ничего не найдено." : "Треков в этом сеттинге пока нет."}</span>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
