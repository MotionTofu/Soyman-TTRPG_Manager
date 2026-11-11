import { battleStats, describeChanges, diffValues, litmStats, type BattleLine, type LogChange } from "@soyman/shared";
import { db } from "../db/db";
import { broadcastToGm } from "./realtime";
import { SESSION_NUMBER_SQL } from "./sessionNumber";

// Бои и их лог (боевой режим, шаг 4, Q15–Q24, Q67–Q83). Бой — от «Старт» до
// «Конец боя»; время — отрезками по сессиям (battle_spans), лог — строками с
// разницей по полям (shared/battleLog.ts).

const NOW_SECONDS = "CAST(ROUND((julianday('now') - julianday(started_at)) * 86400) AS INTEGER)";

interface SessionCombat {
  id: number;
  campaign_id: number;
  date: string;
  combat_active: number;
  combat_round: number;
  combat_turn_entry_id: number | null;
  combat_battle_id: number | null;
  battle_playlist_id: number | null;
}

function sessionCombat(sessionId: number): SessionCombat | undefined {
  return db
    .prepare(
      `SELECT id, campaign_id, date, combat_active, combat_round, combat_turn_entry_id, combat_battle_id, battle_playlist_id
       FROM sessions WHERE id = ?`
    )
    .get(sessionId) as SessionCombat | undefined;
}

/** Сцена, открытая на пульте последней (Q72). */
function currentSceneName(sessionId: number): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(lib.name, s.name) AS name FROM session_scenes j
       JOIN story_scenes s ON s.id = j.scene_id
       LEFT JOIN story_scenes lib ON lib.id = s.library_scene_id
       WHERE j.session_id = ? ORDER BY j.id DESC LIMIT 1`
    )
    .get(sessionId) as { name: string } | undefined;
  return row?.name?.trim() || null;
}

/** Кампания на Legend in the Mist: её бои — «Вызовы» (Backlog Д33), итоги свои. */
function campaignIsLitm(campaignId: number): boolean {
  const row = db
    .prepare("SELECT sy.code FROM campaigns c JOIN systems sy ON sy.id = c.system_id WHERE c.id = ?")
    .get(campaignId) as { code: string | null } | undefined;
  return row?.code === "litm";
}

/** «Засада у моста», второй там же — «Засада у моста · 2»; без сцены — «Бой N» («Вызовы N» в LitM). */
function battleName(sessionId: number, litm: boolean): string {
  const names = (db.prepare("SELECT name FROM battles WHERE session_id = ?").all(sessionId) as { name: string }[]).map(
    (r) => r.name
  );
  const scene = currentSceneName(sessionId);
  if (!scene) return `${litm ? "Вызовы" : "Бой"} ${names.length + 1}`;
  const same = names.filter((n) => n === scene || n.startsWith(`${scene} · `)).length;
  return same ? `${scene} · ${same + 1}` : scene;
}

/** «Старт»: бой заводится вместе с первым отрезком времени и строкой первого хода. */
export function openBattle(sessionId: number, turnEntryId: number | null, round: number): number | null {
  const s = sessionCombat(sessionId);
  if (!s) return null;
  if (s.combat_battle_id) return s.combat_battle_id;
  const id = Number(
    db
      .prepare("INSERT INTO battles (campaign_id, session_id, name) VALUES (?, ?, ?)")
      .run(s.campaign_id, sessionId, battleName(sessionId, campaignIsLitm(s.campaign_id))).lastInsertRowid
  );
  db.prepare("INSERT INTO battle_spans (battle_id, session_id, started_at) VALUES (?, ?, datetime('now'))").run(id, sessionId);
  db.prepare("UPDATE sessions SET combat_battle_id = ? WHERE id = ?").run(id, sessionId);
  const first = turnEntryId
    ? (db.prepare("SELECT name FROM initiative_entries WHERE id = ?").get(turnEntryId) as { name: string } | undefined)
    : undefined;
  if (first) appendLog(id, { session_id: sessionId, round, kind: "turn", text: `Раунд ${round} · ход ${first.name}` });
  return id;
}

/** Отрезок сессии закрыт: время сложено; `ended` — бой кончился здесь. */
function closeSpan(battleId: number, sessionId: number, ended: boolean): void {
  db.prepare(
    `UPDATE battle_spans SET
       seconds = seconds + CASE WHEN started_at IS NULL THEN 0 ELSE MAX(0, ${NOW_SECONDS}) END,
       started_at = NULL, ended = CASE WHEN ? THEN 1 ELSE ended END
     WHERE battle_id = ? AND session_id = ?`
  ).run(ended ? 1 : 0, battleId, sessionId);
}

/** «Конец боя» (и бой, закрытый молча, Q74): отрезок закрыт, у сессии боя нет. */
export function closeBattle(sessionId: number): void {
  const s = sessionCombat(sessionId);
  if (!s?.combat_battle_id) return;
  closeSpan(s.combat_battle_id, sessionId, true);
  db.prepare("UPDATE sessions SET combat_battle_id = NULL WHERE id = ?").run(sessionId);
}

/**
 * Сессию отметили проведённой, а бой идёт (Q74: задним числом, не с пульта) —
 * бой закрывается молча.
 *
 * ponytail: эффекты боя на листах персонажей так не снимаются — их снимает
 * «Конец боя» на клиенте. Сюда попадает только бой, у которого кнопку не
 * нажали; если такие листы станут встречаться — снимать здесь по state строк.
 */
export function closeBattleSilently(sessionId: number): void {
  const s = sessionCombat(sessionId);
  if (!s?.combat_active) return;
  // Бой ждёт следующую сессию (перенос, Q24) — его забирает новая сессия, не закрывать.
  const pending = s.combat_battle_id
    ? (db.prepare("SELECT carry_campaign_id FROM battles WHERE id = ?").get(s.combat_battle_id) as
        | { carry_campaign_id: number | null }
        | undefined)
    : undefined;
  if (pending?.carry_campaign_id != null) return;
  closeBattle(sessionId);
  db.prepare("UPDATE sessions SET combat_active = 0, combat_turn_entry_id = NULL, combat_round = 0 WHERE id = ?").run(
    sessionId
  );
}

interface SessionRef {
  id: number;
  number: number;
  date: string;
}

/** Следующая запланированная сессия кампании (Q24). */
export function nextPlannedSession(sessionId: number): SessionRef | null {
  const s = sessionCombat(sessionId);
  if (!s) return null;
  return (
    (db
      .prepare(
        `SELECT s.id, s.date, ${SESSION_NUMBER_SQL} AS number FROM sessions s
         WHERE s.campaign_id = ? AND s.id <> ? AND s.status = 'planned' AND s.archived_at IS NULL AND s.date >= ?
         ORDER BY s.date, s.id LIMIT 1`
      )
      .get(s.campaign_id, sessionId, s.date) as SessionRef | undefined) ?? null
  );
}

/** Бой со всеми бойцами переезжает в другую сессию; её отрезок начнётся с первым действием. */
function moveBattle(battleId: number, fromId: number, toId: number): void {
  const from = sessionCombat(fromId)!;
  db.prepare("UPDATE initiative_entries SET session_id = ? WHERE session_id = ?").run(toId, fromId);
  db.prepare(
    `UPDATE sessions SET combat_active = 1, combat_turn_entry_id = ?, combat_round = ?, combat_battle_id = ?,
       battle_playlist_id = COALESCE(battle_playlist_id, ?)
     WHERE id = ?`
  ).run(from.combat_turn_entry_id, Math.max(1, from.combat_round), battleId, from.battle_playlist_id, toId);
  db.prepare(
    "UPDATE sessions SET combat_active = 0, combat_turn_entry_id = NULL, combat_round = 0, combat_battle_id = NULL WHERE id = ?"
  ).run(fromId);
  db.prepare("INSERT INTO battle_spans (battle_id, session_id) VALUES (?, ?)").run(battleId, toId);
  db.prepare("UPDATE battles SET carry_campaign_id = NULL WHERE id = ?").run(battleId);
}

/**
 * «Продолжить в следующей сессии» (Q24): в следующую запланированную, а если
 * её нет — бой ждёт первую заведённую в кампании (pullPendingBattle).
 */
export function carryBattle(sessionId: number): { target: SessionRef | null } | null {
  const s = sessionCombat(sessionId);
  if (!s?.combat_active || !s.combat_battle_id) return null;
  const battleId = s.combat_battle_id;
  const target = nextPlannedSession(sessionId);
  db.transaction(() => {
    closeSpan(battleId, sessionId, false);
    if (target) moveBattle(battleId, sessionId, target.id);
    else db.prepare("UPDATE battles SET carry_campaign_id = ? WHERE id = ?").run(s.campaign_id, battleId);
  })();
  return { target };
}

/** Новая сессия кампании забирает бой, который ждал её (Q24). */
export function pullPendingBattle(newSessionId: number, campaignId: number): void {
  const pending = db
    .prepare(
      `SELECT b.id, s.id AS session_id FROM battles b JOIN sessions s ON s.combat_battle_id = b.id
       WHERE b.carry_campaign_id = ? AND s.id <> ? ORDER BY b.id DESC LIMIT 1`
    )
    .get(campaignId, newSessionId) as { id: number; session_id: number } | undefined;
  if (pending) db.transaction(() => moveBattle(pending.id, pending.session_id, newSessionId))();
}

/** Перенесённый бой: отрезок новой сессии идёт с её начала или первого действия. */
export function startSpanIfIdle(sessionId: number): void {
  db.prepare(
    `UPDATE battle_spans SET started_at = datetime('now')
     WHERE session_id = ? AND started_at IS NULL AND ended = 0
       AND battle_id = (SELECT combat_battle_id FROM sessions WHERE id = ?)`
  ).run(sessionId, sessionId);
}

interface SpanRow {
  session_id: number;
  number: number;
  seconds: number;
  running: number;
  started_at: string | null;
  ended: number;
}

function spansOf(battleId: number): SpanRow[] {
  return db
    .prepare(
      `SELECT sp.session_id, ${SESSION_NUMBER_SQL} AS number, sp.seconds, sp.started_at, sp.ended,
              CASE WHEN sp.started_at IS NULL THEN 0 ELSE MAX(0, ${NOW_SECONDS.replace("started_at", "sp.started_at")}) END AS running
       FROM battle_spans sp JOIN sessions s ON s.id = sp.session_id
       WHERE sp.battle_id = ? ORDER BY sp.id`
    )
    .all(battleId) as SpanRow[];
}

/** Идущий бой сессии для пульта: имя, таймер, число строк, куда переносить. */
export function battleInfo(sessionId: number) {
  const s = sessionCombat(sessionId);
  if (!s?.combat_battle_id) return null;
  const b = db.prepare("SELECT id, name, session_id FROM battles WHERE id = ?").get(s.combat_battle_id) as
    | { id: number; name: string; session_id: number }
    | undefined;
  if (!b) return null;
  const spans = spansOf(b.id);
  const own = spans.find((sp) => sp.session_id === sessionId);
  const before = spans.filter((sp) => sp.session_id !== sessionId);
  const count = db.prepare("SELECT COUNT(*) AS n FROM battle_log WHERE battle_id = ?").get(b.id) as { n: number };
  return {
    id: b.id,
    name: b.name,
    /** Время до идущего отрезка, в секундах. */
    seconds: spans.reduce((n, sp) => n + sp.seconds, 0),
    /** Начало идущего отрезка (UTC, как datetime('now')), null — не идёт. */
    running_since: own?.started_at ?? null,
    log_count: count.n,
    carried_from: before.length ? before[before.length - 1].number : null,
    carry_target: nextPlannedSession(sessionId),
  };
}

export interface LogRow {
  id: number;
  battle_id: number;
  session_id: number;
  round: number;
  kind: string;
  text: string;
  sub: string;
  changes: string;
  author: string;
  undone: number;
  blocked: string;
  created_at: string;
}

export function appendLog(
  battleId: number,
  line: { session_id: number; round: number; kind: string; text: string; sub?: string; changes?: unknown; author?: string }
): LogRow {
  const id = Number(
    db
      .prepare(
        `INSERT INTO battle_log (battle_id, session_id, round, kind, text, sub, changes, author)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        battleId,
        line.session_id,
        line.round,
        line.kind,
        line.text,
        line.sub ?? "",
        JSON.stringify(line.changes ?? []),
        line.author ?? ""
      ).lastInsertRowid
  );
  startSpanIfIdle(line.session_id);
  return db.prepare("SELECT * FROM battle_log WHERE id = ?").get(id) as LogRow;
}

/** Поля листа, правки которых идут в лог (Q77). */
const SHEET_LOG_FIELDS = [
  "hitPointsCurrent",
  "hitPointsTemp",
  "conditions",
  "concentration",
  "deathSaveSuccesses",
  "deathSaveFailures",
  "receivedSpells",
  "spellSlotsUsed",
  "pactSlotsUsed",
  "resourceUsed",
];

function pick(raw: string | null): Record<string, unknown> {
  let v: unknown = {};
  try {
    v = JSON.parse(raw || "{}");
  } catch {
    /* битый лист — как пустой */
  }
  const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(SHEET_LOG_FIELDS.map((f) => [f, obj[f]]));
}

/**
 * Правка листа не с пульта (Q69, Q77, Q78): игрок на телефоне или Мастер в
 * листе мимо гнезда. Персонаж в идущем бою — строка в лог без отмены.
 */
export function logSheetEdit(characterId: number, before: string | null, after: string | null, author: string): void {
  const ops = diffValues(pick(before), pick(after));
  if (!ops.length) return;
  const rows = db
    .prepare(
      `SELECT ie.name, ie.session_id, s.combat_battle_id AS battle_id, s.combat_round AS round
       FROM initiative_entries ie JOIN sessions s ON s.id = ie.session_id
       WHERE ie.entity_type = 'character' AND ie.entity_id = ? AND s.combat_active = 1
         AND s.combat_battle_id IS NOT NULL AND json_extract(ie.state, '$.double') IS NULL`
    )
    .all(characterId) as { name: string; session_id: number; battle_id: number; round: number }[];
  for (const r of rows) {
    const changes: LogChange[] = [{ target: { t: "sheet", cid: characterId, name: r.name, party: true }, ops }];
    const { text } = describeChanges(changes, `${r.name}: лист`);
    appendLog(r.battle_id, { session_id: r.session_id, round: r.round, kind: "sheet", text, changes, author });
    broadcastToGm("battle-log-updated", { battleId: r.battle_id, sessionId: r.session_id });
  }
}

function parseLines(rows: { changes: string; undone: number }[]): BattleLine[] {
  return rows.map((l) => {
    let changes: LogChange[] = [];
    try {
      changes = JSON.parse(l.changes);
    } catch {
      /* битая строка в итоги не идёт */
    }
    return { changes, undone: !!l.undone };
  });
}

function characterNames(ids: string[]): Map<number, string> {
  if (!ids.length) return new Map();
  const rows = db
    .prepare(`SELECT id, character_name FROM characters WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids.map(Number)) as { id: number; character_name: string }[];
  return new Map(rows.map((r) => [r.id, r.character_name]));
}

/**
 * «Вызовы вечера» (Д33, Q15): кто чем преодолён и статусы героев — по всему
 * конфликту, спотлайт — только за эту сессию (перенесённый считается в своей).
 */
function litmSummary(battleId: number, sessionId: number) {
  const rows = db.prepare("SELECT changes, undone, session_id FROM battle_log WHERE battle_id = ? ORDER BY id").all(battleId) as {
    changes: string;
    undone: number;
    session_id: number;
  }[];
  const all = litmStats(parseLines(rows));
  const own = litmStats(parseLines(rows.filter((r) => r.session_id === sessionId))).spotlight;
  const names = characterNames(Object.keys(own));
  return {
    overcome: all.overcome,
    statuses: all.statuses,
    spotlight: Object.entries(own).map(([id, n]) => ({ id: Number(id), name: names.get(Number(id)) ?? "?", n })),
  };
}

/** Спотлайт за кампанию по героям (Д33, Q15) — для дела игрока в «Партии». */
export function campaignSpotlight(campaignId: number): Record<string, number> {
  const rows = db
    .prepare("SELECT l.changes, l.undone FROM battle_log l JOIN battles b ON b.id = l.battle_id WHERE b.campaign_id = ?")
    .all(campaignId) as { changes: string; undone: number }[];
  return litmStats(parseLines(rows)).spotlight;
}

/** «Бои вечера» сессии (Q21, Q73, Q79, Q83); в LitM — «Вызовы вечера». */
export function sessionBattles(sessionId: number) {
  const campaign = db.prepare("SELECT campaign_id FROM sessions WHERE id = ?").get(sessionId) as { campaign_id: number } | undefined;
  const litm = campaign ? campaignIsLitm(campaign.campaign_id) : false;
  const battles = db
    .prepare(
      `SELECT b.id, b.name, b.carry_campaign_id FROM battles b
       WHERE b.id IN (SELECT battle_id FROM battle_spans WHERE session_id = ?) ORDER BY b.id`
    )
    .all(sessionId) as { id: number; name: string; carry_campaign_id: number | null }[];
  return battles.map((b) => {
    const spans = spansOf(b.id);
    const i = spans.findIndex((sp) => sp.session_id === sessionId);
    const lines = db.prepare("SELECT changes, undone, round FROM battle_log WHERE battle_id = ?").all(b.id) as {
      changes: string;
      undone: number;
      round: number;
    }[];
    const stats = battleStats(parseLines(lines));
    const rounds = lines.filter((l) => !l.undone).map((l) => l.round).filter((r) => r > 0);
    return {
      id: b.id,
      name: b.name,
      ended: spans.some((sp) => sp.ended),
      rounds: rounds.length ? Math.max(...rounds) : 0,
      spans: spans.map((sp) => ({ session_id: sp.session_id, number: sp.number, minutes: Math.round((sp.seconds + sp.running) / 60) })),
      carried_from: i > 0 ? spans[i - 1].number : null,
      carried_to: i >= 0 && i < spans.length - 1 ? spans[i + 1].number : null,
      /** Ждёт следующую сессию, которой ещё нет. */
      carry_pending: b.carry_campaign_id != null,
      ...stats,
      ...(litm ? { litm: litmSummary(b.id, sessionId) } : {}),
    };
  });
}

/** Кто правил лист (Q78): «Мастер» или имя игрока. */
export function sheetEditAuthor(user: { role: string; playerId: number | null } | undefined): string {
  if (!user || user.role === "gm") return "Мастер";
  const row = db.prepare("SELECT name FROM players WHERE id = ?").get(user.playerId) as { name: string } | undefined;
  return row?.name || "Игрок";
}
