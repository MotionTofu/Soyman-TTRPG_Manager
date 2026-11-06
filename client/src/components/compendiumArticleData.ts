// Чтение полей записи для статьи «Д»: отдельно от компонентов, чтобы файл
// статьи экспортировал только компоненты (fast refresh, oxlint).
import type { CompendiumEntry } from "../types";
import { grantsFromEntry } from "./dnd/dndGrants";
import { ABILITY_LABELS } from "./dnd/AbilityScores";

export function entryValue(entry: CompendiumEntry, key: string): string {
  const value = entry.data[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const FACTS = [["damage", "Урон"], ["ac", "КЗ"], ["cost", "Цена"], ["weight", "Вес"], ["casting_time", "Время"], ["casting_timing", "Время"], ["range", "Дистанция"], ["duration", "Длительность"], ["uses", "Использования"], ["recharge", "Восстановление"]] as const;
export function compendiumFacts(entry: CompendiumEntry) {
  const facts = FACTS.map(([key, label]) => ({key, label, value:entryValue(entry,key)})).filter((fact) => fact.value);
  const attack = [entry.data.attack_melee && "рукопашная", entry.data.attack_ranged && "дальнобойная"].filter(Boolean).join(" · ");
  return { facts, attack };
}
export const abilityLabel = (key:string)=>ABILITY_LABELS.find((ability)=>ability.key===key)?.label ?? key;
export function featBenefitSummary(entry:CompendiumEntry) {
  const grants=grantsFromEntry(entry,()=>null);
  return [grants.abilityIncrease ? `+${grants.abilityIncrease.amount} ${grants.abilityIncrease.options.map(abilityLabel).join("/")}` : "",grants.spells.length ? `${grants.spells.length} закл.` : "",grants.skills.join(", ")].filter(Boolean).join(" · ");
}
