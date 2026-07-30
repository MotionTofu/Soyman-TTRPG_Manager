import { useEffect, useRef, useState } from "react";
import type { Campaign, CalendarSession, GenericLink, Playlist, PlaylistDetail, SessionDetail } from "./types";
import { MentionText } from "./MentionText";
import { parseMentions } from "./mentions";

interface LinkedEntry {
  type: string;
  id: number;
  label: string;
}

// Merges real drag-dropped links with @-mentions found in idea_notes (same
// "auto-surface" behavior as the desktop session page — see mentions.ts),
// deduped by type:id so a being that's both linked and mentioned only shows
// once. Mention labels come straight from the [[type:id|Label]] token, no
// extra fetch needed.
function mergeWithMentions(links: LinkedEntry[], ideaNotes: string, types: string[]): LinkedEntry[] {
  const seen = new Set(links.map((l) => `${l.type}:${l.id}`));
  const mentioned = parseMentions(ideaNotes)
    .filter((m) => types.includes(m.type) && !seen.has(`${m.type}:${m.id}`))
    .map((m) => ({ type: m.type, id: m.id, label: m.label }));
  return [...links, ...mentioned];
}

interface Props {
  session: CalendarSession;
  serverUrl: string;
  token: string;
  onOpenImages: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  planned: "Запланировано",
  held: "Состоялась",
  cancelled: "Отмена",
  rescheduled: "Перенесена",
};

// Fetches a /files/* URL with the auth header a plain <a>/<audio> element
// can't attach, and hands back a local blob URL — same fix used everywhere
// else this app touches protected media (ImagePicker thumbnails, playlist
// playback).
async function fetchAsBlobUrl(src: string, serverUrl: string, token: string): Promise<string> {
  const url = src.startsWith("/files/") ? `${serverUrl.replace(/\/$/, "")}${src}` : src;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Не удалось загрузить файл");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function triggerDownload(blobUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function SessionView({ session, serverUrl, token, onOpenImages }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [playlistsAreFromSetting, setPlaylistsAreFromSetting] = useState(false);
  const [plotCharacterLinks, setPlotCharacterLinks] = useState<LinkedEntry[]>([]);
  const [locationLinks, setLocationLinks] = useState<LinkedEntry[]>([]);
  const [loot, setLoot] = useState<LinkedEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    window.gmApp
      .apiGet<SessionDetail>(`/api/sessions/${session.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    loadPlaylists();
    loadLinkedSection("plot_characters", setPlotCharacterLinks);
    loadLinkedSection("locations", setLocationLinks);
    loadLinkedSection("loot", setLoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Most sessions don't have their own playlist yet — falls back to the
  // campaign's setting playlist (same "nearest session, else its setting"
  // logic as the desktop always-on player bar) rather than just showing
  // nothing, since a setting's ambiance tracks are still exactly what a GM
  // wants cued up mid-session.
  async function loadPlaylists() {
    try {
      const sessionPlaylists = await window.gmApp.apiGet<Playlist[]>(
        `/api/playlists?scope=session&session_id=${session.id}`
      );
      if (sessionPlaylists.length > 0) {
        setPlaylists(sessionPlaylists);
        setPlaylistsAreFromSetting(false);
        return;
      }
      const campaign = await window.gmApp.apiGet<Campaign>(`/api/campaigns/${session.campaign_id}`);
      if (!campaign.setting_id) {
        setPlaylists([]);
        return;
      }
      const settingPlaylists = await window.gmApp.apiGet<Playlist[]>(
        `/api/playlists?scope=setting&setting_id=${campaign.setting_id}`
      );
      setPlaylists(settingPlaylists);
      setPlaylistsAreFromSetting(true);
    } catch {
      setPlaylists([]);
    }
  }

  async function loadLinkedSection(section: string, setter: (rows: LinkedEntry[]) => void) {
    try {
      const links = await window.gmApp.apiGet<GenericLink[]>(
        `/api/links?type=session&id=${session.id}&section=${section}`
      );
      const resolved = await Promise.all(
        links.map(async (l) => {
          const other =
            l.from_type === "session" && l.from_id === session.id
              ? { type: l.to_type, id: l.to_id }
              : { type: l.from_type, id: l.from_id };
          const label = await resolveLabel(other.type, other.id);
          return { ...other, label };
        })
      );
      setter(resolved);
    } catch {
      setter([]);
    }
  }

  async function resolveLabel(type: string, id: number): Promise<string> {
    const endpoint = type === "being" ? "/api/setting-beings" : type === "character" ? "/api/characters" : type === "location" ? "/api/setting-locations" : type === "resource" ? "/api/resources" : null;
    if (!endpoint) return `${type} #${id}`;
    try {
      const entity = await window.gmApp.apiGet<Record<string, unknown>>(`${endpoint}/${id}`);
      return String(entity.character_name ?? entity.name ?? id);
    } catch {
      return `${type} #${id}`;
    }
  }

  const plotCharacters = detail
    ? mergeWithMentions(plotCharacterLinks, detail.idea_notes, ["being", "character"])
    : plotCharacterLinks;
  const locations = detail
    ? mergeWithMentions(locationLinks, detail.idea_notes, ["location"])
    : locationLinks;

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>
        {session.campaign_name} — {session.title || (session.date ?? "")}
      </h2>
      <div className="row" style={{ alignItems: "center" }}>
        <span className="muted">{session.date}</span>
        {detail && <span className="badge planned">{STATUS_LABELS[detail.status] || detail.status}</span>}
      </div>

      <button onClick={onOpenImages} style={{ alignSelf: "flex-start" }}>
        🖼 Показать изображение
      </button>

      {error && <p className="error">{error}</p>}

      {detail && (
        <>
          {detail.attendance.length > 0 && (
            <div className="card stack">
              <strong className="entry-title">Игроки</strong>
              <div className="stack" style={{ gap: 4 }}>
                {detail.attendance.map((a) => (
                  <div key={a.player_id} className="row" style={{ justifyContent: "space-between" }}>
                    <span>{a.name}</span>
                    <span className={a.attended ? "badge held" : "muted"}>
                      {a.attended ? "Пришёл" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.idea_notes && (
            <div className="card stack">
              <strong className="entry-title">Задумка</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={detail.idea_notes} />
              </div>
            </div>
          )}
          {detail.main_events && (
            <div className="card stack">
              <strong className="entry-title">Основные события</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={detail.main_events} />
              </div>
            </div>
          )}

          {plotCharacters.length > 0 && (
            <div className="card stack">
              <strong className="entry-title">Сюжетные персонажи</strong>
              <div className="stack" style={{ gap: 4 }}>
                {plotCharacters.map((e) => (
                  <span key={`${e.type}-${e.id}`}>{e.label}</span>
                ))}
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <div className="card stack">
              <strong className="entry-title">Локации</strong>
              <div className="stack" style={{ gap: 4 }}>
                {locations.map((e) => (
                  <span key={`${e.type}-${e.id}`}>{e.label}</span>
                ))}
              </div>
            </div>
          )}

          {loot.length > 0 && (
            <div className="card stack">
              <strong className="entry-title">Потенциальный лут</strong>
              <div className="stack" style={{ gap: 4 }}>
                {loot.map((e) => (
                  <span key={`${e.type}-${e.id}`}>{e.label}</span>
                ))}
              </div>
            </div>
          )}

          {detail.resources.filter((r) => r.category !== "audio").length > 0 && (
            <div className="card stack">
              <strong className="entry-title">Ресурсы сессии</strong>
              <div className="stack" style={{ gap: 4 }}>
                {detail.resources
                  .filter((r) => r.category !== "audio")
                  .map((r) => (
                    <ResourceRow key={r.id} resource={r} serverUrl={serverUrl} token={token} />
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {playlists?.length === 0 && (
        <p className="muted">
          Плейлистов нет ни у сессии, ни у сеттинга кампании — добавьте их в мастер-клиенте.
        </p>
      )}
      {playlists?.map((p) => (
        <PlaylistPlayer
          key={p.id}
          playlistId={p.id}
          name={p.name}
          serverUrl={serverUrl}
          token={token}
          fromSetting={playlistsAreFromSetting}
        />
      ))}
    </div>
  );
}

function ResourceRow({
  resource,
  serverUrl,
  token,
}: {
  resource: { id: number; name: string; file_url?: string | null; link_url: string | null };
  serverUrl: string;
  token: string;
}) {
  const [busy, setBusy] = useState(false);

  async function openOrDownload() {
    if (resource.link_url && !resource.file_url) {
      window.open(resource.link_url, "_blank");
      return;
    }
    if (!resource.file_url) return;
    setBusy(true);
    try {
      const blobUrl = await fetchAsBlobUrl(resource.file_url, serverUrl, token);
      triggerDownload(blobUrl, resource.name);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="row"
      onClick={openOrDownload}
      disabled={busy}
      style={{ justifyContent: "space-between", alignSelf: "stretch" }}
    >
      <span>{resource.name}</span>
      <span className="muted">{busy ? "…" : resource.file_url ? "⬇" : "↗"}</span>
    </button>
  );
}

function PlaylistPlayer({
  playlistId,
  name,
  serverUrl,
  token,
  fromSetting,
}: {
  playlistId: number;
  name: string;
  serverUrl: string;
  token: string;
  fromSetting: boolean;
}) {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(-1);
  const [downloadingIndex, setDownloadingIndex] = useState(-1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    window.gmApp.apiGet<PlaylistDetail>(`/api/playlists/${playlistId}`).then(setDetail);
  }, [playlistId]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  async function play(i: number) {
    const item = detail?.items[i];
    if (!item?.src || !audioRef.current) return;
    setLoadingIndex(i);
    try {
      const objectUrl = await fetchAsBlobUrl(item.src, serverUrl, token);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = objectUrl;
      audioRef.current.src = objectUrl;
      await audioRef.current.play().catch(() => {});
      setIndex(i);
      setPlaying(true);
    } finally {
      setLoadingIndex(-1);
    }
  }

  async function download(i: number) {
    const item = detail?.items[i];
    if (!item?.src) return;
    setDownloadingIndex(i);
    try {
      const blobUrl = await fetchAsBlobUrl(item.src, serverUrl, token);
      triggerDownload(blobUrl, item.name);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } finally {
      setDownloadingIndex(-1);
    }
  }

  function toggle() {
    if (!audioRef.current || index < 0) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setPlaying(!playing);
  }

  if (!detail) return <p className="muted">Загрузка плейлиста «{name}»…</p>;

  return (
    <div className="card stack">
      <strong className="entry-title">
        🎵 {fromSetting ? "Плейлист сеттинга" : "Плейлист сессии"} — {detail.name}
      </strong>
      {detail.items.map((item, i) => (
        <div key={item.id} className="row" style={{ justifyContent: "space-between" }}>
          <button
            onClick={() => play(i)}
            style={{ alignSelf: "flex-start", flex: 1, textAlign: "left" }}
            disabled={!item.src || loadingIndex === i}
          >
            {loadingIndex === i ? "…" : i === index && playing ? "🔊" : "▶"} {item.name}
          </button>
          <button
            onClick={() => download(i)}
            disabled={!item.src || downloadingIndex === i}
            title="Скачать на устройство"
          >
            {downloadingIndex === i ? "…" : "⬇"}
          </button>
        </div>
      ))}
      {index >= 0 && (
        <div className="row">
          <button onClick={toggle}>{playing ? "⏸" : "▶"}</button>
        </div>
      )}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
    </div>
  );
}
