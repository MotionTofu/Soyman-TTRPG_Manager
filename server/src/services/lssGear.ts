/**
 * Снаряжение из Long Story Short: связь со справочником, настройка и надетое.
 *
 * Экспорт LSS отдаёт инвентарь голыми строками («Кольчуга (средняя)»,
 * «Болты (15)»), итоговое КЗ числом и флаг щита. Отметки «надето» в нём нет,
 * а без неё лист не может вычислить КЗ и показывает сохранённое с пометкой
 * «не пересчитано» (docs/dnd-derive-revision.md, «Находки»).
 *
 * Надетое подбирается сверкой: какой доспех (со щитом по флагу LSS и
 * настроенными предметами с прибавкой к КЗ) даёт по правилам листа ровно то
 * КЗ, что было в LSS. Не сошлось или сошлось с разными доспехами — ничего не
 * отмечается: врущее КЗ за столом хуже честной пометки. Оружие не отмечается
 * никогда — надетое оружие само даёт строки атак, а атаки из LSS уже
 * перенесены.
 *
 * Функция чистая: справочник подаётся списком, лист — нормализованным.
 */
import {
  EMPTY_EQUIPMENT_ITEM,
  deriveSheet,
  equipmentMetaFromEntry,
  isShield,
  splitEquipmentQty,
} from "@soyman/shared";
import type { DndCharacterData, DndEquipmentItem } from "@soyman/shared";

export interface GearEntry {
  id: number;
  kind: string;
  name: string;
  aliases: string[];
  nameOriginal: string;
  data: Record<string, unknown>;
}

export interface GearInput {
  /** Нормализованный лист без инвентаря: по нему считается КЗ. */
  character: DndCharacterData;
  /** Строки инвентаря LSS как есть. */
  rawNames: string[];
  /** Снаряжение и магические предметы справочника. */
  entries: GearEntry[];
  /** Отмеченные строки настройки LSS. */
  attunedNames: string[];
  /** КЗ из LSS; `null` — в экспорте не указано. */
  lssAc: number | null;
  lssShield: boolean;
}

export interface GearResult {
  items: DndEquipmentItem[];
  /** Настройка, не нашедшая строки инвентаря, — уходит в Заметки. */
  unmatchedAttuned: string[];
  /** Одна строка итога для шага «Снаряжение»; пусто — сказать нечего. */
  summary: string;
  /** Текст замечания визарда, если надетое не отмечено из-за расхождения. */
  warning: string | null;
}

export function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»„“"']/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const withoutParenthetical = (s: string) => s.replace(/\s*\(.*\)\s*$/, "");

// Порядок кругов — как у кнопки «Обогатить» визарда: прямое имя, затем
// синонимы и оригинал, затем то же без уточнения в скобках. Синоним никогда
// не перебивает запись, чьё имя совпало напрямую.
function findGearEntry(name: string, entries: GearEntry[]): GearEntry | null {
  const byName = (t: string) => entries.find((e) => normalizeForMatch(e.name) === t);
  const byAlias = (t: string) =>
    entries.find((e) => [e.nameOriginal, ...e.aliases].some((a) => a && normalizeForMatch(a) === t));
  const target = normalizeForMatch(name);
  const base = normalizeForMatch(withoutParenthetical(name));
  if (!target) return null;
  return (
    byName(target) ??
    byAlias(target) ??
    (base && base !== target ? byName(base) ?? byAlias(base) : undefined) ??
    null
  );
}

export function settleImportedGear(input: GearInput): GearResult {
  const { character, rawNames, entries, attunedNames, lssAc, lssShield } = input;
  const entryById = new Map(entries.map((e) => [e.id, e] as const));

  const items: DndEquipmentItem[] = rawNames.map((raw) => {
    const { name, qty } = splitEquipmentQty(raw);
    const base: DndEquipmentItem = { ...EMPTY_EQUIPMENT_ITEM, name, qty };
    const hit = findGearEntry(name, entries);
    return hit ? { ...base, ...equipmentMetaFromEntry(hit.id, hit) } : base;
  });

  // Настройка: строка LSS совпадает с именем строки инвентаря (с уточнением в
  // скобках или без) или с именем записи, с которой строка связана.
  const attunedKeys = attunedNames.map(normalizeForMatch);
  const usedAttuned = new Set<number>();
  items.forEach((it, i) => {
    const keys = new Set([normalizeForMatch(it.name), normalizeForMatch(withoutParenthetical(it.name))]);
    const linked = it.entryId != null ? entryById.get(it.entryId) : undefined;
    if (linked) keys.add(normalizeForMatch(linked.name));
    const k = attunedKeys.findIndex((a, ai) => !usedAttuned.has(ai) && keys.has(a));
    if (k < 0) return;
    usedAttuned.add(k);
    items[i] = { ...it, attuned: true };
  });
  const unmatchedAttuned = attunedNames.filter((_, i) => !usedAttuned.has(i));

  const done = (summary: string, warning: string | null, worn: number[] = []): GearResult => ({
    items: items.map((it, i) => (worn.includes(i) ? { ...it, equipped: true } : it)),
    unmatchedAttuned,
    summary,
    warning,
  });
  const fail = (summary: string) => done(summary, `${summary} Отметьте надетое вручную.`);

  if (lssAc == null) {
    return done(items.length ? "КЗ в экспорте LSS не указан — надетое не отмечено." : "", null);
  }

  // Две строки одной записи («Кольчуга» дважды) — не два разных доспеха.
  const distinct = (pred: (it: DndEquipmentItem) => boolean): number[] => {
    const seen = new Set<string>();
    const out: number[] = [];
    items.forEach((it, i) => {
      if (!pred(it)) return;
      const key = it.entryId != null ? `#${it.entryId}` : normalizeForMatch(it.name);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(i);
    });
    return out;
  };
  const armors = distinct((it) => it.entryId != null && !!it.armorType && !!it.ac && !isShield(it.armorType));
  const shieldAt = items.findIndex((it) => it.entryId != null && isShield(it.armorType));
  const bonusItems = distinct((it) => !!it.attuned && !!it.acBonus && !it.armorType);

  if (lssShield && shieldAt < 0) {
    return fail("В LSS надет щит, но щита из справочника в инвентаре нет — надетое не отмечено.");
  }

  // Настроенные предметы с прибавкой — всеми сочетаниями; их у персонажа
  // единицы, но на случай длинного списка — только «все» и «ни одного».
  const extras: number[][] =
    bonusItems.length <= 4
      ? Array.from({ length: 1 << bonusItems.length }, (_, mask) => bonusItems.filter((_, b) => mask & (1 << b)))
      : [[], bonusItems];

  const matches: number[][] = [];
  for (const armor of [null, ...armors]) {
    for (const extra of extras) {
      const worn = [...(armor != null ? [armor] : []), ...(lssShield ? [shieldAt] : []), ...extra].sort((a, b) => a - b);
      const trial = items.map((it, i) => ({ ...it, equipped: worn.includes(i) }));
      // Сохранённое КЗ убрано: иначе при «ничего не надето» лист отдаёт его, и
      // вариант без доспеха сходился бы с любым числом.
      const ac = deriveSheet({
        ...character,
        armorClass: "",
        equipmentSections: [{ name: "Снаряжение", items: trial }],
      }).armorClass.value;
      if (ac === lssAc) matches.push(worn);
    }
  }

  if (matches.length === 0) {
    return fail(`КЗ ${lssAc} из LSS не сходится с доспехами в инвентаре — надетое не отмечено.`);
  }
  if (matches.length > 1) {
    const options = matches.map(
      (worn) => worn.filter((i) => i !== shieldAt).map((i) => items[i].name).join(" + ") || "без доспеха"
    );
    return fail(`КЗ ${lssAc} из LSS подходит к нескольким доспехам (${options.join(", ")}) — надетое не отмечено.`);
  }

  const worn = matches[0];
  let summary = worn.length
    ? `Надето по КЗ ${lssAc} из LSS: ${worn.map((i) => items[i].name).join(", ")}.`
    : `КЗ ${lssAc} из LSS сходится без доспеха — ничего не надето.`;
  if (!lssShield && shieldAt >= 0) summary += " Щит не надет (так в LSS).";
  return done(summary, null, worn);
}
