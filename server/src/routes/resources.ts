import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { db } from "../db/db";
import { VAULT_ROOT, assertVaultPath, ensureSubfolder, isVaultPath, openInFileExplorer, sanitizeName, toFileUrl, vaultAbs, vaultRel } from "../services/filesystem";
import { storeDeduped, storeDedupedFile } from "../services/vaultDedup";
import type { AuthedRequest } from "../services/auth";
import { ensurePdfNoteDocumentsForUser, isPdfNoteDocument, syncPdfNoteMarkdown } from "../services/pdfNoteMarkdown";
import { BUNDLE_RESOURCE_URL, rewriteMarkdownTargets, safeBundlePath } from "../services/markdownBundle";

// Local Windows path ("C:\...") or a UNC share ("\\server\...") — the only
// kind of "folder" a link_url can point at (see client/src/resourceCategories.ts).
const LOCAL_PATH = /^[a-zA-Z]:[\\/]|^\\\\/;

// English subfolder names for uploaded files, one per resource category (see
// client/src/resourceCategories.ts) — keeps a session's "resources" folder
// organized on disk instead of one flat pile of mixed files.
const CATEGORY_SUBDIR: Record<string, string> = {
  pdf: "pdf",
  markdown: "markdown",
  image: "images",
  audio: "audio",
  other: "other",
};

export const resourcesRouter = Router();
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try { cb(null, vaultAbs(ensureSubfolder(VAULT_ROOT, ".uploads"))); }
      catch (error) { cb(error as Error, ""); }
    },
    filename(_req, _file, cb) { cb(null, crypto.randomUUID() + ".upload"); },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype) || /\.(pdf|md)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Допускаются изображения, PDF и Markdown (.md)"));
  },
});

function uploadResourceFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "Файл слишком большой (не более 200 МБ)" });
    if (error) return res.status(400).json({ error: error instanceof Error ? error.message : "Ошибка загрузки" });
    next();
  });
}

interface ResourceBody {
  name: string;
  type?: string;
  scope: "global" | "campaign" | "session" | "setting" | "system";
  campaign_id?: string;
  session_id?: string;
  setting_id?: string;
  system_id?: string;
  template_kind?: string;
  template_format?: string;
  link_url?: string;
  category?: string;
  tags?: string;
  notes?: string;
  content?: string;
}

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

function validMarkdown(buffer: Buffer): string | null {
  if (buffer.length > MAX_MARKDOWN_BYTES) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
  catch { return null; }
}

function withFileUrl<T extends { file_path?: string | null; type?: string | null }>(row: T) {
  return {
    ...row,
    file_url: row.type === "pdf_notes" ? null : row.file_path ? toFileUrl(row.file_path) : null,
    markdown_linkable: !!row.file_path && isVaultPath(row.file_path),
  };
}

function ensureResourceUid<T extends { id: number; uid?: string | null }>(row: T): T & { uid: string } {
  if (row.uid) return row as T & { uid: string };
  const uid = crypto.randomUUID();
  db.prepare("UPDATE resources SET uid = ? WHERE id = ? AND uid IS NULL").run(uid, row.id);
  const current = db.prepare("SELECT uid FROM resources WHERE id = ?").get(row.id) as { uid: string };
  return { ...row, uid: current.uid };
}

function resolveFolder(body: ResourceBody): string {
  if (body.scope === "campaign" && body.campaign_id) {
    const row = db
      .prepare("SELECT folder_path FROM campaigns WHERE id = ?")
      .get(body.campaign_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  if (body.scope === "session" && body.session_id) {
    const row = db
      .prepare("SELECT folder_path FROM sessions WHERE id = ?")
      .get(body.session_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "resources");
  }
  if (body.scope === "setting" && body.setting_id) {
    const row = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(body.setting_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  if (body.scope === "system" && body.system_id) {
    const row = db
      .prepare("SELECT folder_path FROM systems WHERE id = ?")
      .get(body.system_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  return ensureSubfolder(VAULT_ROOT, "Resources");
}

const BUNDLE_MAX_BYTES = 100 * 1024 * 1024;
const BUNDLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".pdf", ".md"]);
const bundleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file");

function bundleScope(body: ResourceBody): boolean {
  const keys: Record<string, [string, string] | null> = {
    global: null, campaign: ["campaigns", "campaign_id"], session: ["sessions", "session_id"],
    setting: ["settings", "setting_id"], system: ["systems", "system_id"],
  };
  if (!Object.hasOwn(keys, body.scope)) return false;
  const pair = keys[body.scope];
  if (!pair) return true;
  const id = body[pair[1] as keyof ResourceBody];
  return !!id && /^\d+$/.test(id) && !!db.prepare(`SELECT id FROM ${pair[0]} WHERE id = ?`).get(id);
}

// A bundle has one root Markdown file. Never extract ZIP paths onto disk: read
// validated entries as buffers, then place them in newly generated vault names.
resourcesRouter.post("/markdown-bundle", bundleUpload, async (req, res) => {
  const body = req.body as ResourceBody;
  if (!req.file || !/\.zip$/i.test(req.file.originalname)) return res.status(400).json({ error: "Нужен ZIP-комплект" });
  if (!bundleScope(body)) return res.status(400).json({ error: "Выберите существующую область для Ресурса" });
  const createdPaths: string[] = [];
  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = new Map<string, Buffer>();
    let total = 0;
    const zipEntries = zip.getEntries();
    if (zipEntries.length > 200) throw new Error("Слишком много файлов в комплекте");
    for (const entry of zipEntries) {
      if ((entry.header.attr >>> 16 & 0o170000) === 0o120000) throw new Error("Символические ссылки в ZIP запрещены");
      const name = safeBundlePath(entry.entryName.replace(/\/$/, ""));
      if (!name || entries.has(name) || entry.entryName.includes("\\")) throw new Error("Недопустимый или повторяющийся путь в ZIP");
      if (entry.isDirectory) continue;
      if (!BUNDLE_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) throw new Error("В комплекте есть неподдерживаемый файл");
      total += entry.header.size;
      if (total > BUNDLE_MAX_BYTES) throw new Error("Комплект слишком большой");
      const data = entry.getData();
      if (data.length !== entry.header.size) throw new Error("Повреждённый ZIP");
      entries.set(name, data);
    }
    const documents = [...entries.keys()].filter(name => !name.includes("/") && name.toLowerCase().endsWith(".md"));
    if (documents.length !== 1) throw new Error("В корне ZIP нужен ровно один .md файл");
    const mainName = documents[0];
    const referenced = new Set<string>();
    const visitedMarkdown = new Set<string>();
    const resolveLocal = (document: string, target: string): string | null => {
      if (target.startsWith("#") || /^(?:https?:|mailto:)/i.test(target)) return null;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) throw new Error("В комплекте нельзя ссылаться на другой внутренний Ресурс");
      const relative = safeBundlePath(target);
      const name = relative && safeBundlePath(path.posix.join(path.posix.dirname(document), relative));
      if (!name || name === mainName || !entries.has(name)) throw new Error(`Вложение не найдено или путь недопустим: ${target}`);
      return name;
    };
    const visitMarkdown = (name: string): string => {
      const content = validMarkdown(entries.get(name)!);
      if (content == null) throw new Error("Нужен UTF-8 Markdown до 2 МБ");
      if (visitedMarkdown.has(name)) return content;
      visitedMarkdown.add(name);
      rewriteMarkdownTargets(content, target => {
        const linked = resolveLocal(name, target);
        if (linked) {
          referenced.add(linked);
          if (linked.toLowerCase().endsWith(".md")) visitMarkdown(linked);
        }
        return target;
      });
      return content;
    };
    const original = visitMarkdown(mainName);
    if ([...entries.keys()].some(name => name !== mainName && !referenced.has(name))) throw new Error("В ZIP есть файлы без ссылок из Markdown");
    const folder = resolveFolder(body);
    const attachmentFolder = ensureSubfolder(folder, "attachments");
    const markdownFolder = ensureSubfolder(folder, "markdown");
    const linkByPath = new Map<string, string>();
    const rows: Array<{ uid: string; name: string; category: string; type: string; filePath: string; hash: string | null }> = [];
    for (const name of referenced) linkByPath.set(name, `soyman:resource/${crypto.randomUUID()}`);
    const rewriteLocal = (name: string, content: string) => rewriteMarkdownTargets(content, target => {
      const linked = resolveLocal(name, target);
      return linked ? linkByPath.get(linked)! : target;
    });
    for (const name of referenced) {
      const originalBytes = entries.get(name)!;
      const bytes = name.toLowerCase().endsWith(".md") ? Buffer.from(rewriteLocal(name, visitMarkdown(name)), "utf8") : originalBytes;
      if (name.toLowerCase().endsWith(".md") && bytes.length > MAX_MARKDOWN_BYTES) throw new Error("Вложение .md после импорта больше 2 МБ");
      if (name.toLowerCase().endsWith(".pdf") && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Вложение не является PDF");
      if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(name) && bytes.length > 15 * 1024 * 1024) throw new Error("Изображение больше 15 МБ");
      if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(name)) {
        const format = await sharp(bytes).metadata().then(meta => meta.format).catch(() => null);
        const expected = path.posix.extname(name).toLowerCase().replace(".", "");
        if (format !== (expected === "jpg" ? "jpeg" : expected)) throw new Error("Вложение не является изображением указанного типа");
      }
      const uid = linkByPath.get(name)!.slice("soyman:resource/".length);
      const ext = path.posix.extname(name).toLowerCase();
      const filePath = path.join(vaultAbs(attachmentFolder), `${uid}${ext}`);
      await storeDeduped(bytes, filePath);
      createdPaths.push(filePath);
      rows.push({ uid, name: path.posix.basename(name), category: ext === ".pdf" ? "pdf" : ext === ".md" ? "markdown" : "image", type: ext === ".md" ? "markdown" : "note", filePath, hash: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
    const content = rewriteLocal(mainName, original);
    const documentUid = crypto.randomUUID();
    const documentPath = path.join(vaultAbs(markdownFolder), `${sanitizeName(path.posix.parse(mainName).name)}-${documentUid}.md`);
    const documentBytes = Buffer.from(content, "utf8");
    if (documentBytes.length > MAX_MARKDOWN_BYTES) throw new Error("Markdown после импорта больше 2 МБ");
    await storeDeduped(documentBytes, documentPath);
    createdPaths.push(documentPath);
    const insert = db.prepare(`INSERT INTO resources
      (uid, name, type, scope, campaign_id, session_id, setting_id, system_id, template_format, file_path, file_sha256, category, tags, notes, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, '', '', ?)`);
    const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM resources WHERE scope = ? AND campaign_id IS ? AND session_id IS ? AND setting_id IS ? AND system_id IS ?")
      .get(body.scope, body.campaign_id ?? null, body.session_id ?? null, body.setting_id ?? null, body.system_id ?? null) as { m: number };
    let documentId = 0;
    db.transaction(() => {
      let position = maxPos.m;
      for (const row of rows) insert.run(row.uid, row.name, row.type, body.scope, body.campaign_id ?? null, body.session_id ?? null, body.setting_id ?? null, body.system_id ?? null, row.filePath, row.hash, row.category, ++position);
      documentId = Number(insert.run(documentUid, body.name?.trim() || mainName, "markdown", body.scope, body.campaign_id ?? null, body.session_id ?? null, body.setting_id ?? null, body.system_id ?? null, documentPath, crypto.createHash("sha256").update(documentBytes).digest("hex"), "markdown", ++position).lastInsertRowid);
    })();
    res.status(201).json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(documentId) as { file_path: string }));
  } catch (error) {
    for (const file of createdPaths) {
      await fs.promises.unlink(file).catch(() => undefined);
      try { db.prepare("DELETE FROM vault_files WHERE path = ?").run(vaultRel(file)); } catch { /* May not have a dedup row. */ }
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Не удалось импортировать комплект" });
  }
});

resourcesRouter.get("/", (req: AuthedRequest, res) => {
  ensurePdfNoteDocumentsForUser(req.user!.id);
  const { scope, campaign_id, session_id, setting_id, type, category, system_id, q } = req.query as Record<
    string,
    string | undefined
  >;
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (scope) {
    clauses.push("r.scope = @scope");
    params.scope = scope;
  }
  if (campaign_id) {
    clauses.push("r.campaign_id = @campaign_id");
    params.campaign_id = campaign_id;
  }
  if (session_id) {
    clauses.push("r.session_id = @session_id");
    params.session_id = session_id;
  }
  if (setting_id) {
    // Matches either the resource's home setting or one it was additionally
    // tagged into via resource_setting_links (see /:id/settings below).
    clauses.push(
      "(r.setting_id = @setting_id OR r.id IN (SELECT owner_id FROM resource_setting_links WHERE owner_type = 'resource' AND setting_id = @setting_id))"
    );
    params.setting_id = setting_id;
  }
  if (type) {
    clauses.push("r.type = @type");
    params.type = type;
  }
  if (category) {
    clauses.push("r.category = @category");
    params.category = category;
  }
  if (system_id) {
    clauses.push("r.system_id = @system_id");
    params.system_id = system_id;
  }
  if (q) {
    // lower_u — юникодный lower из db.ts: встроенный LIKE в SQLite приводит
    // регистр только у латиницы, и «гуманоид» не находил «Гуманоид».
    clauses.push("lower_u(r.name) LIKE @q");
    params.q = `%${q.toLowerCase()}%`;
  }
  clauses.push("r.archived_at IS NULL");
  clauses.push("(r.type <> 'pdf_notes' OR d.author_user_id = @viewer_id)");
  params.viewer_id = String(req.user!.id);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // Only relevant when browsing without a specific setting_id (e.g. searching
  // audio across every setting for the playlist "add track" picker) — lets
  // the client show which setting a result belongs to.
  const rows = db
    .prepare(
      `SELECT r.*, sys.name as system_name, st.name as setting_name,
        d.pdf_resource_id as linked_pdf_resource_id FROM resources r
       LEFT JOIN systems sys ON sys.id = r.system_id
       LEFT JOIN settings st ON st.id = r.setting_id
       LEFT JOIN pdf_note_documents d ON d.markdown_resource_id = r.id
       ${where} ORDER BY r.position, r.name COLLATE NOCASE`
    )
    .all(params) as { id: number; file_path: string | null }[];

  // One extra query for the whole list (not N+1) to attach each resource's
  // additional setting tags, for the global Ресурсы library's multi-setting
  // membership feature.
  const linkRows = db
    .prepare("SELECT owner_id, setting_id FROM resource_setting_links WHERE owner_type = 'resource'")
    .all() as { owner_id: number; setting_id: number }[];
  const linksByResource = new Map<number, number[]>();
  for (const l of linkRows) {
    const list = linksByResource.get(l.owner_id) ?? [];
    list.push(l.setting_id);
    linksByResource.set(l.owner_id, list);
  }

  res.json(
    rows.map((row) => ({
      ...withFileUrl(ensureResourceUid(row)),
      also_in_settings: linksByResource.get(row.id) ?? [],
      size_bytes: row.file_path ? statSizeOrNull(row.file_path) : null,
    }))
  );
});

function statSizeOrNull(filePath: string): number | null {
  try {
    return fs.statSync(vaultAbs(filePath)).size;
  } catch {
    return null;
  }
}

// Markdown links resolve by stable Resource UID, never by a vault path or a
// database-local numeric ID. The general API role gate keeps this GM-only;
// generated PDF notes remain private to their author.
resourcesRouter.get("/resolve", (req: AuthedRequest, res) => {
  const raw = typeof req.query.uids === "string" ? req.query.uids : "";
  const uids = [...new Set(raw.split(",").filter(Boolean))];
  if (!uids.length || uids.length > 100 || uids.some(uid => !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uid)))
    return res.status(400).json({ error: "Некорректные ключи Ресурсов" });
  const rows = db.prepare(`SELECT r.*, d.author_user_id AS notes_author FROM resources r
    LEFT JOIN pdf_note_documents d ON d.markdown_resource_id = r.id
    WHERE lower(r.uid) IN (${uids.map(() => "?").join(",")}) AND r.archived_at IS NULL`)
    .all(...uids.map(uid => uid.toLowerCase())) as Array<{ id: number; uid: string; type: string; category: string | null; name: string; file_path: string | null; link_url: string | null; notes_author: number | null }>;
  res.json(rows.filter(row => row.type !== "pdf_notes" || row.notes_author === req.user!.id)
    .map(row => {
      let filePath: string | null = null;
      try { if (row.file_path && fs.existsSync(assertVaultPath(row.file_path))) filePath = row.file_path; }
      catch { /* No vault path is exposed for a missing or external file. */ }
      return {
        uid: row.uid, id: row.id, name: row.name, type: row.type, category: row.category,
        file_url: filePath ? toFileUrl(filePath) : null,
      };
    }));
});

// --- "Also present in this setting" tags (global Ресурсы library) ---

resourcesRouter.get("/:id/settings", (req, res) => {
  const rows = db
    .prepare("SELECT setting_id FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ?")
    .all(req.params.id) as { setting_id: number }[];
  res.json(rows.map((r) => r.setting_id));
});

resourcesRouter.post("/:id/settings", (req, res) => {
  const { setting_id } = req.body as { setting_id?: number };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO resource_setting_links (owner_type, owner_id, setting_id) VALUES ('resource', ?, ?)"
  ).run(req.params.id, setting_id);
  res.json({ ok: true });
});

resourcesRouter.delete("/:id/settings/:settingId", (req, res) => {
  db.prepare(
    "DELETE FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ? AND setting_id = ?"
  ).run(req.params.id, req.params.settingId);
  res.json({ ok: true });
});

resourcesRouter.get("/:id", (req: AuthedRequest, res) => {
  const row = db
    .prepare(
      `SELECT r.*, sys.name as system_name, d.pdf_resource_id as linked_pdf_resource_id,
       d.author_user_id as markdown_author_user_id FROM resources r
       LEFT JOIN systems sys ON sys.id = r.system_id
       LEFT JOIN pdf_note_documents d ON d.markdown_resource_id = r.id
       WHERE r.id = ?`
    )
    .get(req.params.id) as { file_path: string | null; markdown_author_user_id?: number | null; type?: string } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.type === "pdf_notes" && row.markdown_author_user_id == null) return res.status(404).json({ error: "not found" });
  if (row.markdown_author_user_id != null && row.markdown_author_user_id !== req.user!.id) return res.status(404).json({ error: "not found" });
  res.json(withFileUrl(ensureResourceUid(row as typeof row & { id: number; uid?: string | null })));
});

resourcesRouter.get("/:id/markdown-content", (req, res) => {
  const row = db.prepare("SELECT type, file_path FROM resources WHERE id = ? AND archived_at IS NULL")
    .get(req.params.id) as { type: string; file_path: string | null } | undefined;
  if (!row || row.type !== "markdown" || !row.file_path) return res.status(404).json({ error: "Markdown-ресурс не найден" });
  try {
    const buffer = fs.readFileSync(assertVaultPath(row.file_path));
    const content = validMarkdown(buffer);
    if (content == null) return res.status(422).json({ error: "Файл не является небольшим UTF-8 Markdown" });
    res.json({ resource_id: Number(req.params.id), content, sha256: crypto.createHash("sha256").update(buffer).digest("hex") });
  } catch { res.status(404).json({ error: "Файл Markdown не найден" }); }
});

resourcesRouter.get("/:id/markdown-bundle", (req: AuthedRequest, res) => {
  const row = db.prepare("SELECT name, type, file_path FROM resources WHERE id = ? AND archived_at IS NULL")
    .get(req.params.id) as { name: string; type: string; file_path: string | null } | undefined;
  if (!row || row.type !== "markdown" || !row.file_path) return res.status(404).json({ error: "Markdown-ресурс не найден" });
  try {
    const source = validMarkdown(fs.readFileSync(assertVaultPath(row.file_path)));
    if (source == null) return res.status(422).json({ error: "Нужен UTF-8 Markdown до 2 МБ" });
    const uids = new Set<string>();
    const scan = (content: string) => rewriteMarkdownTargets(content, target => {
      const uid = BUNDLE_RESOURCE_URL.exec(target)?.[1]?.toLowerCase();
      if (uid) uids.add(uid);
      else if (!target.startsWith("#") && !/^(?:https?:|mailto:)/i.test(target))
        throw new Error(`Ссылка не входит в комплект: ${target}`);
      return target;
    });
    scan(source);
    const targets = new Map<string, { bytes: Buffer; zipPath: string; markdown: boolean }>();
    const names = new Set<string>();
    let total = Buffer.byteLength(source, "utf8");
    for (const uid of uids) {
      if (uids.size > 100) return res.status(422).json({ error: "Слишком много вложений" });
      const target = db.prepare(`SELECT r.name, r.type, r.category, r.file_path, d.author_user_id AS notes_author FROM resources r
        LEFT JOIN pdf_note_documents d ON d.markdown_resource_id = r.id WHERE lower(r.uid) = ? AND r.archived_at IS NULL`)
        .get(uid) as { name: string; type: string; category: string | null; file_path: string | null; notes_author: number | null } | undefined;
      if (!target || target.type === "pdf_notes" || !target.file_path) return res.status(409).json({ error: "Одно из вложений недоступно. Восстановите его перед экспортом." });
      const file = assertVaultPath(target.file_path);
      const bytes = fs.readFileSync(file);
      total += bytes.length;
      if (total > BUNDLE_MAX_BYTES) return res.status(413).json({ error: "Комплект больше 100 МБ" });
      const ext = path.extname(file).toLowerCase();
      if (!BUNDLE_EXTENSIONS.has(ext)) return res.status(422).json({ error: "Вложение неподдерживаемого типа" });
      const original = sanitizeName(target.name).replace(/[?#%]/g, "_");
      const stem = path.parse(original).name || "file";
      const base = original.toLowerCase().endsWith(ext) ? original : `${original}${ext}`;
      let filename = base;
      for (let n = 2; names.has(filename.toLocaleLowerCase("ru")); n++) filename = `${stem}-${n}${ext}`;
      names.add(filename.toLocaleLowerCase("ru"));
      const markdown = target.type === "markdown";
      targets.set(uid, { bytes, zipPath: `assets/${filename}`, markdown });
      if (markdown) {
        const nested = validMarkdown(bytes);
        if (nested == null) return res.status(422).json({ error: "Вложение .md должно быть UTF-8 до 2 МБ" });
        scan(nested);
      }
    }
    const portable = (content: string, from: string) => rewriteMarkdownTargets(content, target => {
      const uid = BUNDLE_RESOURCE_URL.exec(target)?.[1]?.toLowerCase();
      const entry = uid && targets.get(uid);
      const relative = entry && path.posix.relative(path.posix.dirname(from), entry.zipPath);
      if (relative?.startsWith("../")) throw new Error("Ссылка выходит за пределы каталога вложений");
      return relative ? relative.split("/").map(encodeURIComponent).join("/") : target;
    });
    const zip = new AdmZip();
    let mainName = sanitizeName(row.name).replace(/[?#%]/g, "_");
    if (!mainName.toLowerCase().endsWith(".md")) mainName += ".md";
    zip.addFile(mainName, Buffer.from(portable(source, mainName), "utf8"));
    for (const { bytes, zipPath, markdown } of targets.values())
      zip.addFile(zipPath, markdown ? Buffer.from(portable(validMarkdown(bytes)!, zipPath), "utf8") : bytes);
    const buffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="markdown-bundle-${req.params.id}.zip"`);
    res.send(buffer);
  } catch (error) {
    console.error("Markdown bundle export failed", error);
    res.status(409).json({ error: "Не удалось собрать комплект: проверьте файлы вложений" });
  }
});

resourcesRouter.put("/:id/markdown-content", async (req, res) => {
  const row = db.prepare("SELECT type, file_path FROM resources WHERE id = ? AND archived_at IS NULL")
    .get(req.params.id) as { type: string; file_path: string | null } | undefined;
  if (!row || row.type !== "markdown" || !row.file_path) return res.status(404).json({ error: "Markdown-ресурс не найден" });
  const { content, expected_sha256: expectedHash } = (req.body ?? {}) as { content?: unknown; expected_sha256?: unknown };
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES)
    return res.status(400).json({ error: "Markdown должен быть текстом до 2 МБ" });
  if (expectedHash !== undefined && (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)))
    return res.status(400).json({ error: "Неверная версия Markdown" });
  const buffer = Buffer.from(content, "utf8");
  try {
    if (expectedHash) {
      const current = fs.readFileSync(assertVaultPath(row.file_path));
      if (crypto.createHash("sha256").update(current).digest("hex") !== expectedHash)
        return res.status(409).json({ error: "Файл изменился в другом окне. Сохраните свой черновик отдельно и обновите страницу." });
    }
    await storeDeduped(buffer, assertVaultPath(row.file_path));
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    db.prepare("UPDATE resources SET file_sha256 = ? WHERE id = ?")
      .run(sha256, req.params.id);
    res.json({ resource_id: Number(req.params.id), content, sha256 });
  } catch (error) {
    console.error("Markdown save failed", error);
    res.status(500).json({ error: "Не удалось сохранить Markdown" });
  }
});

resourcesRouter.post("/", uploadResourceFile, async (req, res) => {
  const body = req.body as ResourceBody;
  const temporary = req.file?.path;
  let uploadedPdfPath: string | null = null;
  let uploadedMarkdownPath: string | null = null;
  try {
    if (!body.name || !body.scope)
      return res.status(400).json({ error: "name and scope are required" });

    const isPdf = !!req.file && /\.pdf$/i.test(req.file.originalname);
    const isMarkdownFile = !!req.file && /\.md$/i.test(req.file.originalname);
    const createMarkdown = !req.file && body.category === "markdown";
    if (body.type === "markdown" && !isMarkdownFile && !createMarkdown)
      return res.status(400).json({ error: "Для Markdown-ресурса нужен .md файл" });
    let markdownContent: string | null = null;
    if (req.file) {
      if (isPdf) {
        const magic = Buffer.alloc(5);
        const fd = fs.openSync(req.file.path, "r");
        try { fs.readSync(fd, magic, 0, 5, 0); } finally { fs.closeSync(fd); }
        if (magic.toString("ascii") !== "%PDF-")
          return res.status(400).json({ error: "Файл не является PDF" });
        body.category = "pdf";
      } else if (isMarkdownFile) {
        markdownContent = validMarkdown(fs.readFileSync(req.file.path));
        if (markdownContent == null) return res.status(400).json({ error: "Нужен UTF-8 Markdown до 2 МБ" });
        body.category = "markdown";
        body.type = "markdown";
      } else if (body.category === "pdf") {
        return res.status(400).json({ error: "Для категории PDF нужен PDF-файл" });
      } else if (body.category === "markdown") {
        return res.status(400).json({ error: "Для категории Markdown нужен .md файл" });
      } else if (!ALLOWED_IMAGE_MIMES.test(req.file.mimetype) || req.file.size > 15 * 1024 * 1024) {
        return res.status(400).json({ error: "Изображение должно быть меньше 15 МБ" });
      } else if (!body.category) {
        body.category = "image";
      }
    } else if (createMarkdown) {
      if (typeof body.content !== "string" || Buffer.byteLength(body.content, "utf8") > MAX_MARKDOWN_BYTES)
        return res.status(400).json({ error: "Markdown должен быть текстом до 2 МБ" });
      markdownContent = body.content;
      body.type = "markdown";
    }

    const folder = resolveFolder(body);
    let filePath: string | null = null;
    let fileSha256: string | null = null;
    if (req.file || createMarkdown) {
      const subdir = body.category ? CATEGORY_SUBDIR[body.category] : undefined;
      const targetFolder = subdir ? ensureSubfolder(folder, subdir) : folder;
      const original = sanitizeName(req.file?.originalname ?? `${body.name}.md`);
      const targetName = isPdf ? `${path.parse(original).name}-${crypto.randomUUID()}.pdf`
        : (isMarkdownFile || createMarkdown) ? `${path.parse(original).name}-${crypto.randomUUID()}.md` : original;
      const target = path.join(vaultAbs(targetFolder), targetName);
      if (isPdf) {
        uploadedPdfPath = target;
        fileSha256 = await storeDedupedFile(req.file!.path, target);
      } else if (isMarkdownFile || createMarkdown) {
        uploadedMarkdownPath = target;
        const buffer = Buffer.from(markdownContent ?? "", "utf8");
        await storeDeduped(buffer, target);
        fileSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      } else if (req.file) {
        await storeDeduped(fs.readFileSync(req.file.path), target);
      }
      filePath = target;
    }

    const maxPos = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) as m FROM resources
         WHERE scope = ? AND campaign_id IS ? AND session_id IS ? AND setting_id IS ? AND system_id IS ?`
      )
      .get(
        body.scope,
        body.campaign_id ?? null,
        body.session_id ?? null,
        body.setting_id ?? null,
        body.system_id ?? null
      ) as { m: number };

    const info = db
      .prepare(
      `INSERT INTO resources (uid, name, type, scope, campaign_id, session_id, setting_id, system_id, template_kind, template_format, file_path, file_sha256, link_url, category, tags, notes, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        body.name,
        body.type || "note",
        body.scope,
        body.campaign_id ?? null,
        body.session_id ?? null,
        body.setting_id ?? null,
        body.system_id ?? null,
        body.template_kind ?? null,
        body.template_format || "text",
        filePath,
        fileSha256,
        body.link_url || null,
        body.category ?? null,
        body.tags || "",
        body.notes || "",
        maxPos.m + 1
      );
    res.status(201).json(withFileUrl(
      db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }
    ));
  } catch (error) {
    if (uploadedPdfPath) {
      await fs.promises.unlink(uploadedPdfPath).catch(() => undefined);
      try { db.prepare("DELETE FROM vault_files WHERE path = ?").run(vaultRel(uploadedPdfPath)); }
      catch (cleanupError) { console.error("PDF upload cleanup failed", cleanupError); }
    }
    if (uploadedMarkdownPath) {
      await fs.promises.unlink(uploadedMarkdownPath).catch(() => undefined);
      try { db.prepare("DELETE FROM vault_files WHERE path = ?").run(vaultRel(uploadedMarkdownPath)); }
      catch (cleanupError) { console.error("Markdown upload cleanup failed", cleanupError); }
    }
    console.error("Resource upload failed", error);
    res.status(500).json({ error: "Не удалось добавить ресурс" });
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => undefined);
  }
});

// Manual drag reorder — same "order: number[] of ids -> position = index"
// shape already used by /gallery/reorder and /playlists/:id/items/reorder.
// Not scoped server-side: the client only ever sends the ids of one
// category group within one owner, so this just persists that local order.
// Must be registered before PUT /:id or Express would match "reorder" as
// the :id param instead.
resourcesRouter.put("/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const setPos = db.prepare("UPDATE resources SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => setPos.run(i, id));
  });
  tx(order ?? []);
  res.json({ ok: true });
});

// Bulk-prepends/appends a shared prefix/suffix to the display name of
// several selected resources at once (e.g. renaming a batch of session
// handouts to "Сессия 3 - <name>").
resourcesRouter.post("/bulk-rename", (req, res) => {
  const { ids, prefix, suffix } = req.body as { ids: number[]; prefix?: string; suffix?: string };
  const getName = db.prepare("SELECT name FROM resources WHERE id = ?");
  const setName = db.prepare("UPDATE resources SET name = ? WHERE id = ?");
  const tx = db.transaction((targetIds: number[]) => {
    for (const id of targetIds) {
      if (isPdfNoteDocument(id)) continue;
      const row = getName.get(id) as { name: string } | undefined;
      if (!row) continue;
      setName.run(`${prefix ?? ""}${row.name}${suffix ?? ""}`, id);
      const authors = db.prepare("SELECT author_user_id FROM pdf_note_documents WHERE pdf_resource_id = ?")
        .all(id) as { author_user_id: number }[];
      for (const author of authors) syncPdfNoteMarkdown(id, author.author_user_id);
    }
  });
  tx(ids ?? []);
  res.json({ ok: true });
});

resourcesRouter.put("/:id", (req, res) => {
  if (isPdfNoteDocument(Number(req.params.id))) return res.status(409).json({ error: "Заметки правятся в PDF-читалке" });
  const { name, type, tags, notes, system_id, template_kind, template_format, link_url, category } = req.body as {
    name?: string;
    type?: string;
    tags?: string;
    notes?: string;
    system_id?: number | null;
    template_kind?: string;
    template_format?: string;
    link_url?: string;
    category?: string;
  };
  db.transaction(() => {
  db.prepare(
    `UPDATE resources SET
       name = COALESCE(?, name), type = COALESCE(?, type),
       tags = COALESCE(?, tags), notes = COALESCE(?, notes),
       system_id = COALESCE(?, system_id), template_kind = COALESCE(?, template_kind),
       template_format = COALESCE(?, template_format),
       link_url = COALESCE(?, link_url),
       category = COALESCE(?, category)
     WHERE id = ?`
  ).run(
    name ?? null,
    type ?? null,
    tags ?? null,
    notes ?? null,
    system_id ?? null,
    template_kind ?? null,
    template_format ?? null,
    link_url ?? null,
    category ?? null,
    req.params.id
  );
  if (name != null) {
    const authors = db.prepare("SELECT author_user_id FROM pdf_note_documents WHERE pdf_resource_id = ?")
      .all(req.params.id) as { author_user_id: number }[];
    for (const author of authors) syncPdfNoteMarkdown(Number(req.params.id), author.author_user_id);
  }
  })();
  res.json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id) as { file_path: string | null }));
});

// Reveals the resource's file (or, for a "folder" link, the folder itself) in
// the OS file explorer. Runs on the same machine as the vault, so shelling
// out locally is safe here — this is a desktop tool, not a public server.
resourcesRouter.post("/:id/reveal", (req, res) => {
  if (isPdfNoteDocument(Number(req.params.id))) return res.status(409).json({ error: "Этот файл открывается в приложении" });
  const row = db
    .prepare("SELECT file_path, link_url, category FROM resources WHERE id = ?")
    .get(req.params.id) as { file_path: string | null; link_url: string | null; category: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  const target =
    row.file_path || (row.category === "folder" && row.link_url && LOCAL_PATH.test(row.link_url) ? row.link_url : null);
  if (!target) return res.status(400).json({ error: "no local path to reveal" });

  openInFileExplorer(target, !!row.file_path, true);
  res.json({ ok: true });
});

// Avoids silently overwriting an unrelated same-named file in the target
// folder — appends "-2", "-3", … before the extension until free.
function uniqueTargetPath(folder: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const absFolder = vaultAbs(folder);
  let candidate = path.join(absFolder, filename);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(absFolder, `${base}-${n}${ext}`);
  }
  return candidate;
}

// Promotes a resource (typically session-scoped) up to setting scope, so it
// can be attached to other sessions instead of re-uploaded — copies the row
// and, if present, the physical file; the two rows are independent
// afterwards (editing/deleting one doesn't affect the other), same as the
// setting-calendar → campaign-calendar copy pattern elsewhere in this app.
resourcesRouter.post("/:id/promote", async (req, res) => {
  if (isPdfNoteDocument(Number(req.params.id))) return res.status(409).json({ error: "Связанные заметки не копируются отдельно от PDF" });
  const { setting_id } = req.body as { setting_id?: number };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });

  const source = db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id) as
    | {
        name: string;
        type: string;
        category: string | null;
        file_path: string | null;
        link_url: string | null;
        tags: string;
        notes: string;
      }
    | undefined;
  if (!source) return res.status(404).json({ error: "not found" });

  const folder = resolveFolder({ scope: "setting", setting_id: String(setting_id) } as ResourceBody);
  let filePath: string | null = null;
  if (source.file_path && fs.existsSync(vaultAbs(source.file_path))) {
    const subdir = source.category ? CATEGORY_SUBDIR[source.category] : undefined;
    const targetFolder = subdir ? ensureSubfolder(folder, subdir) : folder;
    const target = uniqueTargetPath(targetFolder, path.basename(source.file_path));
    await storeDeduped(fs.readFileSync(vaultAbs(source.file_path)), target);
    filePath = vaultRel(target);
  }

  const info = db
    .prepare(
      `INSERT INTO resources (name, type, scope, setting_id, template_format, file_path, link_url, category, tags, notes)
       VALUES (?, ?, 'setting', ?, 'text', ?, ?, ?, ?, ?)`
    )
    .run(source.name, source.type, setting_id, filePath, source.link_url, source.category, source.tags, source.notes);

  // Tracks that this source resource was already promoted, so the client can
  // grey out the "В сеттинг" button instead of letting it be promoted again —
  // and re-enable it if the promoted copy is later archived/deleted.
  db.prepare(
    `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
     VALUES ('resource', ?, 'resource', ?, 'promoted_to_setting')`
  ).run(req.params.id, info.lastInsertRowid);

  res
    .status(201)
    .json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }));
});

// Attaches a location's map image to a session as an ordinary image
// resource — same dedup-copy approach as /:id/promote above, since a map
// isn't itself a `resources` row (it lives on `setting_locations`).
resourcesRouter.post("/from-location-map", async (req, res) => {
  const { location_id, session_id } = req.body as { location_id?: number; session_id?: number };
  if (!location_id || !session_id) return res.status(400).json({ error: "location_id and session_id are required" });

  const location = db
    .prepare("SELECT name, map_image_path FROM setting_locations WHERE id = ?")
    .get(location_id) as { name: string; map_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "location not found" });
  if (!location.map_image_path) return res.status(400).json({ error: "location has no map" });

  const folder = resolveFolder({ scope: "session", session_id: String(session_id) } as ResourceBody);
  const targetFolder = ensureSubfolder(folder, CATEGORY_SUBDIR.image);
  const target = uniqueTargetPath(targetFolder, path.basename(location.map_image_path));
  await storeDeduped(fs.readFileSync(vaultAbs(location.map_image_path)), target);

  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) as m FROM resources WHERE scope = 'session' AND session_id = ?`
    )
    .get(session_id) as { m: number };

  // type must be 'link' (the value every other resource row gets from the
  // normal creation path — see POST / above) not 'file': SessionDetailPage
  // only ever passes session.resources.filter(r => r.type === "link") into
  // ResourcesSection, so any other value silently hides the row from the
  // session's Ресурсы tab despite the row existing in the DB.
  const info = db
    .prepare(
      `INSERT INTO resources (name, type, scope, session_id, template_format, file_path, category, position)
       VALUES (?, 'link', 'session', ?, 'text', ?, 'map', ?)`
    )
    .run(`Карта: ${location.name}`, session_id, vaultRel(target), maxPos.m + 1);

  res
    .status(201)
    .json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }));
});

resourcesRouter.delete("/:id", (req, res) => {
  if (isPdfNoteDocument(Number(req.params.id))) return res.status(409).json({ error: "Архивируйте связанный PDF" });
  db.transaction(() => {
    db.prepare("UPDATE resources SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
    db.prepare(`UPDATE resources SET archived_at = datetime('now') WHERE id IN
      (SELECT markdown_resource_id FROM pdf_note_documents WHERE pdf_resource_id = ?)`).run(req.params.id);
  })();
  res.json({ ok: true });
});

resourcesRouter.put("/:id/restore", (req, res) => {
  if (isPdfNoteDocument(Number(req.params.id))) return res.status(409).json({ error: "Восстановите связанный PDF" });
  db.transaction(() => {
    db.prepare("UPDATE resources SET archived_at = NULL WHERE id = ?").run(req.params.id);
    db.prepare(`UPDATE resources SET archived_at = NULL WHERE id IN
      (SELECT markdown_resource_id FROM pdf_note_documents WHERE pdf_resource_id = ?)`).run(req.params.id);
  })();
  res.json(db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id));
});
