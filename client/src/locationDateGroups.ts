// Группы периодичности важных дат: общие константы для таба дат и для
// навигации Master–Detail. Отдельный модуль, а не экспорты из компонента
// (react fast-refresh требует, чтобы файл экспортировал только компоненты).
export const DATE_GROUP_ORDER = ["once", "annual", "monthly", "weekly", "custom"] as const;

export type DateGroupKey = (typeof DATE_GROUP_ORDER)[number];

export const DATE_GROUP_LABELS: Record<string, string> = {
  once: "Разовые",
  annual: "Ежегодные",
  monthly: "Ежемесячные",
  weekly: "Еженедельные",
  custom: "Особые",
};
