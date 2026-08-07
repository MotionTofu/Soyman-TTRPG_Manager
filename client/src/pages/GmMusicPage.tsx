import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAudioPlayer, type AudioTrack } from "../audioPlayer";
import { SectionHeading } from "../components/SectionHeading";
import { AddTracksModal } from "../components/AddTracksModal";
import { NavIcon } from "../components/NavIcons";
import type { AppSettings, Playlist, PlaylistDetail, Resource } from "../types";

const TABS = ["Треки", "Плейлисты", "Импорт", "Настройки"] as const;
type Tab = (typeof TABS)[number];

// GM-only full-screen music management window, reached from AudioPlayerBar's
// "🎛 Открыть плеер" button — everything here operates on the whole storage
// (not scoped to one session/setting), unlike ResourcesSection/PlaylistsSection
// which are entity-scoped. Reuses existing endpoints as-is: GET /resources
// and GET /playlists already return an unscoped "everything" list when called
// with no scope filter — no new backend was needed for this page.
export function GmMusicPage() {
  const [tab, setTab] = useState<Tab>("Треки");

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading>Плеер</SectionHeading>
        <Link to="/">← Назад</Link>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Треки" && <TracksTab />}
      {tab === "Плейлисты" && <PlaylistsTab />}
      {tab === "Импорт" && <ImportTab />}
      {tab === "Настройки" && <SettingsTab />}
    </div>
  );
}

function TracksTab() {
  const { playPlaylist, current } = useAudioPlayer();
  const [tracks, setTracks] = useState<Resource[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.get<Resource[]>("/resources?category=audio").then(setTracks);
  }, []);

  const visible = tracks.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  function play(index: number) {
    const list: AudioTrack[] = visible
      .filter((t) => t.file_url || t.link_url)
      .map((t) => ({ id: t.id, name: t.name, src: (t.file_url || t.link_url) as string }));
    playPlaylist(list, index, null);
  }

  return (
    <div className="stack">
      <input
        placeholder="Поиск по названию…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="card stack" style={{ gap: 0 }}>
        {visible.map((t, i) => (
          <div key={t.id} className="row player-list-row track-row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="comp-mini" onClick={() => play(i)} title="Играть">
              <NavIcon name={current?.id === t.id ? "volume" : "play"} />
            </button>
            <span className="track-row-name">{t.name}</span>
            {t.setting_name && <span className="badge tag">{t.setting_name}</span>}
          </div>
        ))}
        {visible.length === 0 && <p className="muted">Ничего не найдено.</p>}
      </div>
      {tracks.length > 0 && <p className="muted" style={{ textAlign: "center" }}>Всего треков: {tracks.length}</p>}
    </div>
  );
}

function groupBy(items: Playlist[], keyOf: (p: Playlist) => string): [string, Playlist[]][] {
  const map = new Map<string, Playlist[]>();
  for (const p of items) {
    const key = keyOf(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return [...map.entries()];
}

function PlaylistsTab() {
  const { playPlaylist, activePlaylistId, isPlaying, index: activeIndex } = useAudioPlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, PlaylistDetail>>({});
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [addTracksFor, setAddTracksFor] = useState<Playlist | null>(null);

  function refresh() {
    api.get<Playlist[]>("/playlists").then(setPlaylists);
  }
  useEffect(refresh, []);

  async function loadDetail(id: number) {
    const detail = await api.get<PlaylistDetail>(`/playlists/${id}`);
    setDetails((prev) => ({ ...prev, [id]: detail }));
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = prev === id ? null : id;
      if (next !== null && !details[next]) loadDetail(next);
      return next;
    });
  }

  function play(id: number) {
    const detail = details[id];
    if (detail) {
      const tracks: AudioTrack[] = detail.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src as string }));
      playPlaylist(tracks, 0, id);
      return;
    }
    api.get<PlaylistDetail>(`/playlists/${id}`).then((d) => {
      setDetails((prev) => ({ ...prev, [id]: d }));
      const tracks: AudioTrack[] = d.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src as string }));
      playPlaylist(tracks, 0, id);
    });
  }

  function playTrack(id: number, startIndex: number) {
    const detail = details[id];
    if (!detail) return;
    const tracks: AudioTrack[] = detail.items
      .filter((it) => it.src)
      .map((it) => ({ id: it.resource_id, name: it.name, src: it.src as string }));
    playPlaylist(tracks, startIndex, id);
  }

  async function rename(id: number) {
    if (!renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    await api.put(`/playlists/${id}`, { name: renameDraft.trim() });
    setRenamingId(null);
    refresh();
  }

  async function remove(id: number) {
    if (!confirm("Удалить плейлист?")) return;
    await api.del(`/playlists/${id}`);
    refresh();
  }

  async function removeTrack(playlistId: number, itemId: number) {
    await api.del(`/playlists/${playlistId}/items/${itemId}`);
    loadDetail(playlistId);
    refresh();
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

  const settingGroups = groupBy(
    playlists.filter((p) => p.scope === "setting"),
    (p) => p.setting_name || "Без сеттинга"
  );
  const sessionGroups = groupBy(
    playlists.filter((p) => p.scope === "session"),
    (p) => `${p.campaign_name || "Кампания"} — ${p.session_date || "?"}`
  );

  function renderRow(p: Playlist) {
    const isExpanded = expanded === p.id;
    const detail = details[p.id];
    return (
      <div key={p.id} className="stack" style={{ gap: 0 }}>
        <div
          className="row player-list-row track-row"
          style={{ justifyContent: "space-between", cursor: "pointer" }}
          onClick={() => toggleExpand(p.id)}
        >
          <button
            type="button"
            className="comp-mini"
            onClick={(e) => {
              e.stopPropagation();
              play(p.id);
            }}
            title="Играть"
          >
            <NavIcon name={activePlaylistId === p.id ? "volume" : "play"} />
          </button>
          {renamingId === p.id ? (
            <input
              autoFocus
              value={renameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => rename(p.id)}
              onKeyDown={(e) => e.key === "Enter" && rename(p.id)}
              style={{ flex: 1 }}
            />
          ) : (
            <span className="track-row-name">{p.name} ({p.item_count})</span>
          )}
          <span className="muted">{isExpanded ? "▾" : "▸"}</span>
          <button
            type="button"
            title="Переименовать"
            onClick={(e) => {
              e.stopPropagation();
              setRenamingId(p.id);
              setRenameDraft(p.name);
            }}
          >
            <NavIcon name="edit" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(p.id);
            }}
            title="Удалить"
          >
            <NavIcon name="delete" />
          </button>
        </div>

        {isExpanded && (
          <div className="stack playlist-block" style={{ gap: 0, padding: "6px 6px 10px" }}>
            {!detail && <span className="muted">Загрузка…</span>}
            {detail?.items.map((item, itemIndex) => {
              const isActiveTrack =
                p.id === activePlaylistId && itemIndex === activeIndex && detail.items[activeIndex]?.id === item.id;
              return (
                <div
                  key={item.id}
                  className="row playlist-track-row"
                  style={{ justifyContent: "space-between" }}
                  onDragOver={(e: DragEvent<HTMLDivElement>) => e.preventDefault()}
                  onDrop={(e: DragEvent<HTMLDivElement>) => {
                    e.stopPropagation();
                    trackDrop(p.id, item.id);
                  }}
                >
                  <span className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
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
                      onClick={() => playTrack(p.id, itemIndex)}
                    >
                      <NavIcon name={isActiveTrack && isPlaying ? "volume" : "play"} />
                    </button>
                    <span className="track-row-name">{item.name}</span>
                  </span>
                  <button type="button" onClick={() => removeTrack(p.id, item.id)} title="Убрать из плейлиста">
                    <NavIcon name="close" />
                  </button>
                </div>
              );
            })}
            {detail?.items.length === 0 && <span className="muted">Треков пока нет.</span>}
            <div className="row" style={{ marginTop: 6 }}>
              <button type="button" onClick={() => setAddTracksFor(p)}>
                + Добавить треки
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {playlists.length === 0 && <p className="muted">Плейлистов пока нет.</p>}
      {settingGroups.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="player-list-letter">Сеттинги</div>
          {settingGroups.map(([name, items]) => (
            <div key={name} className="stack" style={{ gap: 4 }}>
              <div className="muted">{name}</div>
              <div className="card stack" style={{ gap: 0 }}>
                {items.map(renderRow)}
              </div>
            </div>
          ))}
        </div>
      )}
      {sessionGroups.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="player-list-letter">Сессии</div>
          {sessionGroups.map(([name, items]) => (
            <div key={name} className="stack" style={{ gap: 4 }}>
              <div className="muted">{name}</div>
              <div className="card stack" style={{ gap: 0 }}>
                {items.map(renderRow)}
              </div>
            </div>
          ))}
        </div>
      )}

      {addTracksFor && (
        <AddTracksModal
          playlistId={addTracksFor.id}
          scope={addTracksFor.scope}
          entityId={(addTracksFor.scope === "session" ? addTracksFor.session_id : addTracksFor.setting_id) as number}
          onClose={() => setAddTracksFor(null)}
          onAdded={() => {
            loadDetail(addTracksFor.id);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ImportTab() {
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setDone(0);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("name", file.name);
        form.append("type", "link");
        form.append("scope", "global");
        form.append("category", "audio");
        form.append("file", file);
        await api.post<Resource>("/resources", form);
        setDone((d) => d + 1);
      }
    } finally {
      setUploading(false);
    }
  }

  function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    uploadFiles(files);
  }

  return (
    <div className="stack">
      <p className="muted">
        Загруженные файлы попадают в общую библиотеку «Треки» (не привязаны к конкретной сессии или сеттингу).
      </p>
      <input ref={inputRef} type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={handlePick} />
      <button className="primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? `Загружаю… (${done})` : "Выбрать файлы"}
      </button>
    </div>
  );
}

function SettingsTab() {
  const [fadeDraft, setFadeDraft] = useState("0");

  function refresh() {
    api.get<AppSettings>("/app-settings").then((s) => {
      setFadeDraft(String(Math.round(s.fade_duration_ms / 1000)));
    });
  }
  useEffect(refresh, []);

  async function save() {
    const seconds = Math.max(0, Number(fadeDraft) || 0);
    await api.put("/app-settings/fade-duration", { fade_duration_ms: seconds * 1000 });
    refresh();
  }

  return (
    <div className="card stack">
      <label className="row" style={{ gap: 6, alignItems: "center" }}>
        Длительность кроссфейда (сек.)
        <input
          type="number"
          min={0}
          value={fadeDraft}
          onChange={(e) => setFadeDraft(e.target.value)}
          style={{ width: 80 }}
        />
      </label>
      <button className="primary" onClick={save} style={{ alignSelf: "flex-start" }}>
        Сохранить
      </button>
    </div>
  );
}
