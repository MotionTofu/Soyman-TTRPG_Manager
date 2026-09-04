import type { DndEquipmentSection } from "../../types";

// Щит в компендиуме размечен как доспех: `armor_type: "Щит"`, `ac: "2"` —
// то есть двойка лежит в том же поле, что и 18 у лат. Прежний расчёт брал
// её за базовое значение, и персонаж со щитом и без доспеха получал КЗ
// 2 + Ловкость вместо 12 + Ловкость. Поэтому щит распознаётся отдельно и
// его число идёт плюсом, а не в базу.
function isShield(armorType: string | undefined): boolean {
  return (armorType ?? "").trim().toLowerCase().startsWith("щит");
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
// (Shield/Mage Armor spells, etc.).
export function computeArmorClass(dexMod: number, sections: DndEquipmentSection[], manualBonus: number): number {
  const equipped = sections.flatMap((s) => s.items).filter((i) => i.equipped);
  // S-03: если надето несколько доспехов — берём лучший (макс КЗ), а не первый по порядку.
  const armors = equipped.filter((i) => i.armorType && i.ac && !isShield(i.armorType));
  const armor = armors.length
    ? armors.reduce((best, cur) => ((parseInt(cur.ac ?? "", 10) || 0) > (parseInt(best.ac ?? "", 10) || 0) ? cur : best))
    : undefined;

  let base: number;
  let dexBonus: number;
  if (armor) {
    base = parseInt(armor.ac ?? "", 10) || 0;
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
    .reduce((best, i) => Math.max(best, parseInt(i.ac ?? "", 10) || 0), 0);

  const flatBonus = equipped.reduce((sum, i) => sum + (parseInt(i.acBonus ?? "", 10) || 0), 0);

  return base + dexBonus + shieldBonus + flatBonus + manualBonus;
}
