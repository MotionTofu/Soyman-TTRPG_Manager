import { api } from "../../api/client";
import type { CompendiumEntry, System, SystemSection } from "../../types";

// Загрузчики принимают signal, чтобы эффект, снятый при размонтировании
// или при смене системы, не дописывал состояние уже неактуальной формой.
// Каждый ходит в сеть дважды (разделы, потом записи), и без отмены второй
// запрос уезжает уже после того, как первый стал не нужен.
export interface LoadOpts {
  signal?: AbortSignal;
}

const get = <T>(path: string, opts?: LoadOpts) => api.get<T>(path, opts?.signal ? { signal: opts.signal } : undefined);

// Отменённый запрос — не ошибка: так эффект убирает за собой при
// размонтировании и при смене системы. Сообщать о нём мастеру нечего.
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}
export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "неизвестная ошибка";
}

// A D&D statblock is always D&D 5.5 mechanically, whether or not the owning
// campaign happens to have its system_id set to it (campaigns can go
// without a system, or use a different one for other purposes) — so class/
// species/background pickers resolve straight off the "D&D 5.5" system in
// the vault instead of trusting campaign.system_id. Also sidesteps a real
// bug: fetching /campaigns/:id 403s for a player token (GM-only route), so
// the old campaign-lookup path silently left the pickers empty for players.
let dndSystemIdCache: number | null | undefined;
export function clearDndSystemIdCache(): void {
  dndSystemIdCache = undefined;
}
export async function findDndSystemId(): Promise<number | null> {
  if (dndSystemIdCache !== undefined) return dndSystemIdCache;
  const systems = await api.get<System[]>("/systems");
  const byCode = systems.find((s) => s.code === "phb" || s.code === "dnd55");
  const byName = systems.find((s) => s.name === "D&D 5.5");
  dndSystemIdCache = (byCode ?? byName)?.id ?? null;
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
  hitDie: string; // как записано в data.hit_die, например «к10»
  // Уровень класса, с которого доступен подкласс (data.subclass_level).
  // 0 — поле не заполнено, ограничения нет.
  subclassLevel: number;
}
export interface DndSubclassOption {
  id: number;
  name: string;
}
// Порядок в выпадающих списках — по алфавиту, а не по `position` (решение
// W1, гриллинг 2026-09-04). В визарде и в форме класс ищут глазами по букве;
// книжный порядок остаётся в самом Справочнике, где позиция несёт смысл —
// главы, уровни, порядок изложения.
export function byNameRu<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "ru");
}

export interface DndClassHierarchy {
  classes: DndClassOption[];
  subclassesByClass: Record<number, DndSubclassOption[]>;
}

export async function loadDndClassHierarchy(systemId: number, opts?: LoadOpts): Promise<DndClassHierarchy> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return { classes: [], subclassesByClass: {} };
  const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${classSection.id}`, opts);
  const classes = entries
    .filter((e) => e.kind === "class" && e.parent_id === null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      hitDie: String(e.data.hit_die ?? ""),
      subclassLevel: Number(e.data.subclass_level) || 0,
    }))
    .sort(byNameRu);
  const subclassesByClass: Record<number, DndSubclassOption[]> = {};
  for (const c of classes) {
    subclassesByClass[c.id] = entries
      .filter((e) => e.kind === "subclass" && e.parent_id === c.id)
      .map((e) => ({ id: e.id, name: e.name }))
      .sort(byNameRu);
  }
  return { classes, subclassesByClass };
}

// Feature entries (kind "feature") of a given class or subclass entry, for
// auto-filling Классовые особенности when a class/subclass is picked.
export async function loadDndClassFeatures(systemId: number, parentId: number, opts?: LoadOpts): Promise<CompendiumEntry[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return [];
  const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${classSection.id}`, opts);
  return entries.filter((e) => e.kind === "feature" && e.parent_id === parentId);
}

// Feature entries of a given species entry, for auto-filling Видовые
// особенности when a species is picked.
export async function loadDndSpeciesFeatures(systemId: number, speciesId: number, opts?: LoadOpts): Promise<CompendiumEntry[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const speciesSections = sections.filter((s) => s.kind === "species");
  for (const section of speciesSections) {
    const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`, opts);
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

export async function loadDndSpeciesOptions(systemId: number, opts?: LoadOpts): Promise<DndSpeciesOption[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const speciesSections = sections.filter((s) => s.kind === "species");
  const results: DndSpeciesOption[] = [];
  for (const section of speciesSections) {
    const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`, opts);
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
  return results.sort(byNameRu);
}

export interface DndFeatOption {
  id: number;
  name: string;
}

/** Черты происхождения — те, что визард предлагает на шаге выбора черты.
 *  Отбираются по полю `category`, оно заполнено у всех 129 черт. */
export async function loadDndOriginFeats(systemId: number, opts?: LoadOpts): Promise<DndFeatOption[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const featSections = sections.filter((s) => s.kind === "feat");
  const lists = await Promise.all(
    featSections.map((s) => get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${s.id}`, opts))
  );
  return lists
    .flat()
    .filter((e) => e.kind === "feat" && e.data.category === "Черта происхождения")
    .map((e) => ({ id: e.id, name: e.name }))
    .sort(byNameRu);
}

export interface DndBackgroundOption {
  id: number;
  name: string;
}

export async function loadDndBackgroundOptions(systemId: number, opts?: LoadOpts): Promise<DndBackgroundOption[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const bgSections = sections.filter((s) => s.kind === "background");
  const results: DndBackgroundOption[] = [];
  for (const section of bgSections) {
    const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`, opts);
    for (const e of entries) {
      if (e.kind === "background") results.push({ id: e.id, name: e.name });
    }
  }
  return results.sort(byNameRu);
}

export interface DndSpellOption {
  id: number;
  name: string;
}

// Spells of one specific level, for the "+ Добавить заклинание" live-search
// suggestions in that level's section.
export async function loadDndSpellsByLevel(systemId: number, level: number, opts?: LoadOpts): Promise<DndSpellOption[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const spellSections = sections.filter((s) => s.kind === "spell");
  const results: DndSpellOption[] = [];
  for (const section of spellSections) {
    const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`, opts);
    for (const e of entries) {
      if (e.kind === "spell" && e.level === level) results.push({ id: e.id, name: e.name });
    }
  }
  return results;
}

// Все заклинания системы разом. Нужны там, где ссылка на заклинание пришла
// битой: «Обретаемые заклинания» вида и подкласса хранят `id`, а он не
// переживает переустановку модуля — в базе владельца все 288 ссылок вели в
// пустоту. Ключом в таком случае служит `name_original`, как и у навыков.
export async function loadDndSpellIndex(systemId: number, opts?: LoadOpts): Promise<CompendiumEntry[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const spellSections = sections.filter((s) => s.kind === "spell");
  const lists = await Promise.all(
    spellSections.map((s) => get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${s.id}`, opts))
  );
  return lists.flat().filter((e) => e.kind === "spell");
}

// Таблицы развития всех классов системы. Нужны в одном узком случае: когда
// персонаж многоклассовый и среди его классов нет ни одного полного
// заклинателя (Паладин/Следопыт) — таблицу многоклассья тогда неоткуда взять,
// кроме как у полного заклинателя из компендиума.
export async function loadDndClassProgressions(systemId: number, opts?: LoadOpts): Promise<Record<string, unknown>[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const classSection = sections.find((s) => s.kind === "class");
  if (!classSection) return [];
  const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${classSection.id}`, opts);
  return entries
    .filter((e) => e.kind === "class" && e.data.progression)
    .map((e) => e.data.progression as Record<string, unknown>);
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
// Разделов вида `mechanics` у системы может быть несколько: один заводится
// базовым (`ensureDefaultMechanicsSection`), второй приезжает импортом
// модуля — в базе владельца у D&D 5.5 их два, и всё содержимое лежит во
// втором. `find` по первому подходящему возвращал пустой раздел, и список
// молча оказывался пустым — ровно тот способ терять данные, от которого
// уходим. Поэтому ищем во всех.
async function loadMechanicsEntries(systemId: number, opts?: LoadOpts): Promise<CompendiumEntry[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const mechSections = sections.filter((s) => s.kind === "mechanics");
  const lists = await Promise.all(
    mechSections.map((s) => get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${s.id}`, opts))
  );
  return lists.flat();
}

export async function loadDndMechanicsGroup(systemId: number, groupName: string, opts?: LoadOpts): Promise<DndMechanicsOption[]> {
  const entries = await loadMechanicsEntries(systemId, opts);
  const group = entries.find((e) => e.parent_id === null && e.name === groupName);
  if (!group) return [];
  return entries
    .filter((e) => e.parent_id === group.id)
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ id: e.id, name: e.name }));
}

// Снаряжение/Магические предметы entries, for the Инвентарь tab's
// "добавить из компендиума" live-search suggestions.
export async function loadDndEquipmentEntries(systemId: number, opts?: LoadOpts): Promise<CompendiumEntry[]> {
  const sections = await get<SystemSection[]>(`/systems/${systemId}/sections`, opts);
  const equipSections = sections.filter((s) => s.kind === "equipment" || s.kind === "magic_item");
  const results: CompendiumEntry[] = [];
  for (const section of equipSections) {
    const entries = await get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`, opts);
    results.push(...entries.filter((e) => e.kind === "equipment" || e.kind === "magic_item"));
  }
  return results;
}

export interface DndSkillEntry {
  id: number;
  /** Имя, как его показывает справочник. */
  name: string;
  /** Английское имя — ключ владения в листе. Пусто у записей до миграции. */
  nameOriginal: string;
  /** Другие написания: переводы, старые имена, опечатки, сведённые мастером. */
  aliases: string[];
  /** Русское имя характеристики из `data.ability`, если мастер её задал. */
  ability: string;
}

// Навыки из группы «Навыки» Справочника. Лист держит свой встроенный список
// (`skillCatalog.ts`) и без справочника работает, но имена и алиасы, когда
// справочник есть, берутся отсюда: второй список имён — это ровно та
// первопричина, из-за которой владения терялись (гриллинг 2026-09-04).
export async function loadDndSkillEntries(systemId: number, opts?: LoadOpts): Promise<DndSkillEntry[]> {
  const entries = await loadMechanicsEntries(systemId, opts);
  const group = entries.find((e) => e.parent_id === null && e.name === "Навыки");
  if (!group) return [];
  return entries
    .filter((e) => e.parent_id === group.id)
    .sort((a, b) => a.position - b.position)
    .map((e) => ({
      id: e.id,
      name: e.name,
      nameOriginal: e.name_original ?? "",
      aliases: Array.isArray(e.aliases) ? e.aliases : [],
      ability: typeof e.data.ability === "string" ? e.data.ability : "",
    }));
}
