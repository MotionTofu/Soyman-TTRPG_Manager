import type { DndEquipmentSection } from "../../types";

// PHB 2024 ("5.5") КЗ formula: 10 + мод. Ловкости by default. An equipped
// item with cached armor fields (armorType/ac) replaces the base and caps
// the Ловкость bonus per its maxDexBonus ("" = unlimited, "0" = none, N =
// capped at N). Any equipped item's acBonus (shields, rings, …) stacks
// flat on top, plus a manual bonus for effects not captured by inventory
// (Shield/Mage Armor spells, etc.).
export function computeArmorClass(dexMod: number, sections: DndEquipmentSection[], manualBonus: number): number {
  const equipped = sections.flatMap((s) => s.items).filter((i) => i.equipped);
  const armor = equipped.find((i) => i.armorType && i.ac);

  let base: number;
  let dexBonus: number;
  if (armor) {
    base = parseInt(armor.ac ?? "", 10) || 0;
    const maxDex = (armor.maxDexBonus ?? "").trim();
    if (maxDex === "") dexBonus = dexMod;
    else {
      const cap = parseInt(maxDex, 10);
      dexBonus = Number.isFinite(cap) ? Math.min(dexMod, cap) : dexMod;
    }
  } else {
    base = 10;
    dexBonus = dexMod;
  }

  const flatBonus = equipped.reduce((sum, i) => sum + (parseInt(i.acBonus ?? "", 10) || 0), 0);

  return base + dexBonus + flatBonus + manualBonus;
}
