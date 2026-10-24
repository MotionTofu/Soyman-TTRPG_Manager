/** Тоны и подписи точек циклов — один список на редактор и дорожки.
 * Сервер хранит только key; неизвестное значение API отклоняет. */
export const CYCLE_POINT_PALETTE = [
  { key: "ochre", label: "Охра", color: "var(--chronicle-past)" },
  { key: "green", label: "Зелёный", color: "var(--chronicle-ongoing)" },
  { key: "blue", label: "Синий", color: "var(--chronicle-upcoming)" },
  { key: "slate", label: "Серый", color: "var(--chronicle-cancelled)" },
  { key: "plum", label: "Фиолетовый", color: "color-mix(in srgb, var(--role-gm) 65%, var(--paper-muted))" },
  { key: "red", label: "Красный", color: "var(--paper-alarm)" },
  { key: "brown", label: "Коричневый", color: "var(--paper-muted)" },
  { key: "ink", label: "Чернила", color: "var(--paper-ink-soft)" },
  { key: "moss", label: "Мох", color: "color-mix(in srgb, var(--chronicle-ongoing) 65%, var(--paper-muted))" },
] as const;

export function cyclePointColor(key: string | null | undefined): string | undefined {
  return CYCLE_POINT_PALETTE.find((item) => item.key === key)?.color;
}
