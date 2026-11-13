/** Гримуар действий LitM (пачка 4, доски Litm-Grimoire*): статьи из записей раздела,
 *  эффекты глаголами (Q7), ссылки «Название» (с. N) и поиск по указателю книги (Q1). */
import type { CompendiumEntry } from "../../types";
import { namedConsequence, norm } from "./litmBookText";

export const EFFECT_NAMES: Record<string, string> = {
  ATTACK: "Атаковать", DISRUPT: "Помешать", INFLUENCE: "Повлиять", WEAKEN: "Подорвать",
  BESTOW: "Наделить", CREATE: "Создать", ENHANCE: "Усилить", RESTORE: "Восстановить",
  ADVANCE: "Продвинуть", SETBACK: "Отбросить", LESSEN: "Смягчить", DISCOVER: "Узнать",
  EXTRAFEAT: "Дополнительный подвиг", QUICK: "Быстрый", SIMPLE: "Простой", VARIES: "По-разному",
};
/** Исход, а не эффект: значок другого вида. */
export const OUTCOMES = new Set(["QUICK", "SIMPLE", "VARIES"]);

export interface GrimSection { head: string; text: string[] }
export interface GrimIntro { title: string; titleEn?: string; page?: number; limits: string[]; sections: GrimSection[] }
export interface GrimSub { name: string; nameEn?: string; text: string[] }
export interface GrimList { name: string; nameEn?: string; items: string[] }
export interface GrimEffect { key: string; name: string; text: string }

export interface GrimArticle {
  entry: CompendiumEntry;
  chapterId: number;
  page: number | null;
  sub: string;
  see: boolean;
  examples: string[];
  powerPlus: string[];
  powerMinus: string[];
  success: { effects: string[]; text: string }[];
  feats: string[];
  consequences: string[];
  sections: GrimSection[];
  notes: string[];
  index: string[];
  effects: GrimEffect[];
  lists: GrimList[];
}

export interface GrimChapter {
  entry: CompendiumEntry;
  page: number | null;
  intro: GrimIntro | null;
  subs: GrimSub[];
  articles: GrimArticle[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;

/** Главы в порядке книги, статьи — в порядке книги внутри главы. */
export function grimoireOf(entries: CompendiumEntry[]): GrimChapter[] {
  const groups = entries.filter((e) => e.kind === "mechanic_group" && e.parent_id === null).sort(byPos);
  return groups.map((g) => {
    const intro = g.data?.intro as GrimIntro | undefined;
    return {
      entry: g,
      page: num(g.data?.page),
      intro: intro ? { ...intro, limits: arr(intro.limits), sections: arr(intro.sections) } : null,
      subs: arr<GrimSub>(g.data?.subsections).map((s) => ({ ...s, text: arr(s.text) })),
      articles: entries.filter((e) => e.parent_id === g.id).sort(byPos).map((e) => ({
        entry: e,
        chapterId: g.id,
        page: num(e.data?.page),
        sub: typeof e.data?.sub === "string" ? e.data.sub : "",
        see: e.data?.see === true,
        examples: arr(e.data?.examples),
        powerPlus: arr(e.data?.powerPlus),
        powerMinus: arr(e.data?.powerMinus),
        success: arr<{ effects?: unknown; text?: unknown }>(e.data?.success)
          .map((s) => ({ effects: arr<string>(s.effects), text: typeof s.text === "string" ? s.text : "" })),
        feats: arr(e.data?.feats),
        consequences: arr(e.data?.consequences),
        sections: arr<GrimSection>(e.data?.sections).map((s) => ({ head: s.head ?? "", text: arr(s.text) })),
        notes: arr(e.data?.notes),
        index: arr(e.data?.index),
        effects: arr(e.data?.effects),
        lists: arr<GrimList>(e.data?.lists).map((l) => ({ ...l, items: arr(l.items) })),
      })),
    };
  });
}

/** Эффекты статьи без повторов, в порядке книги — строка под именем в оглавлении. */
export function articleEffects(a: GrimArticle): string[] {
  return [...new Set(a.success.flatMap((s) => s.effects))];
}

/** Подпись исхода в шапке статьи: Быстрый / Развёрнутый / По-разному. */
export function articleOutcome(a: GrimArticle): string | null {
  const keys = articleEffects(a);
  if (!keys.length) return null;
  if (keys.includes("VARIES")) return "По-разному";
  const detailed = keys.some((k) => !OUTCOMES.has(k));
  if (detailed && keys.includes("QUICK")) return "Быстрый · Развёрнутый";
  return detailed ? "Развёрнутый" : EFFECT_NAMES[keys[0]] ?? null;
}

const stem = (s: string) => norm(s).replace(/[^a-zа-я0-9]/g, "").slice(0, 4);

/** «Название» (с. N) → статья: страница N (или N−1 — статья начинается на
 *  предыдущей) и то же начало имени статьи или её подраздела. */
export function resolveRef(articles: GrimArticle[], name: string, page: number): GrimArticle | null {
  const s = stem(name);
  const near = articles.filter((a) => a.page === page || a.page === page - 1);
  return near.find((a) => a.page === page && stem(a.entry.name) === s)
    ?? near.find((a) => stem(a.entry.name) === s)
    ?? near.find((a) => a.sub && stem(a.sub) === s)
    ?? articles.find((a) => stem(a.entry.name) === s && a.page !== null && Math.abs(a.page - page) <= 2)
    ?? null;
}

/** Ссылка книги → id статьи или главы («Странствие и выживание» (с. 41)). */
export function resolveBookRef(chapters: GrimChapter[], name: string, page: number): number | null {
  const a = resolveRef(chapters.flatMap((c) => c.articles), name, page);
  if (a) return a.entry.id;
  const s = stem(name);
  return chapters.find((c) => c.page === page && stem(c.entry.name) === s)?.entry.id ?? null;
}

export interface GrimHit { article: GrimArticle; phrase: string | null; rank: number }

/** Поиск по имени, оригиналу, примерам и строкам указателя книги. */
export function searchGrimoire(articles: GrimArticle[], query: string, limit = 40): GrimHit[] {
  const q = norm(query.trim());
  if (!q) return [];
  const hits: GrimHit[] = [];
  for (const a of articles) {
    const name = norm(a.entry.name);
    if (name.startsWith(q)) { hits.push({ article: a, phrase: null, rank: 0 }); continue; }
    if (name.includes(q) || norm(a.entry.name_original).includes(q)) { hits.push({ article: a, phrase: null, rank: 1 }); continue; }
    const phrase = a.index.find((p) => norm(p).includes(q)) ?? a.examples.find((p) => norm(p).includes(q));
    if (phrase) hits.push({ article: a, phrase, rank: 2 });
  }
  return hits.sort((x, y) => x.rank - y.rank).slice(0, limit);
}

/** `*x*` Гримуара: тег, если в имени пробел или рядом сказано «тег»; иначе статус.
 *  Многословный статус пишется через дефис — показывается с пробелами. */
export function grimMark(raw: string, before: string): { kind: "status" | "tag"; name: string; tier?: string } {
  const tier = /^(.*)-(\d+)$/.exec(raw);
  if (tier) return { kind: "status", name: tier[1].replace(/-/g, " "), tier: tier[2] };
  if (raw.includes(" ") || /тег[а-я]*\s*[—:]?\s*$/i.test(before.slice(-14))) return { kind: "tag", name: raw };
  return { kind: "status", name: raw.replace(/-/g, " ") };
}

export interface GrimGive {
  statuses: { name: string; tier?: number }[];
  scratch: boolean;
  named: string[];
}

/** Что пульт умеет взять из строки Гримуара: статусы (не теги), «вычеркнуть тег», **Именованное**. */
export function grimGive(text: string): GrimGive {
  const statuses: GrimGive["statuses"] = [];
  for (const m of text.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/g)) {
    const k = grimMark(m[1], text.slice(0, m.index));
    if (k.kind === "status" && !statuses.some((s) => s.name === k.name)) statuses.push({ name: k.name, tier: k.tier ? Number(k.tier) : undefined });
  }
  return {
    statuses,
    scratch: /вычеркн[а-я]*\s+тег/i.test(text),
    named: [...text.matchAll(/\*\*([^*]+)\*\*/g)].flatMap((m) => {
      const type = namedConsequence(m[1]);
      return type ? [type.name] : [];
    }),
  };
}
