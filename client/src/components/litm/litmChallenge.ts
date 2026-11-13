import type { CompendiumEntry, LitMChallengeData, Statblock } from "../../types";
import { isMight, type LitmMight } from "./litmBookText";
import { challengeStateFromProfile, type LitmLimitSide, type LitmLimitState } from "@shared/litm/conflict";
import type { ConsequenceAction } from "./pult/consequence";
import { BOOK_POLAR_LIMITS, type CompoundEffect } from "@shared/litm/compound";
import { sameStatus } from "@shared/litm/status";

/** Профиль вызова LitM, как его пишет установщик книги (rewrite/install_challenges.py)
 *  поверх прежних текстовых полей статблока `litm_challenge`. */
export interface LitmLimit { name: string; nameEn?: string; max: string; arrow?: boolean; note?: string; noteEn?: string; sides?: LitmLimitSide[] }

export function ribbonLimitUpdates(saved: LitmLimitState[], profile: LitmLimit[]) {
  const canonical = challengeStateFromProfile({ limitList: profile }).limits;
  return saved.flatMap((old, index) => {
    const matching = canonical.filter((l) => sameStatus(l.name, old.name));
    const next = matching.length === 1 ? matching[0] : undefined;
    if (!next || old.sides?.length || (!next.sides?.length && (!next.turns || old.turns))) return [];
    return [{ index, old, next }];
  });
}
export interface LitmChallengeTag { text: string; textEn?: string; weakness?: boolean; group?: string; groupEn?: string; alternatives?: string[]; object?: string }
export interface LitmChallengeMight { name: string; nameEn?: string; level: string; vulnerability?: string; group?: string }
export interface LitmSpecial { name: string; nameEn?: string; text: string; textEn?: string }
export interface LitmThreat {
  name: string;
  nameEn?: string;
  lead: string;
  leadEn?: string;
  consequences: string[];
  consequencesEn?: string[];
  withoutThreat?: boolean;
  effects?: Record<string, ConsequenceAction[]>;
}

export interface LitmChallengeProfileData {
  title: string;
  titleEn: string;
  rating: number;
  roles: string[];
  location: string;
  locationEn: string;
  page: string;
  addon: boolean;
  description: string;
  limitList: LitmLimit[];
  tagList: LitmChallengeTag[];
  mightList: LitmChallengeMight[];
  specialList: LitmSpecial[];
  threatList: LitmThreat[];
  /** Прежние текстовые поля — у вызовов, записанных до разметки (свои вызовы Мастера). */
  legacy: { tags: string; limits: string; threats: string; specials: string } | null;
}

export const OWN_LOCATION = "Свои";

/** Места книги в её порядке (B112–B207) и свои вызовы последними. */
export const LOCATION_ORDER = [
  "Усадьба и деревня", "Окраины и поля", "В пути", "В глуши", "Открытая вода", "Забытые места", "Город",
  "Замок", "Поле боя", "Проклятые пустоши", "Логово тьмы", "Надстройки", OWN_LOCATION,
];

export const ROLE_ORDER = [
  "Агрессор", "Влияние", "Подрыватель", "Обратный отсчёт", "Наблюдатель", "Препятствие", "Преследователь",
  "Загадка", "Дичь", "Подопечный", "Опора", "Разные",
];

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Строки пределов из старого текста: «Изгнан - 4», «**Изгнан-6**», «Пробитая броня 4». */
export function parseLegacyLimits(text: string): LitmLimit[] {
  return text.split("\n").map((l) => l.replace(/\*\*/g, "").trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)[\s-]*(\d+|-)\s*$/.exec(l);
    return m ? { name: m[1].trim(), max: m[2] } : { name: l, max: "" };
  });
}

type EntryBase = Pick<CompendiumEntry, "name" | "name_original" | "description" | "data">;

function withCompoundEffects(title: string, threats: LitmThreat[]): LitmThreat[] {
  return threats.map((threat) => {
    const effects = { ...threat.effects };
    for (const [i, line] of threat.consequences.entries()) {
      if (effects[line]?.some((action) => action.kind === "compound")) continue;
      const original = threat.consequencesEn?.[i] ?? "";
      let keys: CompoundEffect[] = [];
      if (title === "Battlefield Leader" && /Command the troops to charge/i.test(original)) keys = ["orderCharge", "leadCharge"];
      if (title === "Frontier Healer") {
        if (/^Heal their comrade/i.test(original)) keys = ["healAlly"];
        if (/^Heal themselves/i.test(original)) keys = ["healSelf"];
        if (/^Revive a comrade/i.test(original)) keys = ["revive"];
        if (/^Place a life-preserving ward/i.test(original)) keys = ["ward"];
      }
      if (keys.length) effects[line] = keys.map((effect) => ({ kind: "compound", effect }));
    }
    return { ...threat, effects };
  });
}

export function challengeProfile(entry: EntryBase, statblock: Pick<Statblock, "content"> | undefined): LitmChallengeProfileData {
  let c: Record<string, unknown> = {};
  try {
    c = statblock?.content ? JSON.parse(statblock.content) : {};
  } catch {
    c = {};
  }
  return profileFromContent(entry, c);
}

/** Профиль из содержимого статблока: размеченный книгой или прежний текстовый. */
export function profileFromContent(entry: EntryBase, c: Partial<LitMChallengeData> & Record<string, unknown>): LitmChallengeProfileData {
  const data = entry.data ?? {};
  const structured = Array.isArray(c.threatList);
  const roles = arr<string>(c.roles).length ? arr<string>(c.roles)
    : arr<string>(data.roles).length ? arr<string>(data.roles)
      : String(c.role ?? "").split(/[,·]/).map((r) => r.trim()).filter(Boolean);
  const rating = Number(c.rating ?? data.rating ?? c.might ?? 0) || 0;
  const titleEn = String(c.titleEn ?? entry.name_original ?? "");
  const polar = BOOK_POLAR_LIMITS[titleEn];
  return {
    title: entry.name,
    titleEn,
    rating: Math.max(0, Math.min(5, rating)),
    roles,
    location: String(data.location ?? c.location ?? OWN_LOCATION),
    locationEn: String(data.locationEn ?? c.locationEn ?? ""),
    page: String(data.page ?? c.page ?? ""),
    addon: !!(data.addon ?? c.addon),
    description: String(c.description ?? entry.description ?? ""),
    limitList: structured ? arr<LitmLimit>(c.limitList).map((limit) => polar && !limit.sides?.length && sameStatus(limit.name, polar.name)
      ? { ...limit, arrow: true, note: "", sides: polar.sides }
      : limit) : parseLegacyLimits(String(c.limits ?? "")),
    tagList: arr<LitmChallengeTag>(c.tagList),
    mightList: arr<LitmChallengeMight>(c.mightList),
    specialList: arr<LitmSpecial>(c.specialList),
    threatList: titleEn === "Battlefield Leader" || titleEn === "Frontier Healer"
      ? withCompoundEffects(titleEn, arr<LitmThreat>(c.threatList)) : arr<LitmThreat>(c.threatList),
    legacy: structured ? null : {
      tags: String(c.tagsAndStatuses ?? ""),
      limits: String(c.limits ?? ""),
      threats: String(c.threatsConsequences ?? ""),
      specials: String(c.specialFeatures ?? ""),
    },
  };
}

export function mightOf(m: LitmChallengeMight): LitmMight | null {
  return isMight(m.level) ? m.level : null;
}

/** Всё, по чему ищет строка поиска каталога: имена, теги, статусы, угрозы. */
export function challengeSearchText(p: LitmChallengeProfileData): string {
  return [
    p.title, p.titleEn, p.roles.join(" "),
    ...p.tagList.map((t) => t.text), ...p.mightList.map((m) => m.name),
    ...p.threatList.flatMap((t) => [t.name, t.lead, ...t.consequences]),
    ...p.specialList.map((s) => `${s.name} ${s.text}`),
    p.legacy ? Object.values(p.legacy).join(" ") : "",
  ].join(" ").replace(/\*/g, "");
}

const LEVEL_RANK: Record<string, number> = { origin: 0, adventure: 1, greatness: 2 };

/** Содержимое статблока `litm_challenge` из профиля: разметка книги и прежние
 *  текстовые поля (их читает старая форма и экспорт) — одним снимком. */
export function toStatblockContent(p: LitmChallengeProfileData, prev: Record<string, unknown> = {}): Record<string, unknown> {
  const mightLevel = p.mightList.some((m) => m.group) ? "variable"
    : p.mightList.reduce<string>((best, m) => ((LEVEL_RANK[m.level] ?? -1) > (LEVEL_RANK[best] ?? -1) ? m.level : best), p.mightList[0]?.level ?? "origin");
  const tagLines = [
    ...p.tagList.map((t) => `${t.group ? `[${t.group}] ` : ""}${t.text}${t.weakness ? " (слабость)" : ""}`),
    ...p.mightList.map((m) => `Могущество: ${m.name}${m.vulnerability ? ` (уязвимость: ${m.vulnerability})` : ""}`),
  ];
  const { legacy: _legacy, ...rest } = p;
  void _legacy;
  return {
    ...prev,
    ...rest,
    role: p.roles.join(", "),
    mightLevel,
    might: p.rating,
    tagsAndStatuses: tagLines.join("\n"),
    limits: p.limitList.map((l) => {
      const outcome = [l.note, ...(l.sides ?? []).map((side) => side.outcome)].filter(Boolean).join(" ");
      return `${l.name} ${l.max}${l.arrow ? " ↻" : ""}${outcome ? ` — ${outcome}` : ""}`;
    }).join("\n"),
    threatsConsequences: p.threatList.map((t) => [
      t.withoutThreat ? "**Последствия без Угрозы**" : t.name ? `**${t.name}** — ${t.lead}` : `*${t.lead}*`,
      ...t.consequences.map((c) => `• ${c}`),
    ].join("\n")).join("\n\n"),
    specialFeatures: p.specialList.map((s) => `**${s.name}** — ${s.text}`).join("\n\n"),
  };
}

/** Данные записи вызова: место, страница, рейтинг, роли — по ним строит каталог. */
export function toEntryData(p: LitmChallengeProfileData, prev: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...prev, location: p.location || OWN_LOCATION, page: p.page, rating: p.rating, roles: p.roles, addon: p.addon };
}

/** Свой вызов из старых текстовых полей → списки для правки. Блоки угроз и
 *  особенностей разделены пустой строкой: первая строка — зачин или имя. */
export function structuredFromLegacy(p: LitmChallengeProfileData): LitmChallengeProfileData {
  if (!p.legacy) return p;
  const blocks = (text: string) => text.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const unwrap = (s: string) => s.replace(/^\*\*?(.*?)\*\*?$/, "$1").trim();
  return {
    ...p,
    tagList: p.legacy.tags.split("\n").map((l) => l.trim()).filter(Boolean).map((text) => ({ text })),
    threatList: blocks(p.legacy.threats).map(([lead, ...cons]) => ({ name: "", lead: unwrap(lead), consequences: cons })),
    specialList: blocks(p.legacy.specials).map(([name, ...text]) => ({ name: unwrap(name), text: text.join(" ") })),
    legacy: null,
  };
}

export function emptyChallengeProfile(name: string): LitmChallengeProfileData {
  return {
    title: name, titleEn: "", rating: 1, roles: [], location: OWN_LOCATION, locationEn: "", page: "", addon: false, description: "",
    limitList: [{ name: "Ранить", max: "3" }], tagList: [], mightList: [], specialList: [], threatList: [], legacy: null,
  };
}
