import { Router } from "express";
import { db } from "../db/db";

export const calendarRouter = Router();

calendarRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.campaign_id, s.date, s.title, s.status, s.payment_override, s.start_time,
              c.payment_type as campaign_payment_type, c.role as campaign_role,
              s.rescheduled_to_id, s.rescheduled_from_id, c.name as campaign_name
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.archived_at IS NULL AND c.archived_at IS NULL
       ORDER BY s.date`
    )
    .all() as Record<string, unknown>[];
  const withPaymentType = rows.map((r) => ({
    ...r,
    effective_payment_type:
      (r.payment_override as string) || (r.campaign_payment_type as string),
  }));
  res.json(withPaymentType);
});
