// Схема формата adventure-import/1 — см. docs/adventure-import/format.md.
//
// Здесь только форма: типы полей, допустимые значения перечислений, префиксы
// ключей. Смысловые проверки (ссылки в никуда, дубли ключей, меншены на
// несозданные сущности) живут в validate.ts — им нужен файл целиком.
//
// Всё, кроме `format`, `setting` и ключей, необязательно: модель, которая
// поленилась заполнить поле, не должна ронять импорт целой книги.

import { z } from "zod";

const text = z.string().default("");
const optionalText = z.string().optional();

/** Ключ с обязательным префиксом типа: loc.phandalin, npc.sildar. */
const key = (prefix: string) =>
  z
    .string()
    .min(prefix.length + 1, `ключ должен быть длиннее префикса «${prefix}»`)
    .refine((k) => k.startsWith(prefix), `ключ должен начинаться с «${prefix}»`);

/**
 * Имя в оригинале книги и синонимы. Между разными переводами одной книги имя
 * совпадает редко, а «Sea Ward» — почти всегда; алиасы ловят остальное.
 */
const nameOriginal = optionalText;
const aliases = z.array(z.string()).default([]);

/** Ссылка на чужой ключ. Существование проверяется в validate.ts. */
const ref = z.string().min(1);

/**
 * Необязательная ссылка. Промпт просит незаполненные поля не писать вовсе, но
 * модели прилежно пишут `"parent": ""` в значении «родителя нет» — и целая
 * книга отвергалась из-за пустой строки. Пусто здесь и значит «нет ссылки».
 */
const optionalRef = z.preprocess(
  (v) => (typeof v === "string" && !v.trim() ? undefined : v),
  ref.nullish()
);

/** То же для списков: пустая строка в массиве ссылок — просто мусор. */
const refs = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x !== "string" || x.trim()) : v),
  z.array(ref).default([])
);

const chapter = z.object({
  title: text,
  content: text,
});
const chapters = z.array(chapter).default([]);

const importantDate = z.object({
  title: z.string().min(1),
  recurrence: z.enum(["once", "annual", "monthly"]).default("once"),
  year: z.number().int().nullish(),
  month: z.number().int().nullish(),
  day: z.number().int(),
});

export const locationSchema = z.object({
  key: key("loc."),
  name: z.string().min(1),
  name_original: nameOriginal,
  short_name: optionalText,
  kind: text,
  parent: optionalRef,
  description: text,
  chapters,
  aliases,
});

export const beingSchema = z.object({
  key: key("npc."),
  name: z.string().min(1),
  name_original: nameOriginal,
  short_name: optionalText,
  category: z.enum(["key_figure", "influential", "notable"]).default("notable"),
  description: text,
  history: chapters,
  behavior: chapters,
  statblock_short: text,
  statblock_full: text,
  locations: refs,
  communities: refs,
  important_dates: z.array(importantDate).default([]),
  aliases,
});

export const bestiarySchema = z.object({
  key: key("bst."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  description: text,
  statblock_short: text,
  statblock_full: text,
  locations: refs,
  // Названия монстров из системы. По ним экран сверки ищет запись в
  // компендиуме — см. compendium.ts. Сами id машинно-зависимые, поэтому в
  // файле их нет и связь всегда подтверждает человек.
  compendium_hints: z.array(z.string()).default([]),
});

export const communitySchema = z.object({
  key: key("com."),
  name: z.string().min(1),
  name_original: nameOriginal,
  parent: optionalRef,
  description: text,
  history: text,
  current_situation: text,
  features: text,
  goals: text,
  locations: refs,
  aliases,
});

export const treasurySchema = z.object({
  key: key("item."),
  name: z.string().min(1),
  name_original: nameOriginal,
  aliases,
  short_name: optionalText,
  owner: text,
  power: text,
  history: text,
  notes: text,
  item_type: text,
  rarity: text,
  requires_attunement: z.boolean().default(false),
  chapters,
});

const checkSchema = z.object({
  what: text,
  difficulty: text,
  on_success: text,
  on_failure: text,
});

const rewardSchema = z.object({
  what: text,
  where_found: text,
  notes: text,
  item: optionalRef,
});

export const sceneSchema = z.object({
  key: key("scn."),
  chapter: optionalRef,
  name: z.string().min(1),
  kind: z.enum(["scene", "encounter", "branch", "ending"]).default("scene"),
  summary: text,
  read_aloud: text,
  whats_happening: text,
  entry_condition: text,
  outcomes: text,
  locations: refs,
  participants: refs,
  items: refs,
  checks: z.array(checkSchema).default([]),
  rewards: z.array(rewardSchema).default([]),
  next: z.array(z.object({ to: ref, label: text })).default([]),
});

export const adventureSchema = z.object({
  key: key("adv."),
  name: z.string().min(1),
  description: text,
  hook: text,
  recommended_level: text,
  player_count: text,
  duration: text,
  tags: text,
  chapters: z
    .array(z.object({ key: key("chp."), name: z.string().min(1), description: text }))
    .default([]),
  scenes: z.array(sceneSchema).default([]),
  milestones: z
    .array(
      z.object({
        key: key("mls."),
        title: z.string().min(1),
        description: text,
        scene: optionalRef,
      })
    )
    .default([]),
  secrets: z
    .array(
      z.object({
        key: key("sec."),
        kind: z.enum(["secret", "clue", "thread"]).default("secret"),
        title: z.string().min(1),
        content: text,
      })
    )
    .default([]),
  rewards: z.array(rewardSchema).default([]),
});

export const calendarEventSchema = z.object({
  title: z.string().min(1),
  description: text,
  year: z.number().int(),
  month: z.number().int(),
  day: z.number().int(),
  important: z.boolean().default(false),
});

export const relationSchema = z.object({
  from: ref,
  to: ref,
  tone: z.enum(["positive", "negative", "neutral", "mixed"]).default("neutral"),
  label: text,
  description: text,
});

export const importFileSchema = z.object({
  format: z.literal("adventure-import/1"),
  language: z.string().default("ru"),
  setting: z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: text,
  }),
  source: z
    .object({
      title: text,
      authors: text,
      pages: text,
      part: text,
    })
    .default({ title: "", authors: "", pages: "", part: "" }),
  locations: z.array(locationSchema).default([]),
  beings: z.array(beingSchema).default([]),
  bestiary: z.array(bestiarySchema).default([]),
  communities: z.array(communitySchema).default([]),
  treasury: z.array(treasurySchema).default([]),
  adventures: z.array(adventureSchema).default([]),
  calendar_events: z.array(calendarEventSchema).default([]),
  relations: z.array(relationSchema).default([]),
  links: z
    .array(z.object({ from: ref, to: ref, section: text }))
    .default([]),
});

export type ImportFile = z.infer<typeof importFileSchema>;
export type ImportScene = z.infer<typeof sceneSchema>;
export type ImportAdventure = z.infer<typeof adventureSchema>;

/** Префикс ключа → тип сущности приложения (для меншенов и generic_links). */
export const KEY_PREFIX_TO_TYPE: Record<string, string> = {
  "loc.": "location",
  "npc.": "being",
  "bst.": "being",
  "com.": "community",
  "item.": "artifact",
  "adv.": "adventure",
  "chp.": "adventure", // глава — тот же story_arcs
  "scn.": "scene",
};

/** Ключи, у которых в приложении нет своей страницы: меншен на них не собрать. */
export const UNLINKABLE_PREFIXES = ["mls.", "sec."];

export function prefixOf(key: string): string | null {
  const dot = key.indexOf(".");
  return dot === -1 ? null : key.slice(0, dot + 1);
}
