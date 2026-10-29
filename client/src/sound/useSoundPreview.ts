import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundButton } from "./types";
import { previewSourceNeedsRefresh, refreshPreviewSound } from "./previewSource";

const VOLUME_KEY = "soyman.audio-library.preview-volume";
const DEFAULT_VOLUME = 0.3;

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value : DEFAULT_VOLUME;
  } catch { return DEFAULT_VOLUME; }
}

// Единственный элемент аудио у вкладки: скрытый в списке или с обычными
// контролами в редакторе. Пульт, его очередь и громкости сюда не входят.
export function useSoundPreview() {
  const [volume, setVolumeState] = useState(loadVolume);
  const volumeRef = useRef(volume);
  const element = useRef<HTMLAudioElement | null>(null);
  const active = useRef<SoundButton | null>(null);
  const request = useRef(0);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useCallback((audio: HTMLAudioElement | null) => {
    if (element.current && element.current !== audio) {
      element.current.pause();
      // React StrictMode повторяет ref(null) → ref(audio). src принадлежит
      // JSX редактора: удалив его здесь, при повторном ref мы его уже не получим.
    }
    element.current = audio;
    if (audio) audio.volume = volumeRef.current;
  }, []);

  const stop = useCallback(() => {
    request.current += 1;
    active.current = null;
    setPlayingId(null);
    const audio = element.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const setVolume = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(1, value));
    volumeRef.current = next;
    setVolumeState(next);
    if (element.current) element.current.volume = next;
    try { localStorage.setItem(VOLUME_KEY, JSON.stringify(next)); } catch { /* Превью работает и без localStorage. */ }
  }, []);

  const fail = useCallback(() => {
    const sound = active.current;
    if (!sound) return;
    stop();
    setError(`Не удалось прослушать «${sound.name}». Проверьте доступность аудиофайла.`);
  }, [stop]);

  const play = useCallback((sound: SoundButton, audio: HTMLAudioElement, currentRequest: number) => {
    if (request.current !== currentRequest || element.current !== audio || !sound.src) return;
    active.current = sound;
    setPlayingId(sound.resource_id);
    setError(null);
    audio.src = sound.src;
    audio.currentTime = 0;
    audio.volume = volumeRef.current;
    try {
      void audio.play().catch(() => {
        // Отказ старого play() после переключения не должен погасить новый.
        if (request.current === currentRequest && element.current === audio) fail();
      });
    } catch { fail(); }
  }, [fail]);

  const refreshAndPlay = useCallback((sound: SoundButton, audio: HTMLAudioElement, currentRequest: number) => {
    void refreshPreviewSound(sound).then((fresh) => play(fresh, audio, currentRequest)).catch(() => {
      if (request.current === currentRequest && element.current === audio) fail();
    });
  }, [fail, play]);

  const toggle = useCallback((sound: SoundButton) => {
    const audio = element.current;
    if (!audio || sound.missing || !sound.src) return;
    if (active.current?.resource_id === sound.resource_id) {
      stop();
      return;
    }
    stop();
    active.current = sound;
    setPlayingId(sound.resource_id);
    setError(null);
    if (previewSourceNeedsRefresh(sound.src)) refreshAndPlay(sound, audio, request.current);
    else play(sound, audio, request.current);
  }, [play, refreshAndPlay, stop]);

  const onError = useCallback(() => {
    const sound = active.current;
    const audio = element.current;
    // Редактор мог долго оставаться открытым до нажатия native Play.
    if (sound && audio && previewSourceNeedsRefresh(sound.src)) {
      request.current += 1;
      refreshAndPlay(sound, audio, request.current);
    } else fail();
  }, [fail, refreshAndPlay]);

  const onPlay = useCallback((sound: SoundButton) => {
    active.current = sound;
    setPlayingId(sound.resource_id);
    setError(null);
  }, []);

  const onPause = useCallback(() => {
    if (element.current?.paused) {
      active.current = null;
      setPlayingId(null);
    }
  }, []);

  const onVolumeChange = useCallback(() => {
    const next = element.current?.volume;
    if (next !== undefined && next !== volumeRef.current) setVolume(next);
  }, [setVolume]);

  useEffect(() => () => {
    request.current += 1;
    const audio = element.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  return { audioRef, playingId, volume, setVolume, error, toggle, stop, onPlay, onPause, onEnded: stop, onError, onVolumeChange };
}

export type SoundPreview = ReturnType<typeof useSoundPreview>;
