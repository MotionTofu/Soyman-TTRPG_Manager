/**
 * Режим «Вызовы» пульта LitM (Backlog Д33, Q1–Q22): состояние строк расклада.
 *
 * Расклад живёт в `initiative_entries` сессии, как бой D&D, но своими видами
 * строк: `litm_challenge` — вызов на ленте, `litm_scene` — полоса «Сцена»
 * со спотлайтом (одна на сессию). Всё изменчивое — JSON в колонке `state`.
 * Профиль вызова (статблок `litm_challenge`) не меняется: пульт держит копию
 * пределов и живые отметки (Q6).
 */
import { giveStatus, normalizeStatuses, parseStatusTag, reduceMarks, stackMarks, statusTier, type LitmStatus } from "./status";

export const LITM_CHALLENGE_KIND = "litm_challenge";
export const LITM_SCENE_KIND = "litm_scene";

/** Предел вызова — он же карточка учёта засчитанного статуса (Q8). */
export interface LitmLimitState {
  name: string;
  /** null — «—» в книге: так вызов не победить, клеток нет (Q9). */
  max: number | null;
  /** Предел со стрелкой ↻: достигнут — вызов меняется, а не уходит. */
  turns: boolean;
  note: string;
  /** Имя засчитанного статуса («напуган»); пусто, пока ничего не дали. */
  status: string;
  marks: number[];
}

export interface LitmChallengeState {
  limits: LitmLimitState[];
  /** Статусы вне пределов («настороже»). */
  statuses: LitmStatus[];
  /** Номер объявленной угрозы профиля (Q12), null — нет. */
  declaredThreat: number | null;
  /** Зачин объявленной угрозы — для плашки «⚠» над лентой. */
  declaredLead: string;
  /** Надстройки на гнезде — id записей «Надстройки» (Q17). */
  addons: number[];
}

/** Минимум профиля, из которого собирается строка: пределы и теги книги. */
export interface LitmProfileSource {
  limitList?: { name: string; max: string; arrow?: boolean; note?: string }[];
  tagList?: { text: string }[];
}

/** Строка вызова при добавлении на ленту: пределы из профиля, стартовые
 *  статусы — из тегов вида «*настороже-1*» (Q6). */
export function challengeStateFromProfile(p: LitmProfileSource): LitmChallengeState {
  const limits = (p.limitList ?? []).map((l) => {
    const n = Number.parseInt(l.max, 10);
    return {
      name: l.name,
      max: Number.isFinite(n) && n >= 1 ? Math.min(n, 6) : null,
      turns: !!l.arrow || !!l.note?.trim(),
      note: l.note ?? "",
      status: "",
      marks: [],
    };
  });
  let statuses: LitmStatus[] = [];
  for (const t of p.tagList ?? []) {
    const s = parseStatusTag(t.text);
    if (s) statuses = giveStatus(statuses, s.name, s.tier);
  }
  return { limits, statuses, declaredThreat: null, declaredLead: "", addons: [] };
}

export function limitTier(l: Pick<LitmLimitState, "marks">): number {
  return statusTier(l.marks);
}

export function limitReached(l: Pick<LitmLimitState, "max" | "marks">): boolean {
  return l.max != null && statusTier(l.marks) >= l.max;
}

/** Засчитать статус против предела (сложение по книге). У «—» не засчитывается. */
export function giveToLimit(state: LitmChallengeState, index: number, status: string, tier: number): LitmChallengeState {
  const l = state.limits[index];
  if (!l || l.max == null) return state;
  const limits = state.limits.slice();
  limits[index] = { ...l, status: l.status || status.trim(), marks: stackMarks(l.marks, tier) };
  return { ...state, limits };
}

/** Ослабить статус предела («снять 1 уровень с *убежать*»). */
export function reduceLimit(state: LitmChallengeState, index: number, by: number): LitmChallengeState {
  const l = state.limits[index];
  if (!l) return state;
  const limits = state.limits.slice();
  const marks = reduceMarks(l.marks, by);
  limits[index] = { ...l, marks, status: marks.length ? l.status : "" };
  return { ...state, limits };
}

/** Чем вызов преодолён: первый достигнутый предел без ↻. Предел ↻ вызов
 *  меняет, но не убирает (Q9). */
export function overcomeBy(state: LitmChallengeState): LitmLimitState | null {
  return state.limits.find((l) => !l.turns && limitReached(l)) ?? null;
}

/** Достигнутые пределы ↻ — их примечание пульт показывает плашкой. */
export function turnedLimits(state: LitmChallengeState): LitmLimitState[] {
  return state.limits.filter((l) => l.turns && limitReached(l));
}

/** Сюжетный тег сцены (Q11): «мешает» — отрицательный, «1×» — одноразовый. */
export interface LitmStoryTag {
  name: string;
  hindering?: boolean;
  singleUse?: boolean;
}

/** Предел-счётчик сцены («вечерня 4», «ритуал 5»). */
export interface LitmProgressLimit {
  name: string;
  max: number;
  marks: number[];
}

/** Спотлайт (Q4): кто сейчас, кто сходил в круге, сколько раз за сессию. */
export interface LitmSpotlight {
  /** id персонажа в спотлайте. */
  current: number | null;
  acted: number[];
  /** Сколько раз герою давали спотлайт за сессию — ключ id персонажа. */
  counts: Record<string, number>;
}

export interface LitmSceneState {
  tags: LitmStoryTag[];
  statuses: LitmStatus[];
  progress: LitmProgressLimit[];
  spotlight: LitmSpotlight;
  /** Сцена пульта, к которой относятся теги, — для плашки «Сцена сменилась» (Q11). */
  sceneId: number | null;
}

export function emptySceneState(): LitmSceneState {
  return { tags: [], statuses: [], progress: [], spotlight: { current: null, acted: [], counts: {} }, sceneId: null };
}

/**
 * Дать спотлайт герою `to` (или следующему по `order`, кто в круге не ходил
 * и не выбыл). Текущий отмечается сходившим; когда сходили все, кто может
 * действовать, круг начинается заново (номер раунда не нужен, Q4).
 */
export function passSpotlight(sp: LitmSpotlight, order: readonly number[], out: readonly number[] = [], to?: number): LitmSpotlight {
  const able = order.filter((id) => !out.includes(id));
  let acted = sp.current != null && !sp.acted.includes(sp.current) ? [...sp.acted, sp.current] : sp.acted.slice();
  if (able.length && able.every((id) => acted.includes(id))) acted = [];
  let next = to;
  if (next == null) {
    const start = sp.current != null ? order.indexOf(sp.current) : -1;
    for (let k = 1; k <= order.length && next == null; k++) {
      const id = order[(start + k + order.length) % order.length];
      if (able.includes(id) && !acted.includes(id)) next = id;
    }
  }
  if (next == null) return { ...sp, current: null, acted };
  acted = acted.filter((id) => id !== next);
  return { current: next, acted, counts: { ...sp.counts, [next]: (sp.counts[next] ?? 0) + 1 } };
}

/** Привал (Q11, A179): сюжетные теги сцены снимаются. Вычеркнутые теги силы
 *  героев возвращаются в их листах (поле `scratchedTags` темы). */
export function campScene(s: LitmSceneState): LitmSceneState {
  return { ...s, tags: [] };
}

function parseObj(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Состояние строки вызова из колонки `state`; чего нет — пустым. */
export function parseChallengeState(raw: string | null | undefined): LitmChallengeState {
  const o = parseObj(raw);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    limits: arr<LitmLimitState>(o.limits).map((l) => ({
      name: String(l.name ?? ""),
      max: typeof l.max === "number" ? l.max : null,
      turns: !!l.turns,
      note: String(l.note ?? ""),
      status: String(l.status ?? ""),
      marks: arr<number>(l.marks).filter((m) => Number.isInteger(m) && m >= 1 && m <= 6),
    })),
    statuses: normalizeStatuses(o.statuses),
    declaredThreat: typeof o.declaredThreat === "number" ? o.declaredThreat : null,
    declaredLead: typeof o.declaredThreat === "number" ? String(o.declaredLead ?? "") : "",
    addons: arr<number>(o.addons).filter((n) => typeof n === "number"),
  };
}

export function parseSceneState(raw: string | null | undefined): LitmSceneState {
  const o = parseObj(raw);
  const base = emptySceneState();
  const sp = (o.spotlight ?? {}) as Partial<LitmSpotlight>;
  return {
    tags: Array.isArray(o.tags) ? (o.tags as LitmStoryTag[]).filter((t) => t && typeof t.name === "string") : base.tags,
    statuses: normalizeStatuses(o.statuses),
    progress: Array.isArray(o.progress) ? (o.progress as LitmProgressLimit[]) : base.progress,
    spotlight: {
      current: typeof sp.current === "number" ? sp.current : null,
      acted: Array.isArray(sp.acted) ? sp.acted.filter((n) => typeof n === "number") : [],
      counts: sp.counts && typeof sp.counts === "object" ? { ...sp.counts } : {},
    },
    sceneId: typeof o.sceneId === "number" ? o.sceneId : null,
  };
}
