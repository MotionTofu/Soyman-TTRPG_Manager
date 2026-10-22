/**
 * Лог боя (боевой режим, шаг 4, Q15–Q16, Q67–Q79): что изменило одно действие
 * и как его отменить «разницей».
 *
 * Запись хранит не снимок, а разницу по полям: хиты −12, «+Отравленный»,
 * эффект «Порча» добавлен. Отмена применяет обратную разницу к ТЕКУЩЕМУ
 * состоянию: вернуть 12 хитов, снять именно этот эффект, — и не трогает того,
 * что случилось позже. Если обратную разницу приложить нельзя (эффект уже
 * снят, значение с тех пор поменяли), отмена отказывает с причиной.
 *
 * Модуль общий: клиент пишет записи пульта и отменяет их, сервер пишет
 * правки листов игроками (Q69) и считает «Бои вечера» (Q21).
 */

/** Чья это разница: строка очереди, лист персонажа или сама сессия (ход и раунд). */
export type LogTarget =
  | {
      t: "row";
      id: number;
      name: string;
      /** На стороне партии: персонаж, двойник, отмеченный союзник (Q79). */
      party: boolean;
      /** Хиты персонажа с листом — копия листа в строке: в текст и итоги не идут. */
      mirror?: boolean;
    }
  | { t: "sheet"; cid: number; name: string; party: boolean }
  | { t: "session"; round: number; turnName: string };

type Key = string | number;
type Item = Record<string, unknown>;

export type LogOp =
  | { path: Key[]; k: "num"; from: number; to: number; str?: boolean }
  | { path: Key[]; k: "set"; from: unknown; to: unknown }
  | { path: Key[]; k: "list"; add: string[]; del: string[] }
  | { path: Key[]; k: "items"; key: "id" | "name"; add: Item[]; del: Item[]; chg: { from: Item; to: Item }[] }
  /** Строку убрали из боя — вернуть её отменой нельзя. */
  | { path: Key[]; k: "gone" };

export interface LogChange {
  target: LogTarget;
  ops: LogOp[];
}

export type LogKind = "turn" | "event" | "sheet" | "note";

// ---------------------------------------------------------------------------
// Разница

/** Числа, которые отменяются разницей; прочие числа (инициатива, раунд) — значением. */
const NUM_PATHS = [
  "current_hp",
  "temp_hp",
  "state.uses.*",
  "state.legendaryUsed",
  "state.resistanceUsed",
  "hitPointsCurrent",
  "hitPointsTemp",
  "exhaustion",
  "deathSaveSuccesses",
  "deathSaveFailures",
  "spellSlotsUsed.*",
  "pactSlotsUsed",
  "resourceUsed.*",
];
/** Куда разница заходит внутрь объекта; остальные объекты сравниваются целиком. */
const DEEP_PATHS = ["", "state", "state.uses", "state.recharge", "spellSlotsUsed", "resourceUsed"];

function pathPattern(path: Key[]): string[] {
  const exact = path.join(".");
  const star = path.length ? [...path.slice(0, -1), "*"].join(".") : "";
  return [exact, star];
}
const matches = (path: Key[], list: string[]) => pathPattern(path).some((p) => list.includes(p));

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : null;

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isPlain(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => [k, sortKeys(v[k])])
  );
}

function itemKey(list: unknown[]): "id" | "name" | null {
  if (!list.every(isPlain)) return null;
  if (list.every((x) => typeof (x as Item).id === "string" || typeof (x as Item).id === "number")) return "id";
  if (list.every((x) => typeof (x as Item).name === "string")) return "name";
  return null;
}

/** Разница двух состояний одной цели: строка, лист или сессия как плоские объекты. */
export function diffValues(before: unknown, after: unknown, path: Key[] = []): LogOp[] {
  if (same(before, after)) return [];
  // Запас, которого ещё не тратили, хранится отсутствием ключа — это ноль.
  const zero = (v: unknown) => (v === undefined && ["state", "resourceUsed"].includes(String(path[0])) ? 0 : v);
  const a = asNum(zero(before));
  const b = asNum(zero(after));
  if (a != null && b != null && matches(path, NUM_PATHS)) {
    return [{ path, k: "num", from: a, to: b, ...(typeof after === "string" ? { str: true } : {}) }];
  }
  if (isPlain(before) && isPlain(after) && DEEP_PATHS.includes(path.join("."))) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) => diffValues(before[k], after[k], [...path, k]));
  }
  if (Array.isArray(before) && Array.isArray(after) && DEEP_PATHS.includes(path.join("."))) {
    const n = Math.max(before.length, after.length);
    return Array.from({ length: n }, (_, i) => diffValues(before[i] ?? 0, after[i] ?? 0, [...path, i])).flat();
  }
  if (Array.isArray(before ?? []) && Array.isArray(after ?? [])) {
    const x = (before ?? []) as unknown[];
    const y = (after ?? []) as unknown[];
    if ([...x, ...y].every((v) => typeof v === "string")) {
      const xs = x as string[];
      const ys = y as string[];
      return [{ path, k: "list", add: ys.filter((v) => !xs.includes(v)), del: xs.filter((v) => !ys.includes(v)) }];
    }
    const key = itemKey([...x, ...y]);
    if (key) {
      const byKey = (list: unknown[]) => new Map((list as Item[]).map((v) => [String(v[key]), v]));
      const mx = byKey(x);
      const my = byKey(y);
      const add = [...my].filter(([k]) => !mx.has(k)).map(([, v]) => v);
      const del = [...mx].filter(([k]) => !my.has(k)).map(([, v]) => v);
      const chg = [...my]
        .filter(([k, v]) => mx.has(k) && !same(mx.get(k), v))
        .map(([k, v]) => ({ from: mx.get(k)!, to: v }));
      return [{ path, k: "items", key, add, del, chg }];
    }
  }
  return [{ path, k: "set", from: before, to: after }];
}

// ---------------------------------------------------------------------------
// Отмена разницей (Q67)

export function targetKey(t: LogTarget): string {
  return t.t === "row" ? `row:${t.id}` : t.t === "sheet" ? `sheet:${t.cid}` : "session";
}

function getAt(obj: Record<string, unknown>, path: Key[]): unknown {
  let cur: unknown = obj;
  for (const k of path) cur = isPlain(cur) || Array.isArray(cur) ? (cur as Record<Key, unknown>)[k] : undefined;
  return cur;
}
function setAt(obj: Record<string, unknown>, path: Key[], value: unknown): void {
  let cur = obj as Record<Key, unknown>;
  for (const k of path.slice(0, -1)) {
    if (!isPlain(cur[k]) && !Array.isArray(cur[k])) cur[k] = typeof k === "number" ? [] : {};
    cur = cur[k] as Record<Key, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined && !Array.isArray(cur)) delete cur[last];
  else cur[last] = value;
}

const FIELD_NAMES: Record<string, string> = {
  initiative: "инициатива",
  dead: "отметка «повержен»",
  max_hp: "максимум хитов",
  concentration: "концентрация",
  concentrationCheck: "испытание концентрации",
  reactionSpent: "реакция",
  round: "ход",
  turn: "ход",
};
function fieldName(path: Key[]): string {
  const last = path.filter((k) => typeof k === "string").pop() ?? "";
  return FIELD_NAMES[String(last)] ?? String(last);
}
const nameOf = (t: LogTarget) => (t.t === "session" ? "бой" : t.name);
const itemName = (v: Item) => String(v.name ?? v.id);

export interface UndoResult {
  /** Новое состояние каждой задетой цели — писать как есть. */
  next: Map<string, { target: LogTarget; view: Record<string, unknown> }>;
  /** Почему отменить нельзя; тогда `next` пуст. */
  conflict: string | null;
}

/**
 * Обратная разница к текущему состоянию. `current` отдаёт состояние цели в
 * том же виде, в каком снималась разница, или null — цели больше нет.
 */
export function undoChanges(
  changes: LogChange[],
  current: (target: LogTarget) => Record<string, unknown> | null
): UndoResult {
  const next = new Map<string, { target: LogTarget; view: Record<string, unknown> }>();
  const fail = (conflict: string): UndoResult => ({ next: new Map(), conflict });
  for (const change of [...changes].reverse()) {
    const key = targetKey(change.target);
    if (!next.has(key)) {
      const view = current(change.target);
      if (!view) return fail(`«${nameOf(change.target)}» уже не в бою`);
      next.set(key, { target: change.target, view: JSON.parse(JSON.stringify(view)) });
    }
    const view = next.get(key)!.view;
    const who = nameOf(change.target);
    for (const op of [...change.ops].reverse()) {
      const cur = getAt(view, op.path);
      if (op.k === "gone") return fail(`«${who}» убран из боя — вернуть его отменой нельзя`);
      if (op.k === "num") {
        const n = asNum(cur === undefined && ["state", "resourceUsed"].includes(String(op.path[0])) ? 0 : cur);
        if (n == null) return fail(`${who}: ${fieldName(op.path)} — нечего отменять`);
        let res = n + (op.from - op.to);
        if (op.from >= 0 && op.to >= 0) res = Math.max(0, res);
        const max = asNum(view.max_hp);
        if (op.path[0] === "current_hp" && max != null) res = Math.min(max, res);
        setAt(view, op.path, op.str ? String(res) : res);
      } else if (op.k === "set") {
        if (!same(cur, op.to)) return fail(`${who}: ${fieldName(op.path)} с тех пор менялось`);
        setAt(view, op.path, op.from);
      } else if (op.k === "list") {
        let list = Array.isArray(cur) ? [...(cur as string[])] : [];
        list = list.filter((v) => !op.add.includes(v));
        for (const v of op.del) if (!list.includes(v)) list.push(v);
        setAt(view, op.path, list);
      } else {
        let list = Array.isArray(cur) ? [...(cur as Item[])] : [];
        const find = (v: Item) => list.findIndex((x) => isPlain(x) && String(x[op.key]) === String(v[op.key]));
        for (const c of op.chg) {
          const i = find(c.to);
          if (i < 0) return fail(`«${itemName(c.to)}» уже снято — ${who}`);
          if (!same(list[i], c.to)) return fail(`«${itemName(c.to)}» у ${who} с тех пор менялось`);
          list[i] = c.from;
        }
        for (const v of op.add) {
          const i = find(v);
          if (i < 0) return fail(`«${itemName(v)}» уже снято — ${who}`);
          list = list.filter((_, j) => j !== i);
        }
        for (const v of op.del) if (find(v) < 0) list.push(v);
        setAt(view, op.path, list);
      }
    }
  }
  return { next, conflict: null };
}

// ---------------------------------------------------------------------------
// Текст строки (Q71)

function signed(d: number): string {
  return d < 0 ? `−${-d}` : `+${d}`;
}
function durationText(e: Item): string {
  if (typeof e.rounds === "number") return `${e.rounds} р.`;
  if (e.until === "rest") return "до отдыха";
  if (e.until === "combat" || e.until == null) return "до конца боя";
  return "до конца хода";
}

export interface DescribeOptions {
  /** Имя запаса умения по ключу листа; без него — «запас умения». */
  poolName?: (key: string) => string | null;
}

/** Строка лога из разницы: заголовок и, для хода, что сделало его начало. */
export function describeChanges(
  changes: LogChange[],
  label: string,
  options: DescribeOptions = {}
): { kind: LogKind; round: number | null; text: string; sub: string } {
  const session = changes.find((c) => c.target.t === "session" && c.ops.some((o) => o.path[0] === "turn"));
  const turn = session?.target.t === "session" ? session.target : null;
  const parts: string[] = [];
  const quiet: string[] = [];
  const effectsOn = new Map<string, string[]>();
  const effectsOff = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, what: string, who: string) => {
    const list = map.get(what) ?? [];
    if (!list.includes(who)) list.push(who);
    map.set(what, list);
  };

  for (const { target, ops } of changes) {
    if (target.t === "session") continue;
    const n = target.name;
    const touchedEffects = ops.some((o) => o.path[0] === "state" && o.path[1] === "effects");
    const out = (s: string) => parts.push(s);
    for (const op of ops) {
      const p = op.path.map(String);
      const f = p[0] === "state" ? `state.${p[1]}` : p[0];
      if (op.k === "gone") {
        out(`«${n}» убран из боя`);
        continue;
      }
      if (op.k === "num") {
        const d = op.to - op.from;
        if ((f === "current_hp" && !(target.t === "row" && target.mirror)) || f === "hitPointsCurrent")
          out(`${n} ${signed(d)} (${op.from} → ${op.to})`);
        else if (f === "temp_hp" ? !(target.t === "row" && target.mirror) : f === "hitPointsTemp")
          out(`${n}: временные ${op.from} → ${op.to}`);
        else if (f === "state.uses") out(`${n}: ${p[2]} — потрачено ${op.to}`);
        else if (f === "state.legendaryUsed") (op.to ? out : (s: string) => quiet.push(s))(`${n}: легендарные очки — потрачено ${op.to}`);
        else if (f === "state.resistanceUsed") out(`${n}: легендарная устойчивость — потрачено ${op.to}`);
        else if (f === "exhaustion") out(`${n}: истощение ${op.from} → ${op.to}`);
        else if (f === "deathSaveSuccesses") out(`${n}: спасброски от смерти — успехов ${op.to}`);
        else if (f === "deathSaveFailures") out(`${n}: спасброски от смерти — провалов ${op.to}`);
        else if (f === "spellSlotsUsed") out(`${n}: ячейки ${Number(p[1]) + 1} круга — потрачено ${op.from} → ${op.to}`);
        else if (f === "pactSlotsUsed") out(`${n}: ячейки договора — потрачено ${op.from} → ${op.to}`);
        else if (f === "resourceUsed") out(`${n}: ${options.poolName?.(p[1]) ?? "запас умения"} — потрачено ${op.from} → ${op.to}`);
        continue;
      }
      if (op.k === "list") {
        if (f === "conditions") {
          const what = [...op.add.map((c) => `+${c}`), ...op.del.map((c) => `−${c}`)].join(", ");
          if (what) out(`${n}: ${what}`);
        }
        continue;
      }
      if (op.k === "items") {
        if (f === "state.effects") {
          for (const e of op.add) {
            const caster = typeof e.casterName === "string" ? `${e.casterName}: ` : "";
            push(effectsOn, `${caster}«${itemName(e)}» · ${durationText(e)}`, n);
          }
          for (const e of op.del) push(effectsOff, `«${itemName(e)}»`, n);
          for (const c of op.chg) {
            if (typeof c.from.rounds === "number" && typeof c.to.rounds === "number" && c.from.rounds !== c.to.rounds)
              quiet.push(`${itemName(c.to)} у ${n}: ${c.from.rounds} → ${c.to.rounds} р.`);
          }
        } else if (f === "state.counters") {
          for (const c of op.chg) out(`${n}: ${itemName(c.to)} — осталось ${Number(c.to.max) - Number(c.to.used)} из ${c.to.max}`);
          for (const c of op.add) out(`${n}: счётчик «${itemName(c)}»`);
          for (const c of op.del) out(`${n}: счётчик «${itemName(c)}» убран`);
        } else if (f === "receivedSpells" && !touchedEffects) {
          for (const c of op.add) out(`${n}: «${itemName(c)}» на листе`);
          for (const c of op.del) out(`${n}: «${itemName(c)}» снято с листа`);
        }
        continue;
      }
      // set
      if (f === "dead") out(op.to ? `${n} повержен` : `${n} вернулся в бой`);
      else if (f === "initiative") out(`${n}: инициатива ${op.to ?? "—"}`);
      else if (f === "max_hp" && !(target.t === "row" && target.mirror)) out(`${n}: максимум хитов ${op.from ?? "—"} → ${op.to ?? "—"}`);
      else if (f === "state.concentration" || f === "concentration") {
        if (op.from && !op.to) out(`${n}: концентрация на «${op.from}» сорвалась`);
      } else if (f === "state.concentrationCheck") {
        if (typeof op.to === "number") out(`${n}: испытание концентрации, СЛ ${op.to}`);
        else if (!ops.some((o) => o.path[0] === "state" && o.path[1] === "concentration") && !touchedEffects)
          out(`${n}: концентрация удержана`);
      } else if (f === "state.reactionSpent") {
        if (op.to) out(`${n}: реакция`);
      } else if (f === "state.recharge") {
        const r = isPlain(op.to) ? op.to : null;
        if (r && typeof r.roll === "number" && !same(isPlain(op.from) ? op.from.roll : null, r.roll))
          (turn ? (s: string) => quiet.push(s) : out)(`${n}: ${p[2]} — к6 = ${r.roll}, ${r.ready ? "готово" : "не готово"}`);
        else if (r && !r.ready) out(`${n}: ${p[2]} — потрачено`);
      } else if (f === "state.ally") out(op.to ? `${n} — на стороне партии` : `${n} — не на стороне партии`);
      else if (f === "state.inLair") out(op.to ? `${n}: бой в логове` : `${n}: бой не в логове`);
      else if (f === "state.note") out(`${n}: заметка`);
    }
  }

  const on = [...effectsOn].map(([what, who]) => {
    const [head, dur] = what.split(" · ");
    return `${head} → ${who.join(", ")} · ${dur}`;
  });
  const off = [...effectsOff].map(([what, who]) => `${what} снято — ${who.join(", ")}`);

  if (turn) {
    return {
      kind: "turn",
      round: turn.round,
      text: `Раунд ${turn.round} · ход ${turn.turnName}`,
      sub: [...quiet, ...off.map((s) => `закончилось: ${s}`), ...on, ...parts].join("; "),
    };
  }
  const all = [...on, ...off, ...parts];
  return { kind: "event", round: null, text: all.length ? all.join("; ") : label, sub: "" };
}

// ---------------------------------------------------------------------------
// Итоги боя (Q21, Q79)

export interface BattleLine {
  changes: LogChange[];
  undone: boolean;
}

/** Урон по сторонам и повергнутые — из неотменённых строк. */
export function battleStats(lines: BattleLine[]): { dealt: number; taken: number; defeated: string[] } {
  let dealt = 0;
  let taken = 0;
  const down = new Map<string, boolean>();
  for (const line of lines) {
    if (line.undone) continue;
    for (const { target, ops } of line.changes) {
      if (target.t === "session") continue;
      if (target.t === "row" && target.mirror) continue;
      for (const op of ops) {
        const f = String(op.path[0]);
        if (op.k === "num" && ["current_hp", "temp_hp", "hitPointsCurrent", "hitPointsTemp"].includes(f) && op.from > op.to) {
          if (target.party) taken += op.from - op.to;
          else dealt += op.from - op.to;
        }
        if (op.k === "set" && f === "dead" && !target.party) down.set(target.name, !!op.to);
      }
    }
  }
  return { dealt, taken, defeated: [...down].filter(([, d]) => d).map(([n]) => n) };
}
