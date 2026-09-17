import { compendiumPaths } from "./data/compendiumEntries";
import { readResource } from "./data/imperative";
import {
  MECHANICS_ALIGNMENT_GROUP,
  MECHANICS_ARMOR_GROUP,
  MECHANICS_CREATURE_TYPE_GROUP,
  MECHANICS_SCHOOL_GROUP,
  MECHANICS_SENSES_GROUP,
  MECHANICS_SPEED_GROUP,
  MECHANICS_TOOL_GROUP,
  MECHANICS_WEAPON_GROUP,
  MECHANICS_WEAPON_MASTERY_GROUP,
  MECHANICS_WEAPON_PROPERTIES_GROUP,
  mechanicsKeyForGroupName,
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
  damageTypes: MechanicsOption[];
  conditions: MechanicsOption[];
  alignments: MechanicsOption[];
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
  damageTypes: [],
  conditions: [],
  alignments: [],
};

/**
 * Списки опций разделов «механики»: находит раздел механик системы и отдаёт
 * прямых детей фиксированных групп по имени — как выпадающие опции фильтров
 * и пикеров (типы существ, школы заклинаний, оружие/броня и т.п.).
 *
 * Читает разделы и записи раздела механик ключами слоя данных — теми же, что
 * сам раздел в профиле системы. Раньше здесь был свой кэш на 30 секунд со
 * сбросом только из правки в этом окне; теперь любая правка механик (здесь,
 * в соседнем окне) помечает эти ключи, и следующий вызов берёт свежее.
 */
export async function loadMechanicsOptions(systemId: number): Promise<MechanicsOptions> {
  const sections = await readResource<SystemSection[]>(compendiumPaths.sections(systemId));
  const mechSection = sections.find((s) => s.kind === "mechanics");
  if (!mechSection) return EMPTY_MECHANICS_OPTIONS;
  const entries = await readResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(systemId, mechSection.id));
  const groupsByName = new Map(entries.filter((e) => e.parent_id === null).map((e) => [e.name, e]));
  const groupsByKey = new Map<string, CompendiumEntry>();
  for (const e of entries.filter((en) => en.parent_id === null)) {
    const key = (e.data as Record<string, unknown> | undefined)?.group_key as string | undefined;
    if (key) groupsByKey.set(key, e);
    // legacy: also index by canonical name's key so renamed groups still resolve
    const legacyKey = mechanicsKeyForGroupName(e.name);
    if (legacyKey && !groupsByKey.has(legacyKey)) groupsByKey.set(legacyKey, e);
  }
  const optionsFor = (groupName: string): MechanicsOption[] => {
    const key = mechanicsKeyForGroupName(groupName);
    const group = (key ? groupsByKey.get(key) : undefined) ?? groupsByName.get(groupName);
    if (!group) return [];
    return entries
      .filter((e) => e.parent_id === group.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, name: e.name }));
  };
  const value: MechanicsOptions = {
    creatureTypes: optionsFor(MECHANICS_CREATURE_TYPE_GROUP),
    senses: optionsFor(MECHANICS_SENSES_GROUP),
    speeds: optionsFor(MECHANICS_SPEED_GROUP),
    weapons: optionsFor(MECHANICS_WEAPON_GROUP),
    armor: optionsFor(MECHANICS_ARMOR_GROUP),
    tools: optionsFor(MECHANICS_TOOL_GROUP),
    schools: optionsFor(MECHANICS_SCHOOL_GROUP),
    weaponProperties: optionsFor(MECHANICS_WEAPON_PROPERTIES_GROUP),
    weaponMastery: optionsFor(MECHANICS_WEAPON_MASTERY_GROUP),
    damageTypes: optionsFor("Типы урона"),
    conditions: optionsFor("Состояния"),
    alignments: optionsFor(MECHANICS_ALIGNMENT_GROUP),
  };
  return value;
}