import { readResource } from "../../data/imperative";
import type { CompendiumEntry, LitMPower, LitMThemeCard } from "../../types";

// Ступени Могущества по-русски — одни на карточку темы, визард и компендиум.
// Раньше было три словаря: карточка писала по-английски, визард «Переменное»,
// компендиум «Переменная». Род средний — по слову «могущество».
const MIGHT_LABELS: Record<Exclude<LitMPower, "">, string> = {
  origin: "Происхождение",
  adventure: "Приключение",
  greatness: "Величие",
  variable: "Переменное",
};

export function mightLabel(might: string): string {
  return (MIGHT_LABELS as Record<string, string>)[might] ?? "";
}

// Чтения — ключами слоя данных (группа «системы», часть 3): те же разделы и
// записи, что показывает профиль системы, и правка компендиума их помечает.
// Свой кэш id системы убран: список систем — ресурс слоя.
export async function findLitmSystemId(): Promise<number | null> {
  const systems = await readResource<{ id: number; name: string }[]>("/systems");
  return systems.find((s) => s.name === "Legend in the Mist")?.id ?? null;
}

// "Могущество и Темы" is its own compendium section; all might steps, theme
// types, themebooks and theme kits live under it as a single tree. Loaders
// below resolve that section by name instead of assuming a fixed section kind.
async function loadMightSectionEntries(systemId: number): Promise<CompendiumEntry[]> {
  const sections = await readResource<{ id: number; name: string; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.name === "Могущество и Темы");
  if (!sec) return [];
  return readResource<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
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
  /** Наборы тропа по книге: оригинальное имя набора и его тема (тип или путь магии). */
  kits_fixed?: KitRef[];
  kits_choose?: KitRef[];
}

export interface KitRef { name: string; name_original: string; theme: string; page?: string }

export interface LitmTrope {
  id: number;
  name: string;               // «Седой охотник [Grizzled Hunter]»
  data: TropeData;
}

export async function loadLitmTropes(systemId: number): Promise<LitmTrope[]> {
  const sections = await readResource<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "trope");
  if (!sec) return [];
  const entries = await readResource<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
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
      // Имя «Ремесло», оригинал «Skill or Trade»; старые записи — «Ремесло [Skill or Trade]».
      const match = e.name.match(/^(.+?)\s*\[(.+)\]$/);
      return {
        id: e.id,
        name: e.name,
        ruName: match?.[1] ?? e.name,
        enName: e.name_original || match?.[2] || "",
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
  name: string;               // «Старейшина общины»
  nameEn: string;             // «Village Elder»
  parentId: number;           // themebook или путь магии
  themebookEn: string;        // тема по книге: «Circumstance» или путь «Witchcraft»
  bookEn: string;             // анкета темы: у наборов путей — «Magic»
  data: ThemeKitData;
}

/** Наборы тем и наборы путей магии (у путей тема героя — «Магия», ступень — у набора). */
export async function loadLitmThemeKits(systemId: number): Promise<LitmThemeKit[]> {
  const sections = await readResource<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const ways = sections.find((s) => s.kind === "magic_way");
  const [themes, wayEntries] = await Promise.all([
    loadMightSectionEntries(systemId),
    ways ? readResource<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${ways.id}`) : Promise.resolve([]),
  ]);
  return kitsOf([...themes, ...wayEntries]);
}

export function kitsOf(entries: CompendiumEntry[]): LitmThemeKit[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return entries
    .filter((e) => e.kind === "theme_kit")
    .map((e) => {
      const parent = e.parent_id !== null ? byId.get(e.parent_id) : undefined;
      const match = e.name.match(/^(.+?)\s*\[(.+)\]$/);
      const themebookEn = parent?.name_original || match?.[2] || "";
      return {
        id: e.id,
        name: match?.[1] ?? e.name,
        nameEn: e.name_original ?? "",
        parentId: e.parent_id ?? 0,
        themebookEn,
        bookEn: parent?.kind === "magic_way" ? "Magic" : themebookEn,
        data: e.data as unknown as ThemeKitData,
      };
    });
}

/** Ключ сравнения имён книги: регистр, кавычки, апострофы и пометка в скобках не важны. */
export const kitKey = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/\s*\([^)]*\)/g, "").replace(/[“”"«»]/g, "").trim();

/** Набор тропа для темы: по ссылке книги, иначе первый набор этой темы. */
export function findKit(kits: LitmThemeKit[], themeEn: string, ref?: KitRef | null): LitmThemeKit | undefined {
  const own = kits.filter((k) => k.themebookEn === themeEn);
  if (ref) {
    const key = kitKey(ref.name_original);
    const hit = own.find((k) => kitKey(k.nameEn) === key) ?? kits.find((k) => kitKey(k.nameEn) === key);
    if (hit) return hit;
  }
  return own[0];
}

/** Ссылка тропа на набор для его темы `themeEn`. */
export function tropeKitRef(trope: LitmTrope, themeEn: string): KitRef | null {
  return [...(trope.data.kits_fixed ?? []), ...(trope.data.kits_choose ?? [])].find((k) => k.theme === themeEn) ?? null;
}

/** Тема героя из набора: теги, квест, ступень набора; особые улучшения — из анкеты темы. */
export function themeFromKit(themeEn: string, kit: LitmThemeKit | undefined, books: LitmThemeBook[]): LitMThemeCard {
  const book = books.find((b) => b.enName === (kit?.bookEn ?? themeEn));
  return {
    power: (kit?.data.might || book?.data.might || "") as LitMPower,
    themeType: kit?.bookEn ?? themeEn,
    name: kit ? `${kit.name} [${themeEn}]` : book ? `${book.ruName} [${themeEn}]` : themeEn,
    powerTags: kit?.data.powerTags ?? [],
    weaknessTags: kit?.data.weaknessTags ?? [],
    quest: kit?.data.quest ?? "",
    improve: 0, abandon: 0, milestone: 0,
    specialImprovements: (book?.data.improvements ?? []).map((i) => ({ text: `${i.name} — ${i.text}`, active: false })),
  };
}

/** Темы героя по тропу: три постоянные и выбранная (или ни одной на выбор). */
export function tropeThemes(trope: LitmTrope, chooseIdx: number | null, kits: LitmThemeKit[], books: LitmThemeBook[]): LitMThemeCard[] {
  const types = [...trope.data.themes_fixed, ...(chooseIdx === null ? [] : [trope.data.themes_choose_one[chooseIdx]])];
  return types.map((en) => themeFromKit(en, findKit(kits, en, tropeKitRef(trope, en)), books));
}

// --- Пути магии ---

export interface LitmMagicWay {
  id: number;
  name: string;
  description: string;
}

export async function loadLitmMagicWays(systemId: number): Promise<LitmMagicWay[]> {
  const sections = await readResource<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "magic_way");
  if (!sec) return [];
  const entries = await readResource<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
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
  powerTags: string[];
  weakness: string;
}

export async function loadLitmTreasures(systemId: number): Promise<LitmTreasure[]> {
  const sections = await readResource<{ id: number; kind: string }[]>(`/systems/${systemId}/sections`);
  const sec = sections.find((s) => s.kind === "treasure");
  if (!sec) return [];
  const entries = await readResource<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${sec.id}`);
  return entries
    .filter((e) => e.kind === "treasure")
    .map((e) => ({
      id: e.id,
      name: e.name,
      tags: ((e.data.tags as string[]) ?? []),
      powerTags: Array.isArray(e.data.powerTags) ? (e.data.powerTags as string[]) : ((e.data.tags as string[]) ?? []),
      weakness: typeof e.data.weakness === "string" ? e.data.weakness : "",
    }));
}
