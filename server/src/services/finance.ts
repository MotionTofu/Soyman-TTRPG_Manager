import { db } from "../db/db";

export function campaignEarnings(campaignId: number): {
  earned: number;
  heldSessions: number;
} {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sa.amount_paid), 0) as earned,
              COUNT(DISTINCT s.id) as heldSessions
       FROM sessions s
       LEFT JOIN session_attendance sa ON sa.session_id = s.id
       WHERE s.campaign_id = ? AND s.status = 'held' AND s.archived_at IS NULL`
    )
    .get(campaignId) as { earned: number; heldSessions: number };
  return row;
}

export function sessionEarnings(sessionId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount_paid), 0) as earned FROM session_attendance WHERE session_id = ?"
    )
    .get(sessionId) as { earned: number };
  return row.earned;
}

export function totalEarnings(): {
  earned: number;
  heldSessions: number;
  playedSessions: number;
  campaigns: number;
} {
  const gm = db
    .prepare(
      `SELECT COALESCE(SUM(sa.amount_paid), 0) as earned,
              COUNT(DISTINCT s.id) as heldSessions,
              COUNT(DISTINCT c.id) as campaigns
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       LEFT JOIN session_attendance sa ON sa.session_id = s.id
       WHERE s.status = 'held' AND s.archived_at IS NULL AND c.archived_at IS NULL AND c.role = 'gm'`
    )
    .get() as { earned: number; heldSessions: number; campaigns: number };

  const player = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) as playedSessions
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.status = 'held' AND s.archived_at IS NULL AND c.archived_at IS NULL AND c.role = 'player'`
    )
    .get() as { playedSessions: number };

  return { ...gm, playedSessions: player.playedSessions };
}

export function effectivePaymentType(
  campaignPaymentType: string,
  sessionOverride: string | null
): string {
  return sessionOverride || campaignPaymentType;
}

export interface UnpaidSession {
  session_id: number;
  campaign_id: number;
  campaign_name: string;
  date: string;
  title: string | null;
  expected: number;
  paid: number;
}

// Mirrors the client's defaultStake() (client/src/pages/SessionDetailPage.tsx):
// stake_override wins outright, otherwise rate_split='per_table' divides the
// campaign's session_rate across attended players, 'per_person' charges it in
// full to each. Only held sessions the player actually attended and that are
// effectively 'paid' count — a session paid less than expected is "unpaid".
export function unpaidSessionsForPlayer(playerId: number): UnpaidSession[] {
  const rows = db
    .prepare(
      `SELECT s.id as session_id, s.campaign_id, c.name as campaign_name, s.date, s.title,
              s.stake_override, c.session_rate, c.rate_split, c.payment_type, s.payment_override,
              sa.amount_paid
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       JOIN session_attendance sa ON sa.session_id = s.id AND sa.player_id = ?
       WHERE s.status = 'held' AND s.archived_at IS NULL AND sa.attended = 1
       ORDER BY s.date DESC`
    )
    .all(playerId) as {
    session_id: number;
    campaign_id: number;
    campaign_name: string;
    date: string;
    title: string | null;
    stake_override: number | null;
    session_rate: number | null;
    rate_split: string;
    payment_type: string;
    payment_override: string | null;
    amount_paid: number;
  }[];

  const result: UnpaidSession[] = [];
  for (const row of rows) {
    const paymentType = effectivePaymentType(row.payment_type, row.payment_override);
    if (paymentType !== "paid") continue;
    let expected = row.stake_override ?? row.session_rate ?? 0;
    if (row.stake_override == null && row.rate_split === "per_table") {
      const attended = db
        .prepare("SELECT COUNT(*) as n FROM session_attendance WHERE session_id = ? AND attended = 1")
        .get(row.session_id) as { n: number };
      expected = (row.session_rate ?? 0) / (attended.n > 0 ? attended.n : 1);
    }
    if (expected > 0 && row.amount_paid < expected) {
      result.push({
        session_id: row.session_id,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        date: row.date,
        title: row.title,
        expected,
        paid: row.amount_paid,
      });
    }
  }
  return result;
}
