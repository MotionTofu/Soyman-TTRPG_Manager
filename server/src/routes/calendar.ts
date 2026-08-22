import { Router } from "express";
import { db } from "../db/db";

export const calendarRouter = Router();

calendarRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      // session_number считается тем же подзапросом, что и в
      // sessions/campaigns/links: это порядковый номер сессии внутри своей
      // кампании по дате, а не колонка. Понадобился герою главной, который
      // после дизайн-ревизии подписывает ближайшую игру строкой
      // «Сессия №14 · 30 августа · 19:00».
      `SELECT s.id, s.campaign_id, s.date, s.title, s.status, s.payment_override, s.start_time,
              c.payment_type as campaign_payment_type, c.role as campaign_role,
              c.name as campaign_name,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = s.campaign_id AND s2.archived_at IS NULL
                   AND s2.date <= s.date) as session_number
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
