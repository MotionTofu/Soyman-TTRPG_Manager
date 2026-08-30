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
import { api } from "../api/client";
import { useAudioPlayer, type AudioTrack } from "../audioPlayer";
import { onCommand, publishState, type SoundCommand } from "./bus";
import type { PlaylistDetail } from "../types";
import type { ChannelKey, ConsolePayload, SoundState } from "./types";

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

interface Deck {
  a: HTMLAudioElement | null;
  b: HTMLAudioElement | null;
  live: "a" | "b";
  timer: number | null;
}

interface SoundEngineValue {
  state: SoundState;
  enterCombat: (battlePlaylistId: number) => void;
  exitCombat: () => void;
  setSet: (setId: number | null) => void;
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

  const [data, setData] = useState<ConsolePayload | null>(null);
  const [setId, setSetIdState] = useState<number | null>(null);
  const [ambientId, setAmbientId] = useState<number | null>(null);
  const [weatherId, setWeatherId] = useState<number | null>(null);
  const [duckingId, setDuckingId] = useState<number | null>(null);
  const [silence, setSilenceState] = useState(false);
  // Остановленный вручную канал — это не «молчит»: звук выбран и заряжен, его
  // выключил Мастер. Флаг держится отдельно от выбранного звука именно
  // поэтому: стоп не должен стирать выбор, сделанный под сцену.
  const [ambientStopped, setAmbientStopped] = useState(false);
  const [weatherStopped, setWeatherStopped] = useState(false);
  // Звучит ли стингер прямо сейчас. Дакинг для этого не годится: он снимается
  // по DUCK_MAX_MS, а обрывать чаще всего приходится как раз длинный файл,
  // вставленный ради первых пяти секунд, — он к тому моменту ещё играет.
  const [stingerPlaying, setStingerPlaying] = useState(false);
  const [volumes, setVolumes] = useState<Volumes>(loadVolumes);
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
  const [sceneSwitch, setSceneSwitch] = useState<
    { scene: string; to: string; previousSetId: number | null } | null
  >(null);

  const [autoSwitch, setAutoSwitch] = useState<
    {
      from: string;
      to: string;
      previous: { tracks: AudioTrack[]; index: number; time: number; name: string | null };
    } | null
  >(null);

  const ambientDeck = useRef<Deck>({ a: null, b: null, live: "a", timer: null });
  const weatherDeck = useRef<Deck>({ a: null, b: null, live: "a", timer: null });
  const stingerRef = useRef<HTMLAudioElement | null>(null);
  const fadeMsRef = useRef(0);
  // useAudioPlayer() отдаёт новый объект на каждый рендер, поэтому эффект
  // громкости запускается чаще, чем меняется сама громкость. Без этой памяти
  // он звал бы setVolume вхолостую и дёргал провайдер плеера — ровно тот
  // случай, из-за которого «галочка нажималась четыре секунды».
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
    api
      .get<{ fade_duration_ms: number }>("/app-settings")
      .then((s) => (fadeMsRef.current = s.fade_duration_ms || 0))
      .catch(() => (fadeMsRef.current = 0));
  }, []);

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
    const from = el.volume;
    if (ms <= 0 || Math.abs(target - from) < 0.01) {
      el.volume = Math.max(0, Math.min(1, target));
      onDone?.();
      return;
    }
    const steps = Math.max(1, Math.round(ms / 50));
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      const value = from + ((target - from) * step) / steps;
      el.volume = Math.max(0, Math.min(1, value));
      if (step >= steps) {
        window.clearInterval(id);
        onDone?.();
      }
    }, 50);
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
      if (from === null || ms <= 0 || Math.abs(target - from) < 0.01) {
        lastBgGainRef.current = target;
        background.setBackgroundGain(target);
        return;
      }
      const steps = Math.max(1, Math.round(ms / 100));
      let step = 0;
      bgRamp.current = window.setInterval(() => {
        step += 1;
        const value = from + ((target - from) * step) / steps;
        lastBgGainRef.current = Math.max(0, Math.min(1, value));
        background.setBackgroundGain(lastBgGainRef.current);
        if (step >= steps && bgRamp.current) {
          window.clearInterval(bgRamp.current);
          bgRamp.current = null;
        }
      }, 100);
    },
    [background]
  );

  const liveEl = (deck: React.MutableRefObject<Deck>) =>
    deck.current.live === "a" ? deck.current.a : deck.current.b;
  const idleEl = (deck: React.MutableRefObject<Deck>) =>
    deck.current.live === "a" ? deck.current.b : deck.current.a;

  // Смена звука в канале — честный кроссфейд на двух элементах: у зацикленного
  // эмбиента провал в тишину слышен даже сильнее, чем у музыки.
  const switchLoop = useCallback(
    (deck: React.MutableRefObject<Deck>, src: string | null, gain: number) => {
      const outgoing = liveEl(deck);
      const incoming = idleEl(deck);
      const fadeMs = fadeMsRef.current;
      if (!incoming || !outgoing) return;

      if (!src) {
        ramp(outgoing, 0, fadeMs, () => outgoing.pause());
        return;
      }

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
    ramp(liveEl(ambientDeck), ambGain, fade);
    ramp(liveEl(weatherDeck), weaGain, fade);
    const idleAmb = idleEl(ambientDeck);
    const idleWea = idleEl(weatherDeck);
    if (idleAmb && idleAmb.paused) idleAmb.volume = 0;
    if (idleWea && idleWea.paused) idleWea.volume = 0;
    // Стингер уходит в тишину вместе со всеми, а не обрывается: «Тишина»
    // жмётся и посреди стингера, и резкий обрыв там слышен сильнее всего.
    if (!stingerCutting.current) {
      ramp(stingerRef.current, gainFor("stinger", false, silence), silence ? SILENCE_FADE_MS : 0);
    }
    // Бэкграунд — тот же существующий плеер; его громкость здесь производная
    // от общей и канальной, поэтому его собственный ключ в localStorage
    // становится вычисленным значением и перезаписывается движком на старте.
    rampBackground(gainFor("background", ducking, silence), fade);
  }, [volumes, duckingId, silence, gainFor, rampBackground]);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  }, [volumes]);
  useEffect(() => {
    localStorage.setItem(KEYS_KEY, keys);
  }, [keys]);

  // --- загрузка набора ---

  const loadConsole = useCallback(
    (nextSetId: number | null, startPlayback: boolean) => {
      const query = nextSetId ? `?set_id=${nextSetId}` : "";
      return api.get<ConsolePayload>(`/sounds/console${query}`).then((payload) => {
        setData(payload);
        if (!startPlayback) return payload;

        // Набор перебивает стоп: «нажал „Таверна“ — играет таверна», а набор,
        // включающийся наполовину, хуже, чем никакого.
        setAmbientStopped(false);
        setWeatherStopped(false);

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
        if (tracks.length) {
          background.playPlaylist(tracks, 0, null);
        } else {
          // Набор без музыки останавливает её, а не оставляет как есть:
          // предсказуемость важнее — включил «Подземелье», играет подземелье
          // и ничего лишнего.
          background.stop();
        }
        const start = payload.ambient.find((b) => b.is_start && !b.missing) ?? null;
        setAmbientId(start ? start.resource_id : null);
        switchLoop(ambientDeck, start?.src ?? null, gainFor("ambient", false, silence));
        return payload;
      });
    },
    [background, gainFor, silence, switchLoop]
  );

  useEffect(() => {
    void loadConsole(null, false);
    // Один раз при старте: без набора пульт всё равно должен знать про
    // постоянные стингеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- действия ---

  const setSet = useCallback(
    (nextSetId: number | null) => {
      setSetIdState(nextSetId);
      setSilenceState(false);
      void loadConsole(nextSetId, true);
    },
    [loadConsole]
  );

  const playAmbient = useCallback(
    (resourceId: number | null) => {
      const next = resourceId === ambientId ? null : resourceId;
      const button = data?.ambient.find((b) => b.resource_id === next);
      if (next !== null && (!button || button.missing)) return;
      setAmbientId(next);
      setAmbientStopped(false);
      setSilenceState(false);
      switchLoop(ambientDeck, button?.src ?? null, gainFor("ambient", duckingId !== null, false));
    },
    [ambientId, data, duckingId, gainFor, switchLoop]
  );

  const playWeather = useCallback(
    (resourceId: number | null) => {
      const next = resourceId === weatherId ? null : resourceId;
      const button = data?.weather.find((b) => b.resource_id === next);
      if (next !== null && (!button || button.missing)) return;
      setWeatherId(next);
      setWeatherStopped(false);
      setSilenceState(false);
      switchLoop(weatherDeck, button?.src ?? null, gainFor("weather", duckingId !== null, false));
    },
    [weatherId, data, duckingId, gainFor, switchLoop]
  );

  // Стингер обрывает предыдущий: два «Боя» внахлёст — это не эффект, а каша.
  const fireStinger = useCallback(
    (resourceId: number) => {
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
        setDuckingId(null);
        setStingerPlaying(false);
      });
    },
    [data, gainFor]
  );

  // Стоп в центре ручки. Один жест на канал: звучит — выключить, выключен —
  // запустить заново с начала. У каждого канала «заново» своё, потому что и
  // природа у них разная: очередь, зацикленный звук, одиночный выстрел.
  const STINGER_CUT_MS = 350;
  const toggleStop = useCallback(
    (channel: ChannelKey) => {
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
    ]
  );

  const setVolume = useCallback((channel: keyof Volumes, value: number) => {
    setVolumes((prev) => ({ ...prev, [channel]: Math.max(0, Math.min(1, value)) }));
  }, []);

  const setSilence = useCallback((on: boolean) => setSilenceState(on), []);
  const setKeys = useCallback((layout: "digits" | "letters") => setKeysState(layout), []);
  const reload = useCallback(() => void loadConsole(setId, false), [loadConsole, setId]);

  const playPlaylistById = useCallback(
    async (playlistId: number) => {
      const detail = await api.get<PlaylistDetail>(`/playlists/${playlistId}`);
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
      const before = {
        tracks: background.tracks,
        index: background.index,
        time: background.currentTime,
        name: data?.set?.name ?? null,
      };
      void playPlaylistById(battlePlaylistId).then((toName) =>
        setAutoSwitch({
          from: before.name ?? "прежнее",
          to: toName,
          previous: before,
        })
      );
    },
    [background.tracks, background.index, background.currentTime, data, playPlaylistById]
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
      const previousSetId = setId;
      setSet(nextSetId);
      // Тот же набор — не смена: подписывать «включил то, что и так играло»
      // значит приучить Мастера не читать подпись.
      setSceneSwitch(
        nextSetId === previousSetId ? null : { scene: sceneName, to: setName, previousSetId }
      );
    },
    [setId, setSet]
  );

  const revertSceneSet = useCallback(() => {
    const prev = sceneSwitch?.previousSetId ?? null;
    setSceneSwitch(null);
    setSet(prev);
  }, [sceneSwitch, setSet]);

  const exitCombat = useCallback(() => {
    const prev = autoSwitch?.previous ?? null;
    setAutoSwitch(null);
    if (prev && prev.tracks.length) {
      background.playPlaylist(prev.tracks, prev.index, null, prev.time);
    }
  }, [autoSwitch, background]);

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
      <audio ref={(el) => {
        ambientDeck.current.a = el;
      }} preload="auto" />
      <audio ref={(el) => {
        ambientDeck.current.b = el;
      }} preload="auto" />
      <audio ref={(el) => {
        weatherDeck.current.a = el;
      }} preload="auto" />
      <audio ref={(el) => {
        weatherDeck.current.b = el;
      }} preload="auto" />
      <audio
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
