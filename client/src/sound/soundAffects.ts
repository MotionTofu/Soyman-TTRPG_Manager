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

/** Наборы: список (счётчики, привязки) и открытый набор. */
export const SOUND_SET_AFFECTS: readonly Affect[] = [{ path: "/sound-sets" }];

/** Боевые темы: список, открытая тема и наборы, которые на неё ссылаются. */
export const BATTLE_AFFECTS: readonly Affect[] = [{ path: "/playlists" }, { path: "/sound-sets" }];
