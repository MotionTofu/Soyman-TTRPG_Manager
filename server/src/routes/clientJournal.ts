import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db/db";
import type { AuthedRequest } from "../services/auth";

/**
 * Журнал медленных запросов и ошибок клиента.
 *
 * Жалобу «зависает, странные ошибки, много где» не удалось воспроизвести на
 * копии базы (docs/adr/0001): замер пяти экранов дал 0,1–0,6 с на действие.
 * Значит, ловить надо там, где это случается, — на устройстве Мастера или
 * игрока, в тот момент. Клиент записывает каждый запрос дольше секунды и каждую
 * ошибку и присылает сюда пачкой; Мастер смотрит на странице «Здоровье».
 *
 * Смонтирован до ролевого гейта: писать может любая роль (зависание на телефоне
 * игрока — ровно то, что нужно увидеть), читать и чистить — только мастер.
 *
 * Записи — личные данные (кто, с какого устройства, что делал), поэтому
 * сборка сида таблицу вычищает (scripts/buildSeed.ts).
 */
export const clientJournalRouter = Router();

/** Больше этого журнал не держит: старое вытесняется новым. */
export const JOURNAL_MAX_ROWS = 2000;
/** Записи старше этого срока удаляются при каждой новой пачке. */
export const JOURNAL_MAX_AGE_DAYS = 30;
/** Одна пачка с клиента — не больше. */
const MAX_BATCH = 50;

const KINDS = new Set(["slow", "error"]);

const postLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "слишком много записей журнала, подождите минуту" },
});

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Срезает журнал по возрасту и по числу строк. Экспортирован для теста. */
export function trimJournal(maxRows = JOURNAL_MAX_ROWS, maxAgeDays = JOURNAL_MAX_AGE_DAYS): void {
  db.prepare("DELETE FROM client_journal WHERE created_at < datetime('now', ?)").run(`-${maxAgeDays} days`);
  db.prepare(
    `DELETE FROM client_journal WHERE id NOT IN (SELECT id FROM client_journal ORDER BY id DESC LIMIT ?)`
  ).run(maxRows);
}

clientJournalRouter.post("/", postLimiter, (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "authentication required" });
  const entries = (req.body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "entries required" });

  const insert = db.prepare(
    `INSERT INTO client_journal (user_id, role, kind, screen, action, status, duration_ms, message, occurred_at, device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let accepted = 0;
  db.transaction(() => {
    for (const raw of entries.slice(0, MAX_BATCH)) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const kind = text(e.kind, 10);
      if (!KINDS.has(kind)) continue;
      insert.run(
        req.user!.id ?? null,
        req.user!.role ?? null,
        kind,
        text(e.screen, 200),
        text(e.action, 200),
        intOrNull(e.status, 0, 999),
        intOrNull(e.durationMs, 0, 600_000),
        text(e.message, 500),
        text(e.occurredAt, 40) || null,
        text(e.device, 120)
      );
      accepted++;
    }
    trimJournal();
  })();
  res.status(201).json({ accepted });
});

clientJournalRouter.get("/", (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "authentication required" });
  if (req.user.role !== "gm") return res.status(403).json({ error: "forbidden" });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const rows = db
    .prepare(
      `SELECT j.id, j.created_at, j.occurred_at, j.kind, j.screen, j.action, j.status, j.duration_ms,
              j.message, j.device, j.role, u.username
         FROM client_journal j LEFT JOIN users u ON u.id = j.user_id
        ORDER BY j.id DESC LIMIT ?`
    )
    .all(limit);
  res.json(rows);
});

clientJournalRouter.delete("/", (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "authentication required" });
  if (req.user.role !== "gm") return res.status(403).json({ error: "forbidden" });
  const info = db.prepare("DELETE FROM client_journal").run();
  res.json({ deleted: info.changes });
});
