// Наполнение «что внутри» (план «Зоны локаций», этап 6).
//
// Чистый модуль без импорта db — валидация тестируется без открытия базы,
// тот же приём, что locationRoles.test.ts.
export const LOCATION_CONTENT_KINDS = ["secret", "loot", "trap", "feature"] as const;

export type LocationContentKind = (typeof LOCATION_CONTENT_KINDS)[number];

export const LOCATION_CONTENT_LABELS: Record<LocationContentKind, string> = {
  secret: "Секрет",
  loot: "Лут",
  trap: "Ловушка",
  feature: "Особенность",
};

export const MAX_CONTENT_TEXT = 2000;

export function validateContentInput(kind: unknown, text: unknown): string | null {
  if (!(LOCATION_CONTENT_KINDS as readonly string[]).includes(kind as string)) {
    return "kind must be secret|loot|trap|feature";
  }
  const clean = String(text ?? "").trim();
  if (!clean) return "text must not be empty";
  if (clean.length > MAX_CONTENT_TEXT) {
    return `text must be ≤${MAX_CONTENT_TEXT} chars`;
  }
  return null;
}
