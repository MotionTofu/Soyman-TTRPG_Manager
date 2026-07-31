import { useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { useAudioPlayer, type AudioTrack } from "../audioPlayer";
import { AddTracksModal } from "./AddTracksModal";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import type { Playlist, PlaylistDetail, SearchResult } from "../types";

type Scope = "session" | "setting";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface AttachedPlaylist {
  linkId: number;
  playlist: Playlist;
}

interface Props {
  scope: Scope;
  entityId: number;
  // Only meaningful for scope==="session": the campaign's setting, if any —
  // lets the session attach one of that setting's playlists without
  // duplicating anything (same generic_links pattern as attached_resource).
  settingId?: number | null;
  // Notifies the parent (ResourcesSection) that the owned-playlist list
  // changed, so sibling UI with its own copy of that list (the Звуки bulk
  // "отправить в плейлист" dropdown) can refetch instead of going stale.
  onPlaylistsChanged?: () => void;
  // Only meaningful for scope==="session": the current session's battle
  // playlist (sessions.battle_playlist_id) and a setter for it. Omitted by
  // callers with no session in context (e.g. a setting's Ресурсы tab), in
  // which case the per-row toggle button simply doesn't render.
  battlePlaylistId?: number | null;
  onSetBattlePlaylist?: (id: number | null) => void;
}

export function PlaylistsSection({
  scope,
  entityId,
  settingId,
  onPlaylistsChanged,
  battlePlaylistId,
  onSetBattlePlaylist,
}: Props) {
  const { playPlaylist, activePlaylistId, isPlaying, index: activeIndex } = useAudioPlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [attached, setAttached] = useState<AttachedPlaylist[]>([]);
  const [settingPlaylists, setSettingPlaylists] = useState<Playlist[]>([]);
  const [details, setDetails] = useState<Record<number, PlaylistDetail>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingTrackId, setRenamingTrackId] = useState<number | null>(null);
  const [trackRenameDraft, setTrackRenameDraft] = useState("");
  const [trackRenameEverywhere, setTrackRenameEverywhere] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<number | null>(null);
  const [addTracksFor, setAddTracksFor] = useState<number | null>(null);

  function loadOwned() {
    api
      .get<Playlist[]>(`/playlists?scope=${scope}&${scope === "session" ? "session_id" : "setting_id"}=${entityId}`)
      .then(setPlaylists);
  }

  async function loadAttached() {
    if (scope !== "session") return;
    const links = await api.get<GenericLink[]>(
      `/links?type=session&id=${entityId}&section=attached_playlist`
    );
    const resolved = await Promise.all(
      links.map(async (l) => {
        const playlistId = l.from_type === "playlist" ? l.from_id : l.to_id;
        try {
          const playlist = await api.get<Playlist>(`/playlists/${playlistId}`);
          return { linkId: l.id, playlist };
        } catch {
          return null;
        }
      })
    );
    setAttached(resolved.filter((e): e is AttachedPlaylist => e !== null));
  }

  useEffect(() => {
    loadOwned();
    loadAttached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, entityId]);

  useEffect(() => {
    if (scope !== "session" || !settingId) {
      setSettingPlaylists([]);
      return;
    }
    api.get<Playlist[]>(`/playlists?scope=setting&setting_id=${settingId}`).then(setSettingPlaylists);
  }, [scope, settingId]);

  async function loadDetail(id: number) {
    const detail = await api.get<PlaylistDetail>(`/playlists/${id}`);
    setDetails((prev) => ({ ...prev, [id]: detail }));
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (!details[id]) loadDetail(id);
      }
      return next;
    });
  }

  async function createPlaylist() {
    if (!newName.trim()) return;
    await api.post("/playlists", {
      name: newName.trim(),
      scope,
      [scope === "session" ? "session_id" : "setting_id"]: entityId,
    });
    setNewName("");
    loadOwned();
    onPlaylistsChanged?.();
  }

  async function saveRename(id: number) {
    if (!renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    await api.put(`/playlists/${id}`, { name: renameDraft.trim() });
    setRenamingId(null);
    loadOwned();
    setDetails((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], name: renameDraft.trim() } } : prev));
    onPlaylistsChanged?.();
  }

  async function deletePlaylist(id: number) {
    if (!confirm("Удалить плейлист? Файлы ресурсов не пострадают.")) return;
    await api.del(`/playlists/${id}`);
    loadOwned();
    onPlaylistsChanged?.();
  }

  async function attachSettingPlaylist(playlistId: number) {
    await api.post("/links", {
      from_type: "session",
      from_id: entityId,
      to_type: "playlist",
      to_id: playlistId,
      section: "attached_playlist",
    });
    loadAttached();
  }

  async function detachPlaylist(linkId: number) {
    await api.del(`/links/${linkId}`);
    loadAttached();
  }

  async function removeTrack(playlistId: number, itemId: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/playlists/${playlistId}/items/${itemId}`);
    loadDetail(playlistId);
    loadOwned();
  }

  function sortAlphabetically(playlistId: number) {
    const detail = details[playlistId];
    if (!detail) return;
    const sorted = [...detail.items].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const ids = sorted.map((it) => it.id);
    setDetails((prev) => ({
      ...prev,
      [playlistId]: { ...detail, items: sorted.map((it, i) => ({ ...it, position: i })) },
    }));
    api.put(`/playlists/${playlistId}/items/reorder`, { order: ids });
  }

  function trackDrop(playlistId: number, targetId: number) {
    const detail = details[playlistId];
    if (!detail || dragItemId == null || dragItemId === targetId) return;
    const ids = detail.items.map((it) => it.id);
    const from = ids.indexOf(dragItemId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const byId = new Map(detail.items.map((it) => [it.id, it]));
    setDetails((prev) => ({
      ...prev,
      [playlistId]: { ...detail, items: ids.map((id, i) => ({ ...byId.get(id)!, position: i })) },
    }));
    api.put(`/playlists/${playlistId}/items/reorder`, { order: ids });
    setDragItemId(null);
  }

  // A playlist block accepts two kinds of external drops: native OS files
  // (uploaded straight into this scope's Звуки, then added), or a dragged
  // search-result / Звуки row (SEARCH_DRAG_MIME) — added by reference, no
  // file copy either way.
  async function handleExternalDrop(e: DragEvent<HTMLDivElement>, playlistId: number) {
    e.preventDefault();
    setDragOverPlaylistId(null);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (raw) {
      const result: SearchResult = JSON.parse(raw);
      if (result.type !== "resource") return;
      await api.post(`/playlists/${playlistId}/items`, { resource_id: result.id });
      loadDetail(playlistId);
      loadOwned();
      return;
    }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    for (const file of files) {
      const form = new FormData();
      form.append("name", file.name);
      form.append("type", "link");
      form.append("scope", scope);
      form.append(scope === "session" ? "session_id" : "setting_id", String(entityId));
      form.append("category", "audio");
      form.append("file", file);
      const resource = await api.post<{ id: number }>("/resources", form);
      await api.post(`/playlists/${playlistId}/items`, { resource_id: resource.id });
    }
    loadDetail(playlistId);
    loadOwned();
  }

  function playNow(id: number, startIndex = 0) {
    const detail = details[id];
    if (detail) {
      const tracks: AudioTrack[] = detail.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src! }));
      playPlaylist(tracks, startIndex, id);
      return;
    }
    api.get<PlaylistDetail>(`/playlists/${id}`).then((d) => {
      setDetails((prev) => ({ ...prev, [id]: d }));
      const tracks: AudioTrack[] = d.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src! }));
      playPlaylist(tracks, startIndex, id);
    });
  }

  async function saveTrackName(playlistId: number, itemId: number, resourceId: number, everywhere: boolean) {
    const name = trackRenameDraft.trim();
    if (!name) {
      setRenamingTrackId(null);
      return;
    }
    if (everywhere) {
      await api.put(`/resources/${resourceId}`, { name });
    } else {
      await api.put(`/playlists/${playlistId}/items/${itemId}`, { custom_name: name });
    }
    setRenamingTrackId(null);
    loadDetail(playlistId);
  }

  const attachedPlaylistIds = new Set(attached.map((a) => a.playlist.id));
  const attachableSettingPlaylists = settingPlaylists.filter((p) => !attachedPlaylistIds.has(p.id));
  const allPlaylists = [...playlists, ...attached.map((a) => a.playlist)];

  return (
    <div className="stack playlists-section">
      <div className="row">
        <input
          placeholder="Название нового плейлиста"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
        />
        <button type="button" onClick={createPlaylist} disabled={!newName.trim()}>
          + Новый плейлист
        </button>
        {scope === "session" && settingId && attachableSettingPlaylists.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) attachSettingPlaylist(Number(e.target.value));
            }}
          >
            <option value="">Прикрепить плейлист сеттинга…</option>
            {attachableSettingPlaylists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {allPlaylists.length === 0 && <p className="muted">Плейлистов пока нет.</p>}

      {allPlaylists.map((p) => {
        const isAttached = attachedPlaylistIds.has(p.id);
        const isExpanded = expanded.has(p.id);
        const detail = details[p.id];
        return (
          <div
            key={p.id}
            className={`card stack playlist-block${dragOverPlaylistId === p.id ? " drag-over" : ""}`}
            style={{ gap: 6 }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverPlaylistId(p.id);
            }}
            onDragLeave={() => setDragOverPlaylistId(null)}
            onDrop={(e) => handleExternalDrop(e, p.id)}
          >
            <div
              className="row playlist-header"
              style={{ justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => toggleExpand(p.id)}
            >
              <div className="row" style={{ gap: 8 }}>
                <span className="muted">{isExpanded ? "▾" : "▸"}</span>
                {renamingId === p.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => saveRename(p.id)}
                    onKeyDown={(e) => e.key === "Enter" && saveRename(p.id)}
                  />
                ) : (
                  <strong>{p.name}</strong>
                )}
                {p.id === activePlaylistId && (
                  <span className="muted" title={isPlaying ? "Сейчас играет" : "Открыт в плеере"}>
                    {isPlaying ? "🔊" : "⏸"}
                  </span>
                )}
                {isAttached && <span className="muted">🔗 из сеттинга</span>}
                <span className="muted">{p.item_count} треков</span>
              </div>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => playNow(p.id)} disabled={p.item_count === 0}>
                  ▶ Играть
                </button>
                {onSetBattlePlaylist && (
                  <button
                    type="button"
                    onClick={() => onSetBattlePlaylist(p.id === battlePlaylistId ? null : p.id)}
                    title={p.id === battlePlaylistId ? "Убрать пометку «тема боя»" : "Сделать темой боя"}
                  >
                    {p.id === battlePlaylistId ? "⚔️" : "🗡"}
                  </button>
                )}
                {!isAttached && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(p.id);
                      setRenameDraft(p.name);
                    }}
                    title="Переименовать"
                  >
                    ✎
                  </button>
                )}
                {isAttached ? (
                  <button
                    type="button"
                    onClick={() => {
                      const entry = attached.find((a) => a.playlist.id === p.id);
                      if (entry) detachPlaylist(entry.linkId);
                    }}
                    title="Открепить от сессии"
                  >
                    Открепить
                  </button>
                ) : (
                  <button type="button" onClick={() => deletePlaylist(p.id)}>
                    🗑
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="stack" style={{ gap: 0 }} onClick={(e) => e.stopPropagation()}>
                {!detail && <span className="muted">Загрузка…</span>}
                {detail?.items.map((item, itemIndex) => {
                  const isActiveTrack =
                    p.id === activePlaylistId && itemIndex === activeIndex && detail.items[activeIndex]?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      className="row playlist-track-row"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.stopPropagation();
                        trackDrop(p.id, item.id);
                      }}
                      style={{ justifyContent: "space-between" }}
                    >
                      {renamingTrackId === item.id ? (
                        <span className="row" style={{ gap: 6, flex: 1 }}>
                          <input
                            autoFocus
                            value={trackRenameDraft}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setTrackRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveTrackName(p.id, item.id, item.resource_id, trackRenameEverywhere);
                              if (e.key === "Escape") setRenamingTrackId(null);
                            }}
                            style={{ flex: 1 }}
                          />
                          <label className="row muted" style={{ gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
                            <input
                              type="checkbox"
                              checked={trackRenameEverywhere}
                              onChange={(e) => setTrackRenameEverywhere(e.target.checked)}
                            />
                            везде
                          </label>
                          <button
                            type="button"
                            onClick={() => saveTrackName(p.id, item.id, item.resource_id, trackRenameEverywhere)}
                          >
                            ✓
                          </button>
                        </span>
                      ) : (
                        <span className="row" style={{ gap: 8 }}>
                          <span
                            className="comp-drag-handle"
                            title="Перетащить, чтобы изменить порядок"
                            draggable
                            onDragStart={(ev) => {
                              ev.dataTransfer.setData("text/plain", String(item.id));
                              ev.dataTransfer.effectAllowed = "move";
                              setDragItemId(item.id);
                            }}
                          >
                            ⠿
                          </span>
                          <button
                            type="button"
                            className="playlist-track-play-btn"
                            title="Играть этот трек"
                            onClick={() => playNow(p.id, itemIndex)}
                          >
                            {isActiveTrack && isPlaying ? "🔊" : "▶"}
                          </button>
                          {item.name}
                        </span>
                      )}
                      <span className="row" onClick={(e) => e.stopPropagation()}>
                        {renamingTrackId !== item.id && (
                          <button
                            type="button"
                            title="Переименовать трек"
                            onClick={() => {
                              setRenamingTrackId(item.id);
                              setTrackRenameDraft(item.name);
                              setTrackRenameEverywhere(false);
                            }}
                          >
                            ✎
                          </button>
                        )}
                        <button type="button" onClick={() => removeTrack(p.id, item.id)}>
                          ✕
                        </button>
                      </span>
                    </div>
                  );
                })}
                {detail?.items.length === 0 && <span className="muted">Треков пока нет.</span>}
                <div className="row">
                  <button type="button" onClick={() => setAddTracksFor(p.id)}>
                    + Добавить треки
                  </button>
                  {detail && detail.items.length > 1 && (
                    <button type="button" onClick={() => sortAlphabetically(p.id)} title="Отсортировать треки по алфавиту">
                      А-Я
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {addTracksFor != null && (
        <AddTracksModal
          playlistId={addTracksFor}
          scope={scope}
          entityId={entityId}
          onClose={() => setAddTracksFor(null)}
          onAdded={() => {
            loadDetail(addTracksFor);
            loadOwned();
          }}
        />
      )}
    </div>
  );
}
