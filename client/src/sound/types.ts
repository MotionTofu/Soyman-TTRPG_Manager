// Типы пульта звука. Живут рядом с самим пультом, а не в общем types.ts:
// это отдельная подсистема, и её словарь («канал», «набор», «дакинг») за её
// пределами нигде не нужен.

export type AudioRole = "background" | "ambient" | "weather" | "stinger";

export interface SoundButton {
  resource_id: number;
  name: string;
  role: AudioRole | null;
  icon: string | null;
  icon_url: string | null;
  pinned: boolean;
  src: string | null;
  missing: boolean;
  is_start?: boolean;
  from_set?: boolean;
}

export interface SoundSetSummary {
  id: number;
  uid: string | null;
  name: string;
  setting_id: number | null;
  campaign_id: number | null;
  // Плейлист остался ровно под одну роль — тему боя. Музыка самого набора
  // лежит его же треками, см. tracks в SoundSetDetail.
  battle_playlist_id: number | null;
  track_count: number;
  ambient_count: number;
  weather_count: number;
  stinger_count: number;
}

export interface ConsolePayload {
  set: SoundSetSummary | null;
  tracks: { resource_id: number; name: string; src: string | null; missing: boolean }[];
  battle: { id: number; name: string } | null;
  ambient: SoundButton[];
  weather: SoundButton[];
  stingers: SoundButton[];
}

export interface SoundSetDetail extends SoundSetSummary {
  battle_playlist: { id: number; name: string } | null;
  tracks: SoundButton[];
  ambient: SoundButton[];
  weather: SoundButton[];
  stingers: SoundButton[];
}

export interface MissingFile {
  resource_id: number;
  name: string;
  type: string | null;
  audio_role: AudioRole | null;
  file_path: string;
  file_name: string;
}

export interface RelinkCandidate {
  resource_id: number;
  name: string;
  type: string | null;
  file_name: string;
  old_path: string;
  new_path: string;
  match: "name_and_size" | "name_only";
}

export type ChannelKey = "background" | "ambient" | "weather" | "stinger";

// Снимок, который движок из главного окна рассылает пульту. Пульт рисует
// ровно это и ничего не считает сам: два окна, считающие состояние
// независимо, рано или поздно разойдутся, и разойдутся посреди игры.
export interface SoundState {
  setId: number | null;
  ambientId: number | null;
  weatherId: number | null;
  duckingId: number | null;
  silence: boolean;
  // Каналы, остановленные вручную стопом в центре ручки. Бэкграунда здесь нет:
  // его «стоп» виден по самому снимку — очередь есть, играющего трека нет.
  stopped: { ambient: boolean; weather: boolean };
  // Звучит ли стингер прямо сейчас: пока звучит, его есть чем оборвать.
  stingerPlaying: boolean;
  volumes: Record<ChannelKey | "master", number>;
  keys: "digits" | "letters";
  background: {
    trackName: string | null;
    // Что сейчас питает Бэкграунд: имя набора, а в бою — имя боевой темы.
    sourceName: string | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    repeatMode: "off" | "track" | "playlist";
    shuffleMode: boolean;
    tracks: { id: number; name: string; active: boolean }[];
  };
  data: ConsolePayload | null;
  autoSwitch: { from: string; to: string } | null;
  // Набор, включённый запуском сцены. Отдельно от autoSwitch: там возврат —
  // это прежняя очередь треков, здесь — прежний набор целиком.
  sceneSwitch: { scene: string; to: string } | null;
}
