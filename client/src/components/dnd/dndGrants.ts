import type { CompendiumEntry, DndAbilityKey } from "../../types";
import { parseAbilityNames } from "./AbilityScores";
import type { ProgressionRecharge } from "./progression";

/**
 * «Что этот источник даёт персонажу» — один разбор на вид, предысторию,
 * черту и класс.
 *
 * Зачем один. Раньше выдавать что-либо умела только предыстория: у видов в
 * данных нет ни навыков, ни черты происхождения (у «Человека» лежат три
 * текстовые особенности и всё), а у черт нет поля выдачи вовсе. Каждый новый
 * источник тянул за собой свой механизм — а второй механизм для того же
 * самого это ровно то устройство, из-за которого терялись владения навыками
 * (гриллинг 2026-09-04).
 *
 * Граница проведена сознательно: **выдача** — сюда, **изменение правила** —
 * в текст особенности. «Везучий» попадает сюда пулом очков везения, но само
 * правило «перебросить кость» остаётся текстом: тратит очко игрок, а не
 * приложение. Видов выдачи конечное число, частных случаев D&D —
 * бесконечное, и структурировать надо первое.
 *
 * Поля лежат плоско (`skills`, `origin_feat`, `abilities`, `granted_spells`,
 * …) — так их пишет редактор Справочника и так они приехали импортом. Общее
 * здесь не устройство хранения, а **читатель**: одна функция на все
 * источники, и новый источник своего механизма не заводит.
 */

/** Максимум пула. Формул нет намеренно: язык выражений в справочнике — это
 *  отдельная работа, а этих двух имён хватает почти на всё (решение F3). */
export type GrantedResourceMax =
  | { kind: "number"; value: number }
  | { kind: "prof_bonus" }
  | { kind: "ability_mod"; ability: DndAbilityKey };

export interface GrantedResource {
  key: string;
  label: string;
  max: GrantedResourceMax;
  recharge: ProgressionRecharge;
}

/** Готовое заклинание от источника. `outsideLimit` — «не в счёт лимита»:
 *  «Починка» Артефактора и заклинания «Посвящённого в магию» не занимают
 *  места среди заговоров и подготовленных. */
export interface GrantedSpellRef {
  id: number;
  name: string;
  original: string;
  grantLevel: number;
  outsideLimit: boolean;
}

/**
 * «Выбери N заклинаний» — «Посвящённый в магию».
 *
 * Выборов у одного источника бывает несколько: та же черта даёт два заговора
 * И одно заклинание 1 круга, то есть два разных выбора с разными кругами.
 * Поэтому список, а не одна запись.
 *
 * Отбор идёт по **списку класса**, а не по школе: в правилах «Посвящённый в
 * магию» просит выбрать список Жреца, Друида или Волшебника, и у всех 392
 * заклинаний поле `classes` заполнено, а все 1324 ссылки в нём живые. Школа
 * оставлена вторым способом — на случай черт, которые просят именно её.
 */
export interface GrantedSpellChoice {
  count: number;
  /** Записи классов/подклассов, чей список допустим; пусто — любой. */
  classIds: number[];
  /** Русские имена школ; пусто — школа любая. */
  schools: string[];
  /** Круг заклинания; null — любой. */
  level: number | null;
  outsideLimit: boolean;
}

/** «Выбери N владений» — три музыкальных инструмента у «Музыканта», три
 *  ремесленных у «Ремесленника». */
export interface GrantedToolChoice {
  count: number;
  /** Группа механик, откуда выбирать («Музыкальные инструменты»); пусто — любая. */
  group: string;
}

export interface SourceGrants {
  savingThrows: DndAbilityKey[];
  toolIds: number[];
  toolNames: string[];
  /** Ключи владений (`name_original`), уже сведённые resolve. */
  skills: string[];
  skillChoice: { count: number; options: string[] } | null;
  /** Имена черт — по ним снимается выдача при смене источника. */
  featNames: string[];
  originFeat: { id: number; name: string } | null;
  /** Источник даёт выбрать черту происхождения самому — «Универсальность»
   *  Человека. Отдельно от `originFeat`: там черта названа, здесь выбирается. */
  originFeatChoice: boolean;
  /** Характеристики, из которых источник даёт выбрать прибавку. */
  abilityOptions: string[];
  toolChoice: GrantedToolChoice | null;
  spells: GrantedSpellRef[];
  spellChoices: GrantedSpellChoice[];
  resources: GrantedResource[];
}

export const EMPTY_GRANTS: SourceGrants = {
  savingThrows: [],
  toolIds: [],
  toolNames: [],
  skills: [],
  skillChoice: null,
  featNames: [],
  originFeat: null,
  originFeatChoice: false,
  abilityOptions: [],
  toolChoice: null,
  spells: [],
  spellChoices: [],
  resources: [],
};

/** «Лечащее слово [Healing Word]» → имя и оригинал по отдельности. Импорт
 *  складывает оба в одну строку, и это единственное место, где английское
 *  имя у ссылки вообще есть. */
export function splitBracketName(raw: string): { name: string; original: string } {
  const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(raw ?? "");
  return m ? { name: m[1].trim(), original: m[2].trim() } : { name: (raw ?? "").trim(), original: "" };
}

const ABILITY_KEYS: DndAbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

function parseResourceMax(raw: unknown): GrantedResourceMax | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return { kind: "number", value: raw };
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s === "prof_bonus") return { kind: "prof_bonus" };
  const m = /^ability_mod:(\w+)$/.exec(s);
  if (m) {
    const key = m[1] as DndAbilityKey;
    return ABILITY_KEYS.includes(key) ? { kind: "ability_mod", ability: key } : null;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? { kind: "number", value: n } : null;
}

function parseResources(raw: unknown, sourceId: number): GrantedResource[] {
  if (!Array.isArray(raw)) return [];
  const out: GrantedResource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const max = parseResourceMax(r.max);
    if (!label || !max) continue;
    const recharge: ProgressionRecharge = r.recharge === "short" || r.recharge === "none" ? r.recharge : "long";
    // Ключ строится из id источника, чтобы пул одной черты не столкнулся с
    // пулом другой и пережил переименование подписи.
    const own = typeof r.key === "string" && r.key ? r.key : label;
    out.push({ key: `grant:${sourceId}:${own}`, label, max, recharge });
  }
  return out;
}

function parseSpellRefs(raw: unknown, outsideLimit: boolean): GrantedSpellRef[] {
  if (!Array.isArray(raw)) return [];
  const out: GrantedSpellRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "number") continue;
    const split = splitBracketName(typeof r.name === "string" ? r.name : "");
    out.push({
      id: r.id,
      name: split.name,
      original: (typeof r.original === "string" ? r.original.trim() : "") || split.original,
      grantLevel: typeof r.grantLevel === "number" && r.grantLevel > 0 ? r.grantLevel : 1,
      outsideLimit: typeof r.outsideLimit === "boolean" ? r.outsideLimit : outsideLimit,
    });
  }
  return out;
}

function parseSpellChoices(raw: unknown): GrantedSpellChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: GrantedSpellChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const count = typeof r.count === "number" ? r.count : Number.parseInt(String(r.count ?? ""), 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push({
      count,
      classIds: Array.isArray(r.classIds) ? (r.classIds as unknown[]).filter((n): n is number => typeof n === "number") : [],
      schools: Array.isArray(r.schools) ? (r.schools as unknown[]).filter((x): x is string => typeof x === "string") : [],
      level: typeof r.level === "number" ? r.level : null,
      outsideLimit: r.outsideLimit !== false,
    });
  }
  return out;
}

function parseToolChoice(raw: unknown): GrantedToolChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const count = typeof r.count === "number" ? r.count : Number.parseInt(String(r.count ?? ""), 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count, group: typeof r.group === "string" ? r.group.trim() : "" };
}

/**
 * Разбирает запись справочника в выдачу.
 *
 * `resolve` сводит имя навыка к ключу (`name_original`). Имя, не сведённое
 * ни к чему, остаётся как есть — потерять его хуже, чем показать строкой
 * «нет в справочнике».
 */
export function grantsFromEntry(
  entry: CompendiumEntry | undefined,
  resolve: (raw: string) => string | null
): SourceGrants {
  if (!entry) return EMPTY_GRANTS;
  const data = entry.data as Record<string, unknown>;

  const toolPicks = Array.isArray(data.tool_profs) ? (data.tool_profs as { id: number; name: string }[]) : [];
  const bgTool = typeof data.tools === "string" && data.tools ? [data.tools] : [];
  const originFeat = (data.origin_feat as { id: number; name: string } | undefined) ?? null;

  const skillChoiceCount = Number(data.skill_choice_count) || 0;
  const skillChoiceOptions = Array.isArray(data.skill_choice_options)
    ? (data.skill_choice_options as unknown[])
        .filter((s): s is string => typeof s === "string" && !!s.trim())
        .map((s) => resolve(s) ?? s.trim())
    : [];

  return {
    savingThrows: parseAbilityNames(data.saving_throws),
    toolIds: toolPicks.map((t) => t.id).filter((id) => typeof id === "number"),
    toolNames: [...toolPicks.map((t) => t.name).filter(Boolean), ...bgTool],
    skills: (Array.isArray(data.skills) ? (data.skills as unknown[]) : [])
      .filter((s): s is string => typeof s === "string" && !!s.trim())
      .map((s) => resolve(s) ?? s.trim()),
    skillChoice: skillChoiceCount > 0 ? { count: skillChoiceCount, options: skillChoiceOptions } : null,
    featNames: originFeat?.name ? [originFeat.name] : [],
    originFeat: originFeat?.id ? originFeat : null,
    originFeatChoice: data.origin_feat_choice === true,
    abilityOptions: Array.isArray(data.abilities)
      ? (data.abilities as unknown[]).filter((a): a is string => typeof a === "string" && !!a.trim())
      : [],
    toolChoice: parseToolChoice(data.tool_choice),
    spells: parseSpellRefs(data.granted_spells, data.granted_spells_outside_limit === true),
    spellChoices: parseSpellChoices(data.spell_choices),
    resources: parseResources(data.resource_pools, entry.id),
  };
}

export function mergeGrants(list: SourceGrants[]): SourceGrants {
  return {
    savingThrows: list.flatMap((g) => g.savingThrows),
    toolIds: list.flatMap((g) => g.toolIds),
    toolNames: list.flatMap((g) => g.toolNames),
    skills: list.flatMap((g) => g.skills),
    // Выборы навыков не складываются: их несколько и каждый свой. Первый
    // непустой здесь только для мест, где нужен «какой-нибудь».
    skillChoice: list.find((g) => g.skillChoice)?.skillChoice ?? null,
    featNames: list.flatMap((g) => g.featNames),
    originFeat: list.find((g) => g.originFeat)?.originFeat ?? null,
    originFeatChoice: list.some((g) => g.originFeatChoice),
    abilityOptions: list.flatMap((g) => g.abilityOptions),
    toolChoice: list.find((g) => g.toolChoice)?.toolChoice ?? null,
    spells: list.flatMap((g) => g.spells),
    spellChoices: list.flatMap((g) => g.spellChoices),
    resources: list.flatMap((g) => g.resources),
  };
}
