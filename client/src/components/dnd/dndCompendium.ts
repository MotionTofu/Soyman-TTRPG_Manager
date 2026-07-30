import { api } from "../../api/client";
import type { CompendiumEntry, System, SystemSection } from "../../types";

// A D&D statblock is always D&D 5.5 mechanically, whether or not the owning
// campaign happens to have its system_id set to it (campaigns can go
// without a system, or use a different one for other purposes) — so class/
// species/background pickers resolve straight off the "D&D 5.5" system in
// the vault instead of trusting campaign.system_id. Also sidesteps a real
// bug: fetching /campaigns/:id 403s for a player token (GM-only route), so
// the old campaign-lookup path silently left the pickers empty for players.
let dndSystemIdCache: number | null | undefined;
export async function findDndSystemId(): Promise<number | null> {
  if (dndSystemIdCache !== undefined) return dndSystemIdCache;
  const systems = await api.get<System[]>("/systems");
  dndSystemIdCache = systems.find((s) => s.name === "D&D 5.5")?.id ?? null;
  return dndSystemIdCache;
}

// Loaders that pull class/species/background lists out of a system's
// compendium for the DnD character sheet's pickers (requirements 2, 4, 5, 7,
// 8). Kept local to the DnD form rather than shared with CompendiumSection's
// own loaders — same simple shape, but independent so this feature can't
// regress the compendium editor and vice versa.

export interface DndClassOption {
  id: number;
  name: string;
  hitDie: string; // e.g. "d10", from the class entry's data.hit_die field
}
export interface DndSubclassOption {
  id: number;
  name: string;
}
export interface DndClassHierarchy {
  classes: DndClassOption[];
  subclassesByClass: Record<number, DndSubclassOption[]>;
}

export async function loadDndClassHierarchy(systemId: number): Promise<DndClassHierarchy> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return { classes: [], subclassesByClass: {} };
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${classSection.id}`
  );
  const classes = entries
    .filter((e) => e.kind === "class" && e.parent_id === null)
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ id: e.id, name: e.name, hitDie: String(e.data.hit_die ?? "") }));
  const subclassesByClass: Record<number, DndSubclassOption[]> = {};
  for (const c of classes) {
    subclassesByClass[c.id] = entries
      .filter((e) => e.kind === "subclass" && e.parent_id === c.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, name: e.name }));
  }
  return { classes, subclassesByClass };
}

// Feature entries (kind "feature") of a given class or subclass entry, for
// auto-filling Классовые особенности when a class/subclass is picked.
export async function loadDndClassFeatures(systemId: number, parentId: number): Promise<CompendiumEntry[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return [];
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${classSection.id}`
  );
  return entries.filter((e) => e.kind === "feature" && e.parent_id === parentId);
}

// Feature entries of a given species entry, for auto-filling Видовые
// особенности when a species is picked.
export async function loadDndSpeciesFeatures(systemId: number, speciesId: number): Promise<CompendiumEntry[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const speciesSections = sections.filter((s) => s.kind === "species");
  for (const section of speciesSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    if (entries.some((e) => e.id === speciesId)) {
      return entries.filter((e) => e.kind === "feature" && e.parent_id === speciesId);
    }
  }
  return [];
}

export interface DndSpeciesOption {
  id: number;
  name: string;
  creatureTypeName: string;
  walkSpeed: string; // e.g. "30" — distance value of the "Ходьба" speed pick, if any
}

export async function loadDndSpeciesOptions(systemId: number): Promise<DndSpeciesOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const speciesSections = sections.filter((s) => s.kind === "species");
  const results: DndSpeciesOption[] = [];
  for (const section of speciesSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    for (const e of entries) {
      if (e.kind !== "species") continue;
      const creatureType = e.data.creature_type as { name: string } | undefined;
      const speeds = (e.data.speeds as { name: string; distance: string }[] | undefined) ?? [];
      const walk = speeds.find((s) => s.name === "Ходьба") ?? speeds[0];
      results.push({
        id: e.id,
        name: e.name,
        creatureTypeName: creatureType?.name ?? "",
        walkSpeed: walk?.distance ?? "",
      });
    }
  }
  return results;
}

export interface DndBackgroundOption {
  id: number;
  name: string;
}

export async function loadDndBackgroundOptions(systemId: number): Promise<DndBackgroundOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const bgSections = sections.filter((s) => s.kind === "background");
  const results: DndBackgroundOption[] = [];
  for (const section of bgSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    for (const e of entries) {
      if (e.kind === "background") results.push({ id: e.id, name: e.name });
    }
  }
  return results;
}

export interface DndSpellOption {
  id: number;
  name: string;
}

// Spells of one specific level, for the "+ Добавить заклинание" live-search
// suggestions in that level's section.
export async function loadDndSpellsByLevel(systemId: number, level: number): Promise<DndSpellOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const spellSections = sections.filter((s) => s.kind === "spell");
  const results: DndSpellOption[] = [];
  for (const section of spellSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    for (const e of entries) {
      if (e.kind === "spell" && e.level === level) results.push({ id: e.id, name: e.name });
    }
  }
  return results;
}

export interface DndMechanicsOption {
  id: number;
  name: string;
}

// Direct children of a named top-level "Справочник" group (e.g. "Состояния",
// "Типы урона", "Особое восприятие") — a generic version of the per-group
// loaders CompendiumSection.tsx keeps for its own species/class pickers,
// kept separate here (creature wizard/editor only) so neither can regress
// the other's behavior.
export async function loadDndMechanicsGroup(systemId: number, groupName: string): Promise<DndMechanicsOption[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const mechSection = sections.find((s) => s.kind === "mechanics");
  if (!mechSection) return [];
  const entries = await api.get<CompendiumEntry[]>(
    `/systems/${systemId}/entries?section_id=${mechSection.id}`
  );
  const group = entries.find((e) => e.parent_id === null && e.name === groupName);
  if (!group) return [];
  return entries
    .filter((e) => e.parent_id === group.id)
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ id: e.id, name: e.name }));
}

// Снаряжение/Магические предметы entries, for the Инвентарь tab's
// "добавить из компендиума" live-search suggestions.
export async function loadDndEquipmentEntries(systemId: number): Promise<CompendiumEntry[]> {
  const sections = await api.get<SystemSection[]>(`/systems/${systemId}/sections`);
  const equipSections = sections.filter((s) => s.kind === "equipment" || s.kind === "magic_item");
  const results: CompendiumEntry[] = [];
  for (const section of equipSections) {
    const entries = await api.get<CompendiumEntry[]>(
      `/systems/${systemId}/entries?section_id=${section.id}`
    );
    results.push(...entries.filter((e) => e.kind === "equipment" || e.kind === "magic_item"));
  }
  return results;
}
