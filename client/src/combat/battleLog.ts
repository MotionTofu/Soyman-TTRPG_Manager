import { normalizeDndCharacter } from "@shared/dnd/normalize";
import {
  describeChanges,
  diffValues,
  undoChanges,
  type LogChange,
  type LogKind,
  type LogTarget,
} from "@shared/battleLog";
import { write } from "../data/hooks";
import { afterWriteAnywhere, readResource } from "../data/imperative";
import { showSaveError } from "../data/notices";
import { statblockAffects, statblockListPath } from "../data/statblocks";
import type { DndCharacterData, InitiativeEntry, SessionDetail, Statblock } from "../types";
import { parseConditions, parseNestState } from "./nestState";
import { setEndedEffects } from "./combatModeStore";

/**
 * Лог боя на клиенте (шаг 4): пульт снимает разницу каждого своего действия,
 * склеивает действия одного жеста в строку и отменяет строку разницей
 * (shared/battleLog.ts). Строки правок листа игроками пишет сервер.
 */

export interface BattleInfo {
  id: number;
  name: string;
  seconds: number;
  running_since: string | null;
  log_count: number;
  carried_from: number | null;
  carry_target: { id: number; number: number; date: string } | null;
}

export interface BattleLogLine {
  id: number;
  battle_id: number;
  session_id: number;
  round: number;
  kind: LogKind;
  text: string;
  sub: string;
  changes: LogChange[];
  author: string;
  undone: boolean;
  blocked: string;
  created_at: string;
}

export interface BattleSummary {
  id: number;
  name: string;
  ended: boolean;
  rounds: number;
  spans: { session_id: number; number: number; minutes: number }[];
  carried_from: number | null;
  carried_to: number | null;
  carry_pending: boolean;
  dealt: number;
  taken: number;
  defeated: string[];
}

export const battlePath = (sessionId: number) => `/sessions/${sessionId}/battle`;
export const battleLogPath = (battleId: number) => `/battles/${battleId}/log`;
export const sessionBattlesPath = (sessionId: number) => `/sessions/${sessionId}/battles`;
const entriesPath = (sessionId: number) => `/initiative-entries?session_id=${sessionId}`;

/** Сколько последних строк можно отменить (Q16). */
const UNDO_DEPTH = 20;
/**
 * Действия одного жеста (урон → срыв концентрации → копия хитов в строке)
 * приходят вразнобой за доли секунды — они склеиваются в одну строку.
 *
 * ponytail: склейка по времени, а не по жесту: правка листа, которая ждёт
 * свежего чтения дольше окна (медленная сеть), уйдёт отдельной строкой. Если
 * это начнёт путать — передавать id жеста через действия гнезда.
 */
const GROUP_MS = 350;

// ---------------------------------------------------------------------------
// Разница

const dead = (e: InitiativeEntry) => e.dead === true || e.dead === 1;

/** Строка очереди как плоский объект — в этом виде снимается и отменяется разница. */
export function rowView(e: InitiativeEntry): Record<string, unknown> {
  return {
    current_hp: e.current_hp,
    temp_hp: e.temp_hp,
    max_hp: e.max_hp,
    initiative: e.initiative,
    dead: dead(e),
    conditions: parseConditions(e.conditions),
    state: parseNestState(e),
  };
}

function rowTarget(e: InitiativeEntry): LogTarget {
  const state = parseNestState(e);
  return {
    t: "row",
    id: e.id,
    name: e.name,
    party: e.entity_type === "character" || !!state.ally,
    mirror: e.entity_type === "character" && e.entity_id != null && !state.double,
  };
}

export function rowChanges(before: InitiativeEntry[], after: InitiativeEntry[]): LogChange[] {
  const out: LogChange[] = [];
  for (const b of before) {
    const a = after.find((e) => e.id === b.id);
    if (!a) {
      out.push({ target: rowTarget(b), ops: [{ path: [], k: "gone" }] });
      continue;
    }
    const ops = diffValues(rowView(b), rowView(a));
    if (ops.length) out.push({ target: rowTarget(a), ops });
  }
  return out;
}

export function sheetChanges(
  characterId: number,
  name: string,
  before: DndCharacterData,
  patch: Partial<DndCharacterData>
): LogChange[] {
  const keys = Object.keys(patch) as (keyof DndCharacterData)[];
  const pick = (d: Partial<DndCharacterData>) => Object.fromEntries(keys.map((k) => [k, d[k]]));
  const ops = diffValues(pick(before), pick({ ...before, ...patch }));
  return ops.length ? [{ target: { t: "sheet", cid: characterId, name, party: true }, ops }] : [];
}

export function sessionChanges(
  before: { round: number; turn: number | null },
  after: { round: number; turn: number | null },
  turnName: string
): LogChange[] {
  const ops = diffValues(before, after);
  return ops.length ? [{ target: { t: "session", round: after.round, turnName }, ops }] : [];
}

// ---------------------------------------------------------------------------
// Запись

/** Идущий бой сессии — его держит useCombat; без него действия не пишутся. */
const contexts = new Map<number, { battleId: number; round: number }>();

export function setBattleContext(sessionId: number, ctx: { battleId: number; round: number } | null): void {
  if (ctx) contexts.set(sessionId, ctx);
  else contexts.delete(sessionId);
}

interface Pending {
  battleId: number;
  round: number;
  label: string;
  changes: LogChange[];
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<number, Pending>();

export function recordChanges(sessionId: number, label: string, changes: LogChange[]): void {
  const ctx = contexts.get(sessionId);
  if (!ctx || !changes.length) return;
  let p = pending.get(sessionId);
  if (p && p.battleId !== ctx.battleId) {
    void flushBattleLog(sessionId);
    p = undefined;
  }
  if (!p) {
    p = {
      battleId: ctx.battleId,
      round: ctx.round,
      label,
      changes: [],
      timer: setTimeout(() => void flushBattleLog(sessionId), GROUP_MS),
    };
    pending.set(sessionId, p);
  }
  p.changes.push(...changes);
}

function affects(sessionId: number, battleId: number) {
  return [{ path: `/battles/${battleId}` }, { path: battlePath(sessionId) }];
}

async function post(sessionId: number, battleId: number, body: Record<string, unknown>): Promise<void> {
  try {
    await write.post(`/battles/${battleId}/log`, { session_id: sessionId, ...body });
    afterWriteAnywhere(affects(sessionId, battleId));
  } catch (error) {
    showSaveError(`Строка лога боя — ${error instanceof Error ? error.message : String(error)}`, () =>
      post(sessionId, battleId, body)
    );
  }
}

export async function flushBattleLog(sessionId: number): Promise<void> {
  const p = pending.get(sessionId);
  if (!p) return;
  pending.delete(sessionId);
  clearTimeout(p.timer);
  const d = describeChanges(p.changes, p.label);
  // Одна копия хитов персонажа в строке (её запись отстала от листа) — не событие.
  const mirrorOnly = p.changes.every((c) => c.target.t === "row" && c.target.mirror);
  if (d.kind === "event" && d.text === p.label && mirrorOnly) return;
  await post(sessionId, p.battleId, { round: d.round ?? p.round, kind: d.kind, text: d.text, sub: d.sub, changes: p.changes });
}

/** Строка без разницы: бойца поставили в бой (отменяется не здесь, а «Убрать из боя»). */
export function recordNote(sessionId: number, text: string): void {
  const ctx = contexts.get(sessionId);
  if (!ctx) return;
  void flushBattleLog(sessionId).then(() => post(sessionId, ctx.battleId, { round: ctx.round, kind: "note", text }));
}

// ---------------------------------------------------------------------------
// Отмена (Q16, Q67, Q68)

/** Какие строки можно отменить: последние ~20 действий пульта, из ходов — только последний. */
export function undoableIds(lines: BattleLogLine[]): Set<number> {
  const lastTurn = lastLiveTurn(lines);
  return new Set(
    lines
      .slice(-UNDO_DEPTH)
      .filter(
        (l) =>
          !l.undone &&
          !l.blocked &&
          l.changes.length > 0 &&
          (l.kind === "event" || (l.kind === "turn" && l.id === lastTurn?.id))
      )
      .map((l) => l.id)
  );
}

export function lastLiveTurn(lines: BattleLogLine[]): BattleLogLine | undefined {
  return [...lines].reverse().find((l) => l.kind === "turn" && !l.undone);
}

function parseSheet(sb: Statblock): DndCharacterData {
  try {
    return normalizeDndCharacter(JSON.parse(sb.content || "{}"));
  } catch {
    return normalizeDndCharacter({});
  }
}

/**
 * Отменить строку: обратная разница к свежему состоянию строк, листов и хода.
 * Нельзя — строка получает причину («уже не отменить: …»), ничего не пишется.
 * Возвращает причину или null.
 */
export async function undoLine(sessionId: number, line: BattleLogLine): Promise<string | null> {
  await flushBattleLog(sessionId);
  const rows = await readResource<InitiativeEntry[]>(entriesPath(sessionId), { fresh: true });
  const session = await readResource<SessionDetail>(`/sessions/${sessionId}`, { fresh: true });
  const sheets = new Map<number, Statblock>();
  for (const c of line.changes) {
    if (c.target.t !== "sheet" || sheets.has(c.target.cid)) continue;
    const list = await readResource<Statblock[]>(statblockListPath("character", c.target.cid), { fresh: true });
    const sb = list.find((s) => s.format === "dnd_character");
    if (sb) sheets.set(c.target.cid, sb);
  }
  const res = undoChanges(line.changes, (t) => {
    if (t.t === "session") return { round: session.combat_round, turn: session.combat_turn_entry_id };
    if (t.t === "row") {
      const e = rows.find((r) => r.id === t.id);
      return e ? rowView(e) : null;
    }
    const sb = sheets.get(t.cid);
    return sb ? (parseSheet(sb) as unknown as Record<string, unknown>) : null;
  });
  const mark = (body: Record<string, unknown>) =>
    write.put(`/battles/log/${line.id}`, body).then(() => afterWriteAnywhere(affects(sessionId, line.battle_id)));
  if (res.conflict) {
    await mark({ blocked: `уже не отменить: ${res.conflict}` });
    return res.conflict;
  }
  try {
    for (const { target, view } of res.next.values()) {
      if (target.t === "row") {
        const e = rows.find((r) => r.id === target.id)!;
        const was = rowView(e);
        const body: Record<string, unknown> = {};
        for (const k of Object.keys(view)) if (JSON.stringify(view[k]) !== JSON.stringify(was[k])) body[k] = view[k];
        if (Object.keys(body).length) await write.put(`/initiative-entries/${target.id}`, body);
      } else if (target.t === "session") {
        await write.put(`/sessions/${sessionId}/combat`, { active: true, turn_entry_id: view.turn, round: view.round });
        setEndedEffects(sessionId, []);
      } else {
        const sb = sheets.get(target.cid)!;
        const was = parseSheet(sb) as unknown as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(view)) if (JSON.stringify(view[k]) !== JSON.stringify(was[k])) patch[k] = view[k];
        if (Object.keys(patch).length) {
          await write.put(`/statblocks/${sb.id}`, { contentPatch: patch, combat: true });
          afterWriteAnywhere(statblockAffects("character", target.cid));
        }
      }
    }
    await mark({ undone: true });
  } finally {
    afterWriteAnywhere([{ path: entriesPath(sessionId) }, { kind: "session", id: sessionId, card: true }]);
  }
  return null;
}
