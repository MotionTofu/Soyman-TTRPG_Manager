import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAudioPlayer, type AudioTrack } from "../audioPlayer";
import { NavIcon } from "./NavIcons";
import type { Playlist, PlaylistDetail } from "../types";

interface Props {
  onClose: () => void;
}

// Popover opened from the player's "Открыть плейлист" button — browses
// every playlist in the vault, grouped Сеттинги > <сеттинг> > плейлисты and
// Сессии > <кампания, дата> > плейлисты, and starts playback on click.
export function PlaylistNavMenu({ onClose }: Props) {
  const { playPlaylist } = useAudioPlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    api.get<Playlist[]>("/playlists").then(setPlaylists);
  }, []);

  async function select(id: number) {
    const detail = await api.get<PlaylistDetail>(`/playlists/${id}`);
    const tracks: AudioTrack[] = detail.items
      .filter((it) => it.src)
      .map((it) => ({ id: it.resource_id, name: it.name, src: it.src as string }));
    playPlaylist(tracks, 0, id);
    onClose();
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

  const settingGroups = groupBy(
    playlists.filter((p) => p.scope === "setting"),
    (p) => p.setting_name || "Без сеттинга"
  );
  const sessionGroups = groupBy(
    playlists.filter((p) => p.scope === "session"),
    (p) => `${p.campaign_name || "Кампания"} — ${p.session_date || "?"}`
  );

  return (
    <div className="playlist-nav-menu">
      {playlists.length === 0 && <div className="muted" style={{ padding: 8 }}>Плейлистов пока нет.</div>}
      {settingGroups.length > 0 && (
        <details open className="playlist-nav-group">
          <summary>Сеттинги</summary>
          {settingGroups.map(([name, items]) => (
            <details key={name} className="playlist-nav-subgroup">
              <summary>{name}</summary>
              {items.map((p) => (
                <button key={p.id} type="button" className="playlist-nav-item" onClick={() => select(p.id)}>
                  <NavIcon name="player" /> {p.name} ({p.item_count})
                </button>
              ))}
            </details>
          ))}
        </details>
      )}
      {sessionGroups.length > 0 && (
        <details className="playlist-nav-group">
          <summary>Сессии</summary>
          {sessionGroups.map(([name, items]) => (
            <details key={name} className="playlist-nav-subgroup">
              <summary>{name}</summary>
              {items.map((p) => (
                <button key={p.id} type="button" className="playlist-nav-item" onClick={() => select(p.id)}>
                  <NavIcon name="player" /> {p.name} ({p.item_count})
                </button>
              ))}
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
