/** Пути магии LitM (пачка 5в, доска Litm-Way): пути, их наборы и общие главы раздела. */
import type { CompendiumEntry } from "../../types";
import type { RuleSection, RuleSidebar } from "./litmRules";

export interface WayIngredient { name: string; nameEn: string }

export interface MagicWay {
  entry: CompendiumEntry;
  page: string;
  epigraph: string;
  epigraphEn: string;
  ingredients: WayIngredient[];
  sections: RuleSection[];
  sidebars: RuleSidebar[];
  variant: RuleSection | null;
  kits: CompendiumEntry[];
}

/** Глава раздела без пути: «Основы магии», «Волшебный котёл», «Заученные формулы». */
export interface WayChapter { entry: CompendiumEntry; page: string; sections: RuleSection[]; sidebars: RuleSidebar[] }

export interface WayBook { ways: MagicWay[]; chapters: WayChapter[] }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;

const section = (s: Partial<RuleSection>): RuleSection =>
  ({ head: str(s.head), headEn: str(s.headEn), page: str(s.page), text: str(s.text), textEn: str(s.textEn) });
const sidebar = (s: Partial<RuleSidebar>): RuleSidebar =>
  ({ title: str(s.title), titleEn: str(s.titleEn), page: str(s.page), text: str(s.text), textEn: str(s.textEn) });

/** Пути и главы в порядке книги; наборы пути — его дети в порядке записи. */
export function waysOf(entries: CompendiumEntry[]): WayBook {
  const top = entries.filter((e) => e.parent_id === null).sort(byPos);
  const kitsOf = (id: number) => entries.filter((e) => e.parent_id === id && e.kind === "theme_kit").sort(byPos);
  return {
    ways: top.filter((e) => e.kind === "magic_way").map((e) => {
      const v = e.data?.variant as Partial<RuleSection> | null | undefined;
      return {
        entry: e,
        page: str(e.data?.page),
        epigraph: str(e.data?.epigraph),
        epigraphEn: str(e.data?.epigraphEn),
        ingredients: arr<Partial<WayIngredient>>(e.data?.ingredients).map((i) => ({ name: str(i.name), nameEn: str(i.nameEn) })).filter((i) => i.name),
        sections: arr<Partial<RuleSection>>(e.data?.sections).map(section),
        sidebars: arr<Partial<RuleSidebar>>(e.data?.sidebars).map(sidebar),
        variant: v && typeof v === "object" && v.text ? section(v) : null,
        kits: kitsOf(e.id),
      };
    }),
    chapters: top.filter((e) => e.kind !== "magic_way").map((e) => ({
      entry: e,
      page: str(e.data?.page),
      sections: arr<Partial<RuleSection>>(e.data?.sections).map(section),
      sidebars: arr<Partial<RuleSidebar>>(e.data?.sidebars).map(sidebar),
    })),
  };
}

/** Тропы, в которых встречается набор пути (по оригинальному имени набора). */
export function waysInTropes(way: MagicWay, tropes: CompendiumEntry[], key: (s: string) => string): string[] {
  const kits = new Set(way.kits.map((k) => key(k.name_original ?? "")));
  return tropes.filter((t) => [...arr<{ name_original?: string }>(t.data?.kits_fixed), ...arr<{ name_original?: string }>(t.data?.kits_choose)]
    .some((k) => kits.has(key(k.name_original ?? "")))).map((t) => t.name);
}
