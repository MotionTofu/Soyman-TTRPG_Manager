import { useEffect } from "react";
import { diffValues, undoChanges, type LogChange } from "@shared/battleLog";
import { LITM_SCENE_KIND, parseChallengeState, parseSceneState } from "@shared/litm/conflict";
import { describeLitm, sheetFromView, sheetView, type LitmSheetView } from "@shared/litm/log";
import { useEntity, useResource, write } from "../../../data/hooks";
import { afterWriteAnywhere, readResource } from "../../../data/imperative";
import { statblockAffects, statblockListPath } from "../../../data/statblocks";
import {
  battleLogPath,
  battlePath,
  flushBattleLog,
  hasBattleContext,
  recordChanges,
  recordNote,
  sessionBattlesPath,
  setBattleContext,
  type BattleInfo,
  type BattleLogLine,
} from "../../../combat/battleLog";
import { setCombatModeOpen } from "../../../combat/combatModeStore";
import { initiativePath } from "../../../combat/useCombat";
import type { InitiativeEntry, LitMCharacterData, SessionDetail, Statblock } from "../../../types";
import { normalizeCharacter } from "../LitMCharacterForm";

/**
 * Лог режима «Вызовы» (Д33, Q15) поверх лога боя D&D: тот же бой сессии,
 * строки с разницей, отмена разницей. Конфликт заводится сам первым действием
 * идущей сессии — «Старт» в LitM нет; до начала сессии (подготовка) лог молчит.
 * Передача спотлайта — строка-«ход»: «Назад» отменяет последнюю.
 */

const NO_LINES: BattleLogLine[] = [];
const live = new Map<number, boolean>();
const opening = new Map<number, Promise<void>>();

async function ensureBattle(sessionId: number): Promise<boolean> {
  if (hasBattleContext(sessionId)) return true;
  if (!live.get(sessionId)) return false;
  let p = opening.get(sessionId);
  if (!p) {
    p = write
      .put<SessionDetail>(`/sessions/${sessionId}/combat`, { active: true, turn_entry_id: null, round: 1 })
      .then((s) => {
        if (s?.combat_battle_id) setBattleContext(sessionId, { battleId: s.combat_battle_id, round: 1 });
        afterWriteAnywhere([{ kind: "session", id: sessionId, card: true }]);
      })
      .catch(() => undefined)
      .finally(() => opening.delete(sessionId));
    opening.set(sessionId, p);
  }
  await p;
  return hasBattleContext(sessionId);
}

/** Действие пульта — в лог; `turn` — передача спотлайта. */
export function logLitm(sessionId: number, label: string, changes: LogChange[], turn = false): void {
  if (!changes.length) return;
  void ensureBattle(sessionId).then((ok) => {
    if (ok) recordChanges(sessionId, label, changes, { turn, describe: describeLitm });
  });
}

/** Строка без разницы — именованное последствие (**Разоблачение**, Q12): не отменяется. */
export function noteLitm(sessionId: number, text: string): void {
  void ensureBattle(sessionId).then((ok) => {
    if (ok) recordNote(sessionId, text);
  });
}

function rowState(row: InitiativeEntry): unknown {
  return row.kind === LITM_SCENE_KIND ? parseSceneState(row.state) : parseChallengeState(row.state);
}

export function rowChange(row: InitiativeEntry, next: unknown): LogChange[] {
  const ops = diffValues({ state: rowState(row) }, { state: next });
  return ops.length ? [{ target: { t: "row", id: row.id, name: row.name, party: false }, ops }] : [];
}

export function sheetChange(cid: number, name: string, before: LitMCharacterData, after: LitMCharacterData): LogChange[] {
  const ops = diffValues(sheetView(before), sheetView(after));
  return ops.length ? [{ target: { t: "sheet", cid, name, party: true }, ops }] : [];
}

function parseSheet(sb: Statblock): LitMCharacterData {
  try {
    return normalizeCharacter(JSON.parse(sb.content || "{}"));
  } catch {
    return normalizeCharacter({});
  }
}

/** Отменить строку: обратная разница к свежим строкам ленты и листам героев. Нельзя — причина. */
export async function undoLitmLine(sessionId: number, line: BattleLogLine): Promise<string | null> {
  await flushBattleLog(sessionId);
  if (line.author === "litm-compound") {
    const result = await write.post<{ conflict: string | null; characterIds: number[] }>(`/battles/log/${line.id}/litm-undo`, {});
    afterWriteAnywhere([
      { path: initiativePath(sessionId) }, { path: battleLogPath(line.battle_id) }, { path: battlePath(sessionId) },
      ...result.characterIds.flatMap((id) => statblockAffects("character", id)),
    ]);
    return result.conflict;
  }
  const rows = await readResource<InitiativeEntry[]>(initiativePath(sessionId), { fresh: true });
  const sheets = new Map<number, Statblock>();
  for (const c of line.changes) {
    if (c.target.t !== "sheet" || sheets.has(c.target.cid)) continue;
    const list = await readResource<Statblock[]>(statblockListPath("character", c.target.cid), { fresh: true });
    const sb = list.find((s) => s.format === "litm_character");
    if (sb) sheets.set(c.target.cid, sb);
  }
  const res = undoChanges(line.changes, (t) => {
    if (t.t === "row") {
      const e = rows.find((r) => r.id === t.id);
      return e ? { state: rowState(e) } : null;
    }
    const sb = t.t === "sheet" ? sheets.get(t.cid) : undefined;
    return sb ? (sheetView(parseSheet(sb)) as unknown as Record<string, unknown>) : null;
  });
  const mark = (body: Record<string, unknown>) =>
    write.put(`/battles/log/${line.id}`, body).then(() => afterWriteAnywhere([{ path: `/battles/${line.battle_id}` }, { path: battlePath(sessionId) }]));
  if (res.conflict) {
    await mark({ blocked: `уже не отменить: ${res.conflict}` });
    return res.conflict;
  }
  try {
    for (const { target, view } of res.next.values()) {
      if (target.t === "row") await write.put(`/initiative-entries/${target.id}`, { state: view.state });
      else if (target.t === "sheet") {
        const sb = sheets.get(target.cid)!;
        await write.put(`/statblocks/${sb.id}`, { contentPatch: sheetFromView(parseSheet(sb), view as unknown as LitmSheetView) });
        afterWriteAnywhere(statblockAffects("character", target.cid));
      }
    }
    await mark({ undone: true });
  } finally {
    afterWriteAnywhere([{ path: initiativePath(sessionId) }]);
  }
  return null;
}

/** Конфликт сессии для режима: бой, его лог, отмена и «Конец». */
export function useLitmBattle(sessionId: number) {
  const session = useEntity<SessionDetail>("session", sessionId).data ?? null;
  const battleId = session?.combat_active ? (session.combat_battle_id ?? null) : null;
  const battle = useResource<BattleInfo | null>(battleId ? battlePath(sessionId) : null).data ?? null;
  const log = useResource<BattleLogLine[]>(battleId ? battleLogPath(battleId) : null).data ?? NO_LINES;
  const isLive = !!session?.live_mode;
  useEffect(() => {
    live.set(sessionId, isLive);
  }, [sessionId, isLive]);
  useEffect(() => {
    setBattleContext(sessionId, battleId ? { battleId, round: 1 } : null);
  }, [sessionId, battleId]);

  /** «Конец» (Q15): лог закрывается, конфликт встаёт в «Вызовы вечера»; лента остаётся. */
  async function end() {
    await flushBattleLog(sessionId);
    await write.put(`/sessions/${sessionId}/combat`, { active: false, turn_entry_id: null });
    afterWriteAnywhere([{ kind: "session", id: sessionId, card: true }, { path: sessionBattlesPath(sessionId) }]);
    setCombatModeOpen(sessionId, false);
  }

  return { battle, log, live: isLive, undo: (line: BattleLogLine) => undoLitmLine(sessionId, line), end };
}
