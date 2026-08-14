import type { ReactNode } from "react";

// Шесть типов, которые умеет создавать визард. Значения совпадают с типами
// сущностей в графе связей и в поиске, чтобы не заводить второй словарь.
export type WizardEntityType =
  | "location"
  | "being"
  | "bestiary"
  | "community"
  | "artifact"
  | "event";

export interface WizardContext {
  settingId: number;
  // Подстановки от места вызова: страница локации предлагает себя как
  // родителя, страница сообщества — как принадлежность, и так далее.
  defaults?: {
    parentLocationId?: number | null;
    communityIds?: number[];
    locationIds?: number[];
  };
}

// Черновик — общий мешок полей: у каждого типа свой набор, но визард с ним
// работает единообразно (шаг патчит нужные ключи, create собирает запрос).
export type WizardDraft = Record<string, unknown>;

export interface WizardStep {
  title: string;
  render: (
    draft: WizardDraft,
    patch: (values: WizardDraft) => void,
    ctx: WizardContext
  ) => ReactNode;
}

export interface WizardTypeSpec {
  type: WizardEntityType;
  // Как тип называется в списке на первом шаге и в кнопке «Создать и перейти».
  label: string;
  // «…в профиль локации» — родительный падеж для кнопки.
  labelGenitive: string;
  namePlaceholder: string;
  initialDraft: (ctx: WizardContext) => WizardDraft;
  // Шаги со второго: первый (имя и тип) общий для всех типов.
  steps: (ctx: WizardContext) => WizardStep[];
  // Создаёт сущность и возвращает её id — по нему открывается профиль.
  create: (draft: WizardDraft, ctx: WizardContext) => Promise<number>;
  // Куда ведёт «Создать и перейти».
  profilePath: (id: number, ctx: WizardContext) => string;
  // Подпись этой кнопки, если «перейти в профиль» — не то, что произойдёт
  // (у события профиля пока нет, оно открывается в хронике).
  gotoLabel?: string;
}
