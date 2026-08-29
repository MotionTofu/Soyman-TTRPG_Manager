import { api } from "./api/client";
import {
  MECHANICS_ARMOR_GROUP,
  MECHANICS_CREATURE_TYPE_GROUP,
  MECHANICS_SCHOOL_GROUP,
  MECHANICS_SENSES_GROUP,
  MECHANICS_SPEED_GROUP,
  MECHANICS_TOOL_GROUP,
  MECHANICS_WEAPON_GROUP,
  MECHANICS_WEAPON_MASTERY_GROUP,
  MECHANICS_WEAPON_PROPERTIES_GROUP,
} from "./compendium";
import type { CompendiumEntry, SystemSection } from "./types";

export interface MechanicsOption {
  id: number;
  name: string;
}

export interface MechanicsOptions {
  creatureTypes: MechanicsOption[];
  senses: MechanicsOption[];
  speeds: MechanicsOption[];
  weapons: MechanicsOption[];
  armor: MechanicsOption[];
  tools: MechanicsOption[];
  schools: MechanicsOption[];
  weaponProperties: MechanicsOption[];
  weaponMastery: MechanicsOption[];
}

export const EMPTY_MECHANICS_OPTIONS: MechanicsOptions = {
  creatureTypes: [],
  senses: [],
  speeds: [],
  weapons: [],
  armor: [],
  tools: [],
  schools: [],
  weaponProperties: [],
  weaponMastery: [],
};

/**
 * Списки опций разделов «механики»: находит раздел механик системы и отдаёт
 * прямых детей фиксированных групп по имени — как выпадающие опции фильтров
 * и пикеров (типы существ, школы заклинаний, оружие/броня и т.п.).
 */
export async function loadMechanicsOptions(systemId: number): Promise<MechanicsOptions> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const mechSection = sections.find((s) => s.kind === "mechanics");
  if (!mechSection) return EMPTY_MECHANICS_OPTIONS;
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${mechSection.id}`
  );
  const groupsByName = new Map(entries.filter((e) => e.parent_id === null).map((e) => [e.name, e]));
  const optionsFor = (groupName: string): MechanicsOption[] => {
    const group = groupsByName.get(groupName);
    if (!group) return [];
    return entries
      .filter((e) => e.parent_id === group.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, name: e.name }));
  };
  return {
    creatureTypes: optionsFor(MECHANICS_CREATURE_TYPE_GROUP),
    senses: optionsFor(MECHANICS_SENSES_GROUP),
    speeds: optionsFor(MECHANICS_SPEED_GROUP),
    weapons: optionsFor(MECHANICS_WEAPON_GROUP),
    armor: optionsFor(MECHANICS_ARMOR_GROUP),
    tools: optionsFor(MECHANICS_TOOL_GROUP),
    schools: optionsFor(MECHANICS_SCHOOL_GROUP),
    weaponProperties: optionsFor(MECHANICS_WEAPON_PROPERTIES_GROUP),
    weaponMastery: optionsFor(MECHANICS_WEAPON_MASTERY_GROUP),
  };
}