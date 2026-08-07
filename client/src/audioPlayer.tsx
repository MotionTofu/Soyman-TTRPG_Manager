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
import { PlaylistNavMenu } from "./components/PlaylistNavMenu";
import type { Campaign, Playlist, PlaylistDetail, SessionSummary } from "./types";

export interface AudioTrack {
  id: number;
  name: string;
  src: string;
}

export type RepeatMode = "off" | "track" | "playlist";

// Offered when nothing is playing yet — the session-scoped playlist of the
// nearest upcoming session, or (if it has none) that session's setting
// playlist. Purely a suggestion the GM can accept or ignore via the
// playlist nav menu instead.
export interface PlaylistSuggestion {
  playlistId: number;
  label: string;
}

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
  index: number;
  count: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffleMode: boolean;
  activePlaylistId: number | null;
  suggestion: PlaylistSuggestion | null;
  playSuggested: () => void;
  playPlaylist: (tracks: AudioTrack[], startIndex?: number, playlistId?: number | null) => void;
  playTrackAt: (index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
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

  // Computed once at startup: the nearest upcoming session's own playlist,
  // or (if it has none) its campaign's setting playlist — offered in the
  // bar as a one-click "play something relevant" suggestion.
  const [suggestion, setSuggestion] = useState<PlaylistSuggestion | null>(null);
  useEffect(() => {
    async function loadSuggestion() {
      const [sessions, campaigns] = await Promise.all([
        api.get<SessionSummary[]>("/calendar"),
        api.get<Campaign[]>("/campaigns"),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const nearest = sessions
        .filter((s) => s.status === "planned" && s.date >= today)
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      if (!nearest) return;

      const sessionPlaylists = await api.get<Playlist[]>(
        `/playlists?scope=session&session_id=${nearest.id}`
      );
      if (sessionPlaylists.length > 0) {
        setSuggestion({
          playlistId: sessionPlaylists[0].id,
          label: `плейлист сессии «${nearest.title || nearest.campaign_name || "ближайшей"}»`,
        });
        return;
      }

      const campaign = campaigns.find((c) => c.id === nearest.campaign_id);
      if (!campaign?.setting_id) return;
      const settingPlaylists = await api.get<Playlist[]>(
        `/playlists?scope=setting&setting_id=${campaign.setting_id}`
      );
      if (settingPlaylists.length > 0) {
        setSuggestion({
          playlistId: settingPlaylists[0].id,
          label: `плейлист сеттинга кампании «${campaign.name}»`,
        });
      }
    }
    loadSuggestion().catch(() => {});
  }, []);

  function playSuggested() {
    if (!suggestion) return;
    api.get<PlaylistDetail>(`/playlists/${suggestion.playlistId}`).then((d) => {
      const tracks: AudioTrack[] = d.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src! }));
      playPlaylist(tracks, 0, suggestion.playlistId);
    });
  }

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
  function hardSwitch(newIndex: number) {
    unlockAudioElements();
    clearFadeTimer();
    const active = getActive();
    const track = stateRef.current.tracks[newIndex];
    if (!active || !track) return;
    getInactive()?.pause();
    active.src = track.src;
    active.currentTime = 0;
    active.volume = volume;
    active.play().catch(() => {});
    setProgress({ currentTime: 0, duration: 0 });
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

  function playPlaylist(tracks: AudioTrack[], startIndex = 0, playlistId: number | null = null) {
    if (tracks.length === 0) return;
    clearFadeTimer();
    // hardSwitch reads stateRef synchronously — setState alone wouldn't be
    // visible to it until the next render, so seed the ref directly too.
    const next = { tracks, index: startIndex, isPlaying: true, activePlaylistId: playlistId };
    stateRef.current = next;
    setState(next);
    hardSwitch(startIndex);
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
      const active = getActive();
      if (active) active.volume = clamped;
    }
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

  return (
    <AudioPlayerContext.Provider
      value={{
        current,
        index: state.index,
        count: state.tracks.length,
        isPlaying: state.isPlaying,
        currentTime: progress.currentTime,
        duration: progress.duration,
        volume,
        repeatMode,
        shuffleMode,
        activePlaylistId: state.activePlaylistId,
        suggestion,
        playSuggested,
        playPlaylist,
        playTrackAt,
        toggle,
        next,
        prev,
        stop,
        seek,
        setVolume,
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
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayerBar() {
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
    suggestion,
    playSuggested,
    toggle,
    next,
    prev,
    stop,
    seek,
    setVolume,
    setRepeatMode,
    setShuffleMode,
  } = useAudioPlayer();
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);

  if (!current) {
    return (
      <div className="audio-player-bar audio-player-bar-empty">
        {suggestion ? (
          <button type="button" className="audio-player-suggestion" onClick={playSuggested}>
            <NavIcon name="play" /> Играть {suggestion.label}
          </button>
        ) : (
          <span className="muted">Ничего не играет</span>
        )}
        <span className="audio-player-playlist-menu">
          <button
            type="button"
            onClick={() => setPlaylistMenuOpen((v) => !v)}
            title="Открыть плейлист"
            className={playlistMenuOpen ? "active" : ""}
          >
            <NavIcon name="folder" />
          </button>
          {playlistMenuOpen && <PlaylistNavMenu onClose={() => setPlaylistMenuOpen(false)} />}
        </span>
        <Link to="/player" title="Открыть плеер">
          <NavIcon name="player" />
        </Link>
      </div>
    );
  }
  return (
    <div className="audio-player-bar">
      <button type="button" onClick={prev} disabled={!shuffleMode && index <= 0} title="Предыдущий трек">
        <NavIcon name="prev" />
      </button>
      <button type="button" onClick={toggle} title={isPlaying ? "Пауза" : "Играть"}>
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
        className={repeatMode === "track" ? "active" : ""}
        onClick={() => setRepeatMode(repeatMode === "track" ? "off" : "track")}
        title="Повторять трек"
      >
        <NavIcon name="repeatTrack" />
      </button>
      <button
        type="button"
        className={repeatMode === "playlist" ? "active" : ""}
        onClick={() => setRepeatMode(repeatMode === "playlist" ? "off" : "playlist")}
        title="Повторять плейлист"
      >
        <NavIcon name="repeatPlaylist" />
      </button>
      <button
        type="button"
        className={shuffleMode ? "active" : ""}
        onClick={() => setShuffleMode(!shuffleMode)}
        title="Случайный порядок"
      >
        <NavIcon name="shuffle" />
      </button>
      <span className="audio-player-track">{current.name}</span>
      <span className="muted">
        {index + 1}/{count}
      </span>
      <span className="muted audio-player-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        className="audio-player-seek"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="muted audio-player-time">{formatTime(duration)}</span>
      <span className="audio-player-volume">
        <button
          type="button"
          onClick={() => setVolumeOpen((v) => !v)}
          title="Громкость"
          className={volumeOpen ? "active" : ""}
        >
          <NavIcon name="volume" />
        </button>
        {volumeOpen && (
          <div className="volume-popover">
            <input
              type="range"
              className="volume-slider-vertical"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
        )}
      </span>
      <span className="audio-player-playlist-menu">
        <button
          type="button"
          onClick={() => setPlaylistMenuOpen((v) => !v)}
          title="Открыть плейлист"
          className={playlistMenuOpen ? "active" : ""}
        >
          <NavIcon name="folder" />
        </button>
        {playlistMenuOpen && <PlaylistNavMenu onClose={() => setPlaylistMenuOpen(false)} />}
      </span>
      <Link to="/player" title="Открыть плеер">
        <NavIcon name="player" />
      </Link>
      <button type="button" onClick={stop} title="Остановить плейлист" className="audio-player-stop">
        <NavIcon name="stop" />
      </button>
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
    <Link to="/now-playing" className="mini-player-bar">
      <span className="mini-player-track">{current.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          toggle();
        }}
        title={isPlaying ? "Пауза" : "Играть"}
      >
        <NavIcon name={isPlaying ? "pause" : "play"} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          next();
        }}
        title="Следующий трек"
      >
        <NavIcon name="next" />
      </button>
    </Link>
  );
}
