import type { DndClassEntry, DndEquipmentSection, DndFeature } from "./types";

// Щит в компендиуме размечен как доспех: `armor_type: "Щит"`, `ac: "2"` —
// то есть двойка лежит в том же поле, что и 18 у лат. Прежний расчёт брал
// её за базовое значение, и персонаж со щитом и без доспеха получал КЗ
// 2 + Ловкость вместо 12 + Ловкость. Поэтому щит распознаётся отдельно и
// его число идёт плюсом, а не в базу.
function isShield(armorType: string | undefined): boolean {
  return (armorType ?? "").trim().toLowerCase().startsWith("щит");
}

// Отданная вещь (transferOut) снята с носки и из расчётов исключена — один
// фильтр на все боевые расчёты (КЗ, защита без доспехов, боевые искусства).
export function equippedItems(sections: DndEquipmentSection[]) {
  return sections.flatMap((s) => s.items).filter((i) => i.equipped && !i.transferOut);
}

export function wornArmorState(sections: DndEquipmentSection[]): { hasArmor: boolean; hasShield: boolean } {
  const equipped = equippedItems(sections);
  return {
    hasArmor: equipped.some((i) => i.armorType && i.ac && !isShield(i.armorType)),
    hasShield: equipped.some((i) => isShield(i.armorType)),
  };
}

// Тяжёлый доспех в компендиуме не несёт `max_dex_bonus` — вместо него стоит
// `dex_bonus: false`. Пустой предел читался как «Ловкость без ограничения»,
// и Латы давали 18 + Ловкость. Поле снимается при добавлении предмета
// (fetchEquipmentMeta), но у листов, собранных раньше, его нет — поэтому
// тип доспеха остаётся вторым признаком.
function dexApplies(item: { armorType?: string; dexBonus?: boolean }): boolean {
  if (item.dexBonus === false) return false;
  return !(item.armorType ?? "").trim().toLowerCase().startsWith("тяж");
}

// PHB 2024 ("5.5") КЗ formula: 10 + мод. Ловкости by default. An equipped
// item with cached armor fields (armorType/ac) replaces the base and caps
// the Ловкость bonus per its maxDexBonus ("" = unlimited, "0" = none, N =
// capped at N). Any equipped item's acBonus (rings, magic cloaks, …) stacks
// flat on top, plus a manual bonus for effects not captured by inventory
// (Shield/Mage Armor spells, etc.). Защита без доспехов здесь НЕ считается —
// она ниже, в unarmoredDefenseBonus, и прибавляется поверх.
export function computeArmorClass(dexMod: number, sections: DndEquipmentSection[], manualBonus: number): number {
  // Отданная вещь (transferOut) снята с носки и из расчётов исключена: бонус
  // от неё отправитель больше не получает (этап 4б).
  const equipped = equippedItems(sections);
  // S-03: если надето несколько доспехов — берём лучший (макс КЗ), а не первый по порядку.
  const armors = equipped.filter((i) => i.armorType && i.ac && !isShield(i.armorType));
  const armor = armors.length
    ? armors.reduce((best, cur) => ((parseInt(cur.ac ?? "", 10) || 0) > (parseInt(best.ac ?? "", 10) || 0) ? cur : best))
    : undefined;

  let base: number;
  let dexBonus: number;
  if (armor) {
    // Магическая прибавка «Доспех +1» лежит на той же строке, что и сам
    // доспех (решение R3): второй строки инвентаря у него нет, поэтому и
    // прибавлять её надо здесь, а не искать отдельный предмет.
    base = (parseInt(armor.ac ?? "", 10) || 0) + (armor.magicBonus ?? 0);
    const maxDex = (armor.maxDexBonus ?? "").trim();
    if (!dexApplies(armor)) {
      // Тяжёлый доспех: Ловкость не применяется вовсе, ни плюсом, ни минусом.
      dexBonus = 0;
    } else if (maxDex === "") dexBonus = dexMod;
    else {
      const cap = parseInt(maxDex, 10);
      // «0» — та же тяжесть, размеченная пределом. Прежний Math.min(dexMod, 0)
      // при Лов 8 давал −1 к КЗ, то есть наказывал за то, что по правилам не
      // считается.
      //
      // Ненулевой предел — средний доспех: он ограничивает только бонус.
      // Отрицательный модификатор в нём применяется как есть, поэтому здесь
      // нижней границы нет.
      if (!Number.isFinite(cap)) dexBonus = dexMod;
      else if (cap === 0) dexBonus = 0;
      else dexBonus = Math.min(dexMod, cap);
    }
  } else {
    base = 10;
    dexBonus = dexMod;
  }

  // Щитом можно пользоваться только одним — надетые сверх первого не
  // складываются, берётся лучший.
  const shieldBonus = equipped
    .filter((i) => isShield(i.armorType))
    .reduce((best, i) => Math.max(best, (parseInt(i.ac ?? "", 10) || 0) + (i.magicBonus ?? 0)), 0);

  const flatBonus = equipped.reduce((sum, i) => sum + (parseInt(i.acBonus ?? "", 10) || 0), 0);

  return base + dexBonus + shieldBonus + flatBonus + manualBonus;
}

// ——— Защита без доспехов (Монах 10 + Лов + Муд, Варвар 10 + Лов + Тел) ———
//
// Источник истины — умение «Защита без доспехов» в классовых особенностях
// листа, а не имя класса в коде: хоумбрю-класс с тем же умением заводится
// данными. Родительский класс умения определяется через sourceParentId —
// имя, вписанное до скобки оригинала («Монах [Monk]»), чтобы импорт модуля
// не ломал сопоставление (тот же приём, что classKey в dndClassColors).
// Ручное умение (sourceParentId пуст) приписывается единственному классу.
function parentClassKey(feature: DndFeature, classes: DndClassEntry[]): string {
  const own = classes.find((c) => c.classId != null && c.classId === feature.sourceParentId);
  const name = own?.className ?? (classes.length === 1 ? classes[0]?.className ?? "" : "");
  return name
    .split(/[[(]/)[0]
    .trim()
    .toLowerCase();
}

export interface UnarmoredDefense {
  /** Прибавка к КЗ сверх формулы computeArmorClass (0 — нет активной защиты). */
  bonus: number;
  /** Подпись для листа («Защита без доспехов (Муд)»). */
  source: string | null;
}

export function unarmoredDefenseBonus(
  features: DndFeature[],
  classes: DndClassEntry[],
  wisMod: number,
  conMod: number,
  sections: DndEquipmentSection[]
): UnarmoredDefense {
  const none: UnarmoredDefense = { bonus: 0, source: null };
  const hasDefense = (features ?? []).some((f) => (f.name ?? "").trim() === "Защита без доспехов");
  if (!hasDefense) return none;
  const { hasArmor, hasShield } = wornArmorState(sections);
  if (hasArmor) return none;
  const keys = new Set(
    (features ?? [])
      .filter((f) => (f.name ?? "").trim() === "Защита без доспехов")
      .map((f) => parentClassKey(f, classes ?? []))
  );
  const candidates: UnarmoredDefense[] = [];
  // Монаху щит тоже гасит умение, варвару — нет.
  if (keys.has("монах") && !hasShield) candidates.push({ bonus: wisMod, source: "Защита без доспехов (Муд)" });
  if (keys.has("варвар")) candidates.push({ bonus: conMod, source: "Защита без доспехов (Тел)" });
  if (candidates.length === 0) return none;
  // Мультикласс монах/варвар: по правилам выбирается одна защита — берём
  // большую прибавку, меньшую игроку не предлагаем (документировано в тикете).
  return candidates.reduce((best, cur) => (cur.bonus > best.bonus ? cur : best));
}
