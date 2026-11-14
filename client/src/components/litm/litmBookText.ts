/** Слова и правила «сказочной книги» LitM без разметки — их делят каталоги и профиль. */
import type { SystemSection } from "../../types";

const CONSEQUENCE_TYPES = [
  { key: "blocked", name: "Возможность закрыта", alias: "Заблокировано" },
  { key: "revelation", name: "Обнаружение", alias: "Разоблачение" },
  { key: "ill_tidings", name: "Дурные вести" },
  { key: "new_challenge", name: "Новый вызов" },
  { key: "complication", name: "Осложнение" },
  { key: "yes_but", name: "Да, но…" },
  { key: "negative_effects", name: "Негативные эффекты" },
] as const;

export function namedConsequence(text: string) {
  const key = norm(text.trim().replace(/[«»„“”"]/g, "").replace(/:\s*$/, "").replace(/\.\.\./g, "…"));
  return CONSEQUENCE_TYPES.find((c) => c.key === key || norm(c.name) === key || ("alias" in c && norm(c.alias) === key));
}

export type LitmMight = "origin" | "adventure" | "greatness" | "variable";

export const MIGHT_NAMES: Record<LitmMight, string> = {
  origin: "Происхождение",
  adventure: "Приключение",
  greatness: "Величие",
  variable: "Переменная",
};

export function isMight(v: unknown): v is LitmMight {
  return v === "origin" || v === "adventure" || v === "greatness" || v === "variable";
}

/** Последствие угрозы: текст, а эффект из скобок в конце — хвостом без скобок.
 *  Точка после скобок (так в виньетках путешествий) не мешает. */
export function splitConsequence(text: string): { lead: string; effect: string | null } {
  const m = /^(.*\S)\s*\(((?:[^()]|\([^()]*\))*)\)\.?\s*$/.exec(text);
  return m ? { lead: m[1], effect: m[2] } : { lead: text, effect: null };
}

/** Склонение счётчика: 1 вызов, 2 вызова, 5 вызовов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  if (n % 10 === 1) return one;
  if (n % 10 >= 2 && n % 10 <= 4) return few;
  return many;
}

/** Абзацы текста записи: через пустую строку. */
export const paras = (text: string) => text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

/** Поиск без учёта регистра по русскому тексту. */
export function norm(s: string): string {
  return s.toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Раздел тем LitM: прежнее имя «Могущество и Темы» и новое «Темы» (владелец, 2026-11-13). */
export function isLitmThemesSection(name: string | null | undefined): boolean {
  return name === "Могущество и Темы" || name === "Темы";
}

export type LitmCatalog = "challenges" | "themes" | "tropes" | "grimoire" | "rules" | "ways" | "store" | "treasury" | "journeys" | "oracles";

/** Какой каталог «сказочной книги» у раздела LitM — или никакого. */
export function litmCatalogOf(systemCode: string | null | undefined, section: SystemSection): LitmCatalog | null {
  if (systemCode !== "litm") return null;
  if (section.kind === "monster") return "challenges";
  if (section.kind === "trope") return "tropes";
  if (section.kind === "magic_way") return "ways";
  if (section.kind === "mechanic_backpack_category") return "store";
  if (section.kind === "treasure") return "treasury";
  if (section.kind === "oracle") return "oracles";
  if (section.kind === "journey") return "journeys";
  if (isLitmThemesSection(section.name)) return "themes";
  if (section.name === "Гримуар действий") return "grimoire";
  if (section.name === "Справочник") return "rules";
  return null;
}
