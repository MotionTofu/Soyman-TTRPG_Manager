import type { ReactNode } from "react";
import { useAudioPlayer } from "../audioPlayer";
import { useResource } from "../data/hooks";
import { sessionPaths } from "../data/sessions";
import { formatDuration } from "../sound/duration";
import { useSoundEngineOptional } from "../sound/engine";
import type { Playlist } from "../types";

// Значки — из макета v2 (холст «Боевой режим»).
const ICON = {
  prev: "M4 3v10M13 3 6 8l7 5z",
  next: "M12 3v10M3 3l7 5-7 5z",
  play: "M4 2.5 13 8l-9 5.5z",
  pause: "M4 3h3v10H4zM9 3h3v10H9z",
  speaker: "M2 6h3l4-3v10l-4-3H2z",
};
function Icon({ d, size = 16, children }: { d: string; size?: number; children?: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="currentColor" stroke="currentColor" strokeWidth={d === ICON.prev || d === ICON.next ? 1.5 : 0} />
      {children}
    </svg>
  );
}

/**
 * Плеер боевой темы над лентой (Q32–Q35): то же воспроизведение, что включил
 * «Старт», — второй звук не заводится. Громкость — канал фона пульта звука
 * (Q33), «Заглушить» — его же «Тишина». Стингеров здесь нет (Q35).
 */
export function CombatPlayer({
  themeId,
  onTheme,
}: {
  themeId: number | null;
  onTheme: (id: number | null) => void;
}) {
  const player = useAudioPlayer();
  const sound = useSoundEngineOptional();
  const themes = useResource<Playlist[]>(sessionPaths.playlists()).data ?? [];
  const fromSet = sound?.state.data?.battle?.name;
  const silent = !!sound?.state.silence;
  const volume = sound?.state.volumes.background ?? 0;

  function toggle() {
    // Очередь есть, но ничего не выбрано (стоп на пульте) — играть с начала.
    if (player.index < 0 && player.tracks.length) player.playTrackAt(0);
    else player.toggle();
  }

  return (
    <div className="cm-player" aria-label="Боевая музыка">
      <label className="cm-player__theme">
        <span className="cm-ui">Боевая тема</span>
        <select value={themeId ?? ""} onChange={(e) => onTheme(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{fromSet ? `из набора: ${fromSet}` : "— из набора —"}</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="cm-pbtn" aria-label="Предыдущий трек" onClick={player.prev} disabled={!player.count}>
        <Icon d={ICON.prev} />
      </button>
      <button
        type="button"
        className="cm-pbtn cm-pbtn--main"
        aria-label={player.isPlaying ? "Пауза" : "Играть"}
        onClick={toggle}
        disabled={!player.count}
      >
        <Icon d={player.isPlaying ? ICON.pause : ICON.play} size={18} />
      </button>
      <button type="button" className="cm-pbtn" aria-label="Следующий трек" onClick={player.next} disabled={!player.count}>
        <Icon d={ICON.next} />
      </button>
      <div className="cm-track">
        <div className="cm-track__t">
          <span>{player.current?.name ?? "Ничего не играет"}</span>
          {player.duration > 0 && (
            <span className="cm-track__time">
              {formatDuration(player.currentTime)} / {formatDuration(player.duration)}
            </span>
          )}
        </div>
        <input
          type="range"
          aria-label="Перемотка"
          min={0}
          max={player.duration || 0}
          step={1}
          value={Math.min(player.currentTime, player.duration || 0)}
          disabled={!player.duration}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
      </div>
      {sound && (
        <>
          <label className="cm-vol">
            <span className="cm-ui">Громкость</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => sound.setVolume("background", Number(e.target.value) / 100)}
            />
          </label>
          <button
            type="button"
            className={`cm-pbtn${silent ? " is-on" : ""}`}
            aria-pressed={silent}
            title={silent ? "Вернуть звук" : "Заглушить"}
            aria-label={silent ? "Вернуть звук" : "Заглушить"}
            onClick={() => sound.setSilence(!silent)}
          >
            <Icon d={ICON.speaker}>
              {silent ? (
                <path d="m11 5 4 6m0-6-4 6" stroke="currentColor" strokeWidth={1.6} />
              ) : (
                <path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth={1.6} />
              )}
            </Icon>
          </button>
          {sound.state.autoSwitch && (
            <span className="cm-player__ret">
              после боя вернётся:{" "}
              {/* «прежнее» — заглушка движка, когда набора не было (engine.tsx, enterCombat) */}
              {sound.state.autoSwitch.from === "прежнее" ? "то, что играло до боя" : `набор «${sound.state.autoSwitch.from}»`}
            </span>
          )}
        </>
      )}
    </div>
  );
}
