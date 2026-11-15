import { useAudioPlayer } from "../audioPlayer";
import { Modal } from "../components/Modal";
import { NavIcon } from "../components/NavIcons";
import { useEntity, useResource } from "../data/hooks";
import { useGalleryImage } from "../media/galleryImages";
import { useSoundEngineOptional } from "../sound/engine";
import type { PlaylistDetail, Resource, Setting } from "../types";
import "./media-library.css";

function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function NowPlayingSheet({ onClose }: { onClose: () => void }) {
  const {
    current, tracks, index, count, isPlaying, currentTime, duration, repeatMode, shuffleMode,
    activePlaylistId, toggle, next, prev, seek, playTrackAt, setRepeatMode, setShuffleMode,
  } = useAudioPlayer();
  const activeSet = useSoundEngineOptional()?.state.data?.set;
  const playlist = useResource<PlaylistDetail>(activePlaylistId ? `/playlists/${activePlaylistId}` : null).data;
  const resource = useEntity<Resource>("resource", current?.id ?? null).data;
  const setting = useEntity<Setting>("setting", resource?.setting_id ?? null).data;
  const cover = useGalleryImage(setting?.background_image_url || setting?.thumbnail_image_url);
  const repeat = repeatMode === "track" ? "Один трек" : repeatMode === "playlist" ? "По кругу" : "Выключен";
  const subtitle = [activeSet?.name ?? playlist?.name, count > 1 ? `${index + 1} из ${count}` : ""].filter(Boolean).join(" · ");

  return (
    <Modal onClose={onClose} ariaLabel="Сейчас играет" className="media-playing">
      <h2>Сейчас играет</h2>
      {!current ? <p className="media-playing__empty">Очередь пуста.</p> : (
        <div className="media-playing__body">
          <div className="media-playing__cover">
            {cover && <img src={cover} alt="" />}
            <div>
              <strong>{current.name}</strong>
              {subtitle && <span>{subtitle}</span>}
            </div>
          </div>

          <div className="now-playing-seek">
            <input type="range" aria-label="Позиция трека" min={0} max={duration || 0} step={0.1}
              value={Math.min(currentTime, duration || 0)} onChange={event => seek(Number(event.target.value))} />
            <div className="media-playing__times">
              <span className="muted">{formatTime(currentTime)}</span>
              <span className="muted">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="now-playing-controls">
            <button type="button" aria-pressed={shuffleMode} className={shuffleMode ? "active" : ""}
              onClick={() => setShuffleMode(!shuffleMode)} title="Случайный порядок"><NavIcon name="shuffle" /></button>
            <button type="button" onClick={prev} disabled={!shuffleMode && index <= 0} title="Предыдущий трек"><NavIcon name="prev" /></button>
            <button type="button" className="now-playing-play" onClick={toggle} title={isPlaying ? "Пауза" : "Играть"}>
              <NavIcon name={isPlaying ? "pause" : "play"} />
            </button>
            <button type="button" onClick={next} disabled={!shuffleMode && index >= count - 1 && repeatMode !== "playlist"} title="Следующий трек">
              <NavIcon name="next" />
            </button>
            <button type="button" className={repeatMode !== "off" ? "active" : ""} aria-label={`Повтор: ${repeat.toLowerCase()}`}
              onClick={() => setRepeatMode(repeatMode === "off" ? "playlist" : repeatMode === "playlist" ? "track" : "off")} title={repeat}>
              <NavIcon name={repeatMode === "track" ? "repeatTrack" : "repeatPlaylist"} />
            </button>
          </div>

          <p className="media-playing__repeat">Повтор · {repeat.toLowerCase()}</p>
          {tracks.length > 1 && (
            <details className="now-playing-queue">
              <summary className="muted now-playing-queue-head">Очередь · {tracks.length}</summary>
              {tracks.map((track, position) => (
                <button key={position} type="button" aria-current={position === index}
                  className={position === index ? "now-playing-queue-row active" : "now-playing-queue-row"}
                  onClick={() => { if (position !== index) playTrackAt(position); }}>
                  <span className="now-playing-queue-num">{position + 1}</span>
                  <span className="now-playing-queue-name">{track.name}</span>
                </button>
              ))}
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
