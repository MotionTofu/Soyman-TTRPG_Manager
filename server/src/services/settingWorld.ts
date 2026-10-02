// Паспорт сеттинга и лёгкие записи «Мира» (разбор профиля сеттинга
// 2026-10-01, Q2/Q3/Q8/Q10; словарь граф — .scratch/workbook-redesign/
// glossary.md §3). Как и двигатель силы (services/beingForce.ts), это
// короткие тексты по закрытому набору ключей: одна JSON-колонка, ключи —
// словарь здесь, подписи — в client/src/settingWorld.ts.

const MAX_LEN = 2000;
const MAX_SIGNATURES = 5;

export const PASSPORT_KEYS = ["promise", "premise", "experience", "tone", "scale", "not_this"] as const;

/** Вид записи → ключи её полей. `notes` — «Задумки», у них только текст. */
export const ENTRY_FIELDS: Record<string, readonly string[]> = {
  world_truth: ["formula", "strictness", "scope", "noticeable", "enables", "hinders", "exceptions", "exception_cost", "consequences"],
  tradition: ["names", "where", "languages", "practices", "prestige", "contested", "axes", "rituals", "sacred", "schools", "syncretism", "transmission", "player_notice"],
  norm: ["declared", "practice", "exemptions", "at_risk"],
  tension: ["state", "forces", "incompatibility", "escalates", "unbalances", "without", "signs", "interventions", "play_types", "adventures"],
  activity: ["supports", "needs", "tradeoff", "changes", "where", "promised"],
  capability: ["allows", "access", "prevalence", "cost", "learnability", "reliability", "maintenance", "limits", "consequences", "informal", "risks"],
  flow: ["stages", "owner", "informal", "substitutes", "noticeable", "failure"],
  claim: ["claim", "truth", "common", "versions", "before_pc"],
  diegetic_doc: ["author", "purpose", "distorts", "names"],
  negative_space: ["area", "why", "must_fit", "when_needed"],
  notes: [],
};

export const STRICTNESS = ["hard", "soft", "norm", "exception", "unknown"] as const;

export function isEntryCategory(category: unknown): category is string {
  return typeof category === "string" && Object.prototype.hasOwnProperty.call(ENTRY_FIELDS, category);
}

function pick(raw: unknown, keys: readonly string[], maxLen = MAX_LEN): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, maxLen);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface Passport {
  promise?: string;
  premise?: string;
  experience?: string;
  tone?: string;
  scale?: string;
  not_this?: string;
  signature?: string[];
}

function cleanPassport(raw: unknown): Passport {
  const out: Passport = pick(raw, PASSPORT_KEYS);
  const list = raw && typeof raw === "object" ? (raw as { signature?: unknown }).signature : undefined;
  if (Array.isArray(list)) {
    const signature = list
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, MAX_LEN))
      .filter(Boolean)
      .slice(0, MAX_SIGNATURES);
    if (signature.length) out.signature = signature;
  }
  return out;
}

/** Из колонки — в объект. Битый JSON — пустой паспорт, а не 500. */
export const parsePassport = (raw: unknown): Passport => cleanPassport(parseJson(raw));
/** Из тела запроса — в колонку. Чужие ключи и пустые строки отбрасываются. */
export const serializePassport = (raw: unknown): string => JSON.stringify(cleanPassport(raw));

export function parseEntryFields(category: string, raw: unknown): Record<string, string> {
  return pick(parseJson(raw), ENTRY_FIELDS[category] ?? []);
}

export function serializeEntryFields(category: string, raw: unknown): string {
  const out = pick(raw, ENTRY_FIELDS[category] ?? []);
  // Строгость — выбор из пяти (Q10), а не свободный текст.
  if (out.strictness && !(STRICTNESS as readonly string[]).includes(out.strictness)) delete out.strictness;
  // «Обещано» у деятельности (Q9) — флажок.
  if (out.promised && out.promised !== "1") delete out.promised;
  return JSON.stringify(out);
}

// Паспорт приключения (гриллинг профилей 2026-10-02, Q14; словарь граф №1–8):
// те же ключи, что у паспорта сеттинга, плюс вопросы ваншота и жанр — тетрадь
// ваншота пишет в те же поля.
export const ARC_PASSPORT_KEYS = [
  "central_question",
  "theme_question",
  ...PASSPORT_KEYS,
  "genre",
] as const;
export const parseArcPassport = (raw: unknown): Record<string, string> => pick(parseJson(raw), ARC_PASSPORT_KEYS);
export const serializeArcPassport = (raw: unknown): string => JSON.stringify(pick(raw, ARC_PASSPORT_KEYS));

// Паспорт кампании (спека campaign-paper, Q7/Q16; лист 1 тетради кампании).
// Поля «Препродакшена» переехали сюда миграцией, поэтому потолок длиннее:
// старые тексты бывали в несколько экранов, и обрезать их нельзя.
export const CAMPAIGN_PASSPORT_KEYS = [
  "premise",
  "promise",
  "activity",
  "experience",
  "genre",
  "tone",
  "scale",
  "project_limits",
  "not_this",
  "background",
  "tension",
  "stakes",
] as const;
const CAMPAIGN_PASSPORT_MAX = 20000;
export const parseCampaignPassport = (raw: unknown): Record<string, string> =>
  pick(parseJson(raw), CAMPAIGN_PASSPORT_KEYS, CAMPAIGN_PASSPORT_MAX);
export const serializeCampaignPassport = (raw: unknown): string =>
  JSON.stringify(pick(raw, CAMPAIGN_PASSPORT_KEYS, CAMPAIGN_PASSPORT_MAX));

// Паспорт сессии (спека campaign-paper, Q42; лист 11 тетради кампании).
// Обещание вечера живёт в sessions.idea_notes — здесь остальное.
export const SESSION_PASSPORT_KEYS = ["questions", "player_intent", "exit_state"] as const;
export const parseSessionPassport = (raw: unknown): Record<string, string> => pick(parseJson(raw), SESSION_PASSPORT_KEYS);
export const serializeSessionPassport = (raw: unknown): string => JSON.stringify(pick(raw, SESSION_PASSPORT_KEYS));

// «Чем кончилось» — исходы по осям (словарь №40): цель · цена · отношения ·
// угроза · мир · персонажи. Заполняется после игры.
export const OUTCOME_KEYS = ["goal", "cost", "relations", "threat", "world", "pcs"] as const;
export const parseOutcomes = (raw: unknown): Record<string, string> => pick(parseJson(raw), OUTCOME_KEYS);
export const serializeOutcomes = (raw: unknown): string => JSON.stringify(pick(raw, OUTCOME_KEYS));

// Достоверность тайны (словарь §1): известно · слух · спорно. Пусто — не указана.
export const CERTAINTY = ["known", "rumor", "disputed"] as const;
