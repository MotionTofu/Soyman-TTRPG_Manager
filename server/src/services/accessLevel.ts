// Ступень выдачи (Кабинет игрока, 2026-09-12, шаг 2): 'mentioned' (упомянута —
// имя, вид, картинка) | 'open' (открыта — всё, кроме мастерских полей).
//
// Живёт отдельно, а не в routes/visibilityGrants.ts, чтобы расчёт выдачи
// (services/playerContent.ts) и ручки выдачи не тянули друг друга по кругу:
// превью «Глазами игрока» обязано идти тем же расчётом, что и выдача игроку.
//
// Неизвестное читается как 'open', а не как «спрятать»: умолчание обязано
// сохранять то, что уже роздано.
export type AccessLevel = "mentioned" | "open";

const VALID_ACCESS_LEVELS = new Set<string>(["mentioned", "open"]);

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && VALID_ACCESS_LEVELS.has(value);
}

export function normalizeAccessLevel(value: unknown): AccessLevel {
  return isAccessLevel(value) ? value : "open";
}
