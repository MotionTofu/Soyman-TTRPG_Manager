import type { DndEquipmentItem, DndEquipmentSection } from "./types";

// Щит в компендиуме размечен как доспех: `armor_type: "Щит"`, `ac: "2"` —
// то есть двойка лежит в том же поле, что и 18 у лат. Прежний расчёт брал
// её за базовое значение, и персонаж со щитом и без доспеха получал КЗ
// 2 + Ловкость вместо 12 + Ловкость. Поэтому щит распознаётся отдельно и
// его число идёт плюсом, а не в базу.
export function isShield(armorType: string | undefined): boolean {
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

/** Лучший надетый доспех (не щит): при нескольких — с большим КЗ (S-03). */
export function wornBodyArmor(sections: DndEquipmentSection[]): DndEquipmentItem | undefined {
  const armors = equippedItems(sections).filter((i) => i.armorType && i.ac && !isShield(i.armorType));
  if (!armors.length) return undefined;
  return armors.reduce((best, cur) => ((parseInt(cur.ac ?? "", 10) || 0) > (parseInt(best.ac ?? "", 10) || 0) ? cur : best));
}

/**
 * Сколько Ловкости доспех пропускает в КЗ: maxDexBonus "" — без предела,
 * "0" — нисколько, N — не больше N. Нулевой предел не наказывает за
 * отрицательную Ловкость (Лов 8 в латах — не −1), ненулевой режет только
 * бонус: отрицательный модификатор в среднем доспехе применяется как есть.
 */
export function armorDexBonus(armor: DndEquipmentItem, dexMod: number): number {
  if (!dexApplies(armor)) return 0;
  const maxDex = (armor.maxDexBonus ?? "").trim();
  if (maxDex === "") return dexMod;
  const cap = parseInt(maxDex, 10);
  if (!Number.isFinite(cap)) return dexMod;
  if (cap === 0) return 0;
  return Math.min(dexMod, cap);
}

/**
 * Лучший надетый щит с его прибавкой. Щитом можно пользоваться только одним —
 * надетые сверх первого не складываются.
 */
export function wornShield(sections: DndEquipmentSection[]): { item: DndEquipmentItem; bonus: number } | undefined {
  let best: { item: DndEquipmentItem; bonus: number } | undefined;
  for (const i of equippedItems(sections)) {
    if (!isShield(i.armorType)) continue;
    const bonus = (parseInt(i.ac ?? "", 10) || 0) + (i.magicBonus ?? 0);
    if (!best || bonus > best.bonus) best = { item: i, bonus };
  }
  return best;
}
