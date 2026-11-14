import type { CompendiumEntry } from "../../types";
import { norm } from "./litmBookText";

export type Die = "d6" | "d66";
export type OracleKey = "question" | "conflict" | "premade" | "builder" | "action" | "consequence" | "revelation";
export interface Named { name: string; nameEn?: string }
export interface Text { text: string; textEn?: string }
export interface RollRow { roll: string }
export interface TableRow extends RollRow, Partial<Named>, Partial<Text> {
  note?: string; noteEn?: string; area?: string; areaEn?: string; page?: string; again?: boolean;
}
export interface Table extends Named { key: string; rows: TableRow[] }
export interface Question {
  yesNo: { rule: string; ruleEn: string; outcomes: (Named & Text & { key: string; range: string })[] };
  interpretive: { rule: string; ruleEn: string; tables: Table[] };
}
export interface Conflict { columns: Table[]; scaleNote: string; scaleNoteEn: string }
export interface ProfileRow extends RollRow, Named { kind: "challenge" | "journey" | "vignettes"; refs?: string[]; page: string }
export type ProfileColumn = "creatures" | "people" | "places";
export type Area = RollRow & Named & Partial<Record<ProfileColumn, ProfileRow[]>> & { page?: string; again?: boolean };
export interface VignetteRow extends RollRow, Named { page?: string; refs?: string[] }
export interface VignetteTable extends VignetteRow { items: VignetteRow[] }
export interface Premade {
  areas: Area[];
  columns: (Named & { key: ProfileColumn })[];
  vignettes: VignetteTable[];
}
export interface Builder { steps: (Named & Text & { key: string })[]; example: Named & Text }
export interface Action {
  roles: { role: string; roleEn: string; actions: (Named & { threat: string; threatEn: string; consequences: (RollRow & Text)[] })[] }[];
}
export interface Consequences { rows: (RollRow & Named & Text & { effect: string; effectEn: string; specific: (RollRow & Text)[] })[] }
export interface Revelation { rows: (RollRow & Record<"act1" | "act2" | "act3" | "act1En" | "act2En" | "act3En", string>)[] }
type OracleData = {
  question: Question; conflict: Conflict; premade: Premade; builder: Builder;
  action: Action; consequence: Consequences; revelation: Revelation;
};
type OraclePayload = { [K in OracleKey]: OracleData[K] & { key: K; page: string; leadEn: string } }[OracleKey];
export interface Oracle { entry: CompendiumEntry; data: OraclePayload }

export const ORACLE_INFO: Record<OracleKey, { dice: string; summary: string }> = {
  question: { dice: "2d6 + Сила · d66", summary: "Да или нет и толкование по символам" },
  conflict: { dice: "d66 × 7 столбцов", summary: "Вызов серии, приключения или сцены" },
  premade: { dice: "d66 · d6", summary: "Вызов или путешествие из книги по области" },
  builder: { dice: "d6", summary: "Свой вызов на ходу за пять шагов" },
  action: { dice: "d6 по роли", summary: "Что вызов делает дальше" },
  consequence: { dice: "d66 · d6", summary: "Последствия действия Героя без вызова" },
  revelation: { dice: "d66 · акт", summary: "Тайны Великой опасности в серии «Гора»" },
};

export function oraclesOf(entries: CompendiumEntry[]): Oracle[] {
  return entries.filter((e) => typeof e.data?.key === "string" && Object.hasOwn(ORACLE_INFO, e.data.key) && typeof e.data.page === "string")
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((entry) => ({ entry, data: entry.data as unknown as OraclePayload }));
}

export function oraclePath(systemId: number, sectionId: number, entryId?: number, area?: string) {
  const params = new URLSearchParams({ section: String(sectionId) });
  if (entryId !== undefined) params.set("entry", String(entryId));
  if (area) params.set("area", area);
  return "/systems/" + systemId + "?" + params;
}

export function throwDice(die: Die | "2d6") {
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const first = d6();
  const second = die === "d6" ? null : d6();
  const value = second === null ? first : die === "d66" ? first * 10 + second : first + second;
  return { dice: second === null ? [first] : [first, second], value };
}
export type Dice = ReturnType<typeof throwDice>;

export function rowAt<T extends RollRow>(rows: readonly T[], value: number): T | undefined {
  return rows.find(({ roll }) => {
    const [min, max = min] = roll.split(/[–—-]/).map(Number);
    return value >= min && value <= max;
  });
}

export function yesNoOutcome(first: number, second: number, power: number) {
  if (first === 1 && second === 1) return "extremeNo";
  if (first === 6 && second === 6) return "extremeYes";
  const total = first + second + power;
  return total <= 6 ? "no" : total < 10 ? "mixed" : "yes";
}

export function findByOriginal<T extends { nameEn?: string }>(rows: readonly T[], name?: string): T | undefined {
  return name ? rows.find((row) => row.nameEn && norm(row.nameEn) === norm(name)) : undefined;
}

export function plainOracleText(text: string) {
  return text.replaceAll("*", "").trim();
}
