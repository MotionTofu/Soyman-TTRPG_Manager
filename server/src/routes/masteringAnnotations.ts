import { createHash, randomUUID } from "crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../db/db";
import { requireAuth, type AuthedRequest } from "../services/auth";

export const masteringAnnotationsRouter = Router();
masteringAnnotationsRouter.use("/:bookId/notes", requireAuth("gm"));
const anchorSchema = z.object({ start: z.number().int().min(0).max(20_000_000), end: z.number().int().min(1).max(20_000_000) }).refine(value => value.end > value.start);
const noteSchema = z.object({
  body: z.string().trim().min(1).max(20_000), quote: z.string().max(10_000).default(""),
  anchor: anchorSchema.nullable().default(null),
  context_before: z.string().max(200).default(""), context_after: z.string().max(200).default(""),
}).refine(value => !!value.quote.trim() === !!value.anchor);
type NoteRow = { id: string; book_id: number; body: string; quote: string; anchor_json: string | null; context_before: string; context_after: string; content_sha256: string | null; created_at: string; updated_at: string };
function bookFor(req: AuthedRequest, res: Response) {
  const book = db.prepare("SELECT id, content FROM mastering_notes WHERE id = ? AND archived_at IS NULL").get(req.params.bookId) as { id: number; content: string } | undefined;
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return null; }
  return { ...book, hash: createHash("sha256").update(book.content ?? "").digest("hex") };
}
function present(row: NoteRow, hash: string) {
  const { anchor_json, content_sha256, ...fields } = row;
  return { ...fields, anchor: anchor_json ? JSON.parse(anchor_json) : null, needs_reattach: !!anchor_json && content_sha256 !== hash };
}
masteringAnnotationsRouter.get("/:bookId/notes", (req: AuthedRequest, res) => {
  const book = bookFor(req, res); if (!book) return;
  const rows = db.prepare("SELECT * FROM mastering_annotations WHERE book_id = ? AND author_user_id = ? ORDER BY created_at, id").all(book.id, req.user!.id) as NoteRow[];
  res.json(rows.map(row => present(row, book.hash)));
});
masteringAnnotationsRouter.post("/:bookId/notes", (req: AuthedRequest, res) => {
  const book = bookFor(req, res); if (!book) return;
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Некорректная заметка или привязка" });
  const note = parsed.data, id = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO mastering_annotations (id, book_id, author_user_id, body, quote, anchor_json, context_before, context_after, content_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, book.id, req.user!.id, note.body, note.quote, note.anchor ? JSON.stringify(note.anchor) : null, note.context_before, note.context_after, book.hash, now, now);
  res.status(201).json(present(db.prepare("SELECT * FROM mastering_annotations WHERE id = ?").get(id) as NoteRow, book.hash));
});
masteringAnnotationsRouter.put("/:bookId/notes/:noteId", (req: AuthedRequest, res) => {
  const book = bookFor(req, res); if (!book) return;
  const row = db.prepare("SELECT * FROM mastering_annotations WHERE id = ? AND book_id = ? AND author_user_id = ?").get(req.params.noteId, book.id, req.user!.id) as NoteRow | undefined;
  if (!row) return res.status(404).json({ error: "Заметка не найдена" });
  const input = req.body ?? {};
  const parsed = noteSchema.safeParse({ body: row.body, quote: row.quote, anchor: row.anchor_json ? JSON.parse(row.anchor_json) : null, context_before: row.context_before, context_after: row.context_after, ...input });
  if (!parsed.success) return res.status(400).json({ error: "Некорректная заметка или привязка" });
  const note = parsed.data;
  db.prepare(`UPDATE mastering_annotations SET body = ?, quote = ?, anchor_json = ?, context_before = ?, context_after = ?, content_sha256 = ?, updated_at = ? WHERE id = ?`)
    .run(note.body, note.quote, note.anchor ? JSON.stringify(note.anchor) : null, note.context_before, note.context_after, Object.hasOwn(input, "anchor") ? book.hash : row.content_sha256, new Date().toISOString(), row.id);
  res.json(present(db.prepare("SELECT * FROM mastering_annotations WHERE id = ?").get(row.id) as NoteRow, book.hash));
});
masteringAnnotationsRouter.delete("/:bookId/notes/:noteId", (req: AuthedRequest, res) => {
  const book = bookFor(req, res); if (!book) return;
  const result = db.prepare("DELETE FROM mastering_annotations WHERE id = ? AND book_id = ? AND author_user_id = ?").run(req.params.noteId, book.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "Заметка не найдена" });
  res.json({ ok: true });
});
