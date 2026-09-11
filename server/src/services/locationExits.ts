// Выходы между местами (решения 2026-09-11, §4).
//
// Чистый модуль без импорта db — разбор полей тестируется без открытия базы,
// тот же приём, что locationContent.ts.
export const MAX_EXIT_HOW = 200;
export const MAX_EXIT_TRAVEL = 100;
export const MAX_EXIT_NOTE = 2000;

export interface ExitFields {
  how: string;
  travel_time: string;
  one_way: number;
  secret: number;
  note: string;
}

/**
 * Поля выхода из тела запроса или строки выгрузки. `partial` — для правки:
 * отсутствующее поле не трогается; без него отсутствующее получает умолчание.
 */
export function parseExitFields(
  body: Record<string, unknown>,
  partial: boolean
): { fields: Partial<ExitFields> } | { error: string } {
  const out: Partial<ExitFields> = {};

  const text = (key: "how" | "travel_time" | "note", max: number): string | null => {
    const v = body[key];
    if (v === undefined) {
      if (!partial) out[key] = "";
      return null;
    }
    if (v !== null && typeof v !== "string") return `${key} must be a string`;
    const clean = String(v ?? "").trim();
    if (clean.length > max) return `${key} must be ≤${max} chars`;
    out[key] = clean;
    return null;
  };

  const flag = (key: "one_way" | "secret"): string | null => {
    const v = body[key];
    if (v === undefined) {
      if (!partial) out[key] = 0;
      return null;
    }
    if (v !== true && v !== false && v !== 0 && v !== 1) return `${key} must be boolean`;
    out[key] = v === true || v === 1 ? 1 : 0;
    return null;
  };

  const error =
    text("how", MAX_EXIT_HOW) ??
    text("travel_time", MAX_EXIT_TRAVEL) ??
    text("note", MAX_EXIT_NOTE) ??
    flag("one_way") ??
    flag("secret");
  return error ? { error } : { fields: out };
}
