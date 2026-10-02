// Двигатель силы и участие (разбор профилей 2026-10-01, Q3/Q7, словарь граф
// §2). Оба — короткие тексты по закрытому набору ключей, поэтому лежат
// одной JSON-колонкой, а не десятью: набор ключей — словарь, а не схема, и
// у сообщества (тоже «сила») он будет тем же.
//
// Двигатель — свойство существа: что оно хочет, боится, знает… Участие —
// контекст кампании: текущая цель, план, что будет без вмешательства, что
// будет, если помочь. Контекст в свойства сущности не попадает (принцип
// словаря), поэтому участие живёт на главе «Текущая ситуация» с её
// campaign_id, а не на существе.

export const FORCE_KEYS = [
  // ядро
  "want",
  "fear",
  "knows",
  "can",
  "cannot",
  "needs",
  // необязательные
  "means",
  "interest",
  "stance",
  "pressure",
] as const;

// Ход событий (словарь §2): цель, план, без вмешательства, если помочь, если
// лишить ресурса или рычага. Один набор на участие в кампании (глава
// «Текущая ситуация») и в приключении (таблица participations).
export const PARTICIPATION_KEYS = ["goal", "plan", "without", "if_help", "if_deprived"] as const;
// Участие персонажа игрока в кампании (словарь №21; гриллинг 2026-10-02, Q16):
// почему здесь, личная ставка, почему сейчас.
export const PC_PARTICIPATION_KEYS = ["why_here", "stake", "why_now"] as const;

const MAX_LEN = 600;

function pick(raw: unknown, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_LEN);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function parse(raw: unknown, keys: readonly string[]): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return pick(JSON.parse(raw), keys);
  } catch {
    return {};
  }
}

/** Из колонки базы — в объект для клиента. Битый JSON — пустой двигатель. */
export const parseForce = (raw: unknown) => parse(raw, FORCE_KEYS);
export const parseParticipation = (raw: unknown) => parse(raw, PARTICIPATION_KEYS);
export const parsePcParticipation = (raw: unknown) => parse(raw, PC_PARTICIPATION_KEYS);

/** Из тела запроса — в колонку. Чужие ключи и пустые строки отбрасываются. */
export const serializeForce = (raw: unknown) => JSON.stringify(pick(raw, FORCE_KEYS));
export const serializeParticipation = (raw: unknown) => JSON.stringify(pick(raw, PARTICIPATION_KEYS));
export const serializePcParticipation = (raw: unknown) => JSON.stringify(pick(raw, PC_PARTICIPATION_KEYS));
