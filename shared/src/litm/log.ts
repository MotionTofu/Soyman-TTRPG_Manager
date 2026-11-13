/**
 * Лог режима «Вызовы» LitM (Backlog Д33, Q15): в каком виде строка расклада
 * и лист героя снимают разницу для лога боя (battleLog.ts), что пишется
 * строкой лога, и «Вызовы вечера» — итоги, пересчитанные из неотменённых строк.
 */
import type { BattleLine, LogChange, LogOp } from "../battleLog";
import { limitReached, type LitmLimitState } from "./conflict";
import { statusTier, type LitmStatus } from "./status";

/** Тема листа — ровно то, что лог трогает: имя и вычеркнутые теги. */
interface ThemeLike {
  scratchedTags?: string[];
}
export interface LitmSheetLike {
  statuses?: LitmStatus[];
  backpack?: string[];
  themes: ThemeLike[];
  storyThemes: ThemeLike[];
  fellowshipTheme: ThemeLike;
}

/** Вид листа для разницы: статусы и вычеркнутое плоским списком «тема/номер/тег». */
export interface LitmSheetView {
  statuses: LitmStatus[];
  backpack: string[];
  scratched: string[];
}

export function sheetView(d: LitmSheetLike): LitmSheetView {
  const marks = (kind: string, list: ThemeLike[]) => list.flatMap((t, i) => (t.scratchedTags ?? []).map((tag) => `${kind}/${i}/${tag}`));
  return {
    statuses: d.statuses ?? [],
    backpack: d.backpack ?? [],
    scratched: [...marks("themes", d.themes), ...marks("storyThemes", d.storyThemes), ...marks("fellowshipTheme", [d.fellowshipTheme])],
  };
}

/** Обратно в поля листа — для отмены: статусы и вычеркнутое каждой темы. */
export function sheetFromView<T extends LitmSheetLike>(d: T, view: LitmSheetView): Pick<T, "statuses" | "backpack" | "themes" | "storyThemes" | "fellowshipTheme"> {
  const of = (kind: string, i: number) =>
    view.scratched.filter((s) => s.startsWith(`${kind}/${i}/`)).map((s) => s.slice(`${kind}/${i}/`.length));
  return {
    statuses: view.statuses,
    backpack: view.backpack,
    themes: d.themes.map((t, i) => ({ ...t, scratchedTags: of("themes", i) })),
    storyThemes: d.storyThemes.map((t, i) => ({ ...t, scratchedTags: of("storyThemes", i) })),
    fellowshipTheme: { ...d.fellowshipTheme, scratchedTags: of("fellowshipTheme", 0) },
  } as Pick<T, "statuses" | "backpack" | "themes" | "storyThemes" | "fellowshipTheme">;
}

type Item = Record<string, unknown>;
const tierText = (s: Item) => `${String(s.name)}-${statusTier((s.marks as number[]) ?? [])}`;
const limitText = (l: Item) => `${String(l.name)} ${statusTier((l.marks as number[]) ?? [])}/${l.max ?? "—"}`;

/** Строка лога из разницы: «Воин: +ранен-2», «Домовой: Изгнать 2/3». Пусто — сказать нечего. */
export function describeLitm(changes: LogChange[]): string {
  const parts: string[] = [];
  for (const { target, ops } of changes) {
    if (target.t === "session") continue;
    const who = target.name;
    const say = (s: string) => parts.push(`${who}: ${s}`);
    for (const op of ops) {
      const at = op.path.join(".");
      if (op.k === "gone") say("убран с ленты");
      else if (op.k === "items" && (at === "statuses" || at === "state.statuses")) {
        for (const s of op.add) say(`+${tierText(s)}`);
        for (const c of op.chg) say(`${tierText(c.from)} → ${tierText(c.to)}`);
        for (const s of op.del) say(`снят ${String(s.name)}`);
      } else if (op.k === "items" && (at === "state.limits" || at === "state.progress")) {
        for (const c of op.chg) say(limitText(c.to));
        for (const l of op.add) say(`+ ${String(l.name)}`);
        for (const l of op.del) say(`− ${String(l.name)}`);
      } else if (op.k === "items" && at === "state.tags") {
        for (const t of op.add) say(`+тег «${String(t.name)}»`);
        for (const t of op.del) say(`снят тег «${String(t.name)}»`);
      } else if (op.k === "list" && at === "scratched") {
        const tag = (s: string) => s.split("/").slice(2).join("/");
        for (const s of op.add) say(`вычеркнут «${tag(s)}»`);
        for (const s of op.del) say(`вернулся «${tag(s)}»`);
      } else if (op.k === "list" && at === "backpack") {
        for (const s of op.add) say(`+тег «${s}»`);
        for (const s of op.del) say(`снят тег «${s}»`);
      } else if (op.k === "set" && at === "state.declaredThreat") {
        say(op.to == null ? "угроза разрешена" : "угроза объявлена");
      } else if (op.k === "set" && at === "state.guardLost") {
        say(op.to ? "утрачено «Под охраной»" : "восстановлено «Под охраной»");
      }
    }
  }
  return parts.join("; ");
}

function applyItems(map: Map<string, Item>, op: Extract<LogOp, { k: "items" }>): void {
  for (const v of op.del) map.delete(String(v.name));
  for (const v of op.add) map.set(String(v.name), v);
  for (const c of op.chg) map.set(String(c.to.name), c.to);
}

const spotCurrent = (v: unknown): number | null => {
  const c = v && typeof v === "object" ? (v as { current?: unknown }).current : null;
  return typeof c === "number" ? c : null;
};

export interface LitmBattleStats {
  /** Кто чем преодолён: вызов и предел, достигнутый без ↻. */
  overcome: { name: string; by: string }[];
  /** Статусы, которые герои получили за вечер, — как они стоят к концу. */
  statuses: { cid: number; name: string; list: string[] }[];
  /** Сколько раз спотлайт приходил к герою — ключ id персонажа. */
  spotlight: Record<string, number>;
}

/** «Вызовы вечера» (Q15) из неотменённых строк лога. */
export function litmStats(lines: BattleLine[]): LitmBattleStats {
  const rows = new Map<number, { name: string; limits: Map<string, Item> }>();
  const heroes = new Map<number, { name: string; statuses: Map<string, Item> }>();
  const spotlight: Record<string, number> = {};
  for (const line of lines) {
    if (line.undone) continue;
    for (const { target, ops } of line.changes) {
      for (const op of ops) {
        const at = op.path.join(".");
        if (target.t === "row" && op.k === "items" && at === "state.limits") {
          const r = rows.get(target.id) ?? { name: target.name, limits: new Map() };
          applyItems(r.limits, op);
          rows.set(target.id, r);
        } else if (target.t === "row" && op.k === "set" && at === "state.spotlight") {
          const to = spotCurrent(op.to);
          if (to != null && to !== spotCurrent(op.from)) spotlight[to] = (spotlight[to] ?? 0) + 1;
        } else if (target.t === "sheet" && op.k === "items" && at === "statuses") {
          const h = heroes.get(target.cid) ?? { name: target.name, statuses: new Map() };
          applyItems(h.statuses, op);
          heroes.set(target.cid, h);
        }
      }
    }
  }
  const overcome = [...rows.values()].flatMap((r) => {
    const hit = [...r.limits.values()].find((l) => !l.turns && limitReached(l as unknown as LitmLimitState));
    return hit ? [{ name: r.name, by: String(hit.name) }] : [];
  });
  const statuses = [...heroes]
    .map(([cid, h]) => ({ cid, name: h.name, list: [...h.statuses.values()].filter((s) => statusTier((s.marks as number[]) ?? []) > 0).map(tierText) }))
    .filter((h) => h.list.length);
  return { overcome, statuses, spotlight };
}
