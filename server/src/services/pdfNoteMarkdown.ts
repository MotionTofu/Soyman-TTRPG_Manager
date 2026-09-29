import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "../db/db";
import { isVaultPath, vaultAbs, vaultRel, VAULT_ROOT } from "./filesystem";

type PdfRow = {
  id: number; name: string; file_path: string | null; scope: string;
  file_sha256: string | null;
  campaign_id: number | null; session_id: number | null; setting_id: number | null;
  system_id: number | null; archived_at: string | null;
};
type NoteRow = { id: string; page_number: number | null; quote: string; body: string; file_sha256: string | null; created_at: string; updated_at: string };
export type PdfNoteDocument = { pdf_resource_id: number; author_user_id: number; markdown_resource_id: number; file_path: string };

function safeMarkdownLink(filename: string, page: number | null): string {
  return encodeURIComponent(filename).replace(/%2F/gi, "%252F") + (page ? `#page=${page}` : "");
}

function render(pdf: PdfRow, notes: NoteRow[]): string {
  const lines = [`# Заметки к «${pdf.name.replace(/\r?\n/g, " ")}»`, ""];
  if (pdf.file_path) lines.push(`[Открыть PDF](${safeMarkdownLink(path.basename(pdf.file_path), null)})`, "");
  if (notes.length === 0) lines.push("_Заметок пока нет._", "");
  for (const note of notes) {
    const stale = !!note.quote && !!note.file_sha256 && !!pdf.file_sha256 && note.file_sha256 !== pdf.file_sha256;
    const heading = note.page_number ? `Страница ${note.page_number}${stale ? " — проверьте привязку" : ""}` : "Общая заметка";
    lines.push(`## ${heading}`, "");
    if (note.quote) {
      lines.push(...note.quote.split(/\r?\n/).map(line => `> ${line}`), "");
    }
    lines.push(note.body.trim(), "");
    if (stale) lines.push("_Цитата относится к прежней версии PDF; перепривяжите её в читалке._", "");
    if (pdf.file_path && note.page_number && !stale) {
      lines.push(`[Открыть страницу ${note.page_number}](${safeMarkdownLink(path.basename(pdf.file_path), note.page_number)})`, "");
    }
    lines.push(`<!-- pdf-note-id: ${note.id} -->`, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function documentPath(pdf: PdfRow, userId: number): string {
  if (!pdf.file_path) throw new Error("PDF file is missing");
  const pdfPath = vaultAbs(pdf.file_path);
  const folder = isVaultPath(pdfPath) ? path.dirname(pdfPath) : path.join(VAULT_ROOT, "Resources");
  const filename = `${path.basename(pdfPath, path.extname(pdfPath))}.${pdf.id}.${userId}.notes.md`;
  const target = path.join(folder, filename);
  if (!isVaultPath(target)) throw new Error("Markdown path is outside the vault");
  return vaultRel(target);
}

function writeAtomically(storedPath: string, content: string): void {
  const target = vaultAbs(storedPath);
  if (!isVaultPath(target)) throw new Error("Markdown path is outside the vault");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function getPdfNoteDocument(pdfId: number, userId: number): PdfNoteDocument | undefined {
  // Запрос готовится при вызове: на импорте модуля база ещё не открыта (initDatabase в index.ts).
  return db.prepare(`SELECT * FROM pdf_note_documents WHERE pdf_resource_id = ? AND author_user_id = ?`)
    .get(pdfId, userId) as PdfNoteDocument | undefined;
}

export function getPdfNoteDocumentByResource(markdownId: number, userId: number): PdfNoteDocument | undefined {
  return db.prepare("SELECT * FROM pdf_note_documents WHERE markdown_resource_id = ? AND author_user_id = ?")
    .get(markdownId, userId) as PdfNoteDocument | undefined;
}

export function isPdfNoteDocument(markdownId: number): boolean {
  return !!db.prepare("SELECT 1 FROM pdf_note_documents WHERE markdown_resource_id = ?").get(markdownId);
}

export function isPrivatePdfNotesPath(absolutePath: string): boolean {
  const rel = vaultRel(path.resolve(absolutePath));
  // Keep orphaned copies private too, e.g. after a parent account or setting
  // was deleted by a foreign-key cascade before filesystem cleanup.
  if (/\.\d+\.\d+\.notes\.md$/i.test(path.basename(rel))) return true;
  return !!db.prepare("SELECT 1 FROM pdf_note_documents WHERE lower_u(file_path) = lower_u(?)").get(rel);
}

export function readPdfNoteMarkdown(pdfId: number, userId: number): { document: PdfNoteDocument; content: string } | null {
  const document = getPdfNoteDocument(pdfId, userId);
  if (!document) return null;
  const pdf = db.prepare("SELECT * FROM resources WHERE id = ?").get(pdfId) as PdfRow | undefined;
  if (!pdf) return null;
  const notes = db.prepare(`SELECT id, page_number, quote, body, file_sha256, created_at, updated_at FROM pdf_notes
    WHERE resource_id = ? AND author_user_id = ? ORDER BY page_number IS NOT NULL, page_number, created_at, id`)
    .all(pdfId, userId) as NoteRow[];
  const content = render(pdf, notes);
  const target = vaultAbs(document.file_path);
  if (!isVaultPath(target)) throw new Error("Markdown path is outside the vault");
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) writeAtomically(document.file_path, content);
  return { document, content };
}

export function syncPdfNoteMarkdown(pdfId: number, userId: number): PdfNoteDocument | null {
  const pdf = db.prepare("SELECT * FROM resources WHERE id = ? AND category = 'pdf'").get(pdfId) as PdfRow | undefined;
  if (!pdf?.file_path) return null;
  const notes = db.prepare(`SELECT id, page_number, quote, body, file_sha256, created_at, updated_at FROM pdf_notes
    WHERE resource_id = ? AND author_user_id = ? ORDER BY page_number IS NOT NULL, page_number, created_at, id`)
    .all(pdfId, userId) as NoteRow[];
  let document = getPdfNoteDocument(pdfId, userId);
  if (!document && notes.length === 0) return null;
  if (!document) {
    const filePath = documentPath(pdf, userId);
    const name = `${pdf.name} — заметки.md`;
    const info = db.prepare(`INSERT INTO resources
      (name, type, scope, campaign_id, session_id, setting_id, system_id, category, notes, archived_at)
      VALUES (?, 'pdf_notes', ?, ?, ?, ?, ?, 'markdown', 'Создаётся из заметок PDF', ?)`).run(
      name, pdf.scope, pdf.campaign_id, pdf.session_id, pdf.setting_id, pdf.system_id, pdf.archived_at,
    );
    document = { pdf_resource_id: pdfId, author_user_id: userId, markdown_resource_id: Number(info.lastInsertRowid), file_path: filePath };
    db.prepare(`INSERT INTO pdf_note_documents (pdf_resource_id, author_user_id, markdown_resource_id, file_path)
      VALUES (?, ?, ?, ?)`).run(pdfId, userId, document.markdown_resource_id, filePath);
  }
  db.prepare("UPDATE resources SET name = ? WHERE id = ?").run(`${pdf.name} — заметки.md`, document.markdown_resource_id);
  writeAtomically(document.file_path, render(pdf, notes));
  return document;
}

export function ensurePdfNoteDocumentsForUser(userId: number): void {
  const missing = db.prepare(`SELECT DISTINCT n.resource_id FROM pdf_notes n
    JOIN resources r ON r.id = n.resource_id AND r.category = 'pdf' AND r.archived_at IS NULL
    LEFT JOIN pdf_note_documents d ON d.pdf_resource_id = n.resource_id AND d.author_user_id = n.author_user_id
    WHERE n.author_user_id = ? AND d.markdown_resource_id IS NULL`).all(userId) as { resource_id: number }[];
  for (const row of missing) db.transaction(() => syncPdfNoteMarkdown(row.resource_id, userId))();
}

export function syncAllPdfNoteDocuments(): void {
  const pairs = db.prepare(`SELECT d.pdf_resource_id AS pdf_id, d.author_user_id AS user_id FROM pdf_note_documents d
    UNION SELECT n.resource_id AS pdf_id, n.author_user_id AS user_id FROM pdf_notes n`)
    .all() as { pdf_id: number; user_id: number }[];
  for (const pair of pairs) db.transaction(() => syncPdfNoteMarkdown(pair.pdf_id, pair.user_id))();
}
