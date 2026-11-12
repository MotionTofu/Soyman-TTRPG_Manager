/** Справочник LitM (пачка 5г, доски Litm-Rules и Litm-Rules-Cards): группы книги,
 *  статьи «коротко → шаги → врезки и связи → Подробно», примеры статусов, карточки и словарь. */
import type { CompendiumEntry } from "../../types";
import { norm } from "./litmBookText";

export interface RuleSection { head: string; headEn: string; page: string; text: string; textEn: string }
export interface RuleSidebar { title: string; titleEn: string; page: string; text: string; textEn: string }
export interface RuleRef { name: string; page: string }

export interface RuleArticle {
  entry: CompendiumEntry;
  groupId: number;
  page: string;
  steps: string[];
  related: RuleRef[];
  sections: RuleSection[];
  sidebars: RuleSidebar[];
}

/** Подгруппа примеров (8 групп статусов книги): запись и её статусы. */
export interface RuleCatalog { entry: CompendiumEntry; items: CompendiumEntry[] }

export interface RuleGroup { entry: CompendiumEntry; articles: RuleArticle[]; catalog: RuleCatalog[] }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;

/** Группы в порядке книги; запись с детьми — подгруппа примеров, без детей — статья. */
export function rulesOf(entries: CompendiumEntry[]): RuleGroup[] {
  const kids = new Map<number, CompendiumEntry[]>();
  for (const e of entries) if (e.parent_id !== null) kids.set(e.parent_id, [...(kids.get(e.parent_id) ?? []), e]);
  return entries.filter((e) => e.kind === "mechanic_group" && e.parent_id === null).sort(byPos).map((g) => {
    const children = (kids.get(g.id) ?? []).sort(byPos);
    return {
      entry: g,
      catalog: children.filter((c) => kids.has(c.id)).map((c) => ({ entry: c, items: (kids.get(c.id) ?? []).sort(byPos) })),
      articles: children.filter((c) => !kids.has(c.id)).map((e) => ({
        entry: e,
        groupId: g.id,
        page: str(e.data?.page),
        steps: arr<string>(e.data?.steps).filter((s) => typeof s === "string"),
        related: arr<Partial<RuleRef>>(e.data?.related).map((r) => ({ name: str(r.name), page: str(r.page) })).filter((r) => r.name),
        sections: arr<Partial<RuleSection>>(e.data?.sections).map((s) => ({
          head: str(s.head), headEn: str(s.headEn), page: str(s.page), text: str(s.text), textEn: str(s.textEn),
        })),
        sidebars: arr<Partial<RuleSidebar>>(e.data?.sidebars).map((s) => ({
          title: str(s.title), titleEn: str(s.titleEn), page: str(s.page), text: str(s.text), textEn: str(s.textEn),
        })),
      })),
    };
  });
}

/** Карточка в ряд (доска Litm-Rules-Cards): вид Последствия или роль вызова (Угрозы / Последствия). */
export function isCard(a: RuleArticle): boolean {
  return a.entry.kind === "mechanic_consequence_item" || a.sections.some((s) => s.head === "Угрозы");
}

/** Термин словаря: одно определение, без шагов и связей. */
export function isTerm(a: RuleArticle): boolean {
  return !isCard(a) && !a.steps.length && !a.related.length && !a.sidebars.length && a.sections.length === 1;
}

export const sectionText = (a: RuleArticle, head: string) => a.sections.find((s) => s.head === head)?.text ?? "";

export interface RuleHit { article: RuleArticle; phrase: string | null; rank: number }

/** Поиск по имени, оригиналу, «коротко» и полному переводу. */
export function searchRules(articles: RuleArticle[], query: string, limit = 40): RuleHit[] {
  const q = norm(query.trim());
  if (!q) return [];
  const hits: RuleHit[] = [];
  for (const a of articles) {
    const name = norm(a.entry.name);
    if (name.startsWith(q)) { hits.push({ article: a, phrase: null, rank: 0 }); continue; }
    if (name.includes(q) || norm(a.entry.name_original ?? "").includes(q)) { hits.push({ article: a, phrase: null, rank: 1 }); continue; }
    const line = [a.entry.description, ...a.steps, ...a.sections.map((s) => s.text), ...a.sidebars.map((s) => s.text)]
      .flatMap((t) => (t ?? "").split("\n")).find((t) => norm(t).includes(q));
    if (line) hits.push({ article: a, phrase: snippet(line, q), rank: 2 });
  }
  return hits.sort((x, y) => x.rank - y.rank).slice(0, limit);
}

/** Кусок строки вокруг найденного, без разметки книги. */
export function snippet(line: string, q: string, width = 90): string {
  const plain = line.replace(/\*+/g, "").replace(/^•\s*/, "");
  const at = norm(plain).indexOf(q);
  const from = Math.max(0, at - Math.floor(width / 3));
  return (from > 0 ? "…" : "") + plain.slice(from, from + width).trim() + (from + width < plain.length ? "…" : "");
}

