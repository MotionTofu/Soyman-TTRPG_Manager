// Паспорт сеттинга и лёгкие записи «Мира» — подписи (разбор профиля
// сеттинга 2026-10-01, Q2/Q10; словарь граф — .scratch/workbook-redesign/
// glossary.md §3). Ключи — те же, что у сервера (server/src/services/
// settingWorld.ts); подписи — здесь, в одном месте.

import type { Affect } from "./data/entities";

/** Записи «Мира» сеттинга: один список на все виды — группирует клиент. */
export const worldPath = (settingId: number) => `/setting-entries?setting_id=${settingId}`;
/** Правка записи задевает и список, и счётчик на язычке «Мир». */
export const worldAffects = (settingId: number): Affect[] => [{ path: "/setting-entries" }, { path: `/settings/${settingId}/counts` }];

export const PASSPORT_FIELDS = [
  { key: "promise", label: "Обещание", hint: "Что игроки получат в этом мире — одной-двумя фразами" },
  { key: "premise", label: "Исходная ситуация", hint: "Что происходит, когда герои входят в игру" },
  { key: "experience", label: "Желаемый опыт", hint: "Какие чувства и решения должна давать игра" },
  { key: "tone", label: "Тон", hint: "Мрачно, легко, нуар, сказка…" },
  { key: "scale", label: "Масштаб", hint: "Квартал, город, континент…" },
] as const;

/** «Чем не является» — последней строкой паспорта (поправка владельца, Q2). */
export const PASSPORT_NOT_THIS = { key: "not_this", label: "Чем не является", hint: "Чего в этом мире сознательно нет" } as const;

export const MAX_SIGNATURES = 5;

export interface EntryField {
  key: string;
  label: string;
}

export interface EntryType {
  key: string;
  /** Заголовок группы в «Мире». */
  group: string;
  /** Вид записи в единственном числе — в «+ Запись» и шапке карточки. */
  one: string;
  /** Поля по словарю граф; первое — главная строка в списке. */
  fields: EntryField[];
}

const f = (key: string, label: string): EntryField => ({ key, label });

/** Порядок групп «Мира» — как на макете (доска 13), «Задумки» последними. */
export const ENTRY_TYPES: EntryType[] = [
  {
    key: "world_truth",
    group: "Правила мира",
    one: "Правило мира",
    fields: [
      f("formula", "Формула"),
      f("strictness", "Строгость"),
      f("scope", "Область"),
      f("noticeable", "Как заметно"),
      f("enables", "Что делает возможным"),
      f("hinders", "Что затрудняет"),
      f("exceptions", "Исключения"),
      f("exception_cost", "Цена исключения"),
      f("consequences", "Следствия"),
    ],
  },
  {
    key: "tradition",
    group: "Традиции",
    one: "Традиция",
    fields: [
      f("practices", "Практики"),
      f("names", "Самоназвание и внешние названия"),
      f("where", "Где живут"),
      f("languages", "Языки"),
      f("prestige", "Что престижно"),
      f("contested", "Что оспаривается"),
      f("axes", "Внутренние различия"),
      f("rituals", "Ритуалы и табу"),
      f("sacred", "Священное"),
      f("schools", "Школы и споры"),
      f("syncretism", "Синкретизм"),
      f("transmission", "Как передаётся"),
      f("player_notice", "Что игрок заметит"),
    ],
  },
  {
    key: "norm",
    group: "Нормы",
    one: "Норма",
    fields: [f("declared", "Заявлено"), f("practice", "Как работает на деле"), f("exemptions", "Кто получает исключение"), f("at_risk", "Кто рискует")],
  },
  {
    key: "tension",
    group: "Напряжения",
    one: "Напряжение",
    fields: [
      f("state", "Состояние"),
      f("forces", "Силы"),
      f("incompatibility", "Несовместимость"),
      f("escalates", "Что обостряет"),
      f("unbalances", "Что выводит из равновесия"),
      f("without", "Без вмешательства"),
      f("signs", "Признаки"),
      f("interventions", "Точки вмешательства"),
      f("play_types", "Типы игры"),
      f("adventures", "Три приключения"),
    ],
  },
  {
    key: "activity",
    group: "Деятельность",
    one: "Деятельность",
    fields: [f("supports", "Что поддерживает"), f("needs", "Что нужно"), f("tradeoff", "Компромисс"), f("changes", "Что меняет"), f("where", "Где")],
  },
  {
    key: "capability",
    group: "Возможности",
    one: "Возможность",
    fields: [
      f("allows", "Что позволяет"),
      f("access", "Доступ"),
      f("prevalence", "Распространённость"),
      f("cost", "Цена"),
      f("learnability", "Обучаемость"),
      f("reliability", "Надёжность"),
      f("maintenance", "Обслуживание"),
      f("limits", "Ограничения"),
      f("consequences", "Дерево последствий"),
      f("informal", "Неформальный доступ"),
      f("risks", "Новые риски"),
    ],
  },
  {
    key: "flow",
    group: "Потоки",
    one: "Поток",
    fields: [f("stages", "Этапы"), f("owner", "Владелец"), f("informal", "Неформальный доступ"), f("substitutes", "Замены"), f("noticeable", "Как заметно"), f("failure", "Что при сбое")],
  },
  {
    key: "claim",
    group: "Утверждения и версии",
    one: "Утверждение",
    fields: [f("claim", "Что утверждается"), f("truth", "Правда автора"), f("common", "Общеизвестное"), f("versions", "Версии"), f("before_pc", "Знать до создания персонажа")],
  },
  {
    key: "diegetic_doc",
    group: "Документы мира",
    one: "Документ мира",
    fields: [f("author", "Кто создал"), f("purpose", "Зачем"), f("distorts", "Что исказил или скрыл"), f("names", "Названия-позиции")],
  },
  {
    key: "negative_space",
    group: "Белые пятна",
    one: "Белое пятно",
    fields: [f("area", "Область"), f("why", "Почему не детализируем"), f("must_fit", "С чем обязано совместиться"), f("when_needed", "Когда понадобится")],
  },
  // «Задумки» (Q19): бывший раздел «Заметки». Только текст, игрокам не видны.
  { key: "notes", group: "Задумки", one: "Задумка", fields: [] },
];

export const ENTRY_TYPE = new Map(ENTRY_TYPES.map((t) => [t.key, t]));

export const STRICTNESS_OPTIONS = [
  { value: "hard", label: "жёсткое" },
  { value: "soft", label: "мягкое" },
  { value: "norm", label: "норма" },
  { value: "exception", label: "исключение" },
  { value: "unknown", label: "неизвестно" },
] as const;

export function strictnessLabel(value: string | undefined): string {
  return STRICTNESS_OPTIONS.find((o) => o.value === value)?.label ?? "";
}

/** Главная строка записи в списке: первое заполненное поле вида, иначе текст. */
export function entryLine(type: EntryType | undefined, fields: Record<string, string>, content: string): string {
  for (const fld of type?.fields ?? []) {
    const v = fields[fld.key];
    if (v?.trim()) return fld.key === "strictness" ? strictnessLabel(v) : v;
  }
  return content;
}
