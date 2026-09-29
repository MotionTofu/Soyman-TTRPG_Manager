import { createHash, randomUUID } from "crypto";
import fs from "fs";
import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "../db/db";
import type { AuthedRequest } from "../services/auth";
import { isVaultPath, vaultAbs } from "../services/filesystem";
import { getPdfNoteDocument, getPdfNoteDocumentByResource, readPdfNoteMarkdown, syncPdfNoteMarkdown } from "../services/pdfNoteMarkdown";

export const pdfNotesRouter = Router();

const rectSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  w: z.number().finite().positive().max(1),
  h: z.number().finite().positive().max(1),
}).refine((rect) => rect.x + rect.w <= 1.001 && rect.y + rect.h <= 1.001);
const anchorSchema = z.object({
  page: z.number().int().positive(),
  rects: z.array(rectSchema).min(1).max(100),
});
const noteSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  quote: z.string().trim().max(10_000).default(""),
  anchors: z.array(anchorSchema).max(20).default([]),
  context_before: z.string().max(200).default(""),
  context_after: z.string().max(200).default(""),
});
const preferenceSchema = z.object({
  note_mode: z.enum(["margins", "list"]),
  notes_collapsed: z.boolean(),
  show_highlights: z.boolean(),
});

type PdfResource = { id: number; category: string | null; file_path: string | null; file_sha256: string | null };
type NoteRow = {
  id: string; resource_id: number; author_user_id: number; page_number: number | null;
  quote: string; body: string; anchors_json: string; context_before: string;
  context_after: string; file_sha256: string | null; created_at: string; updated_at: string;
};

function resourceFor(req: AuthedRequest, res: Response): PdfResource | null {
  const resource = db.prepare("SELECT id, category, file_path, file_sha256 FROM resources WHERE id = ? AND archived_at IS NULL")
    .get(req.params.resourceId) as PdfResource | undefined;
  if (!resource) { res.status(404).json({ error: "Ресурс не найден" }); return null; }
  if (resource.category !== "pdf" || !resource.file_path) {
    res.status(400).json({ error: "Ресурс не содержит PDF" });
    return null;
  }
  // Older PDF resources predate the checksum column. Establish their baseline
  // before saving notes so a later file replacement can invalidate anchors.
  if (!resource.file_sha256) {
    const file = vaultAbs(resource.file_path);
    if (isVaultPath(file) && fs.existsSync(file)) {
      const hash = createHash("sha256");
      const fd = fs.openSync(file, "r");
      const chunk = Buffer.allocUnsafe(1024 * 1024);
      try {
        let count: number;
        while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count));
      } finally {
        fs.closeSync(fd);
      }
      resource.file_sha256 = hash.digest("hex");
      db.prepare("UPDATE resources SET file_sha256 = ? WHERE id = ? AND file_sha256 IS NULL")
        .run(resource.file_sha256, resource.id);
    }
  }
  return resource;
}

function validNote(input: unknown) {
  const result = noteSchema.safeParse(input);
  if (!result.success) return null;
  const note = result.data;
  if (note.anchors.length > 0 && !note.quote) return null;
  if (note.anchors.length === 0 && note.quote) return null;
  return note;
}

function present(row: NoteRow, currentHash: string | null) {
  const anchors = JSON.parse(row.anchors_json) as z.infer<typeof anchorSchema>[];
  return {
    id: row.id,
    resource_id: row.resource_id,
    page_number: row.page_number,
    quote: row.quote,
    body: row.body,
    anchors,
    context_before: row.context_before,
    context_after: row.context_after,
    file_sha256: row.file_sha256,
    needs_reattach: anchors.length > 0 && !!row.file_sha256 && !!currentHash && row.file_sha256 !== currentHash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

pdfNotesRouter.get("/:resourceId/pdf-notes", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  if (!getPdfNoteDocument(resource.id, req.user!.id)) {
    const existing = db.prepare("SELECT 1 FROM pdf_notes WHERE resource_id = ? AND author_user_id = ? LIMIT 1")
      .get(resource.id, req.user!.id);
    if (existing) db.transaction(() => syncPdfNoteMarkdown(resource.id, req.user!.id))();
  }
  const rows = db.prepare("SELECT * FROM pdf_notes WHERE resource_id = ? AND author_user_id = ? ORDER BY page_number, created_at")
    .all(resource.id, req.user!.id) as NoteRow[];
  res.json(rows.map((row) => present(row, resource.file_sha256)));
});

pdfNotesRouter.post("/:resourceId/pdf-notes", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const note = validNote(req.body);
  if (!note) return res.status(400).json({ error: "Некорректная заметка или привязка" });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
  db.prepare(`INSERT INTO pdf_notes
    (id, resource_id, author_user_id, page_number, quote, body, anchors_json, context_before, context_after, file_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, resource.id, req.user!.id, note.anchors[0]?.page ?? null, note.quote, note.body,
    JSON.stringify(note.anchors), note.context_before, note.context_after, resource.file_sha256, now, now,
  );
  syncPdfNoteMarkdown(resource.id, req.user!.id);
  })();
  const row = db.prepare("SELECT * FROM pdf_notes WHERE id = ?").get(id) as NoteRow;
  res.status(201).json(present(row, resource.file_sha256));
});

pdfNotesRouter.put("/:resourceId/pdf-notes/:noteId", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const existing = db.prepare("SELECT * FROM pdf_notes WHERE id = ? AND resource_id = ? AND author_user_id = ?")
    .get(req.params.noteId, resource.id, req.user!.id) as NoteRow | undefined;
  if (!existing) return res.status(404).json({ error: "Заметка не найдена" });
  const input = req.body ?? {};
  const reanchor = Object.hasOwn(input, "anchors");
  const note = validNote({
    body: input.body ?? existing.body,
    quote: input.quote ?? existing.quote,
    anchors: input.anchors ?? JSON.parse(existing.anchors_json),
    context_before: input.context_before ?? existing.context_before,
    context_after: input.context_after ?? existing.context_after,
  });
  if (!note) return res.status(400).json({ error: "Некорректная заметка или привязка" });
  db.transaction(() => {
  db.prepare(`UPDATE pdf_notes SET page_number = ?, quote = ?, body = ?, anchors_json = ?,
    context_before = ?, context_after = ?, file_sha256 = ?, updated_at = ? WHERE id = ?`).run(
    note.anchors[0]?.page ?? null, note.quote, note.body, JSON.stringify(note.anchors),
    note.context_before, note.context_after, reanchor ? resource.file_sha256 : existing.file_sha256,
    new Date().toISOString(), existing.id,
  );
  syncPdfNoteMarkdown(resource.id, req.user!.id);
  })();
  const row = db.prepare("SELECT * FROM pdf_notes WHERE id = ?").get(existing.id) as NoteRow;
  res.json(present(row, resource.file_sha256));
});

pdfNotesRouter.delete("/:resourceId/pdf-notes/:noteId", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const result = db.transaction(() => {
    const deleted = db.prepare("DELETE FROM pdf_notes WHERE id = ? AND resource_id = ? AND author_user_id = ?")
      .run(req.params.noteId, resource.id, req.user!.id);
    if (deleted.changes) syncPdfNoteMarkdown(resource.id, req.user!.id);
    return deleted;
  })();
  if (!result.changes) return res.status(404).json({ error: "Заметка не найдена" });
  res.json({ ok: true });
});

pdfNotesRouter.get("/:resourceId/pdf-notes-markdown", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const result = readPdfNoteMarkdown(resource.id, req.user!.id);
  if (!result) return res.status(404).json({ error: "Заметок ещё нет" });
  res.json({ resource_id: result.document.markdown_resource_id, pdf_resource_id: resource.id, content: result.content });
});

pdfNotesRouter.get("/:resourceId/pdf-notes-markdown/download", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const result = readPdfNoteMarkdown(resource.id, req.user!.id);
  if (!result) return res.status(404).json({ error: "Заметок ещё нет" });
  res.attachment(`pdf-${resource.id}.notes.md`).type("text/markdown; charset=utf-8").send(result.content);
});

pdfNotesRouter.get("/:markdownId/markdown-content", (req: AuthedRequest, res, next) => {
  const document = getPdfNoteDocumentByResource(Number(req.params.markdownId), req.user!.id);
  if (!document) {
    const standalone = db.prepare("SELECT id FROM resources WHERE id = ? AND type = 'markdown' AND archived_at IS NULL")
      .get(req.params.markdownId);
    if (standalone) return next();
    return res.status(404).json({ error: "Ресурс не найден" });
  }
  const result = readPdfNoteMarkdown(document.pdf_resource_id, req.user!.id);
  if (!result) return res.status(404).json({ error: "Ресурс не найден" });
  res.json({ resource_id: document.markdown_resource_id, pdf_resource_id: document.pdf_resource_id, content: result.content });
});

pdfNotesRouter.get("/:markdownId/markdown-download", (req: AuthedRequest, res) => {
  const document = getPdfNoteDocumentByResource(Number(req.params.markdownId), req.user!.id);
  if (!document) return res.status(404).json({ error: "Ресурс не найден" });
  const result = readPdfNoteMarkdown(document.pdf_resource_id, req.user!.id);
  if (!result) return res.status(404).json({ error: "Ресурс не найден" });
  res.attachment(`pdf-${document.pdf_resource_id}.notes.md`).type("text/markdown; charset=utf-8").send(result.content);
});

pdfNotesRouter.get("/:resourceId/pdf-reader-preferences", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const row = db.prepare("SELECT note_mode, notes_collapsed, show_highlights FROM pdf_reader_preferences WHERE resource_id = ? AND user_id = ?")
    .get(resource.id, req.user!.id) as { note_mode: "margins" | "list"; notes_collapsed: number; show_highlights: number } | undefined;
  res.json({ note_mode: row?.note_mode ?? "margins", notes_collapsed: !!row?.notes_collapsed, show_highlights: row ? !!row.show_highlights : true });
});

pdfNotesRouter.put("/:resourceId/pdf-reader-preferences", (req: AuthedRequest, res) => {
  const resource = resourceFor(req, res);
  if (!resource) return;
  const parsed = preferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Некорректные настройки читалки" });
  const { note_mode, notes_collapsed, show_highlights } = parsed.data;
  db.prepare(`INSERT INTO pdf_reader_preferences (resource_id, user_id, note_mode, notes_collapsed, show_highlights)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(resource_id, user_id) DO UPDATE SET
    note_mode = excluded.note_mode, notes_collapsed = excluded.notes_collapsed, show_highlights = excluded.show_highlights`)
    .run(resource.id, req.user!.id, note_mode, Number(notes_collapsed), Number(show_highlights));
  res.json(parsed.data);
});
