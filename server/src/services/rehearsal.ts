import { db } from "../db/db";

// Тестовый прогон (гриллинг 2026-09-28, Q43): при старте снимается всё, что
// принадлежит вечеру, а «Закончить прогон» возвращает это как было.
//
// Откатывается только сессионное и то, что вечер двигает у кампании:
// ленту, журнал сцен, экран показа, явку, инициативу, связи панелей сессии,
// поля боя и времени у самой сессии; у кампании — место партии, тайны,
// улики и пройденность сцен. Правки карточек (NPC без хитов, опечатка в
// локации) остаются: на прогоне это почти всегда настоящая подготовка.
//
// Снимок — строки целиком, откат — удалить в тех же границах и вставить
// снятое. Так возвращается и удалённое за прогон, и созданное уходит.

interface Scope {
  table: string;
  where: string;
}

function scopes(sessionId: number, campaignId: number): { scope: Scope; params: number[] }[] {
  const s = (table: string, where: string, ...params: number[]) => ({ scope: { table, where }, params });
  return [
    s("session_notes", "session_id = ?", sessionId),
    s("session_scenes", "session_id = ?", sessionId),
    s("session_show_state", "session_id = ?", sessionId),
    s("session_attendance", "session_id = ?", sessionId),
    s("initiative_entries", "session_id = ?", sessionId),
    s("generic_links", "from_type = 'session' AND from_id = ?", sessionId),
    // Спутники связей сессии: удаление связи уносит их каскадом.
    s("link_cast", "link_id IN (SELECT id FROM generic_links WHERE from_type = 'session' AND from_id = ?)", sessionId),
    s("link_notes", "link_id IN (SELECT id FROM generic_links WHERE from_type = 'session' AND from_id = ?)", sessionId),
    s("campaign_party_place", "campaign_id = ?", campaignId),
    s("campaign_secret_state", "campaign_id = ?", campaignId),
    s("campaign_clue_state", "campaign_id = ?", campaignId),
    s("campaign_scene_state", "campaign_id = ?", campaignId),
  ];
}

const SESSION_FIELDS = [
  "status",
  "inworld_year",
  "inworld_month",
  "inworld_day",
  "inworld_year_end",
  "inworld_month_end",
  "inworld_day_end",
  "combat_active",
  "combat_turn_entry_id",
  "combat_round",
] as const;

interface Snapshot {
  session: Record<string, unknown>;
  tables: { table: string; rows: Record<string, unknown>[] }[];
}

export function takeSnapshot(sessionId: number, campaignId: number): string {
  const session = db.prepare(`SELECT ${SESSION_FIELDS.join(", ")} FROM sessions WHERE id = ?`).get(sessionId) as Record<
    string,
    unknown
  >;
  const tables = scopes(sessionId, campaignId).map(({ scope, params }) => ({
    table: scope.table,
    rows: db.prepare(`SELECT * FROM ${scope.table} WHERE ${scope.where}`).all(...params) as Record<string, unknown>[],
  }));
  return JSON.stringify({ session, tables } satisfies Snapshot);
}

export function restoreSnapshot(sessionId: number, campaignId: number, raw: string): void {
  const snap = JSON.parse(raw) as Snapshot;
  const all = scopes(sessionId, campaignId);
  db.transaction(() => {
    // Спутники связей — до связей: их граница читается через generic_links.
    for (const { scope, params } of all) db.prepare(`DELETE FROM ${scope.table} WHERE ${scope.where}`).run(...params);
    // Порядок вставки — как в scopes(): связи раньше своих спутников.
    for (const { table, rows } of snap.tables) {
      for (const row of rows) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
          ...cols.map((c) => row[c] as never)
        );
      }
    }
    const set = SESSION_FIELDS.map((f) => `${f} = ?`).join(", ");
    db.prepare(`UPDATE sessions SET ${set}, live_mode = NULL, rehearsal_snapshot = NULL WHERE id = ?`).run(
      ...SESSION_FIELDS.map((f) => snap.session[f] as never),
      sessionId
    );
  })();
}
