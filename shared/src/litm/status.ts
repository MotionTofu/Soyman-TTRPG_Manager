/**
 * Статусы Legend in the Mist — карточка учёта из книги (A166–A170).
 *
 * Статус — тег с уровнем 1–6. На карточке шесть клеток; уровень — старшая
 * отмеченная. Пришёл такой же статус — отмечается клетка его уровня, а если
 * она занята, следующая свободная справа (ранен-2 + ранен-2 = ранен-3).
 * Ослабление сдвигает все отметки влево; ушедшие ниже 1 пропадают.
 *
 * Модуль общий для листа героя и пульта (режим «Вызовы», Backlog Д33):
 * одна арифметика на всех, чтобы лист и пульт не разошлись.
 */

export const STATUS_MAX_TIER = 6;
/** Предел героя — всегда 5 для любого статуса (A169). */
export const HERO_LIMIT = 5;

export interface LitmStatus {
  name: string;
  /** Отмеченные клетки 1–6, по возрастанию, без повторов. */
  marks: number[];
}

function clampTier(n: number): number {
  return Math.max(0, Math.min(STATUS_MAX_TIER, Math.trunc(Number(n) || 0)));
}

function cleanMarks(marks: readonly number[]): number[] {
  return [...new Set(marks.map((m) => Math.trunc(Number(m))).filter((m) => m >= 1 && m <= STATUS_MAX_TIER))].sort((a, b) => a - b);
}

/** Уровень — старшая отмеченная клетка; 0 — статуса нет. */
export function statusTier(marks: readonly number[]): number {
  return marks.length ? Math.max(...marks) : 0;
}

/** Отметить уровень `tier` по правилу сложения. Клетки 6 и правее нет: сверх
 *  шестой статус не растёт. */
export function stackMarks(marks: readonly number[], tier: number): number[] {
  const t = clampTier(tier);
  const cur = cleanMarks(marks);
  if (t < 1) return cur;
  let box = t;
  while (box <= STATUS_MAX_TIER && cur.includes(box)) box++;
  return box > STATUS_MAX_TIER ? cur : cleanMarks([...cur, box]);
}

/** Ослабить на `by` уровней: все отметки сдвигаются влево. */
export function reduceMarks(marks: readonly number[], by: number): number[] {
  const n = Math.max(0, Math.trunc(Number(by) || 0));
  return cleanMarks(marks.map((m) => m - n));
}

/** Одинаковое имя — без регистра, лишних пробелов и «ё/е». */
export function sameStatus(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

export function formatStatus(s: Pick<LitmStatus, "name" | "marks">): string {
  return `${s.name}-${statusTier(s.marks)}`;
}

/**
 * Дать статус в список. Тот же статус (по имени или `into` — «Сложить с»,
 * когда Рассказчик признал похожие) складывается; иначе — новая карточка.
 */
export function giveStatus(list: readonly LitmStatus[], name: string, tier: number, into?: string): LitmStatus[] {
  const target = into ?? name;
  const i = list.findIndex((s) => sameStatus(s.name, target));
  if (i < 0) {
    const marks = stackMarks([], tier);
    return marks.length ? [...list, { name: name.trim(), marks }] : [...list];
  }
  const next = list.slice();
  next[i] = { ...list[i], marks: stackMarks(list[i].marks, tier) };
  return next;
}

/** Ослабить статус; ослабленный до нуля снимается совсем. */
export function reduceStatus(list: readonly LitmStatus[], name: string, by: number): LitmStatus[] {
  return list.flatMap((s) => {
    if (!sameStatus(s.name, name)) return [s];
    const marks = reduceMarks(s.marks, by);
    return marks.length ? [{ ...s, marks }] : [];
  });
}

/**
 * Статус из разметки книги: «*настороже-1*», «застигнут-врасплох-3».
 * Имя может содержать дефисы — уровень только последнее число.
 */
export function parseStatusTag(text: string): { name: string; tier: number } | null {
  const m = /^\*?\s*(.+?)-([1-6])\s*\*?$/.exec(text.trim());
  if (!m || m[1].includes("*")) return null;
  return { name: m[1].trim(), tier: Number(m[2]) };
}

/** Что видит Рассказчик на карточке героя: 5 — повержен, 6 — необратимо. */
export function heroCondition(list: readonly LitmStatus[]): { overcome: LitmStatus | null; beyond: LitmStatus | null } {
  let overcome: LitmStatus | null = null;
  let beyond: LitmStatus | null = null;
  for (const s of list) {
    const t = statusTier(s.marks);
    if (t > HERO_LIMIT && !beyond) beyond = s;
    if (t >= HERO_LIMIT && (!overcome || t > statusTier(overcome.marks))) overcome = s;
  }
  return { overcome, beyond };
}

/** Статусы из сохранённого JSON: битое — выбросить, отметки привести в порядок. */
export function normalizeStatuses(raw: unknown): LitmStatus[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const marks = Array.isArray(o.marks) ? cleanMarks(o.marks.map(Number)) : [];
    return name && marks.length ? [{ name, marks }] : [];
  });
}
