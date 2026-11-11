import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import path from "path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/db";
import { requireKind } from "../db/entityKinds";
import { artifactFolder, beingFolder, communityFolder, locationFolder, settingGeographyRoot } from "../services/filesystem";

// Захват с сайтов расширением браузера (гриллинг 2026-11-05, Q1–Q24;
// .scratch/web-sources/extension-decisions.md).
//
// Два роутера. Расширение ходит со своим ключом, не с входом Мастера: ключ
// выдаётся в обмен на одноразовый код из настроек и умеет только положить
// фрагмент во Входящие, создать из него сущность («Разобрать сейчас»,
// поставка 2) и узнать, жив ли он. В базе — только хэши. Всё
// остальное (выдать код, разобрать Входящие, отключить ключ) — Мастер, за
// общим гейтом /api.

export const webCaptureExtRouter = Router();
export const webCaptureRouter = Router();

const PAIRING_TTL_MS = 10 * 60 * 1000;
const KEY_BYTES = 32;
// Без похожих знаков (0/O, 1/I/L): код набирают руками.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Событие процесса для electron/main.js: открыть окно SoyMan на маршруте. */
export const OPEN_ROUTE_EVENT = "soyman:open-route";

const sha256Hex = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
const nowIso = () => new Date().toISOString();
const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

interface ExtRequest extends Request {
  webCaptureKeyId?: string;
}

function requireExtensionKey(req: ExtRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = token
    ? (db.prepare("SELECT id FROM web_capture_keys WHERE token_hash = ? AND revoked_at IS NULL")
        .get(sha256Hex(token)) as { id: string } | undefined)
    : undefined;
  if (!row) {
    res.status(401).json({ error: "Расширение не подключено к SoyMan" });
    return;
  }
  req.webCaptureKeyId = row.id;
  db.prepare("UPDATE web_capture_keys SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.id);
  next();
}

// ───────────── Расширение ─────────────

const pairInput = z.object({ code: z.string().max(32), label: z.string().max(80).optional() });

webCaptureExtRouter.post("/pair", (req, res) => {
  const parsed = pairInput.safeParse(req.body);
  const code = parsed.success ? normalizeCode(parsed.data.code) : "";
  if (code.length !== CODE_LENGTH) return res.status(400).json({ error: "Код — шесть знаков из окна SoyMan" });
  // Проверка и выдача одной транзакцией: два обмена одного кода не получат два ключа.
  const result = db.transaction(() => {
    const row = db.prepare("SELECT expires_at, used_at FROM web_capture_pairings WHERE code_hash = ?")
      .get(sha256Hex(code)) as { expires_at: string; used_at: string | null } | undefined;
    if (!row || row.used_at || row.expires_at <= nowIso()) return null;
    const id = randomUUID();
    const key = randomBytes(KEY_BYTES).toString("base64url");
    db.prepare("INSERT INTO web_capture_keys (id, token_hash, label) VALUES (?, ?, ?)")
      .run(id, sha256Hex(key), (parsed.success && parsed.data.label?.trim()) || "Браузер");
    db.prepare("UPDATE web_capture_pairings SET used_at = ? WHERE code_hash = ?").run(nowIso(), sha256Hex(code));
    return { key };
  })();
  // 401, а не 404: общий лимитер считает именно неудачные попытки.
  if (!result) return res.status(401).json({ error: "Код не подошёл: он неверный, уже использован или истёк" });
  res.status(201).json(result);
});

webCaptureExtRouter.get("/status", requireExtensionKey, (_req, res) => {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM web_inbox").get() as { n: number };
  res.json({ connected: true, inbox: n });
});

const inboxInput = z.object({
  client_id: z.string().min(8).max(64),
  url: z.string().max(4096).refine((u) => /^https?:\/\//i.test(u), "Только адрес сайта"),
  page_title: z.string().max(1000).default(""),
  heading: z.string().max(1000).default(""),
  text: z.string().min(1).max(200_000),
  captured_at: z.string().max(40).optional(),
});

webCaptureExtRouter.post("/inbox", requireExtensionKey, (req, res) => {
  const parsed = inboxInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Фрагмент не принят: нет текста или адреса страницы" });
  const item = parsed.data;
  const captured = item.captured_at && !Number.isNaN(Date.parse(item.captured_at)) ? new Date(item.captured_at).toISOString() : nowIso();
  // Очередь расширения повторяет отправку, пока не получит ответ: тот же
  // client_id второй раз ничего не добавляет.
  const existing = db.prepare("SELECT id FROM web_inbox WHERE client_id = ?").get(item.client_id) as { id: string } | undefined;
  if (existing) return res.json({ id: existing.id, duplicate: true });
  const id = randomUUID();
  db.prepare(`INSERT INTO web_inbox (id, client_id, kind, url, page_title, heading, text, captured_at)
    VALUES (?, ?, 'text', ?, ?, ?, ?, ?)`).run(id, item.client_id, item.url, item.page_title.trim(),
    item.heading.trim(), item.text.trim(), captured);
  res.status(201).json({ id });
});

// ── «Разобрать сейчас…» (поставка 2, Q10/Q11/Q20/Q21) ──
// Окно расширения создаёт сущность само, не открывая SoyMan: список
// сеттингов, проверка имени, создание с источником. Содержимое сущностей
// ключ не читает — только имена совпавших, чтобы предупредить о дубле.

const EXT_KINDS = {
  being: { label: "Существо", route: "/beings" },
  location: { label: "Место", route: "/locations" },
  community: { label: "Сообщество", route: "/communities" },
  artifact: { label: "Артефакт", route: "/artifacts" },
} as const;
type ExtKind = keyof typeof EXT_KINDS;
const extKind = z.enum(["being", "location", "community", "artifact"]);

webCaptureExtRouter.get("/settings", requireExtensionKey, (_req, res) => {
  res.json(db.prepare("SELECT id, name FROM settings WHERE archived_at IS NULL ORDER BY name").all());
});

const createInput = inboxInput.omit({ client_id: true }).extend({
  kind: extKind,
  setting_id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  // Мастер уже видел предупреждение о дубле и выбрал «Всё равно создать».
  force: z.boolean().optional(),
});

/** Сущности четырёх видов с тем же именем в сеттинге (Q20), без учёта регистра. */
function sameName(settingId: number, name: string) {
  const union = (Object.keys(EXT_KINDS) as ExtKind[])
    .map((kind) => `SELECT '${kind}' AS kind, id, name FROM ${requireKind(kind).table}
      WHERE setting_id = @setting AND lower_u(trim(name)) = lower_u(@name)`)
    .join(" UNION ALL ");
  return db.prepare(`${union} LIMIT 5`).all({ setting: settingId, name: name.trim() }) as { kind: ExtKind; id: number; name: string }[];
}

// Та же вставка, что у POST маршрута каждого вида без необязательных полей:
// папка в хранилище только вычисляется, создаётся она при первом файле.
function insertEntity(kind: ExtKind, settingId: number, settingFolder: string, name: string, description: string): number {
  const run = (sql: string, ...args: unknown[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  switch (kind) {
    case "being":
      return run(`INSERT INTO setting_beings (setting_id, name, category, description, folder_path, tags)
        VALUES (?, ?, 'bestiary', ?, ?, '[]')`, settingId, name, description, beingFolder(settingFolder, name));
    case "location":
      return run(`INSERT INTO setting_locations (setting_id, parent_id, name, kind, role, description, folder_path)
        VALUES (?, NULL, ?, '', 'location', ?, ?)`, settingId, name, description,
        locationFolder(settingGeographyRoot(settingFolder), name));
    case "community":
      return run(`INSERT INTO setting_communities (setting_id, parent_id, name, description, folder_path, tags)
        VALUES (?, NULL, ?, ?, ?, '[]')`, settingId, name, description, communityFolder(settingFolder, name));
    case "artifact":
      return run(`INSERT INTO artifacts (setting_id, name, description, folder_path) VALUES (?, ?, ?, ?)`,
        settingId, name, description, artifactFolder(settingFolder, name));
  }
}

webCaptureExtRouter.post("/entities", requireExtensionKey, (req, res) => {
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Не хватает вида, сеттинга, названия или текста" });
  const input = parsed.data;
  const setting = db.prepare("SELECT name, folder_path FROM settings WHERE id = ? AND archived_at IS NULL")
    .get(input.setting_id) as { name: string; folder_path: string } | undefined;
  if (!setting) return res.status(404).json({ error: "Сеттинг не найден" });
  if (!input.force) {
    const duplicates = sameName(input.setting_id, input.name);
    if (duplicates.length) return res.status(409).json({ duplicates: duplicates.map((d) => ({ ...d, label: EXT_KINDS[d.kind].label })) });
  }
  const captured = input.captured_at && !Number.isNaN(Date.parse(input.captured_at)) ? new Date(input.captured_at).toISOString() : nowIso();
  const text = input.text.trim();
  // Сущность и её источник — вместе или никак.
  const id = db.transaction(() => {
    const entityId = insertEntity(input.kind, input.setting_id, setting.folder_path, input.name, text);
    db.prepare(`INSERT INTO web_entity_sources (id, target_kind, target_id, field_name, url, page_title, quote, captured_at)
      VALUES (?, ?, ?, 'description', ?, ?, ?, ?)`).run(randomUUID(), input.kind, entityId, input.url, input.page_title.trim(), text, captured);
    return entityId;
  })();
  res.status(201).json({ kind: input.kind, id, name: input.name, label: EXT_KINDS[input.kind].label, setting: setting.name });
});

// «Открыть в SoyMan» из уведомления. Окно открывает Electron (сервер живёт в
// его процессе и слушает событие); без него — например, сервер запущен из
// репозитория — расширение откроет страницу вкладкой браузера.
webCaptureExtRouter.post("/open", requireExtensionKey, (req, res) => {
  const parsed = z.object({ kind: extKind, id: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неверная сущность" });
  const { kind, id } = parsed.data;
  if (!db.prepare(`SELECT 1 FROM ${requireKind(kind).table} WHERE id = ?`).get(id)) {
    return res.status(404).json({ error: "Сущность не найдена" });
  }
  const route = `${EXT_KINDS[kind].route}/${id}`;
  const bus: NodeJS.EventEmitter = process;
  const opened = bus.listenerCount(OPEN_ROUTE_EVENT) > 0 && bus.emit(OPEN_ROUTE_EVENT, route);
  res.json({ opened, route });
});

webCaptureExtRouter.post("/disconnect", requireExtensionKey, (req: ExtRequest, res) => {
  db.prepare("UPDATE web_capture_keys SET revoked_at = ? WHERE id = ?").run(nowIso(), req.webCaptureKeyId);
  res.json({ ok: true });
});

// ───────────── Мастер ─────────────

webCaptureRouter.post("/pairings", (_req, res) => {
  // Старые коды не копятся: истёкшие и использованные убираются при выдаче нового.
  db.prepare("DELETE FROM web_capture_pairings WHERE used_at IS NOT NULL OR expires_at <= ?").run(nowIso());
  const code = newCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  db.prepare("INSERT INTO web_capture_pairings (code_hash, expires_at) VALUES (?, ?)").run(sha256Hex(code), expiresAt);
  res.status(201).json({ code: `${code.slice(0, 3)}-${code.slice(3)}`, expiresAt });
});

// Где лежит расширение, чтобы загрузить его распакованным: Electron передаёт
// папку из ресурсов установки, при запуске из репозитория — extension/ в корне.
webCaptureRouter.get("/extension-dir", (_req, res) => {
  res.json({ path: process.env.SOYMAN_EXTENSION_DIR || path.resolve(__dirname, "..", "..", "..", "extension") });
});

webCaptureRouter.get("/keys", (_req, res) => {
  res.json(db.prepare(`SELECT id, label, created_at, last_seen_at FROM web_capture_keys
    WHERE revoked_at IS NULL ORDER BY created_at DESC, rowid DESC`).all());
});

webCaptureRouter.delete("/keys/:id", (req, res) => {
  const info = db.prepare("UPDATE web_capture_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(nowIso(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Расширение не найдено" });
  res.json({ ok: true });
});

webCaptureRouter.get("/inbox", (_req, res) => {
  res.json(db.prepare(`SELECT id, kind, url, page_title, heading, text, captured_at FROM web_inbox
    ORDER BY captured_at DESC, rowid DESC`).all());
});

webCaptureRouter.delete("/inbox/:id", (req, res) => {
  const info = db.prepare("DELETE FROM web_inbox WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Фрагмент уже разобран" });
  res.json({ ok: true });
});

// Графы, к которым можно привязать цитату, — те же, что у источников PDF.
const TARGETS = {
  being: { table: requireKind("being").table, fields: ["description", "history", "behavior", "secret", "player_text"] },
  location: { table: requireKind("location").table, fields: ["description", "player_text"] },
  community: { table: requireKind("community").table, fields: ["description", "history", "current_situation", "features", "goals", "player_text"] },
  artifact: { table: requireKind("artifact").table, fields: ["description", "history", "power", "notes", "secret"] },
} as const;
type TargetKind = keyof typeof TARGETS;
const isTargetKind = (kind: string): kind is TargetKind => Object.prototype.hasOwnProperty.call(TARGETS, kind);

const attachInput = z.object({
  target_kind: z.enum(["being", "location", "community", "artifact"]),
  target_id: z.number().int().positive(),
  field_name: z.string(),
});

// Разбор фрагмента: источник у сущности и уход из Входящих — одной
// транзакцией. Сущность создаёт клиент обычным маршрутом вида (у каждого своя
// раскладка папок); при сбое здесь он повторяет только этот шаг, с тем же id.
webCaptureRouter.post("/inbox/:id/attach", (req, res) => {
  const parsed = attachInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неверная сущность для источника" });
  const { target_kind, target_id, field_name } = parsed.data;
  const config = TARGETS[target_kind];
  if (!(config.fields as readonly string[]).includes(field_name)) {
    return res.status(400).json({ error: "Эта графа не принимает источник" });
  }
  const result = db.transaction(() => {
    const item = db.prepare("SELECT url, page_title, text, captured_at FROM web_inbox WHERE id = ?")
      .get(req.params.id) as { url: string; page_title: string; text: string; captured_at: string } | undefined;
    if (!item) return { status: 404, error: "Фрагмент уже разобран" };
    if (!db.prepare(`SELECT 1 FROM ${config.table} WHERE id = ?`).get(target_id)) {
      return { status: 404, error: "Сущность не найдена" };
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO web_entity_sources (id, target_kind, target_id, field_name, url, page_title, quote, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, target_kind, target_id, field_name, item.url, item.page_title, item.text, item.captured_at);
    db.prepare("DELETE FROM web_inbox WHERE id = ?").run(req.params.id);
    return { status: 201, id };
  })();
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.status(201).json(db.prepare("SELECT * FROM web_entity_sources WHERE id = ?").get(result.id));
});

webCaptureRouter.get("/sources/entity/:kind/:targetId", (req, res) => {
  if (!isTargetKind(req.params.kind)) return res.status(400).json({ error: "Неверный вид Сущности" });
  const targetId = Number(req.params.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: "Неверная Сущность" });
  res.json(db.prepare(`SELECT * FROM web_entity_sources WHERE target_kind = ? AND target_id = ?
    ORDER BY created_at DESC, rowid DESC`).all(req.params.kind, targetId));
});
