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

const mechanicsCache = new Map<number, { at: number; value: MechanicsOptions }>();
const MECHANICS_TTL_MS = 30_000;

function isCacheFresh(entry: { at: number } | undefined): boolean {
  return !!entry && Date.now() - entry.at < MECHANICS_TTL_MS;
}

export function invalidateMechanicsCache(systemId: number): void {
  mechanicsCache.delete(systemId);
}

/**
 * Списки опций разделов «механики»: находит раздел механик системы и отдаёт
 * прямых детей фиксированных групп по имени — как выпадающие опции фильтров
 * и пикеров (типы существ, школы заклинаний, оружие/броня и т.п.).
 */
export async function loadMechanicsOptions(systemId: number, opts?: { force?: boolean; signal?: AbortSignal }): Promise<MechanicsOptions> {
  if (!opts?.force) {
    const cached = mechanicsCache.get(systemId);
    if (cached && isCacheFresh(cached)) return cached.value;
  }
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`, opts?.signal ? { signal: opts.signal } as RequestInit : undefined);
  const mechSection = sections.find((s) => s.kind === "mechanics");
  if (!mechSection) return EMPTY_MECHANICS_OPTIONS;
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${mechSection.id}`,
    opts?.signal ? { signal: opts.signal } as RequestInit : undefined
  );
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
  mechanicsCache.set(systemId, { at: Date.now(), value });
  return value;
}