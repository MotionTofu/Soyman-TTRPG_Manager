import { api } from "../../api/client";
import type { CompendiumEntry } from "../../types";

let litmSystemIdCache: number | null | undefined;
export async function findLitmSystemId(): Promise<number | null> {
  if (litmSystemIdCache !== undefined) return litmSystemIdCache;
  const systems = await api.get<{ id: number; name: string }[]>("/systems");
  litmSystemIdCache = systems.find((s) => s.name === "Legend in the Mist")?.id ?? null;
  return litmSystemIdCache;
}

// "Могущество и Темы" is its own compendium section; all might steps, theme
// types, themebooks and theme kits live under it as a single tree. Loaders
// below resolve that section by name instead of assuming a fixed section kind.
async function loadMightSectionEntries(systemId: number): Promise<CompendiumEntry[]> {
  const sections = await api.get<{ id: number; name: string; kind: string }[]>(
    `/systems/${systemId}/sections`
  );
  const sec = sections.find((s) => s.name === "Могущество и Темы");
  if (!sec) return [];
  return api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
}

// --- Справочник (mechanics) ---

export interface LitmRefGroup {
  id: number;
  name: string;
  description: string;
}

export interface LitmRefItem {
  id: number;
  name: string;
  parentId: number;
  data: Record<string, unknown>;
  description: string;
}

export async function loadLitmRefGroups(systemId: number): Promise<LitmRefGroup[]> {
  const entries = await loadMightSectionEntries(systemId);
  return entries
    .filter((e) => e.kind === "mechanic_group" && e.parent_id === null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
    }));
}

export async function loadLitmRefItems(systemId: number): Promise<LitmRefItem[]> {
  const entries = await loadMightSectionEntries(systemId);
  return entries
    .filter((e) => e.kind === "mechanic_item")
    .map((e) => ({
      id: e.id,
      name: e.name,
      parentId: e.parent_id ?? 0,
      data: e.data as Record<string, unknown>,
      description: e.description,
    }));
}

// Convenience: get items by group name. The "Могущество и Темы" steps are
// top-level mechanic_items in that section (no wrapper group), so return them
// directly; other groups resolve by name as before.
export async function loadLitmRefItemsByGroup(systemId: number, groupName: string): Promise<LitmRefItem[]> {
  const entries = await loadMightSectionEntries(systemId);
  if (groupName === "Могущество и Темы") {
    return entries
      .filter((e) => e.kind === "mechanic_item" && e.parent_id === null)
      .map((e) => ({
        id: e.id,
        name: e.name,
        parentId: e.parent_id ?? 0,
        data: e.data as Record<string, unknown>,
        description: e.description,
      }));
  }
  const group = entries.find((e) => e.kind === "mechanic_group" && e.name === groupName);
  if (!group) return [];
  return entries
    .filter((e) => e.parent_id === group.id)
    .map((e) => ({
      id: e.id,
      name: e.name,
      parentId: e.parent_id ?? 0,
      data: e.data as Record<string, unknown>,
      description: e.description,
    }));
}

// ---- Тропы ----

export interface TropeData {
  group: string;
  blurb: string;
  themes_fixed: string[];      // EN-имена типов тембуков
  themes_choose_one: string[];
  backpack: string[];
}

export interface LitmTrope {
  id: number;
  name: string;               // «Седой охотник [Grizzled Hunter]»
  data: TropeData;
}

export async function loadLitmTropes(systemId: number): Promise<LitmTrope[]> {
  const sections = await api.get<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "trope");
  if (!sec) return [];
  const entries = await api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
  return entries
    .filter((e) => e.kind === "trope")
    .map((e) => ({
      id: e.id,
      name: e.name,
      data: e.data as unknown as TropeData,
    }));
}

// --- Анкеты тем ---

export interface ThemeBookData {
  might: string;
  powerQuestions: string[];
  weaknessQuestions: string[];
  questIdeas: string[];
  improvements: { name: string; text: string; active?: boolean }[];
}

export interface LitmThemeBook {
  id: number;
  name: string;               // «Ремесло [Skill or Trade]»
  enName: string;             // «Skill or Trade»
  ruName: string;             // «Ремесло»
  data: ThemeBookData;
}

export async function loadLitmThemeBooks(systemId: number): Promise<LitmThemeBook[]> {
  const entries = await loadMightSectionEntries(systemId);
  return entries
    .filter((e) => e.kind === "themebook" && e.parent_id !== null)
    .map((e) => {
      const match = e.name.match(/^(.+?)\s*\[(.+)\]$/);
      return {
        id: e.id,
        name: e.name,
        ruName: match?.[1] ?? e.name,
        enName: match?.[2] ?? "",
        data: e.data as unknown as ThemeBookData,
      };
    });
}

// --- Наборы тем (theme_kit) ---

export interface ThemeKitData {
  might: string;
  powerTags: string[];
  weaknessTags: string[];
  quest: string;
}

export interface LitmThemeKit {
  id: number;
  name: string;               // «Старейшина общины [Circumstance]»
  parentId: number;           // themebook id
  themebookEn: string;        // «Circumstance»
  data: ThemeKitData;
}

export async function loadLitmThemeKits(systemId: number): Promise<LitmThemeKit[]> {
  const entries = await loadMightSectionEntries(systemId);
  return entries
    .filter((e) => e.kind === "theme_kit")
    .map((e) => {
      const match = e.name.match(/^(.+?)\s*\[(.+)\]$/);
      return {
        id: e.id,
        name: e.name,
        parentId: e.parent_id ?? 0,
        themebookEn: match?.[2] ?? "",
        data: e.data as unknown as ThemeKitData,
      };
    });
}

// --- Пути магии ---

export interface LitmMagicWay {
  id: number;
  name: string;
  description: string;
}

export async function loadLitmMagicWays(systemId: number): Promise<LitmMagicWay[]> {
  const sections = await api.get<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "magic_way");
  if (!sec) return [];
  const entries = await api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
  return entries
    .filter((e) => e.kind === "magic_way")
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
    }));
}

// --- Сокровищница ---

export interface LitmTreasure {
  id: number;
  name: string;
  tags: string[];
}

export async function loadLitmTreasures(systemId: number): Promise<LitmTreasure[]> {
  const sections = await api.get<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "treasure");
  if (!sec) return [];
  const entries = await api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
  return entries
    .filter((e) => e.kind === "treasure")
    .map((e) => ({
      id: e.id,
      name: e.name,
      tags: ((e.data.tags as string[]) ?? []),
    }));
}
