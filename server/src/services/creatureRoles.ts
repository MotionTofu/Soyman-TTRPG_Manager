import { averageDamageText, estimateCreatureDpr } from "./creatureDpr";

/**
 * Автоподбор боевых ролей существа (dnd_creature) — затравка для Мастера,
 * а не приговор: неверный тег правится руками в редакторе карточки.
 *
 * Детерминированная локальная эвристика (offline-first, без внешних вызовов):
 * разбирает строки действий/черт, скорость, resistances и DPR из того же
 * статблока. Возвращает до 2 ролей из COMBAT_ROLES (см. CreatureCard.tsx).
 * Ручные роли главнее: бэкфилл заполняет только пустые.
 */

export const SUGGESTED_ROLE_PRIORITY = [
  "Заклинатель",
  "Контроль",
  "Высокий урон",
  "Танковый",
  "Дальний бой",
  "Ближний бой",
  "Мобильный",
] as const;

interface RowLike {
  name?: unknown;
  category?: unknown;
  isMultiattack?: unknown;
  damage?: unknown;
  description?: unknown;
  sourceSpellName?: unknown;
}

function rowsOf(value: unknown): RowLike[] {
  return Array.isArray(value) ? (value as RowLike[]) : [];
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isMultiRow(a: RowLike): boolean {
  if (a.isMultiattack === true) return true;
  return /^\s*мультиатака/iu.test(textOf(a.name));
}

// Верх границы DPR по КО (таблица DMG, offensive CR) — для «Высокого урона».
const DPR_TOP_BY_CR: Record<string, number> = {
  "0": 1, "1/8": 3, "1/4": 5, "1/2": 8, "1": 14, "2": 20, "3": 26, "4": 32,
  "5": 38, "6": 44, "7": 50, "8": 56, "9": 62, "10": 68, "11": 76, "12": 84,
  "13": 92, "14": 98, "15": 104, "16": 110, "17": 116, "18": 122, "19": 128,
  "20": 132, "21": 140, "22": 158, "23": 176, "24": 194, "25": 212, "26": 230,
  "27": 248, "28": 266, "29": 284, "30": 302,
};

const CR_DECIMALS: Record<string, string> = {
  "0.125": "1/8", "0.25": "1/4", "0.5": "1/2", "0.33": "1/3", "0.333": "1/3",
};

function challengeRating(sb: Record<string, unknown>): string {
  const ch = sb.challenge as { rating?: unknown } | undefined;
  const raw =
    (ch && typeof ch === "object" && typeof ch.rating === "string" && ch.rating) ||
    (typeof sb.challengeRating === "string" && sb.challengeRating) ||
    "";
  const t = raw.trim();
  return CR_DECIMALS[t] ?? t;
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string");
  if (typeof v === "string" && v.trim()) return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

// Состояния, которые вешаются на цель (не типы урона!): «становится
// Отравленной» — да, «урона Ядом» — нет.
const CONTROL_WORDS =
  /(отравлен|очарован|испуган|опрокинут|опутан|парали|оглуш|недееспособ|ослепл|окамен|схвачен|схват|бессознател|подчинен|проклят|очарование)/iu;

const SPELL_WORDS = /(заклинани|колдовств|слот|заговор)/iu;

function hasMelee(a: RowLike): boolean {
  const t = `${textOf(a.name)} ${textOf(a.damage)} ${textOf(a.description)}`;
  // «Бросок рукопашной атаки» и «Бросок атаки в ближнем бою» — обе формы книг.
  return /рукопашн|ближн/iu.test(t);
}

function hasRanged(a: RowLike): boolean {
  const t = `${textOf(a.name)} ${textOf(a.damage)} ${textOf(a.description)}`;
  return /дальнобойн|дистанц/iu.test(t);
}

export function suggestCombatRoles(content: string): string[] {
  let sb: Record<string, unknown>;
  try {
    sb = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!sb || typeof sb !== "object") return [];

  const actions = rowsOf(sb.actions);
  const bonus = rowsOf((sb as { bonusActions?: unknown }).bonusActions);
  const traits = rowsOf(sb.traits);
  const combatRows = [...actions, ...bonus].filter((a) => !isMultiRow(a));
  // Строки с броском: категория attack новой формы либо проза с броском.
  const rolls = combatRows.filter((a) => {
    if (a.category === "attack") return true;
    const cat = a.category;
    if (cat !== undefined && cat !== null && cat !== "" && cat !== "other") return false;
    if (typeof a.damage === "string" && (a.damage as string).trim() !== "") return true;
    return /атак|спасбросок|испытани/iu.test(textOf(a.description));
  });

  const score: Record<string, number> = {
    "Ближний бой": 0, "Дальний бой": 0, "Танковый": 0, "Заклинатель": 0,
    "Контроль": 0, "Мобильный": 0, "Высокий урон": 0,
  };

  if (rolls.some(hasMelee)) score["Ближний бой"] += 2;
  if (rolls.some(hasRanged)) score["Дальний бой"] += 2;
  // Атаки есть, а слов дистанции нет вовсе — по умолчанию грызётся в упор.
  if (rolls.length > 0 && !rolls.some(hasRanged)) score["Ближний бой"] += 1;

  // Танковость — про переживание урона: одни состояния без резистов
  // (визгун с иммунитетом к испугу) танком не делают.
  const dmgResCount = strList(sb.damageResistances).length + strList(sb.damageImmunities).length;
  const resCount =
    dmgResCount + strList(sb.conditionImmunities).length;
  if (dmgResCount >= 1 && resCount >= 4) score["Танковый"] += 2;
  else if (dmgResCount >= 1 && resCount >= 2) score["Танковый"] += 1;

  const spell = sb.spellcasting as { enabled?: unknown } | undefined;
  if (spell && typeof spell === "object" && spell.enabled === true) score["Заклинатель"] += 3;
  const spellTexts = [...traits, ...combatRows].map((a) => `${textOf(a.name)} ${textOf(a.description)}`);
  if (spellTexts.some((t) => SPELL_WORDS.test(t))) score["Заклинатель"] += 2;

  for (const a of combatRows) {
    const t = `${textOf(a.name)} ${textOf(a.description)}`;
    if (!CONTROL_WORDS.test(t)) continue;
    // Выделенный контроль (без урона) весомее райдера к урону.
    score["Контроль"] += averageDamageText(
      typeof a.damage === "string" && (a.damage as string).trim() ? a.damage : a.description
    ).avg > 0 ? 1 : 2;
  }

  // Полёт/телепорт весомее плавания и лазания. Скорость бывает объектом
  // новой формы ({fly: 60}) и строкой легаси («30 фт., летая 30 фт.»).
  const speed = sb.speed as Record<string, unknown> | string | null | undefined;
  let speedScore = 0;
  if (speed && typeof speed === "object") {
    if (speed.fly !== null && speed.fly !== undefined) speedScore = 2;
    else if (speed.swim !== null && speed.swim !== undefined && speed.swim !== 0) speedScore = 1;
    else if (
      (speed.climb !== null && speed.climb !== undefined && speed.climb !== 0) ||
      (speed.burrow !== null && speed.burrow !== undefined && speed.burrow !== 0)
    )
      speedScore = 1;
  } else if (typeof speed === "string") {
    if (/пол[её]т|лета|парит/iu.test(speed)) speedScore = 2;
    else if (/плава|лазан|копан/iu.test(speed)) speedScore = 1;
  }
  const moveTexts = spellTexts.join(" ");
  if (speedScore === 0 && /телепорт/iu.test(moveTexts)) speedScore = 2;
  score["Мобильный"] += speedScore;

  const cr = challengeRating(sb);
  const top = DPR_TOP_BY_CR[cr];
  if (top !== undefined) {
    const { dpr } = estimateCreatureDpr(content);
    if (dpr !== null) {
      if (dpr > top) score["Высокий урон"] += 3;
      else if (dpr >= top * 0.8) score["Высокий урон"] += 2;
      else if (dpr >= top * 0.6) score["Высокий урон"] += 1;
    }
  }

  // Ранжирование — сначала очки, при равенстве порядок приоритетов:
  // грубая драка в упор не должна выпадать ради второстепенных сигналов.
  const order = new Map(SUGGESTED_ROLE_PRIORITY.map((r, i) => [r, i]));
  const byScore = [...SUGGESTED_ROLE_PRIORITY].sort(
    (a, b) => score[b] - score[a] || (order.get(a) ?? 0) - (order.get(b) ?? 0)
  );
  const ranked = byScore.filter((r) => score[r] >= 2).slice(0, 2);
  const extras = byScore.filter((r) => !ranked.includes(r) && score[r] === 1);
  const out = [...ranked, ...extras].slice(0, 2);
  if (out.length > 0) return out;
  // Атаки есть, а зацепок нет вовсе — грызётся в упор, пусть Мастер поправит.
  if (rolls.length > 0) return ["Ближний бой"];
  return [];
}
