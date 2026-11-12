/** Общая лавка LitM (пачка 5, доска Litm-Store): рюкзак по категориям, Монеты, Награды Рассказчика. */
import type { CompendiumEntry } from "../../types";
import { norm, paras } from "./litmBookText";

export interface StoreItem { name: string; nameEn: string; note: string; noteEn: string }
/** Подгруппа категории («Лёгкая броня», «Щиты»); у большинства категорий одна безымянная. */
export interface StoreSub { name: string; nameEn: string; text: string; items: StoreItem[] }
export interface StoreCategory { entry: CompendiumEntry; page: string; tail: string; subs: StoreSub[] }
export interface RewardGroup { name: string; nameEn: string; items: { name: string; nameEn: string }[] }
/** Награды: вводный абзац, части «**Заголовок.** текст» и шесть групп примеров. */
export interface Rewards { entry: CompendiumEntry; page: string; lead: string[]; parts: { head: string; text: string }[]; groups: RewardGroup[] }
export interface StoreBook { intro: CompendiumEntry | null; categories: StoreCategory[]; coin: StoreCategory | null; rewards: Rewards | null }

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const byPos = (a: CompendiumEntry, b: CompendiumEntry) => a.position - b.position || a.id - b.id;

function category(e: CompendiumEntry): StoreCategory {
  const items = arr<Record<string, unknown>>(e.data?.items).map((i) => ({
    name: str(i.name), nameEn: str(i.nameEn), note: str(i.note), noteEn: str(i.noteEn), group: str(i.group),
  })).filter((i) => i.name);
  const declared = arr<Record<string, unknown>>(e.data?.subgroups).map((s) => ({ name: str(s.name), nameEn: str(s.nameEn), text: str(s.text) }));
  const names = [...new Set([...declared.map((s) => s.name), ...items.map((i) => i.group)])];
  const subs = names.map((name) => ({
    ...(declared.find((s) => s.name === name) ?? { name, nameEn: "", text: "" }),
    items: items.filter((i) => i.group === name).map((i) => ({ name: i.name, nameEn: i.nameEn, note: i.note, noteEn: i.noteEn })),
  })).filter((s) => s.items.length);
  return { entry: e, page: str(e.data?.page), tail: str(e.data?.tail), subs };
}

function rewardsOf(e: CompendiumEntry): Rewards {
  const lead: string[] = [];
  const parts: Rewards["parts"] = [];
  for (const p of paras(e.description ?? "")) {
    const m = /^\*\*(.+?)\.?\*\*\s*([\s\S]*)$/.exec(p);
    if (m) parts.push({ head: m[1], text: m[2] }); else lead.push(p);
  }
  const groups = arr<Record<string, unknown>>(e.data?.groups).map((g) => ({
    name: str(g.name), nameEn: str(g.nameEn),
    items: arr<Record<string, unknown>>(g.items).map((i) => ({ name: str(i.name), nameEn: str(i.nameEn) })).filter((i) => i.name),
  }));
  return { entry: e, page: str(e.data?.page), lead, parts, groups };
}

/** Записи раздела в порядке книги: шапка «Рюкзак», категории, Монеты, Награды. */
export function storeOf(entries: CompendiumEntry[]): StoreBook {
  const all = [...entries].sort(byPos);
  const cats = all.filter((e) => e.kind === "mechanic_backpack_category_item").map(category);
  const groups = all.filter((e) => e.kind === "mechanic_group");
  const rewards = groups.find((e) => Array.isArray(e.data?.groups));
  return {
    intro: groups.find((e) => e !== rewards) ?? null,
    categories: cats.filter((c) => c.entry.data?.category_key !== "coin"),
    coin: cats.find((c) => c.entry.data?.category_key === "coin") ?? null,
    rewards: rewards ? rewardsOf(rewards) : null,
  };
}

/** Поиск по предметам: имя по-русски и в книге, пояснение. Совпало имя категории — она вся. */
export function filterStore(book: StoreBook, query: string): StoreBook {
  const q = norm(query.trim());
  if (!q) return book;
  const has = (...s: string[]) => s.some((x) => norm(x).includes(q));
  const cats = book.categories.map((c) => has(c.entry.name, c.entry.name_original ?? "") ? c : {
    ...c, subs: c.subs.map((s) => ({ ...s, items: s.items.filter((i) => has(i.name, i.nameEn, i.note)) })).filter((s) => s.items.length),
  }).filter((c) => c.subs.length);
  const rewards = book.rewards && {
    ...book.rewards,
    groups: book.rewards.groups.map((g) => has(g.name, g.nameEn) ? g : { ...g, items: g.items.filter((i) => has(i.name, i.nameEn)) }).filter((g) => g.items.length),
  };
  return { ...book, categories: cats, coin: book.coin && has(book.coin.entry.name, book.coin.entry.description ?? "") ? book.coin : null, rewards };
}
