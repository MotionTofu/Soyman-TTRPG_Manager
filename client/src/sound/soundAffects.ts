import type { Affect } from "../data/entities";

/**
 * Что задевает правка звука (docs/adr/0001). Звук — ресурс библиотеки: его имя,
 * роль и иконку показывают библиотека, составы наборов и боевых тем, а
 * загрузка и удаление меняют и общий список «Ресурсов», и список пропавших
 * файлов.
 */
export const SOUND_LIBRARY_AFFECTS: readonly Affect[] = [
  { path: "/sounds" },
  { path: "/files/missing" },
  { path: "/sound-sets" },
  { path: "/playlists" },
  { kind: "resource" },
];

/**
 * Наборы: список (счётчики, привязки), открытый набор и состав на пульте
 * (`/sounds/console`) — его держит движок звука, в каком бы окне ни играл.
 */
export const SOUND_SET_AFFECTS: readonly Affect[] = [{ path: "/sound-sets" }, { path: "/sounds/console" }];

/** Боевые темы: список, открытая тема, наборы, которые на неё ссылаются, и пульт. */
export const BATTLE_AFFECTS: readonly Affect[] = [{ path: "/playlists" }, { path: "/sound-sets" }, { path: "/sounds/console" }];
