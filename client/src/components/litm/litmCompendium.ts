import { api } from "../../api/client";
import type { CompendiumEntry } from "../../types";

let litmSystemIdCache: number | null | undefined;
export async function findLitmSystemId(): Promise<number | null> {
  if (litmSystemIdCache !== undefined) return litmSystemIdCache;
  const systems = await api.get<{ id: number; name: string }[]>("/systems");
  litmSystemIdCache = systems.find((s) => s.name === "Legend in the Mist")?.id ?? null;
  return litmSystemIdCache;
}

// --- Тропы ---

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
  const sections = await api.get<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "themebook");
  if (!sec) return [];
  const entries = await api.get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
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
