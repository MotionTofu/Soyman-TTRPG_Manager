import { abilityModifier } from "./AbilityScores";
import type { DndAbilityKey, DndAbilityScores, DndClassEntry, DndCompanion } from "../../types";

// Тела спутников по чертежам (Фаза B): пушка и защитник Артефактора.
//
// Чертеж — поле data.companion у фичи-хозяина (или data.summon у заклинания),
// кладётся миграцией, имён классов и id записей в коде нет:
//   { name, ac: "18" | "12+int", hp: "5*level" | "5+5*spell",
//     maxCount: 1, extraCount?: { feature: "Укреплённая позиция", count: 2 },
//     mending?: "2к6" | null, detonateFeature?: "Взрывная пушка",
//     coverFeature?: "Укреплённая позиция",
//     actions?: [{ name: "Силовой удар", note: "…" }], expiry?: "permanent" }
// Формулы — мини-язык: целые числа, level (уровень класса), моды характеристик
// (str dex con int wis cha — английские ключи, регистр не важен), spell (круг
// ячейки призыва), операции + - * и скобки. Свой парсер (не eval):
// данные идут из справочника, который правит Мастер, — выполнять их как код
// нельзя.

export interface CompanionBlueprintVariant {
  /** Имя вида («Наземный зверь»). Хранится в инстансе как variant. */
  name?: string;
  ac?: string;
  hp?: string;
  /** Приёмы вида (карточка): перекрывают общие actions чертежа. */
  actions?: { name?: string; note?: string }[];
}

export interface CompanionBlueprint {
  name?: string;
  ac?: string;
  hp?: string;
  maxCount?: number;
  extraCount?: { feature?: string; count?: number };
  mending?: string | null;
  detonateFeature?: string;
  coverFeature?: string;
  /** Тело временное (пушка: час/развеивание) — на долгом отдыхе исчезает.
   *  Постоянное (защитник) — собирается заново с полными хитами. */
  dismissable?: boolean;
  /** Строки приёмов тела (карточка): что умеет, в свободной форме. */
  actions?: { name?: string; note?: string }[];
  /** "permanent" — призыв мгновенного сотворения (гомункул): отдыхом не
   *  трогаем вовсе. Без поля — по dismissable, как раньше. */
  expiry?: string;
  /** Виды тела на одном чертеже (звери Повелителя зверей: наземный, морской,
   *  небесный — разные КД/хиты/приёмы). Без поля — как раньше, один вид. */
  variants?: CompanionBlueprintVariant[];
}

// Чертеж лежит в data записи компендиума, а не в строке листа — достаётся
// через getEntry по featureEntryId (data.companion) или spellEntryId
// (data.summon) инстанса.
export function blueprintFromEntryData(data: Record<string, unknown> | undefined): CompanionBlueprint | null {
  const c = data?.companion ?? data?.summon;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  return c as CompanionBlueprint;
}

type Tok = { t: "num"; v: number } | { t: "var"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < src.length && src[j] >= "0" && src[j] <= "9") j++;
      out.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_]/.test(src[j])) j++;
      out.push({ t: "var", v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*()".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

// Рекурсивный спуск: expr := term (('+'|'-') term)* ; term := fact ('*' fact)* ;
// fact := number | var | '(' expr ')' | '-' fact.
function parseExpr(toks: Tok[], vars: Record<string, number>): number | null {
  let pos = 0;
  function expr(): number | null {
    let v = term();
    if (v == null) return null;
    while (pos < toks.length && toks[pos].t === "op" && (toks[pos].v === "+" || toks[pos].v === "-")) {
      const op = toks[pos].v;
      pos++;
      const r = term();
      if (r == null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number | null {
    let v = fact();
    if (v == null) return null;
    while (pos < toks.length && toks[pos].t === "op" && toks[pos].v === "*") {
      pos++;
      const r = fact();
      if (r == null) return null;
      v = v * r;
    }
    return v;
  }
  function fact(): number | null {
    const tk = toks[pos];
    if (!tk) return null;
    if (tk.t === "num") {
      pos++;
      return tk.v;
    }
    if (tk.t === "var") {
      pos++;
      const v = vars[tk.v];
      return typeof v === "number" ? v : null;
    }
    if (tk.t === "op" && tk.v === "(") {
      pos++;
      const v = expr();
      if (v == null) return null;
      if (!toks[pos] || toks[pos].t !== "op" || toks[pos].v !== ")") return null;
      pos++;
      return v;
    }
    if (tk.t === "op" && tk.v === "-") {
      pos++;
      const v = fact();
      return v == null ? null : -v;
    }
    return null;
  }
  const v = expr();
  return pos === toks.length ? v : null;
}

/** Безопасный подсчёт формулы чертежа. level — уровень класса, int — мод INT,
 *  spell — круг ячейки призыва (гомункул 5+5×круг). mods — моды остальных
 *  характеристик ключами (str/dex/con/wis/cha, регистр не важен): зверь
 *  Повелителя зверей считается от Мудрости (КД 13+wis, хиты 5+5×level). */
export function evalCompanionFormula(
  src: string | undefined,
  level: number,
  intMod: number,
  spellLevel = 0,
  mods: Partial<Record<string, number>> = {}
): number | null {
  if (!src) return null;
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return null;
  const lowered: Record<string, number> = {};
  for (const [k, v] of Object.entries(mods)) {
    if (typeof v === "number") lowered[k.toLowerCase()] = v;
  }
  const v = parseExpr(toks, { level, int: intMod, spell: spellLevel, ...lowered });
  if (v == null || !Number.isFinite(v)) return null;
  return Math.floor(v);
}

export interface CompanionStats {
  maxHp: number;
  ac: number | null;
}

/** Активный вид тела: выбранный инстансом или первый из списка. Без
 *  variants — сам чертёж. Возвращает плоский вид (имя/КД/хиты/приёмы). */
export function resolveBlueprintVariant(
  blueprint: CompanionBlueprint | null,
  variantName: string | null | undefined
): { name?: string; ac?: string; hp?: string; actions?: { name?: string; note?: string }[] } | null {
  if (!blueprint) return null;
  const list = blueprint.variants;
  if (!list || list.length === 0) {
    return { name: blueprint.name, ac: blueprint.ac, hp: blueprint.hp, actions: blueprint.actions };
  }
  const picked =
    (variantName != null && variantName !== ""
      ? list.find((v) => v.name === variantName)
      : undefined) ?? list[0];
  return {
    name: picked.name ?? blueprint.name,
    ac: picked.ac ?? blueprint.ac,
    hp: picked.hp ?? blueprint.hp,
    actions: picked.actions ?? blueprint.actions,
  };
}

const ABILITY_MOD_KEYS: DndAbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Живые статы инстанса: уровень класса + моды характеристик (+ круг призыва)
 *  пересчитываются при каждом рендере, поэтому ап уровня сам поднимает
 *  максимум (израсходованное не трогаем — как у пулов ресурсов). */
export function companionStats(
  blueprint: CompanionBlueprint | null,
  classes: DndClassEntry[],
  classId: number | null | undefined,
  abilities: DndAbilityScores,
  spellLevel = 0,
  variantName: string | null | undefined = null
): CompanionStats | null {
  const view = resolveBlueprintVariant(blueprint, variantName);
  if (!view?.hp) return null;
  const lvl = classes.find((c) => c.classId === classId)?.level
    ?? Math.max(0, ...classes.map((c) => c.level || 0));
  const mods: Partial<Record<string, number>> = {};
  for (const k of ABILITY_MOD_KEYS) mods[k] = abilityModifier(abilities[k]);
  const maxHp = evalCompanionFormula(view.hp, lvl, mods.int ?? 0, spellLevel, mods);
  if (maxHp == null || maxHp < 1) return null;
  const ac = view.ac ? evalCompanionFormula(view.ac, lvl, mods.int ?? 0, spellLevel, mods) : null;
  return { maxHp, ac };
}

/** Сколько таких тел можно держать одновременно: база из чертежа, повышение —
 *  за владение названным умением (две пушки за «Укреплённую позицию»). */
export function companionMaxCount(
  blueprint: CompanionBlueprint | null,
  ownedFeatureNames: string[]
): number {
  const base = blueprint?.maxCount && blueprint.maxCount > 0 ? Math.floor(blueprint.maxCount) : 1;
  const extra = blueprint?.extraCount;
  if (extra?.feature && extra.count && extra.count > base) {
    const owned = ownedFeatureNames.some((n) => n === extra.feature);
    if (owned) return Math.floor(extra.count);
  }
  return base;
}

/** Долгий отдых для тел: временные (dismissable — пушка: час истёк) исчезают,
 *  постоянные (защитник) собираются заново — полные хиты, смерть и развеивание
 *  сняты, перманентные призывы (гомункул, expiry "permanent") не трогаем
 *  вовсе. Обычные жетоны без чертежа не трогаем. Возвращает null, если менять
 *  нечего — модалка отдыха тогда молчит про спутников. */
export function companionsAfterLongRest(
  companions: DndCompanion[] | undefined,
  blueprintOf: (c: DndCompanion) => CompanionBlueprint | null
): DndCompanion[] | null {
  if (!companions || companions.length === 0) return null;
  let changed = false;
  const next: DndCompanion[] = [];
  for (const c of companions) {
    if (c.featureEntryId == null && c.spellEntryId == null) {
      next.push(c);
      continue;
    }
    const bp = blueprintOf(c);
    if (!bp || bp.expiry === "permanent") {
      next.push(c);
      continue;
    }
    if (bp.dismissable) {
      changed = true;
      continue;
    }
    if ((c.hpUsed ?? 0) > 0 || c.dead || c.dismissed) {
      changed = true;
      next.push({ ...c, hpUsed: 0, dead: false, dismissed: false });
    } else {
      next.push(c);
    }
  }
  return changed ? next : null;
}

/** Класс-хозяин фичи-чертежа: фича → подкласс → класс, сверка со строками
 *  классов листа. Не сошлось — класс с высшим уровнем (мультикласс не должен
 *  ронять тело в ноль). parentOf — parent_id записи (getEntry), без типов
 *  компендиума в этом модуле. */
export function companionClassId(
  featureEntryId: number,
  classes: DndClassEntry[],
  parentOf: (id: number | null | undefined) => number | null | undefined
): number | null {
  const subId = parentOf(featureEntryId);
  const fromSub = subId != null ? classes.find((c) => c.subclassId === subId)?.classId ?? null : null;
  if (fromSub != null) return fromSub;
  const classEntryId = subId != null ? parentOf(subId) : null;
  if (classEntryId != null && classes.some((c) => c.classId === classEntryId)) return classEntryId;
  let best: number | null = null;
  let bestLevel = -1;
  for (const c of classes) {
    if (c.classId != null && (c.level || 0) > bestLevel) {
      bestLevel = c.level || 0;
      best = c.classId;
    }
  }
  return best;
}

/** Живые инстансы чертежа среди спутников листа. */
export function liveCompanionsOf(
  companions: DndCompanion[] | undefined,
  featureEntryId: number
): { index: number; companion: DndCompanion }[] {
  return (companions ?? [])
    .map((companion, index) => ({ index, companion }))
    .filter(({ companion }) => companion.featureEntryId === featureEntryId && !companion.dead && !companion.dismissed);
}

/** Живые инстансы призыва среди спутников листа (мёртвые не в счёт: новый
 *  каст их заменяет, а не копит — «если у вас уже есть гомункул, его заменяет
 *  новый»). */
export function liveSummonOf(
  companions: DndCompanion[] | undefined,
  spellEntryId: number
): { index: number; companion: DndCompanion }[] {
  return (companions ?? [])
    .map((companion, index) => ({ index, companion }))
    .filter(({ companion }) => companion.spellEntryId === spellEntryId && !companion.dead && !companion.dismissed);
}
