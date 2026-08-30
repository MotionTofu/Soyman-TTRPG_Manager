import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Link } from "react-router-dom";
import { api } from "./api/client";
import { NavIcon } from "./components/NavIcons";


export interface AudioTrack {
  id: number;
  name: string;
  src: string;
}

export type RepeatMode = "off" | "track" | "playlist";

interface PlayerState {
  tracks: AudioTrack[];
  index: number;
  isPlaying: boolean;
  // The playlist this queue came from, if any (drag-drop tracks or a bare
  // playPlaylist call with no id leave this null) — lets the playlist list
  // show which one is currently playing.
  activePlaylistId: number | null;
}

interface AudioPlayerContextValue {
  current: AudioTrack | null;
  tracks: AudioTrack[];
  index: number;
  count: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffleMode: boolean;
  activePlaylistId: number | null;
  playPlaylist: (
    tracks: AudioTrack[],
    startIndex?: number,
    playlistId?: number | null,
    startTime?: number
  ) => void;
  playTrackAt: (index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  halt: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setBackgroundGain: (gain: number) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleMode: (on: boolean) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}

const VOLUME_STORAGE_KEY = "audioPlayerVolume";
const REPEAT_STORAGE_KEY = "audioPlayerRepeatMode";
const SHUFFLE_STORAGE_KEY = "audioPlayerShuffleMode";

function loadStoredVolume(): number {
  const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (stored == null) return 1;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
}

function loadStoredRepeatMode(): RepeatMode {
  const raw = localStorage.getItem(REPEAT_STORAGE_KEY);
  return raw === "track" || raw === "playlist" ? raw : "off";
}

function loadStoredShuffleMode(): boolean {
  return localStorage.getItem(SHUFFLE_STORAGE_KEY) === "1";
}

// Mounted once at the app root, outside the routed <Outlet/> — so playback
// survives navigating to a different page instead of unmounting with
// whichever page started the playlist.
//
// Two <audio> elements, not one: a genuine crossfade needs the incoming
// track already playing (silently) while the outgoing one is still ramping
// down, which a single element can't do — swapping its `src` cuts the
// outgoing track off outright. `activeSlot` tracks which element is "live"
// for seek/volume/progress purposes; a crossfade ramps both in lockstep and
// then flips which one is active.
// A ~50ms silent WAV, used only to "arm" an <audio> element from within a
// real user gesture before it has ever had a track loaded. Mobile browsers
// (iOS Safari in particular) block .play() on a given element unless that
// exact element was already played at least once inside a user-gesture call
// stack — a natural track-end crossfade (triggered by the 'ended' event, not
// a click) plays the *inactive* element for the first time, which silently
// failed on mobile until this unlock ran once, from a real tap.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const unlockedRef = useRef(false);

  // Called synchronously at the top of every function that's only ever
  // reachable from a click handler (toggle/playPlaylist/playTrackAt/next/
  // prev) — primes BOTH elements while still inside that gesture's call
  // stack, so a later programmatic play() (e.g. the inactive element's fade-
  // in during a natural track-end crossfade) is allowed instead of silently
  // rejected. Runs once per page load.
  function unlockAudioElements() {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    for (const el of [audioARef.current, audioBRef.current]) {
      if (!el) continue;
      if (!el.src) el.src = SILENT_WAV;
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.then(() => el.pause()).catch(() => {});
      } else {
        el.pause();
      }
    }
  }

  const [state, setState] = useState<PlayerState>({
    tracks: [],
    index: -1,
    isPlaying: false,
    activePlaylistId: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const [progress, setProgress] = useState({ currentTime: 0, duration: 0 });
  const [volume, setVolumeState] = useState(loadStoredVolume);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>(loadStoredRepeatMode);
  const [shuffleMode, setShuffleModeState] = useState<boolean>(loadStoredShuffleMode);

  // Множитель фоновой громкости от sound engine (дакинг, тишина).
  // Реальная громкость audio-элемента = volume * bgGain.
  // Это позволяет пульту управлять дакингом, не ломая пользовательский ползунок.
  const bgGainRef = useRef(1);

  function applyVolume(v: number, bg: number) {
    const effective = Math.min(1, Math.max(0, v * bg));
    const a = audioARef.current;
    const b = audioBRef.current;
    if (a) a.volume = effective;
    if (b) b.volume = effective;
  }

  // The configurable gap between tracks (Настройки → Внешний вид). 0 (the
  // default) skips the ramp entirely — a plain, instant switch.
  const fadeMsRef = useRef(0);
  const fadeTimerRef = useRef<number | null>(null);
  const isFadingRef = useRef(false);
  useEffect(() => {
    api.get<{ fade_duration_ms: number }>("/app-settings").then((s) => {
      fadeMsRef.current = s.fade_duration_ms || 0;
    });
  }, []);

  // Синхронизация громкости с audio-элементами при изменении volume.
  // Реальная громкость = volume * bgGain (множитель от sound engine).
  useEffect(() => {
    applyVolume(volume, bgGainRef.current);
  }, [volume]);

  function getActive(): HTMLAudioElement | null {
    return activeSlotRef.current === "a" ? audioARef.current : audioBRef.current;
  }
  function getInactive(): HTMLAudioElement | null {
    return activeSlotRef.current === "a" ? audioBRef.current : audioARef.current;
  }

  function clearFadeTimer() {
    if (fadeTimerRef.current != null) {
      window.clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    isFadingRef.current = false;
  }

  // Instant switch: load the track straight into the active element and
  // play immediately. Used for the first track of a freshly chosen
  // playlist/track pick, and whenever no fade duration is configured.
  // startAt — не перемотка ради перемотки: так пульт возвращает Бэкграунд
  // ровно туда, где его застал бой. Секунда назначается после loadedmetadata,
  // иначе браузер отбросит её на ещё не загруженном треке.
  function hardSwitch(newIndex: number, startAt = 0) {
    unlockAudioElements();
    clearFadeTimer();
    const active = getActive();
    const track = stateRef.current.tracks[newIndex];
    if (!active || !track) return;
    getInactive()?.pause();
    active.src = track.src;
    active.currentTime = 0;
    active.volume = volume * bgGainRef.current;
    if (startAt > 0) {
      const seekOnce = () => {
        active.removeEventListener("loadedmetadata", seekOnce);
        try {
          active.currentTime = startAt;
        } catch {
          /* трек короче запомненной позиции — начнём сначала */
        }
      };
      active.addEventListener("loadedmetadata", seekOnce);
    }
    active.play().catch(() => {});
    setProgress({ currentTime: startAt, duration: 0 });
    setState((s) => ({ ...s, index: newIndex, isPlaying: true }));
  }

  // Crossfade: the incoming track starts on the inactive element at volume
  // 0 and ramps up, while the outgoing (active) track ramps down — both at
  // once. Which element is "active" (and the displayed index/name/progress)
  // flips immediately, not when the ramp finishes — the fade is a background
  // audio transition, the UI shouldn't lag behind the user's click waiting
  // for it.
  function crossfadeSwitch(newIndex: number) {
    unlockAudioElements();
    const outgoing = getActive();
    const incoming = getInactive();
    const track = stateRef.current.tracks[newIndex];
    const fadeMs = fadeMsRef.current;
    if (!outgoing || !incoming || !track) return;
    if (fadeMs <= 0 || outgoing.paused) {
      hardSwitch(newIndex);
      return;
    }
    clearFadeTimer();
    isFadingRef.current = true;
    const startVolume = outgoing.volume;
    const targetVolume = volume;
    incoming.src = track.src;
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.play().catch(() => {});
    setActiveSlot((prev) => (prev === "a" ? "b" : "a"));
    setProgress({ currentTime: 0, duration: 0 });
    setState((s) => ({ ...s, index: newIndex, isPlaying: true }));
    const steps = Math.max(1, Math.round(fadeMs / 50));
    let i = 0;
    fadeTimerRef.current = window.setInterval(() => {
      i++;
      const t = Math.min(1, i / steps);
      outgoing.volume = startVolume * (1 - t);
      incoming.volume = targetVolume * t;
      if (t >= 1) {
        clearFadeTimer();
        outgoing.pause();
      }
    }, fadeMs / steps);
  }

  function playPlaylist(
    tracks: AudioTrack[],
    startIndex = 0,
    playlistId: number | null = null,
    startTime = 0
  ) {
    if (tracks.length === 0) return;
    clearFadeTimer();
    // hardSwitch reads stateRef synchronously — setState alone wouldn't be
    // visible to it until the next render, so seed the ref directly too.
    const next = { tracks, index: startIndex, isPlaying: true, activePlaylistId: playlistId };
    stateRef.current = next;
    setState(next);
    hardSwitch(startIndex, startTime);
  }

  // Jumps to one track within the *current* queue (e.g. clicking ▶ on a
  // single row of an already-open playlist) — crossfades like next/prev,
  // same as any other track transition.
  function playTrackAt(index: number) {
    if (index < 0 || index >= stateRef.current.tracks.length) return;
    crossfadeSwitch(index);
  }

  function toggle() {
    unlockAudioElements();
    const active = getActive();
    setState((s) => {
      if (s.index < 0) return s;
      const nowPlaying = !s.isPlaying;
      if (active) {
        if (nowPlaying) active.play().catch(() => {});
        else active.pause();
      }
      return { ...s, isPlaying: nowPlaying };
    });
  }

  function computeAdvance(delta: number): number | null {
    const s = stateRef.current;
    if (s.tracks.length === 0) return null;
    // Shuffle picks a random *other* track for both next and prev — with
    // more than one track queued there's no meaningful "previous" order to
    // walk backwards through once playback order stopped being sequential.
    if (shuffleMode) {
      if (s.tracks.length === 1) return repeatMode === "off" && delta > 0 ? null : 0;
      let candidate = Math.floor(Math.random() * s.tracks.length);
      while (candidate === s.index) candidate = Math.floor(Math.random() * s.tracks.length);
      return candidate;
    }
    let nextIndex = s.index + delta;
    if (nextIndex >= s.tracks.length) {
      if (repeatMode !== "playlist") return null;
      nextIndex = 0;
    }
    if (nextIndex < 0) nextIndex = 0;
    return nextIndex;
  }

  function next() {
    const nextIndex = computeAdvance(1);
    if (nextIndex == null) {
      setState((s) => ({ ...s, isPlaying: false }));
      return;
    }
    crossfadeSwitch(nextIndex);
  }

  function prev() {
    const nextIndex = computeAdvance(-1);
    if (nextIndex == null) return;
    crossfadeSwitch(nextIndex);
  }

  function stop() {
    clearFadeTimer();
    audioARef.current?.pause();
    audioBRef.current?.pause();
    setState({ tracks: [], index: -1, isPlaying: false, activePlaylistId: null });
  }

  // Стоп канала с ручки пульта: музыка встаёт и активного трека больше нет, но
  // очередь остаётся на экране — Мастер видит, что канал заряжен, просто
  // выключен. Отличие от stop() ровно в этом: тот уносит и очередь, и его
  // жмёт набор без музыки, которому нечего показывать.
  function halt() {
    clearFadeTimer();
    audioARef.current?.pause();
    audioBRef.current?.pause();
    setState((s) => ({ ...s, index: -1, isPlaying: false }));
    setProgress({ currentTime: 0, duration: 0 });
  }

  function seek(time: number) {
    const active = getActive();
    if (!active) return;
    active.currentTime = time;
    setProgress((p) => ({ ...p, currentTime: time }));
  }

  function setVolume(v: number) {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    // Mid-crossfade, the ramp owns both elements' volume — don't fight it.
    if (!isFadingRef.current) {
      applyVolume(clamped, bgGainRef.current);
    }
  }

  function setBackgroundGain(g: number) {
    const clamped = Math.min(1, Math.max(0, g));
    bgGainRef.current = clamped;
    applyVolume(volume, clamped);
  }

  function setRepeatMode(mode: RepeatMode) {
    setRepeatModeState(mode);
    localStorage.setItem(REPEAT_STORAGE_KEY, mode);
  }

  function setShuffleMode(on: boolean) {
    setShuffleModeState(on);
    localStorage.setItem(SHUFFLE_STORAGE_KEY, on ? "1" : "0");
  }

  // "Repeat track" replays the same track in place (no fade, no element
  // swap) rather than going through next() — everything else, including
  // wrap-to-start for "repeat playlist", flows through next()'s crossfade.
  function handleEnded(e: SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== getActive()) return; // stray event from the just-faded-out element
    if (repeatMode === "track") {
      const active = getActive();
      if (active) {
        active.currentTime = 0;
        active.play().catch(() => {});
      }
      return;
    }
    next();
  }

  function handleTimeUpdate(e: SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== getActive()) return;
    // Read synchronously — React nulls out e.currentTarget once this handler
    // returns, but the setProgress updater below can run later (after
    // batching), so closing over `e` itself would crash.
    const time = e.currentTarget.currentTime;
    setProgress((p) => ({ ...p, currentTime: time }));
  }

  function handleLoadedMetadata(e: SyntheticEvent<HTMLAudioElement>) {
    if (e.currentTarget !== getActive()) return;
    const dur = e.currentTarget.duration || 0;
    setProgress((p) => ({ ...p, duration: dur }));
  }

  const current = state.index >= 0 ? (state.tracks[state.index] ?? null) : null;

  // Global keyboard shortcuts for the player bar. Only when no input/textarea
  // is focused, no modal is open, and no contentEditable element is active.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (document.querySelector(".modal-backdrop")) return;
      const shift = e.shiftKey;
      if (e.code === "Space" && !shift) { e.preventDefault(); toggle(); return; }
      if (shift) {
        if (e.code === "KeyS") { e.preventDefault(); stop(); return; }
        if (e.code === "KeyM") { e.preventDefault(); setVolume(volume > 0 ? 0 : 1); return; }
        if (e.code === "ArrowLeft") { e.preventDefault(); prev(); return; }
        if (e.code === "ArrowRight") { e.preventDefault(); next(); return; }
        if (e.code === "KeyR") {
          e.preventDefault();
          const modes: RepeatMode[] = ["off", "playlist", "track"];
          setRepeatMode(modes[(modes.indexOf(repeatMode) + 1) % modes.length]);
          return;
        }
        if (e.code === "KeyX") { e.preventDefault(); setShuffleMode(!shuffleMode); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, stop, volume, setVolume, prev, next, repeatMode, setRepeatMode, shuffleMode, setShuffleMode]);

  return (
    <AudioPlayerContext.Provider
      value={{
        current,
        tracks: state.tracks,
        index: state.index,
        count: state.tracks.length,
        isPlaying: state.isPlaying,
        currentTime: progress.currentTime,
        duration: progress.duration,
        volume,
        repeatMode,
        shuffleMode,
        activePlaylistId: state.activePlaylistId,
        playPlaylist,
        playTrackAt,
        toggle,
        next,
        prev,
        stop,
        halt,
        seek,
        setVolume,
        setBackgroundGain,
        setRepeatMode,
        setShuffleMode,
      }}
    >
      {children}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioARef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
      />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioBRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
      />
    </AudioPlayerContext.Provider>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  // Часы показываем часами: в библиотеке есть трёхчасовые фоновые записи, и
  // «180:11» вместо «3:00:11» читается как ошибка, а не как длительность.
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayerBar({
  extras,
  empty,
}: { extras?: ReactNode; empty?: ReactNode } = {}) {
  const {
    current,
    index,
    count,
    isPlaying,
    currentTime,
    duration,
    volume,
    repeatMode,
    shuffleMode,
    toggle,
    next,
    prev,
    stop,
    seek,
    setVolume,
    setRepeatMode,
    setShuffleMode,
  } = useAudioPlayer();

  const [showRemaining, setShowRemaining] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Shift+? toggles keyboard shortcuts overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "?" || e.code === "Slash")) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if ((e.target as HTMLElement)?.isContentEditable) return;
        if (document.querySelector(".modal-backdrop")) return;
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Раскладка одна и та же независимо от того, играет что-то или нет:
  // кнопки справа не должны переезжать по панели, когда трек кончился.
  // Меняется только содержимое левой части.
  if (!current) {
    return (
      <div className="audio-player-bar">
        <span className="audio-player-now">
          {empty ?? (
            <span className="audio-player-empty" role="status">
              <span className="muted">Ничего не играет</span>
              <span className="audio-player-empty-hint">· Нажмите «Включить набор» или выберите в пульте</span>
            </span>
          )}
        </span>
        <span className="audio-player-divider" />
        {extras}
        <button
          type="button"
          className="audio-player-btn audio-player-help"
          onClick={() => setShowShortcuts((v) => !v)}
          aria-label="Горячие клавиши"
          title="Горячие клавиши (Shift+?)"
        >
          ?
        </button>
      </div>
    );
  }

  const elapsedOrRemaining = showRemaining
    ? `-${formatTime(duration - currentTime)}`
    : formatTime(currentTime);

  return (
    <div
      className="audio-player-bar"
      onWheel={(e) => {
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setVolume(Math.min(1, Math.max(0, volumeRef.current + delta)));
      }}
    >
      <span className="audio-player-transport">
        <button type="button" onClick={prev} disabled={!shuffleMode && index <= 0} aria-label="Предыдущий трек" title="Предыдущий трек (Shift+←)">
          <NavIcon name="prev" />
        </button>
        <button type="button" onClick={toggle} aria-label={isPlaying ? "Пауза" : "Играть"} title={isPlaying ? "Пауза (Пробел)" : "Играть (Пробел)"}>
          <NavIcon name={isPlaying ? "pause" : "play"} />
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!shuffleMode && index >= count - 1 && repeatMode !== "playlist"}
          aria-label="Следующий трек"
          title="Следующий трек (Shift+→)"
        >
          <NavIcon name="next" />
        </button>
        <button type="button" onClick={stop} aria-label="Стоп" title="Стоп (Shift+S)">
          <NavIcon name="stop" />
        </button>
      </span>

      <span className="audio-player-now">
        <span className="audio-player-now-line">
          <span className="audio-player-track">{current.name}</span>
          <span className="audio-player-counter">{index + 1}/{count}</span>
          <span
            className="audio-player-time"
            role="button"
            tabIndex={0}
            onClick={() => setShowRemaining((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowRemaining((v) => !v); } }}
            title="Нажмите, чтобы показать оставшееся время"
          >
            {elapsedOrRemaining} / {formatTime(duration)}
          </span>
        </span>
        <span
          className="audio-player-progress"
          role="slider"
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (duration) seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { seek(Math.min(duration, currentTime + 5)); e.preventDefault(); }
            else if (e.key === "ArrowLeft") { seek(Math.max(0, currentTime - 5)); e.preventDefault(); }
          }}
        >
          <span
            className="audio-player-progress-fill"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
        </span>
      </span>

      <span className="audio-player-divider" />

      <span className="audio-player-transport">
        <span className="audio-player-volume">
          <button
            type="button"
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            className="audio-player-btn"
            aria-label={`Громкость: ${Math.round(volume * 100)}%`}
            title={`Громкость: ${Math.round(volume * 100)}%`}
          >
            <NavIcon name="volume" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onWheel={(e) => {
              e.stopPropagation();
              const d = e.deltaY > 0 ? -0.05 : 0.05;
              setVolume(Math.min(1, Math.max(0, volume + d)));
            }}
            className="audio-player-volume-range"
            aria-label="Громкость"
          />
        </span>
        <button
          type="button"
          onClick={() => setShuffleMode(!shuffleMode)}
          aria-label={shuffleMode ? "Выключить случайный порядок" : "Случайный порядок"}
          title={shuffleMode ? "Случайный порядок: вкл" : "Случайный порядок: выкл"}
          className={shuffleMode ? "audio-player-btn active" : "audio-player-btn"}
        >
          <NavIcon name="shuffle" />
        </button>
        <button
          type="button"
          onClick={() => {
            const modes: RepeatMode[] = ["off", "playlist", "track"];
            const next = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
            setRepeatMode(next);
          }}
          aria-label={
            repeatMode === "off" ? "Повтор: выкл" :
            repeatMode === "track" ? "Повтор трека" : "Повтор плейлиста"
          }
          title={
            repeatMode === "off" ? "Повтор: выкл" :
            repeatMode === "track" ? "Повтор трека" : "Повтор плейлиста"
          }
          className={repeatMode !== "off" ? "audio-player-btn active" : "audio-player-btn"}
        >
          <NavIcon name={repeatMode === "track" ? "repeatTrack" : "repeatPlaylist"} />
        </button>
      </span>

      {extras}

      <button
        type="button"
        className="audio-player-btn audio-player-help"
        onClick={() => setShowShortcuts((v) => !v)}
        aria-label="Горячие клавиши"
        title="Горячие клавиши (Shift+?)"
      >
        ?
      </button>

      {showShortcuts && (
        <div className="audio-player-shortcuts">
          <div className="audio-player-shortcuts-title">Горячие клавиши</div>
          <div className="audio-player-shortcuts-list">
            <span><kbd>Пробел</kbd> Играть / Пауза</span>
            <span><kbd>Shift+S</kbd> Стоп</span>
            <span><kbd>Shift+←</kbd> Предыдущий</span>
            <span><kbd>Shift+→</kbd> Следующий</span>
            <span><kbd>Shift+M</kbd> Звук / Тишина</span>
            <span><kbd>Shift+R</kbd> Повтор</span>
            <span><kbd>Shift+X</kbd> Случайный порядок</span>
            <span><kbd>Shift+?</kbd> Эта подсказка</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Mobile-only "now playing" capsule — floats above .mobile-bottom-nav (see
// index.css) and only exists while a track is actually playing, replacing
// the old always-present mobile drawer entirely per the user's request.
// Tapping it (anywhere but the transport buttons) opens NowPlayingPage for
// the scrubber/shuffle/repeat controls that don't fit here.
export function MiniPlayerBar() {
  const { current, isPlaying, toggle, next } = useAudioPlayer();
  if (!current) return null;

  return (
    <div className="mini-player-bar" role="group" aria-label={`Сейчас играет: ${current.name}`}>
      <Link to="/now-playing" className="mini-player-link" aria-label={`Развернуть плеер: ${current.name}`}>
        <span className="mini-player-track">{current.name}</span>
      </Link>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Пауза" : "Играть"}
        title={isPlaying ? "Пауза" : "Играть"}
      >
        <NavIcon name={isPlaying ? "pause" : "play"} />
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Следующий трек"
        title="Следующий трек"
      >
        <NavIcon name="next" />
      </button>
    </div>
  );
}
