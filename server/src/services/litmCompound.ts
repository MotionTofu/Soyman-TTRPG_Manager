import {
  COMPOUND_EFFECTS, VITALITY, charge, describeLitm, diffValues, giveStatus, healStatuses, normalizeStatuses,
  parseChallengeState, reduceInjury, reduceStatus, same, sameStatus, undoChanges,
  type CompoundEffect, type CompoundTarget, type Injury, type LitmChallengeState, type LogChange, type LogTarget,
} from "@soyman/shared";
import { db } from "../db/db";
import { appendLog, openBattle, type LogRow } from "./battles";

interface RibbonRow {
  id: number;
  name: string;
  state: string;
  entity_type: string | null;
  entity_id: number | null;
}

interface HeroSheet {
  id: number;
  name: string;
  content: string;
}

export interface CompoundRequest {
  sourceId: number;
  effect: CompoundEffect;
  threat?: number;
  target?: CompoundTarget;
  injury?: Injury;
  withTroop?: boolean;
  newChallenge?: string;
  expectedSource?: string | null;
  expectedTroop?: string | null;
}

export class LitmActionError extends Error {}

export const COMPOUND_LOG_AUTHOR = "litm-compound";

function getRow(sessionId: number, id: number): RibbonRow {
  const row = db.prepare("SELECT * FROM initiative_entries WHERE session_id = ? AND id = ? AND kind = 'litm_challenge'").get(sessionId, id) as RibbonRow | undefined;
  if (!row || parseChallengeState(row.state).vignette) throw new LitmActionError("Вызов больше не на ленте.");
  return row;
}

function getSheet(sessionId: number, id: number): HeroSheet {
  const sheet = db.prepare(`SELECT sb.id, c.character_name AS name, sb.content
    FROM sessions s JOIN characters c ON c.campaign_id = s.campaign_id
    JOIN statblocks sb ON sb.owner_type = 'character' AND sb.owner_id = c.id
    WHERE s.id = ? AND c.id = ? AND c.archived_at IS NULL AND sb.archived_at IS NULL AND sb.format = 'litm_character'
    ORDER BY sb.created_at, sb.id LIMIT 1`).get(sessionId, id) as HeroSheet | undefined;
  if (!sheet) throw new LitmActionError("У выбранного Героя нет листа LitM в этой кампании.");
  return sheet;
}

function readObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* прежняя запись без содержимого */ }
  return {};
}

function saveRow(row: RibbonRow, state: unknown) {
  db.prepare("UPDATE initiative_entries SET state = ? WHERE id = ?").run(JSON.stringify(state), row.id);
}

function saveStatuses(sheet: HeroSheet, statuses: unknown) {
  const content = { ...readObject(sheet.content), statuses };
  db.prepare("UPDATE statblocks SET content = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?").run(JSON.stringify(content), sheet.id);
}

function record(changes: LogChange[], target: LogTarget, before: unknown, after: unknown) {
  const ops = diffValues(before, after);
  if (ops.length) changes.push({ target, ops });
}

function apply(sessionId: number, req: CompoundRequest) {
  const session = db.prepare(`SELECT s.combat_battle_id AS battle, s.live_mode AS live
    FROM sessions s JOIN campaigns c ON c.id = s.campaign_id JOIN systems sy ON sy.id = c.system_id
    WHERE s.id = ? AND sy.code = 'litm'`).get(sessionId) as { battle: number | null; live: number } | undefined;
  if (!session) throw new LitmActionError("Сессия LitM не найдена.");
  const source = getRow(sessionId, req.sourceId);
  if (req.expectedSource !== undefined && source.state !== req.expectedSource) throw new LitmActionError("Источник уже изменился. Откройте Последствие заново.");
  const profile = db.prepare(`SELECT content FROM statblocks WHERE owner_type = ? AND owner_id = ?
    AND format = 'litm_challenge' AND archived_at IS NULL ORDER BY created_at, id LIMIT 1`)
    .get(source.entity_type, source.entity_id) as { content: string } | undefined;
  const action = COMPOUND_EFFECTS[req.effect];
  if (!profile || readObject(profile.content).titleEn !== action.profile) throw new LitmActionError("Эффект недоступен этому Вызову.");
  const before = parseChallengeState(source.state);
  let next = before;
  const changes: LogChange[] = [];
  const characterIds: number[] = [];
  const writeRow = (row: RibbonRow, old: LitmChallengeState | null, state: LitmChallengeState) => {
    const count = changes.length;
    record(changes, { t: "row", id: row.id, name: row.name, party: false }, { state: old }, { state });
    if (changes.length > count) saveRow(row, state);
  };

  if (req.effect === "leadCharge") {
    next = { ...charge(before, 3), guardLost: true };
  } else if (req.effect === "orderCharge") {
    if (req.target?.kind !== "row" || req.target.id === source.id) throw new LitmActionError("Выберите отряд на ленте.");
    const troop = getRow(sessionId, req.target.id);
    if (req.expectedTroop !== undefined && troop.state !== req.expectedTroop) throw new LitmActionError("Отряд уже изменился. Откройте Последствие заново.");
    const troopState = parseChallengeState(troop.state);
    writeRow(troop, troopState, charge(troopState, 1));
    if (req.withTroop) next = { ...charge(before, 1), troopId: troop.id };
    else {
      const { troopId: _troop, ...separate } = before;
      next = separate;
    }
  } else {
    if (!before.statuses.some((s) => sameStatus(s.name, VITALITY))) throw new LitmActionError("У лекаря иссякла жизненная сила.");
    const wounded = req.effect === "healSelf" || req.effect === "healAlly";
    if (wounded && !req.injury) throw new LitmActionError("Выберите ранение.");
    if (req.effect === "healSelf") {
      const healed = reduceInjury(before, req.injury!, 1);
      if (!healed) throw new LitmActionError("Ранение уже снято.");
      next = healed;
    } else {
      const target = req.target;
      if (!target || (target.kind === "row" && target.id === source.id)) throw new LitmActionError("Выберите товарища.");
      const ally = target.kind === "row" ? getRow(sessionId, target.id) : getSheet(sessionId, target.id);
      if (req.effect === "revive") {
        const name = req.newChallenge?.trim();
        if (!name) throw new LitmActionError("Назовите Новый вызов.");
        const state = parseChallengeState(null);
        const id = Number(db.prepare("INSERT INTO initiative_entries (session_id, name, kind, state) VALUES (?, ?, 'litm_challenge', '{}')").run(sessionId, name).lastInsertRowid);
        writeRow(getRow(sessionId, id), null, state);
      } else if ("state" in ally) {
        const old = parseChallengeState(ally.state);
        const updated = wounded ? reduceInjury(old, req.injury!, 3)
          : { ...old, statuses: giveStatus(old.statuses, "защищён-от-вреда", 1) };
        if (!updated) throw new LitmActionError("Ранение уже снято.");
        writeRow(ally, old, updated);
      } else {
        const statuses = normalizeStatuses(readObject(ally.content).statuses);
        const updated = wounded ? healStatuses(statuses, req.injury!, 3) : giveStatus(statuses, "защищён-от-вреда", 1);
        if (!updated) throw new LitmActionError("Ранение уже снято.");
        record(changes, { t: "sheet", cid: target.id, name: ally.name, party: true }, { statuses }, { statuses: updated });
        saveStatuses(ally, updated);
        characterIds.push(target.id);
      }
    }
    next = { ...next, statuses: reduceStatus(next.statuses, VITALITY, 1) };
  }
  if (req.threat != null && next.declaredThreat === req.threat) next = { ...next, declaredThreat: null, declaredLead: "" };
  writeRow(source, before, next);
  if (changes.length && (session.live || session.battle)) {
    const battle = session.battle ?? openBattle(sessionId, null, 1);
    if (battle != null) {
      if (session.battle == null) db.prepare("UPDATE sessions SET combat_active = 1, combat_round = 1 WHERE id = ?").run(sessionId);
      appendLog(battle, {
        session_id: sessionId, round: 1, kind: "event", author: COMPOUND_LOG_AUTHOR,
        text: `${source.name} · ${action.label}`, sub: describeLitm(changes), changes,
      });
    }
  }
  return { characterIds };
}

export function applyLitmCompound(sessionId: number, req: CompoundRequest) {
  return db.transaction(apply)(sessionId, req);
}

function undo(lineId: number) {
  const line = db.prepare("SELECT * FROM battle_log WHERE id = ? AND author = ?").get(lineId, COMPOUND_LOG_AUTHOR) as LogRow | undefined;
  if (!line || line.undone) throw new LitmActionError("Запись уже отменена или недоступна.");
  const changes = JSON.parse(line.changes) as LogChange[];
  const rows = new Map<number, RibbonRow>();
  const sheets = new Map<number, HeroSheet>();
  function unchangedItems(t: LogTarget, view: Record<string, unknown>) {
    const sameTarget = (other: LogTarget) => t.t === "row" && other.t === "row" ? t.id === other.id
      : t.t === "sheet" && other.t === "sheet" && t.cid === other.cid;
    for (const op of changes.filter((c) => sameTarget(c.target)).flatMap((c) => c.ops)) {
      if (op.k !== "items") continue;
      const value = op.path.reduce<unknown>((v, key) => v && typeof v === "object" ? (v as Record<string | number, unknown>)[key] : undefined, view);
      const items = Array.isArray(value) ? value : [];
      if (op.add.some((item) => !items.some((current) => same(current, item)))
        || op.del.some((item) => items.some((current) => current[op.key] === item[op.key]))) return null;
    }
    return view;
  }
  const restored = undoChanges(changes, (t) => {
    try {
      if (t.t === "row") {
        const row = getRow(line.session_id, t.id);
        const created = changes.some((c) => c.target.t === "row" && c.target.id === t.id
          && c.ops.some((op) => op.k === "set" && op.path.length === 1 && op.path[0] === "state" && op.from === null));
        if (created && row.name !== t.name) return null;
        rows.set(t.id, row);
        return unchangedItems(t, { state: parseChallengeState(row.state) });
      }
      if (t.t === "sheet") {
        const sheet = getSheet(line.session_id, t.cid);
        sheets.set(t.cid, sheet);
        return unchangedItems(t, { statuses: normalizeStatuses(readObject(sheet.content).statuses) });
      }
    } catch (error) {
      if (!(error instanceof LitmActionError)) throw error;
    }
    return null;
  });
  if (restored.conflict) {
    db.prepare("UPDATE battle_log SET blocked = ? WHERE id = ?").run(restored.conflict, line.id);
    return { conflict: restored.conflict, characterIds: [] };
  }
  for (const { target, view } of restored.next.values()) {
    if (target.t === "row") {
      if (view.state === null) db.prepare("DELETE FROM initiative_entries WHERE id = ?").run(target.id);
      else saveRow(rows.get(target.id)!, view.state);
    } else if (target.t === "sheet") saveStatuses(sheets.get(target.cid)!, view.statuses);
  }
  db.prepare("UPDATE battle_log SET undone = 1, blocked = '' WHERE id = ?").run(line.id);
  return { conflict: null, characterIds: [...sheets.keys()] };
}

export function undoLitmCompound(lineId: number) {
  return db.transaction(undo)(lineId);
}
