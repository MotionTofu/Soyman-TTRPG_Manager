import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAudioPlayer } from "../audioPlayer";
import { NavIcon } from "../components/NavIcons";
import type { PlaylistDetail, Resource, Setting } from "../types";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Full-screen "now playing" view, opened by tapping MiniPlayerBar — same
// spirit as a phone's system music player. The cover art isn't the track's
// own (resources don't carry artwork) — per the user's request it's one of
// the setting images tied to whatever's playing. Resolved two ways: primarily
// via the current track's own resource (every resource already carries its
// own setting_id/setting_name — works whether the track came from a playlist
// or was played ad-hoc from the Треки library, where there's no playlist at
// all); falls back to the active playlist's own setting (directly, or via
// session -> campaign -> setting) only if the resource itself has none.
export function NowPlayingPage() {
  const navigate = useNavigate();
  const {
    current,
    tracks,
    index,
    count,
    isPlaying,
    currentTime,
    duration,
    repeatMode,
    shuffleMode,
    activePlaylistId,
    toggle,
    next,
    prev,
    seek,
    playTrackAt,
    setRepeatMode,
    setShuffleMode,
  } = useAudioPlayer();

  // Играющая строка сама подкручивается в видимую часть — на телефоне список
  // длиннее экрана всегда.
  // Кадром позже, а не сразу: на монтировании страницы список ещё не получил
  // окончательную высоту, и прокрутка уезжала в никуда. Строка ставится по
  // центру, а не «ближайшим краем»: у нижнего края её накрывает плавающая
  // навигация.
  const activeTrackRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      activeTrackRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [index]);

  const [subtitle, setSubtitle] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    setCoverUrl(null);
    setSubtitle("");
    if (!current) return;
    let cancelled = false;

    async function resolveSetting(): Promise<Setting | null> {
      // Primary: the playing resource's own home setting.
      try {
        const resource = await api.get<Resource>(`/resources/${current!.id}`);
        if (resource.setting_id) return await api.get<Setting>(`/settings/${resource.setting_id}`);
      } catch {
        // fall through to the playlist-based lookup below
      }
      // Запасного пути по плейлисту больше нет: плейлист остался только
      // боевой темой и ничьему сеттингу не принадлежит. Если у самого трека
      // сеттинга нет — обложки не будет, и это честнее выдуманной.
      return null;
    }

    async function resolve() {
      if (activePlaylistId) {
        api
          .get<PlaylistDetail>(`/playlists/${activePlaylistId}`)
          .then((p) => !cancelled && setSubtitle(p.name))
          .catch(() => {});
      }
      const setting = await resolveSetting();
      if (!cancelled && setting) {
        setCoverUrl(setting.background_image_url || setting.thumbnail_image_url);
      }
    }
    resolve().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current, activePlaylistId]);

  if (!current) {
    navigate("/", { replace: true });
    return null;
  }

  return (
    <div className="now-playing-page">
      <div className="now-playing-topbar">
        <button type="button" onClick={() => navigate(-1)} title="Закрыть">
          ⌄
        </button>
        <span className="muted">Сейчас играет</span>
        <span />
      </div>

      <div className="now-playing-cover">
        {coverUrl ? (
          <img src={coverUrl} alt="" />
        ) : (
          <NavIcon name="player" className="now-playing-cover-placeholder" />
        )}
      </div>

      <div className="now-playing-info">
        <strong>{current.name}</strong>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>

      <div className="now-playing-seek">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">{formatTime(currentTime)}</span>
          <span className="muted">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="now-playing-controls">
        <button
          type="button"
          className={shuffleMode ? "active" : ""}
          onClick={() => setShuffleMode(!shuffleMode)}
          title="Случайный порядок"
        >
          <NavIcon name="shuffle" />
        </button>
        <button type="button" onClick={prev} disabled={!shuffleMode && index <= 0} title="Предыдущий трек">
          <NavIcon name="prev" />
        </button>
        <button type="button" className="now-playing-play" onClick={toggle} title={isPlaying ? "Пауза" : "Играть"}>
          <NavIcon name={isPlaying ? "pause" : "play"} />
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!shuffleMode && index >= count - 1 && repeatMode !== "playlist"}
          title="Следующий трек"
        >
          <NavIcon name="next" />
        </button>
        <button
          type="button"
          className={repeatMode !== "off" ? "active" : ""}
          onClick={() => setRepeatMode(repeatMode === "off" ? "playlist" : repeatMode === "playlist" ? "track" : "off")}
          title={
            repeatMode === "off" ? "Повтор выключен" : repeatMode === "playlist" ? "По кругу" : "Один трек"
          }
        >
          <NavIcon name={repeatMode === "track" ? "repeatTrack" : "repeatPlaylist"} />
        </button>
      </div>

      {/* Очередь целиком: щелчок по строке переключает на неё. Страница из-за
          этого стала прокручиваемой — обложку не режем, она здесь и есть
          главное, а список живёт ниже транспорта. */}
      {tracks.length > 1 ? (
        <div className="now-playing-queue">
          <div className="muted now-playing-queue-head">Очередь · {tracks.length}</div>
          {tracks.map((t, i) => (
            <button
              key={i}
              type="button"
              className={i === index ? "now-playing-queue-row active" : "now-playing-queue-row"}
              ref={i === index ? activeTrackRef : undefined}
              onClick={() => {
                if (i === index) return; // по играющему не бьём
                playTrackAt(i);
              }}
            >
              <span className="now-playing-queue-num">{i + 1}</span>
              <span className="now-playing-queue-name">{t.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
