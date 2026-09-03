import type { DndEquipmentSection } from "../../types";

// PHB 2024 ("5.5") КЗ formula: 10 + мод. Ловкости by default. An equipped
// item with cached armor fields (armorType/ac) replaces the base and caps
// the Ловкость bonus per its maxDexBonus ("" = unlimited, "0" = none, N =
// capped at N). Any equipped item's acBonus (shields, rings, …) stacks
// flat on top, plus a manual bonus for effects not captured by inventory
// (Shield/Mage Armor spells, etc.).
export function computeArmorClass(dexMod: number, sections: DndEquipmentSection[], manualBonus: number): number {
  const equipped = sections.flatMap((s) => s.items).filter((i) => i.equipped);
  // S-03: если надето несколько доспехов — берём лучший (макс КЗ), а не первый по порядку.
  const armors = equipped.filter((i) => i.armorType && i.ac);
  const armor = armors.length
    ? armors.reduce((best, cur) => ((parseInt(cur.ac ?? "", 10) || 0) > (parseInt(best.ac ?? "", 10) || 0) ? cur : best))
    : undefined;

  let base: number;
  let dexBonus: number;
  if (armor) {
    base = parseInt(armor.ac ?? "", 10) || 0;
    const maxDex = (armor.maxDexBonus ?? "").trim();
    if (maxDex === "") dexBonus = dexMod;
    else {
      const cap = parseInt(maxDex, 10);
      // «0» — тяжёлый доспех: Ловкость не применяется вовсе, ни плюсом, ни
      // минусом. Прежний Math.min(dexMod, 0) при Лов 8 давал −1 к КЗ, то есть
      // наказывал за то, что по правилам не считается.
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

  const flatBonus = equipped.reduce((sum, i) => sum + (parseInt(i.acBonus ?? "", 10) || 0), 0);

  return base + dexBonus + flatBonus + manualBonus;
}
