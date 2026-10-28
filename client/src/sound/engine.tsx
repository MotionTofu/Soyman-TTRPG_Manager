import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useResource } from "../data/hooks";
import { readResource } from "../data/imperative";
import { useAudioPlayer } from "../audioPlayer";
import { onCommand, publishState, type SoundCommand } from "./bus";
import type { PlaylistDetail } from "../types";
import type { ChannelKey, ConsolePayload, SoundState } from "./types";
import type { CutsceneAudioReturnSnapshot, CutsceneAudioScope, CutsceneBackgroundQueueSnapshot, CutsceneLoopChannelSnapshot } from "@shared/cutscenes/types";
import { audioAuthority, useAudioOwnership } from "./audioOwnership";
import { CutsceneAudioController, type ApplicationAudioPort } from "./cutsceneAudio";
import { freshAudioSources } from "./audioSources";
import { fadeAndPause, fadeInTransport, positionAfterMetadata } from "./audioTransport";
import { showSaveError } from "../data/notices";
import { CutsceneAudioRunner } from "./cutsceneAudioRunner";
import { createCutscenePlayback } from "../cutscenes/browser";
import { workshopPreview } from "../cutscenes/workshopPreview";
import type { CutscenePlaybackController } from "../cutscenes/controller";
import { onOrdinaryBackgroundIntent } from "./backgroundHandoff";

// Движок пульта звука. Живёт в ГЛАВНОМ окне — окно пульта только шлёт сюда
// команды и рисует присланный снимок.
//
// Почему так, а не наоборот: Бэкграунд — это существующий плеер, который
// звучит из главного окна и живёт в нижней панели на всех страницах. Если бы
// владельцем звука было окно пульта, случайно закрытое посреди боя окно
// обрывало бы музыку, а открытие пульта поверх играющего трека требовало бы
// передачи владения, то есть разрыва звука. Канал синхронизации нужен в
// любом случае, так что владение в пульте ничего не экономит.

const VOLUME_KEY = "soundConsoleVolumes";

function consolePath(setId: number | null): string {
  return setId ? `/sounds/console?set_id=${setId}` : "/sounds/console";
}
const KEYS_KEY = "soundConsoleKeys";

// Уход в тишину — три секунды: столько нужно, чтобы звук «отпустил» комнату,
// а не оборвался, когда за столом что-то случилось.
const SILENCE_FADE_MS = 3000;

// Возврат из тишины — за секунду. Несимметрично намеренно: тишину включают
// срочно (кто-то пришёл, зазвонил телефон), и там важен мягкий уход; а после
// «продолжаем» ждать три секунды, пока звук доползёт обратно, незачем.
const SILENCE_RETURN_MS = 1000;

// Дакинг: остальные каналы уходят до 40% на время стингера. Без этого «Бой!»
// тонет в музыке — то есть стингер не делает ровно того, ради чего он есть.
const DUCK_FACTOR = 0.4;
const DUCK_FADE_MS = 220;

// Предохранитель на дакинг. Нашёлся на живой проверке: стингером Мастер
// вполне может отметить файл на четыре минуты, и тогда «на время стингера»
// означает четыре минуты приглушённых каналов, из которых нет выхода, кроме
// «Тишины». Дакинг отпускает по окончании стингера ИЛИ по этому сроку —
// смотря что раньше; сам звук при этом доигрывает.
const DUCK_MAX_MS = 12000;

type Volumes = Record<ChannelKey | "master", number>;

const DEFAULT_VOLUMES: Volumes = {
  master: 0.75,
  background: 0.62,
  ambient: 0.55,
  weather: 0.45,
  stinger: 0.7,
};

function loadVolumes(): Volumes {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (!raw) return DEFAULT_VOLUMES;
    const parsed = JSON.parse(raw) as Partial<Volumes>;
    const clean = { ...DEFAULT_VOLUMES };
    for (const key of Object.keys(clean) as (keyof Volumes)[]) {
      const value = parsed[key];
      if (typeof value === "number" && value >= 0 && value <= 1) clean[key] = value;
    }
    return clean;
  } catch {
    return DEFAULT_VOLUMES;
  }
}

function loadKeys(): "digits" | "letters" {
  return localStorage.getItem(KEYS_KEY) === "letters" ? "letters" : "digits";
}

function useMirrorState<T>(initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>, React.MutableRefObject<T>] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback((next: React.SetStateAction<T>) => {
    const value = typeof next === "function" ? (next as (previous: T) => T)(ref.current) : next;
    ref.current = value; setValue(value);
  }, []);
  return [value, set, ref];
}

interface Deck {
  a: HTMLAudioElement | null;
  b: HTMLAudioElement | null;
  live: "a" | "b";
  timer: number | null;
}

interface SoundEngineValue {
  state: SoundState;
  cutsceneAudio: CutsceneAudioController;
  cutsceneMusic: CutsceneAudioRunner;
  cutscenePlayback: CutscenePlaybackController;
  enterCombat: (battlePlaylistId: number) => void;
  exitCombat: () => void;
  setSet: (setId: number | null) => Promise<void>;
  sceneSet: (setId: number | null, sceneName: string, setName: string) => void;
  revertSceneSet: () => void;
  playAmbient: (resourceId: number | null) => void;
  playWeather: (resourceId: number | null) => void;
  fireStinger: (resourceId: number) => void;
  setVolume: (channel: keyof Volumes, value: number) => void;
  setSilence: (on: boolean) => void;
  setKeys: (layout: "digits" | "letters") => void;
  reload: () => void;
}

const SoundEngineContext = createContext<SoundEngineValue | null>(null);

export function useSoundEngine(): SoundEngineValue {
  const ctx = useContext(SoundEngineContext);
  if (!ctx) throw new Error("useSoundEngine вне SoundEngineProvider");
  return ctx;
}

// Для тех, кто может оказаться и вне главного окна: вынесенная панель пульта
// сессии рендерится без AppShell, а значит и без движка. Там автопереключение
// боя просто не срабатывает вместо того, чтобы ронять окно.
export function useSoundEngineOptional(): SoundEngineValue | null {
  return useContext(SoundEngineContext);
}

export function SoundEngineProvider({ children }: { children: ReactNode }) {
  const background = useAudioPlayer();
  const ownership = useAudioOwnership();
  const runtimePort = useRef<ApplicationAudioPort | null>(null);
  const controller = useRef<CutsceneAudioController | null>(null);
  if (!controller.current) controller.current = new CutsceneAudioController({
    capture: scope => runtimePort.current!.capture(scope),
    suspend: (...args) => runtimePort.current!.suspend(...args),
    restore: (...args) => runtimePort.current!.restore(...args),
  });
  const musicRunner = useRef<CutsceneAudioRunner | null>(null);
  if (!musicRunner.current) musicRunner.current = new CutsceneAudioRunner();
  useEffect(() => {
    const runner = musicRunner.current!;
    const unregister = controller.current!.registerMusic(runner);
    const detach = onOrdinaryBackgroundIntent(() => runner.stop());
    return () => { detach(); unregister(); runner.stop(); };
  }, []);
  const playback = useRef<CutscenePlaybackController | null>(null);
  if (!playback.current) playback.current = createCutscenePlayback(controller.current, musicRunner.current);
  useEffect(() => playback.current!.connect(), []);
  useEffect(() => workshopPreview(controller.current!, musicRunner.current!).connect(), []);
  const pendingPositions = useRef(new Map<HTMLAudioElement, () => void>());
  const runtimeOperation = useRef(0);
  const commandRequest = useRef(0);

  const [data, setData] = useState<ConsolePayload | null>(null);
  const [setId, setSetIdState, setIdRef] = useMirrorState<number | null>(null);
  const [ambientId, setAmbientId, ambientIdRef] = useMirrorState<number | null>(null);
  const [weatherId, setWeatherId, weatherIdRef] = useMirrorState<number | null>(null);
  const [duckingId, setDuckingId, duckingIdRef] = useMirrorState<number | null>(null);
  const [silence, setSilenceState, silenceRef] = useMirrorState(false);
  // Остановленный вручную канал — это не «молчит»: звук выбран и заряжен, его
  // выключил Мастер. Флаг держится отдельно от выбранного звука именно
  // поэтому: стоп не должен стирать выбор, сделанный под сцену.
  const [ambientStopped, setAmbientStopped, ambientStoppedRef] = useMirrorState(false);
  const [weatherStopped, setWeatherStopped, weatherStoppedRef] = useMirrorState(false);
  // Звучит ли стингер прямо сейчас. Дакинг для этого не годится: он снимается
  // по DUCK_MAX_MS, а обрывать чаще всего приходится как раз длинный файл,
  // вставленный ради первых пяти секунд, — он к тому моменту ещё играет.
  const [stingerPlaying, setStingerPlaying] = useMirrorState(false);
  const [volumes, setVolumes, volumesRef] = useMirrorState<Volumes>(loadVolumes);
  const [keys, setKeysState] = useState<"digits" | "letters">(loadKeys);
  // Что Бэкграунд играл до боя — чтобы вернуть это, когда бой кончится, и
  // чтобы честно показать, что переключение сделал трекер инициативы, а не
  // Мастер. Автоматика, которую нельзя предсказать за столом, хуже её
  // отсутствия, поэтому она ровно одна и всегда видима.
  // Запоминается не id плейлиста, а сам список треков и позиция в нём:
  // Бэкграунд набора не плейлист, возвращать его «по id» больше не из чего.
  // Набор, включённый запуском сцены. Хранится id прежнего набора, а не его
  // очередь треков: набор возвращается целиком одной командой, в отличие от
  // боевой темы, которая перебивает только Бэкграунд.
  const [sceneSwitch, setSceneSwitch, sceneSwitchRef] = useMirrorState<
    { scene: string; to: string; previousSetId: number | null } | null
  >(null);

  const [autoSwitch, setAutoSwitch, autoSwitchRef] = useMirrorState<
    {
      from: string;
      to: string;
      previous: CutsceneBackgroundQueueSnapshot;
    } | null
  >(null);

  const ambientDeck = useRef<Deck>({ a: null, b: null, live: "a", timer: null });
  const weatherDeck = useRef<Deck>({ a: null, b: null, live: "a", timer: null });
  const stingerRef = useRef<HTMLAudioElement | null>(null);
  const fadeMsRef = useRef(0);
  const setBackgroundGainRef = useRef(background.setBackgroundGain);
  setBackgroundGainRef.current = background.setBackgroundGain;
  const rampTimers = useRef(new Map<HTMLAudioElement, { id: number; target: number; onDone?: () => void }>());
  const lastBgGainRef = useRef<number | null>(null);
  const duckTimer = useRef<number | null>(null);
  const bgRamp = useRef<number | null>(null);
  const bgTarget = useRef<number | null>(null);
  const wasSilent = useRef(false);
  // Стингер сейчас обрывается рампой. Флаг нужен потому, что громкость канала
  // пересчитывается общим эффектом, а обрыв снимает дакинг — и этот же эффект
  // тут же возвращал стингеру полную громкость посреди ухода, превращая
  // мягкий обрыв в скачок вверх.
  const stingerCutting = useRef(false);

  useEffect(() => {
    const voices = [ambientDeck.current.a, ambientDeck.current.b, weatherDeck.current.a, weatherDeck.current.b, stingerRef.current];
    return () => {
    runtimeOperation.current++;
    pendingPositions.current.forEach(cancel => cancel()); pendingPositions.current.clear();
    voices.forEach(el => el?.pause());
    for (const { id } of rampTimers.current.values()) window.clearInterval(id);
    if (bgRamp.current !== null) window.clearInterval(bgRamp.current);
    if (duckTimer.current !== null) window.clearTimeout(duckTimer.current);
    };
  }, []);

  // Затухание — из слоя данных: правка в настройках (в любом окне) доходит
  // сюда без перезагрузки окна.
  const fadeSetting = useResource<{ fade_duration_ms: number }>("/app-settings").data?.fade_duration_ms;
  useEffect(() => {
    fadeMsRef.current = fadeSetting || 0;
  }, [fadeSetting]);

  // --- громкость ---

  const gainFor = useCallback(
    (channel: ChannelKey, duckingNow: boolean, silentNow: boolean) => {
      if (silentNow) return 0;
      const duck = duckingNow && channel !== "stinger" ? DUCK_FACTOR : 1;
      return volumes.master * volumes[channel] * duck;
    },
    [volumes]
  );

  function ramp(el: HTMLAudioElement | null, target: number, ms: number, onDone?: () => void) {
    if (!el) return;
    const running = rampTimers.current.get(el);
    if (running?.target === target) {
      if (onDone) {
        const previous = running.onDone;
        running.onDone = () => { previous?.(); onDone(); };
      }
      return;
    }
    if (running) {
      window.clearInterval(running.id);
      rampTimers.current.delete(el);
    }
    const from = el.volume;
    if (ms <= 0 || Math.abs(target - from) < 0.01) {
      el.volume = Math.max(0, Math.min(1, target));
      onDone?.();
      return;
    }
    const steps = Math.max(1, Math.round(ms / 50));
    let step = 0;
    const entry = { id: 0, target, onDone };
    const id = window.setInterval(() => {
      step += 1;
      const value = from + ((target - from) * step) / steps;
      el.volume = Math.max(0, Math.min(1, value));
      if (step >= steps) {
        window.clearInterval(id);
        rampTimers.current.delete(el);
        entry.onDone?.();
      }
    }, 50);
    entry.id = id;
    rampTimers.current.set(el, entry);
  }

  // Бэкграунд звучит не своим <audio>, а плеером, поэтому его громкость
  // меняется через setVolume — и раньше менялась мгновенно. На «Тишине» это
  // слышно резче всего: три канала уходили за три секунды, а музыка
  // обрывалась. Здесь та же рампа, но шагом 100 мс, а не 50: каждый шаг
  // проходит через состояние плеера и localStorage, и частить незачем.
  const rampBackground = useCallback(
    (target: number, ms: number) => {
      const from = lastBgGainRef.current;
      if (bgTarget.current !== null && Math.abs(bgTarget.current - target) < 0.001 && bgRamp.current) {
        return; // рампа к этому же значению уже идёт — не перезапускаем её
      }
      if (bgRamp.current) {
        window.clearInterval(bgRamp.current);
        bgRamp.current = null;
      }
      bgTarget.current = target;
      if (from !== null && Math.abs(target - from) < 0.001) return;
      if (from === null || ms <= 0 || Math.abs(target - from) < 0.01) {
        lastBgGainRef.current = target;
        setBackgroundGainRef.current(target);
        return;
      }
      const steps = Math.max(1, Math.round(ms / 100));
      let step = 0;
      bgRamp.current = window.setInterval(() => {
        step += 1;
        const value = from + ((target - from) * step) / steps;
        lastBgGainRef.current = Math.max(0, Math.min(1, value));
        setBackgroundGainRef.current(lastBgGainRef.current);
        if (step >= steps && bgRamp.current) {
          window.clearInterval(bgRamp.current);
          bgRamp.current = null;
        }
      }, 100);
    },
    []
  );

  const liveEl = (deck: React.MutableRefObject<Deck>) =>
    deck.current.live === "a" ? deck.current.a : deck.current.b;
  const idleEl = (deck: React.MutableRefObject<Deck>) =>
    deck.current.live === "a" ? deck.current.b : deck.current.a;

  // Смена звука в канале — честный кроссфейд на двух элементах: у зацикленного
  // эмбиента провал в тишину слышен даже сильнее, чем у музыки.
  const switchLoop = useCallback(
    (deck: React.MutableRefObject<Deck>, src: string | null, gain: number) => {
      const channel = deck === ambientDeck ? "ambient" : "weather";
      if (!audioAuthority.allows(channel)) return;
      const outgoing = liveEl(deck);
      const incoming = idleEl(deck);
      const fadeMs = fadeMsRef.current;
      if (!incoming || !outgoing) return;

      if (!src) {
        ramp(outgoing, 0, fadeMs, () => outgoing.pause());
        return;
      }

      pendingPositions.current.get(incoming)?.(); pendingPositions.current.delete(incoming);
      incoming.src = src;
      incoming.loop = true;
      incoming.volume = 0;
      void incoming.play().catch(() => {
        /* файл пропал между проверкой и запуском — кнопка уже погашена */
      });
      ramp(incoming, gain, fadeMs);
      ramp(outgoing, 0, fadeMs, () => outgoing.pause());
      deck.current.live = deck.current.live === "a" ? "b" : "a";
    },
    []
  );

  // Любое изменение громкости, дакинга или тишины применяется мгновенно ко
  // всем каналам: держать здесь плавность незачем, кроме тишины и дакинга,
  // у которых своё время ухода.
  useEffect(() => {
    const ducking = duckingId !== null;
    const ambGain = gainFor("ambient", ducking, silence);
    const weaGain = gainFor("weather", ducking, silence);
    const fade = silence
      ? SILENCE_FADE_MS
      : wasSilent.current
        ? SILENCE_RETURN_MS
        : ducking
          ? DUCK_FADE_MS
          : 0;
    wasSilent.current = silence;
    if (!ambientStopped && audioAuthority.allows("ambient")) ramp(liveEl(ambientDeck), ambGain, fade);
    if (!weatherStopped && audioAuthority.allows("weather")) ramp(liveEl(weatherDeck), weaGain, fade);
    const idleAmb = idleEl(ambientDeck);
    const idleWea = idleEl(weatherDeck);
    if (idleAmb && idleAmb.paused) idleAmb.volume = 0;
    if (idleWea && idleWea.paused) idleWea.volume = 0;
    // Стингер уходит в тишину вместе со всеми, а не обрывается: «Тишина»
    // жмётся и посреди стингера, и резкий обрыв там слышен сильнее всего.
    if (!stingerCutting.current && audioAuthority.allows("stinger")) {
      ramp(stingerRef.current, gainFor("stinger", false, silence), silence ? SILENCE_FADE_MS : 0);
    }
    // Бэкграунд — тот же существующий плеер; его громкость здесь производная
    // от общей и канальной, поэтому его собственный ключ в localStorage
    // становится вычисленным значением и перезаписывается движком на старте.
    if (audioAuthority.allows("background")) rampBackground(gainFor("background", ducking, silence), fade);
  }, [volumes, duckingId, silence, ambientStopped, weatherStopped, gainFor, rampBackground]);

  // Releasing music must not restart a fade or alter the uncaptured atmosphere.
  useEffect(() => {
    if (ownership) return;
    const current = volumesRef.current;
    const gain = silenceRef.current ? 0 : current.master * current.background * (duckingIdRef.current !== null ? DUCK_FACTOR : 1);
    rampBackground(gain, 0);
  }, [ownership, rampBackground, volumesRef, silenceRef, duckingIdRef]);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  }, [volumes]);
  useEffect(() => {
    localStorage.setItem(KEYS_KEY, keys);
  }, [keys]);

  // --- загрузка набора ---

  const loadConsole = useCallback(
    (nextSetId: number | null, startPlayback: boolean) => {
      const request = ++commandRequest.current;
      const bgEpoch = audioAuthority.epoch("background"), ambientEpoch = audioAuthority.epoch("ambient");
      return readResource<ConsolePayload>(consolePath(nextSetId), { fresh: true }).then((payload) => {
        if (request !== commandRequest.current) return payload;
        setData(payload);
        if (!startPlayback) return payload;
        const canBackground = bgEpoch === audioAuthority.epoch("background") && audioAuthority.allows("background");
        const canAmbient = ambientEpoch === audioAuthority.epoch("ambient") && audioAuthority.allows("ambient");
        if (!canBackground && !canAmbient) return payload;

        // Набор перебивает стоп: «нажал „Таверна“ — играет таверна», а набор,
        // включающийся наполовину, хуже, чем никакого.
        if (canAmbient) setAmbientStopped(false);
        if (audioAuthority.allows("weather")) setWeatherStopped(false);

        // Включение набора перебивает Бэкграунд и Эмбиент — это и есть его
        // смысл: нажал «Таверна», сразу играет таверна. Погоду и Стингеры не
        // трогаем: дождь идёт и снаружи, и в таверне, а самозапускающийся
        // стингер — просто пугание игроков.
        // Бэкграунд набора — его собственный список треков, без плейлиста,
        // поэтому и playlistId у плеера нет: возврат после боя держится не на
        // нём, а на запомненном списке (см. enterCombat).
        const tracks = payload.tracks
          .filter((t) => t.src)
          .map((t) => ({ id: t.resource_id, name: t.name, src: t.src as string }));
        if (canBackground && tracks.length) {
          background.playPlaylist(tracks, 0, null);
        } else if (canBackground) {
          // Набор без музыки останавливает её, а не оставляет как есть:
          // предсказуемость важнее — включил «Подземелье», играет подземелье
          // и ничего лишнего.
          background.stop();
        }
        const start = payload.ambient.find((b) => b.is_start && !b.missing) ?? null;
        if (canAmbient) {
          setAmbientId(start ? start.resource_id : null);
          switchLoop(ambientDeck, start?.src ?? null, gainFor("ambient", false, silence));
        }
        return payload;
      });
    },
    [background, gainFor, silence, switchLoop, setAmbientId, setAmbientStopped, setWeatherStopped]
  );

  // Состав играющего набора — под наблюдением слоя данных: правка набора или
  // звука в любом окне перечитывает его, и пульт сразу показывает новый состав.
  // Звучащее при этом не перезапускается — как и раньше при `reload`.
  const liveConsole = useResource<ConsolePayload>(consolePath(setId)).data;
  useEffect(() => {
    if (!liveConsole) return;
    setData(liveConsole);
    // Набор удалили: снимаем его с пульта, а звучащее доигрывает — обрывать
    // музыку посреди сцены из-за правки в библиотеке хуже.
    if (liveConsole.set == null && setId != null) setSetIdState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveConsole]);

  // --- действия ---

  const setSet = useCallback(
    (nextSetId: number | null) => {
      if (!audioAuthority.allows("background") && !audioAuthority.allows("ambient")) return Promise.resolve();
      setSetIdState(nextSetId);
      setSilenceState(false);
      return loadConsole(nextSetId, true).then(() => {}).catch(error => { showSaveError(String(error)); });
    },
    [loadConsole, setSetIdState, setSilenceState]
  );

  const playAmbient = useCallback(
    (resourceId: number | null) => {
      if (!audioAuthority.allows("ambient")) return;
      const next = resourceId === ambientId ? null : resourceId;
      const button = data?.ambient.find((b) => b.resource_id === next);
      if (next !== null && (!button || button.missing)) return;
      setAmbientId(next);
      setAmbientStopped(false);
      setSilenceState(false);
      switchLoop(ambientDeck, button?.src ?? null, gainFor("ambient", duckingId !== null, false));
    },
    [ambientId, data, duckingId, gainFor, switchLoop, setAmbientId, setAmbientStopped, setSilenceState]
  );

  const playWeather = useCallback(
    (resourceId: number | null) => {
      if (!audioAuthority.allows("weather")) return;
      const next = resourceId === weatherId ? null : resourceId;
      const button = data?.weather.find((b) => b.resource_id === next);
      if (next !== null && (!button || button.missing)) return;
      setWeatherId(next);
      setWeatherStopped(false);
      setSilenceState(false);
      switchLoop(weatherDeck, button?.src ?? null, gainFor("weather", duckingId !== null, false));
    },
    [weatherId, data, duckingId, gainFor, switchLoop, setWeatherId, setWeatherStopped, setSilenceState]
  );

  // Стингер обрывает предыдущий: два «Боя» внахлёст — это не эффект, а каша.
  const fireStinger = useCallback(
    (resourceId: number) => {
      if (!audioAuthority.allows("stinger")) return;
      const epoch = audioAuthority.epoch("stinger");
      const button = data?.stingers.find((b) => b.resource_id === resourceId);
      const el = stingerRef.current;
      if (!button || button.missing || !button.src || !el) return;
      setSilenceState(false);
      setStingerPlaying(true);
      stingerCutting.current = false;
      el.pause();
      el.src = button.src;
      el.volume = gainFor("stinger", false, false);
      setDuckingId(resourceId);
      if (duckTimer.current) clearTimeout(duckTimer.current);
      duckTimer.current = window.setTimeout(() => setDuckingId(null), DUCK_MAX_MS);
      void el.play().catch(() => {
        if (epoch !== audioAuthority.epoch("stinger")) return;
        setDuckingId(null);
        setStingerPlaying(false);
      });
    },
    [data, gainFor, setSilenceState, setStingerPlaying, setDuckingId]
  );

  // Стоп в центре ручки. Один жест на канал: звучит — выключить, выключен —
  // запустить заново с начала. У каждого канала «заново» своё, потому что и
  // природа у них разная: очередь, зацикленный звук, одиночный выстрел.
  const STINGER_CUT_MS = 350;
  const toggleStop = useCallback(
    (channel: ChannelKey) => {
      if (!audioAuthority.allows(channel)) return;
      if (channel === "background") {
        if (background.index >= 0) background.halt();
        else if (background.tracks.length) background.playTrackAt(0);
        return;
      }
      if (channel === "stinger") {
        const el = stingerRef.current;
        if (!el || !stingerPlaying) return;
        // Дакинг снимается сразу, не дожидаясь рампы: приглушать остальные
        // каналы ради звука, который уже уходит, незачем.
        if (duckTimer.current) clearTimeout(duckTimer.current);
        setDuckingId(null);
        stingerCutting.current = true;
        ramp(el, 0, STINGER_CUT_MS, () => {
          el.pause();
          stingerCutting.current = false;
          setStingerPlaying(false);
        });
        return;
      }
      const isAmbient = channel === "ambient";
      const deck = isAmbient ? ambientDeck : weatherDeck;
      const stopped = isAmbient ? ambientStopped : weatherStopped;
      const setStopped = isAmbient ? setAmbientStopped : setWeatherStopped;
      const chosen = isAmbient ? ambientId : weatherId;
      if (chosen === null) return; // выбирать нечего — и останавливать тоже
      if (!stopped) {
        const live = liveEl(deck);
        ramp(live, 0, fadeMsRef.current, () => live?.pause());
        setStopped(true);
        return;
      }
      const list = isAmbient ? data?.ambient : data?.weather;
      const button = list?.find((b) => b.resource_id === chosen);
      if (!button?.src) return;
      setStopped(false);
      // Через switchLoop, а не play() на живом элементе: звук должен пойти с
      // начала, а живой элемент стоит на том месте, где его застал стоп.
      switchLoop(deck, button.src, gainFor(channel, duckingId !== null, silence));
    },
    [
      background,
      stingerPlaying,
      ambientStopped,
      weatherStopped,
      ambientId,
      weatherId,
      data,
      duckingId,
      silence,
      gainFor,
      switchLoop,
      setStingerPlaying, setAmbientStopped, setDuckingId, setWeatherStopped,
    ]
  );

  const setVolume = useCallback((channel: keyof Volumes, value: number) => {
    if (!Number.isFinite(value) || (channel === "master" ? audioAuthority.getSnapshot()?.scope === "all" : !audioAuthority.allows(channel))) return;
    setVolumes((prev) => ({ ...prev, [channel]: Math.max(0, Math.min(1, value)) }));
  }, [setVolumes]);

  const setSilence = useCallback((on: boolean) => {
    if (audioAuthority.getSnapshot()?.scope !== "all") setSilenceState(on);
  }, [setSilenceState]);
  const setKeys = useCallback((layout: "digits" | "letters") => setKeysState(layout), []);
  const reload = useCallback(() => void loadConsole(setId, false), [loadConsole, setId]);

  const playPlaylistById = useCallback(
    async (playlistId: number) => {
      if (!audioAuthority.allows("background")) return null;
      const epoch = audioAuthority.epoch("background");
      const detail = await readResource<PlaylistDetail>(`/playlists/${playlistId}`, { fresh: true });
      if (epoch !== audioAuthority.epoch("background") || !audioAuthority.allows("background")) return null;
      const tracks = detail.items
        .filter((it) => it.src)
        .map((it) => ({ id: it.resource_id, name: it.name, src: it.src as string }));
      if (tracks.length) background.playPlaylist(tracks, 0, playlistId);
      return detail.name;
    },
    [background]
  );

  // Возврат после боя запоминает сам список треков и место в нём, а не id
  // плейлиста: у бэкграунда набора никакого id нет, а бой длится десять минут
  // — вернуться в середину той же дорожки и есть то, чего от этого ждёшь.
  const enterCombat = useCallback(
    (battlePlaylistId: number) => {
      if (!audioAuthority.allows("background")) return;
      const before = background.captureSnapshot();
      const epoch = audioAuthority.epoch("background");
      // Уже в бою (сменили тему посреди боя) — возврат остаётся прежним:
      // иначе после боя вернулась бы старая боевая тема.
      const earlier = autoSwitch;
      void playPlaylistById(battlePlaylistId).then(toName => {
        if (toName === null || epoch !== audioAuthority.epoch("background") || !audioAuthority.allows("background")) return;
        setAutoSwitch({ from: earlier?.from ?? data?.set?.name ?? "прежнее", to: toName, previous: earlier?.previous ?? before });
      }).catch(error => showSaveError(String(error)));
    },
    [autoSwitch, background, data, playPlaylistById, setAutoSwitch]
  );

  /**
   * Набор включила сцена. Запуск сцены делает это сам (решение раунда 3): у
   * Мастера перед этим был предпросмотр, и просить его нажать ещё одну кнопку
   * — лишний орган управления там, где он уже подтвердил.
   *
   * Подпись обязательна: пульт звука у большинства не на втором мониторе, и
   * набор, сменившийся сам по себе, читается как поломка.
   */
  const sceneSet = useCallback(
    (nextSetId: number | null, sceneName: string, setName: string) => {
      if (!audioAuthority.allows("background") && !audioAuthority.allows("ambient")) return;
      const previousSetId = setId;
      setSet(nextSetId);
      // Тот же набор — не смена: подписывать «включил то, что и так играло»
      // значит приучить Мастера не читать подпись.
      setSceneSwitch(
        nextSetId === previousSetId ? null : { scene: sceneName, to: setName, previousSetId }
      );
    },
    [setId, setSet, setSceneSwitch]
  );

  const revertSceneSet = useCallback(() => {
    if (!audioAuthority.allows("background") && !audioAuthority.allows("ambient")) return;
    const prev = sceneSwitch?.previousSetId ?? null;
    setSceneSwitch(null);
    setSet(prev);
  }, [sceneSwitch, setSet, setSceneSwitch]);

  const exitCombat = useCallback(() => {
    if (!audioAuthority.allows("background")) return;
    const previous = autoSwitchRef.current?.previous;
    if (!previous) return;
    void background.restoreSnapshot(previous, freshAudioSources()).then(() => setAutoSwitch(null))
      .catch(error => showSaveError(String(error)));
  }, [background, autoSwitchRef, setAutoSwitch]);

  const cancelDeck = (deck: React.MutableRefObject<Deck>) => {
    if (deck.current.timer !== null) clearTimeout(deck.current.timer);
    for (const el of [deck.current.a, deck.current.b]) {
      if (!el) continue;
      const running = rampTimers.current.get(el);
      if (running) { clearInterval(running.id); rampTimers.current.delete(el); }
      pendingPositions.current.get(el)?.(); pendingPositions.current.delete(el);
    }
  };
  const loopSnapshot = (deck: React.MutableRefObject<Deck>, chosen: number | null, stopped: boolean): CutsceneLoopChannelSnapshot => {
    const el = liveEl(deck);
    return { source: chosen === null ? null : { kind: "resource", resourceId: chosen },
      positionSeconds: Math.max(0, el?.currentTime || 0), state: chosen === null || stopped ? "stopped" : el?.paused ? "paused" : "playing" };
  };
  const captureApplication = (scope: CutsceneAudioScope): CutsceneAudioReturnSnapshot => {
    const automation = { combat: autoSwitchRef.current ? structuredClone(autoSwitchRef.current) : null,
      ...(scope === "all" ? { sceneSet: sceneSwitchRef.current ? { ...sceneSwitchRef.current } : null } : {}) };
    const base = { background: background.captureSnapshot(), automation };
    if (scope === "music") return { scope, ...base };
    return { scope, ...base, ambient: loopSnapshot(ambientDeck, ambientIdRef.current, ambientStoppedRef.current),
      weather: loopSnapshot(weatherDeck, weatherIdRef.current, weatherStoppedRef.current), setId: setIdRef.current,
      duckingId: duckingIdRef.current, silence: silenceRef.current, volumes: { ...volumesRef.current } };
  };
  runtimePort.current = {
    capture: captureApplication,
    suspend: async (owner, scope, fadeOutMs) => {
      audioAuthority.assert(owner);
      const operation = ++runtimeOperation.current;
      if (bgRamp.current !== null) clearInterval(bgRamp.current); bgRamp.current = null; bgTarget.current = null;
      const jobs = [background.suspendForCutscene(owner, fadeOutMs)];
      if (scope === "all") {
        commandRequest.current++; cancelDeck(ambientDeck); cancelDeck(weatherDeck);
        if (duckTimer.current !== null) clearTimeout(duckTimer.current); duckTimer.current = null;
        const stinger = stingerRef.current, ramping = stinger && rampTimers.current.get(stinger);
        if (ramping) { clearInterval(ramping.id); rampTimers.current.delete(stinger!); }
        stingerCutting.current = true; setDuckingId(null); setStingerPlaying(false);
        const voices = [ambientDeck.current.a, ambientDeck.current.b, weatherDeck.current.a, weatherDeck.current.b, stinger];
        jobs.push(fadeAndPause(voices, fadeOutMs, () => operation === runtimeOperation.current &&
          audioAuthority.getSnapshot()?.owner.runId === owner.runId && audioAuthority.getSnapshot()?.owner.controllerId === owner.controllerId));
      }
      await Promise.all(jobs); audioAuthority.assert(owner);
      if (scope === "all" && stingerRef.current) stingerRef.current.removeAttribute("src");
    },
    restore: async (owner, snapshot, resolve, beforeCommit, fadeInMs = 0) => {
      audioAuthority.assert(owner);
      const operation = ++runtimeOperation.current;
      const consoleData = snapshot.scope === "all" ? await readResource<ConsolePayload>(consolePath(snapshot.setId), { fresh: true }) : null;
      const loopSources = snapshot.scope === "all" ? await Promise.all([snapshot.ambient.source, snapshot.weather.source]
        .map(source => source ? resolve(source) : Promise.resolve(null))) : [];
      audioAuthority.assert(owner);
      if (operation !== runtimeOperation.current) throw new Error("Восстановление слоёв отменено");
      if (snapshot.scope === "all" && snapshot.setId !== null && consoleData?.set?.id !== snapshot.setId) throw new Error("Исходный набор звука недоступен");
      beforeCommit();
      const jobs: Promise<unknown>[] = [];
      const targets = new Map<HTMLAudioElement, number>();
      let backgroundGain = 0;
      audioAuthority.withOwner(owner, () => {
        if (snapshot.scope === "all") {
          cancelDeck(ambientDeck); cancelDeck(weatherDeck); commandRequest.current++;
          if (duckTimer.current !== null) clearTimeout(duckTimer.current); duckTimer.current = null;
          stingerRef.current?.pause(); stingerRef.current?.removeAttribute("src");
          setStingerPlaying(false); setDuckingId(null); stingerCutting.current = false;
          setSetIdState(snapshot.setId); setData(consoleData); setVolumes({ ...snapshot.volumes }); setSilenceState(snapshot.silence);
          setSceneSwitch(snapshot.automation?.sceneSet ?? null);
          const restoreLoop = (deck: React.MutableRefObject<Deck>, state: CutsceneLoopChannelSnapshot, src: string | null, channel: "ambient" | "weather") => {
            for (const el of [deck.current.a, deck.current.b]) { el?.pause(); el?.removeAttribute("src"); }
            const el = liveEl(deck);
            if (el && src) {
              el.src = src; el.loop = true;
              const target = snapshot.silence ? 0 : snapshot.volumes.master * snapshot.volumes[channel];
              targets.set(el, target); el.volume = fadeInMs > 0 ? 0 : target;
              pendingPositions.current.set(el, positionAfterMetadata(el, state.positionSeconds));
              if (state.state === "playing") jobs.push(el.play());
            }
          };
          restoreLoop(ambientDeck, snapshot.ambient, loopSources[0], "ambient");
          restoreLoop(weatherDeck, snapshot.weather, loopSources[1], "weather");
          setAmbientId(snapshot.ambient.source?.kind === "resource" ? snapshot.ambient.source.resourceId : null);
          setWeatherId(snapshot.weather.source?.kind === "resource" ? snapshot.weather.source.resourceId : null);
          setAmbientStopped(snapshot.ambient.state === "stopped"); setWeatherStopped(snapshot.weather.state === "stopped");
          const gain = snapshot.silence ? 0 : snapshot.volumes.master * snapshot.volumes.background;
          backgroundGain = gain;
          background.setBackgroundGain(fadeInMs > 0 ? 0 : gain); lastBgGainRef.current = gain; bgTarget.current = gain;
        } else {
          const gain = gainFor("background", duckingIdRef.current !== null, silenceRef.current);
          backgroundGain = gain;
          background.setBackgroundGain(fadeInMs > 0 ? 0 : gain); lastBgGainRef.current = gain; bgTarget.current = gain;
        }
        setAutoSwitch(snapshot.automation?.combat ? structuredClone(snapshot.automation.combat) : null);
        if (snapshot.background.kind === "cutscene") background.stop();
      });
      if (snapshot.background.kind === "queue") jobs.push(background.restoreSnapshot(snapshot.background, resolve, owner));
      try {
        await Promise.all(jobs);
        await fadeInTransport(fadeInMs, fraction => {
          audioAuthority.withOwner(owner, () => background.setBackgroundGain(backgroundGain * fraction));
          for (const [element, gain] of targets) element.volume = gain * fraction;
        }, () => operation === runtimeOperation.current &&
          audioAuthority.getSnapshot()?.owner.runId === owner.runId && audioAuthority.getSnapshot()?.owner.controllerId === owner.controllerId);
      }
      catch (error) {
        await background.suspendForCutscene(owner);
        if (snapshot.scope === "all") for (const el of [ambientDeck.current.a, ambientDeck.current.b, weatherDeck.current.a, weatherDeck.current.b]) el?.pause();
        throw error;
      }
      audioAuthority.assert(owner);
      if (operation !== runtimeOperation.current) throw new Error("Восстановление слоёв отменено");
    },
  };

  // --- снимок для окна пульта ---

  const state = useMemo<SoundState>(
    () => ({
      setId,
      ambientId,
      weatherId,
      duckingId,
      silence,
      stopped: { ambient: ambientStopped, weather: weatherStopped },
      stingerPlaying,
      volumes,
      keys,
      background: {
        trackName: background.current?.name ?? null,
        sourceName: autoSwitch ? autoSwitch.to : (data?.set?.name ?? null),
        isPlaying: background.isPlaying,
        currentTime: background.currentTime,
        duration: background.duration,
        repeatMode: background.repeatMode,
        shuffleMode: background.shuffleMode,
        tracks: background.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          active: t.id === background.current?.id,
        })),
      },
      data,
      autoSwitch: autoSwitch ? { from: autoSwitch.from, to: autoSwitch.to } : null,
      sceneSwitch: sceneSwitch ? { scene: sceneSwitch.scene, to: sceneSwitch.to } : null,
    }),
    [
      setId,
      ambientId,
      weatherId,
      duckingId,
      silence,
      ambientStopped,
      weatherStopped,
      stingerPlaying,
      volumes,
      keys,
      data,
      autoSwitch,
      sceneSwitch,
      background.current,
      // Список нужен в зависимостях: по нему теперь щёлкают, и устаревший
      // снимок означал бы попадание не в тот трек, а не просто старую надпись.
      background.tracks,
      background.isPlaying,
      background.repeatMode,
      background.shuffleMode,
      background.currentTime,
      background.duration,
    ]
  );

  useEffect(() => {
    publishState(state);
  }, [state]);

  useEffect(() => {
    return onCommand((command: SoundCommand) => {
      switch (command.kind) {
        case "hello":
          publishState(state);
          break;
        case "set":
          setSet(command.setId);
          break;
        case "ambient":
          playAmbient(command.resourceId);
          break;
        case "weather":
          playWeather(command.resourceId);
          break;
        case "stinger":
          fireStinger(command.resourceId);
          break;
        case "volume":
          setVolume(command.channel, command.value);
          break;
        case "silence":
          setSilence(command.on);
          break;
        case "stop":
          toggleStop(command.channel);
          break;
        case "keys":
          setKeys(command.layout);
          break;
        case "background":
          // На остановленном канале «играть» в транспорте значит то же, что
          // повторное нажатие стопа: активного трека нет, продолжать нечего.
          if (command.action === "toggle") {
            if (background.index < 0 && background.tracks.length) background.playTrackAt(0);
            else background.toggle();
          }
          if (command.action === "next") background.next();
          if (command.action === "prev") background.prev();
          if (command.action === "track") background.playTrackAt(command.index);
          break;
        case "repeat":
          background.setRepeatMode(command.mode);
          break;
        case "shuffle":
          background.setShuffleMode(command.on);
          break;
        case "revertAutoSwitch":
          exitCombat();
          break;
        case "sceneSet":
          sceneSet(command.setId, command.sceneName, command.setName);
          break;
        case "revertSceneSet":
          revertSceneSet();
          break;
        case "reload":
          reload();
          break;
        default:
          break;
      }
    });
  }, [state, setSet, playAmbient, playWeather, fireStinger, setVolume, setSilence, setKeys, reload, exitCombat, sceneSet, revertSceneSet, background, toggleStop]);

  const value: SoundEngineValue = {
    state,
    cutsceneAudio: controller.current,
    cutsceneMusic: musicRunner.current,
    cutscenePlayback: playback.current,
    enterCombat,
    exitCombat,
    setSet,
    sceneSet,
    revertSceneSet,
    playAmbient,
    playWeather,
    fireStinger,
    setVolume,
    setSilence,
    setKeys,
    reload,
  };

  return (
    <SoundEngineContext.Provider value={value}>
      {children}
      <audio data-audio-channel="ambient" data-audio-slot="a" ref={(el) => {
        ambientDeck.current.a = el;
      }} preload="auto" />
      <audio data-audio-channel="ambient" data-audio-slot="b" ref={(el) => {
        ambientDeck.current.b = el;
      }} preload="auto" />
      <audio data-audio-channel="weather" data-audio-slot="a" ref={(el) => {
        weatherDeck.current.a = el;
      }} preload="auto" />
      <audio data-audio-channel="weather" data-audio-slot="b" ref={(el) => {
        weatherDeck.current.b = el;
      }} preload="auto" />
      <audio
        data-audio-channel="stinger"
        ref={stingerRef}
        preload="auto"
        onEnded={() => {
          if (duckTimer.current) clearTimeout(duckTimer.current);
          setDuckingId(null);
          setStingerPlaying(false);
        }}
      />
    </SoundEngineContext.Provider>
  );
}
