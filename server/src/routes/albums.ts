import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { db } from "../db/db";
import { VAULT_ROOT, ensureSubfolder, sanitizeName, vaultAbs, vaultRel } from "../services/filesystem";
import { storeDeduped } from "../services/vaultDedup";
import { loadArchiver } from "./backup";

// Альбомы галереи (разбор профиля сеттинга 2026-10-02, Q20–Q22, Q26–Q28).
// Альбом группирует ресурсы-изображения: resources.album_id, одна картинка —
// один альбом. Владелец — сеттинг, кампания или никто (глобальный альбом).
export const albumsRouter = Router();

const ownerId = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

albumsRouter.get("/", (req, res) => {
  const settingId = ownerId(req.query.setting_id);
  const campaignId = ownerId(req.query.campaign_id);
  const where = settingId ? "WHERE a.setting_id = ?" : campaignId ? "WHERE a.campaign_id = ?" : "";
  const params = settingId ? [settingId] : campaignId ? [campaignId] : [];
  res.json(
    db
      .prepare(
        `SELECT a.*, s.name AS setting_name, c.name AS campaign_name FROM albums a
         LEFT JOIN settings s ON s.id = a.setting_id
         LEFT JOIN campaigns c ON c.id = a.campaign_id
         ${where} ORDER BY a.position, a.id`
      )
      .all(...params)
  );
});

albumsRouter.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Нужно название альбома" });
  const settingId = ownerId(req.body.setting_id);
  const campaignId = settingId ? null : ownerId(req.body.campaign_id);
  if (settingId && !db.prepare("SELECT 1 FROM settings WHERE id = ?").get(settingId)) return res.status(404).json({ error: "Сеттинг не найден" });
  if (campaignId && !db.prepare("SELECT 1 FROM campaigns WHERE id = ?").get(campaignId)) return res.status(404).json({ error: "Кампания не найдена" });
  const { m } = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM albums WHERE setting_id IS ? AND campaign_id IS ?")
    .get(settingId, campaignId) as { m: number };
  const id = db
    .prepare("INSERT INTO albums (setting_id, campaign_id, name, position) VALUES (?, ?, ?, ?)")
    .run(settingId, campaignId, name, m + 1).lastInsertRowid;
  res.status(201).json(db.prepare("SELECT * FROM albums WHERE id = ?").get(id));
});

// До PUT /:id, иначе «reorder» уйдёт в :id.
albumsRouter.put("/reorder", (req, res) => {
  const order = Array.isArray(req.body?.order) ? (req.body.order as unknown[]).map(Number).filter(Number.isInteger) : [];
  const setPos = db.prepare("UPDATE albums SET position = ? WHERE id = ?");
  db.transaction(() => order.forEach((id, i) => setPos.run(i, id)))();
  res.json({ ok: true });
});

albumsRouter.put("/:id", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Нужно название альбома" });
  const info = db.prepare("UPDATE albums SET name = ? WHERE id = ?").run(name, req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Альбом не найден" });
  res.json(db.prepare("SELECT * FROM albums WHERE id = ?").get(req.params.id));
});

// Картинки удалённого альбома остаются — в «Без альбома» (Q27).
albumsRouter.delete("/:id", (req, res) => {
  db.transaction(() => {
    db.prepare("UPDATE resources SET album_id = NULL WHERE album_id = ?").run(req.params.id);
    db.prepare("DELETE FROM albums WHERE id = ?").run(req.params.id);
  })();
  res.json({ ok: true });
});

/**
 * Альбомы из модуля сеттинга (разбор 2026-10-02, Q1/Q2): недостающие
 * заводятся по имени, в них ложатся только переданные — новые — картинки.
 */
export function applyImportedAlbums(
  settingId: number,
  albums: { name: string; position?: number }[] | undefined,
  placed: { id: number; album?: string }[]
): void {
  if (!Array.isArray(albums) || !albums.length) return;
  const byName = new Map(
    (db.prepare("SELECT id, name FROM albums WHERE setting_id = ?").all(settingId) as { id: number; name: string }[]).map((a) => [a.name, a.id])
  );
  let { m } = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM albums WHERE setting_id = ?").get(settingId) as { m: number };
  const insert = db.prepare("INSERT INTO albums (setting_id, name, position) VALUES (?, ?, ?)");
  for (const a of [...albums].sort((x, y) => (x.position ?? 0) - (y.position ?? 0))) {
    const name = typeof a?.name === "string" ? a.name.trim() : "";
    if (name && !byName.has(name)) byName.set(name, Number(insert.run(settingId, name, ++m).lastInsertRowid));
  }
  const put = db.prepare("UPDATE resources SET album_id = ? WHERE id = ?");
  for (const p of placed) if (p.album && byName.has(p.album)) put.run(byName.get(p.album), p.id);
}

// ─── Файл альбома (Q3–Q7): ZIP — картинки файлами плюс album.json ─────────

const ALBUM_FORMAT = "soyman-album/1";
const IMAGE_FORMATS: Record<string, string> = { jpeg: ".jpg", png: ".png", gif: ".gif", webp: ".webp", avif: ".avif" };
const MAX_ENTRIES = 2000;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

interface AlbumFileImage {
  file?: string | null;
  name: string;
  category?: string | null;
  tags?: string;
  link_url?: string | null;
}

albumsRouter.get("/:id/export", async (req, res) => {
  const album = db.prepare("SELECT id, name FROM albums WHERE id = ?").get(req.params.id) as { id: number; name: string } | undefined;
  if (!album) return res.status(404).json({ error: "Альбом не найден" });
  const rows = db
    .prepare("SELECT name, category, tags, link_url, file_path FROM resources WHERE album_id = ? AND archived_at IS NULL ORDER BY id")
    .all(album.id) as { name: string; category: string | null; tags: string; link_url: string | null; file_path: string | null }[];
  // Заметок в файле нет (Q4): альбомом делятся, а в заметках — личное Мастера.
  const images: AlbumFileImage[] = [];
  const files: { abs: string; name: string }[] = [];
  rows.forEach((r, i) => {
    const abs = r.file_path ? vaultAbs(r.file_path) : null;
    const file = abs && fs.existsSync(abs) ? `images/${String(i + 1).padStart(3, "0")}-${sanitizeName(path.basename(abs))}` : null;
    if (abs && file) files.push({ abs, name: file });
    if (file || r.link_url) images.push({ file, name: r.name, category: r.category, tags: r.tags, link_url: r.link_url });
  });
  const { ZipArchive } = await loadArchiver();
  // Картинки уже сжаты — кладём как есть.
  const archive = new ZipArchive({ store: true });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="album.zip"; filename*=UTF-8''${encodeURIComponent(`${album.name}.zip`)}`);
  archive.on("error", (err: Error) => res.destroy(err));
  archive.pipe(res);
  archive.append(JSON.stringify({ format: ALBUM_FORMAT, name: album.name, images }, null, 2), { name: "album.json" });
  for (const f of files) archive.file(f.abs, { name: f.name });
  await archive.finalize();
});

const zipUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        cb(null, vaultAbs(ensureSubfolder(VAULT_ROOT, ".uploads")));
      } catch (error) {
        cb(error as Error, "");
      }
    },
    filename(_req, _file, cb) {
      cb(null, crypto.randomUUID() + ".upload");
    },
  }),
  limits: { fileSize: MAX_TOTAL_BYTES },
}).single("file");

// Импорт — всегда новым альбомом в сеттинг (Q6/Q7). ZIP не распаковывается
// на диск: записи читаются буферами, картинка проверяется sharp-ом и ложится
// под новым именем. Та же картинка (по хэшу), что уже есть в галерее
// сеттинга, не дублируется — остаётся где лежит.
albumsRouter.post("/import", zipUpload, async (req, res) => {
  const temporary = req.file?.path;
  const created: string[] = [];
  try {
    const settingId = ownerId(req.query.setting_id);
    const setting = settingId
      ? (db.prepare("SELECT folder_path FROM settings WHERE id = ?").get(settingId) as { folder_path: string } | undefined)
      : undefined;
    if (!settingId || !setting) return res.status(400).json({ error: "Сеттинг не найден" });
    if (!req.file || !/\.zip$/i.test(req.file.originalname)) return res.status(400).json({ error: "Нужен ZIP-файл альбома" });

    // ponytail: adm-zip держит архив в памяти целиком — потолок MAX_TOTAL_BYTES;
    // если альбомы перерастут, читать записи потоком (yauzl).
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) throw new Error("Слишком много файлов в архиве");
    const byName = new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.entryName, e]));
    const manifestEntry = byName.get("album.json");
    if (!manifestEntry || manifestEntry.header.size > 2 * 1024 * 1024) throw new Error("Это не файл альбома: нет album.json");
    const manifest = JSON.parse(manifestEntry.getData().toString("utf8")) as { format?: string; name?: string; images?: AlbumFileImage[] };
    if (manifest.format !== ALBUM_FORMAT || !Array.isArray(manifest.images)) throw new Error("Это не файл альбома или он из более новой версии");

    const known = new Set(
      (
        db
          .prepare(
            `SELECT file_sha256 FROM resources WHERE archived_at IS NULL AND file_sha256 IS NOT NULL AND (setting_id = ?
               OR id IN (SELECT owner_id FROM resource_setting_links WHERE owner_type = 'resource' AND setting_id = ?))`
          )
          .all(settingId, settingId) as { file_sha256: string }[]
      ).map((r) => r.file_sha256)
    );
    const folder = ensureSubfolder(ensureSubfolder(setting.folder_path, "Resources"), "images");
    const rows: { name: string; category: string; tags: string; link_url: string | null; file_path: string | null; sha: string | null }[] = [];
    let skipped = 0;
    let total = 0;
    for (const item of manifest.images) {
      const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim().slice(0, 300) : "Картинка";
      const category = item?.category === "map" ? "map" : "image";
      const tags = typeof item?.tags === "string" ? item.tags.slice(0, 1000) : "";
      if (!item?.file) {
        if (typeof item?.link_url === "string" && /^https?:\/\//i.test(item.link_url))
          rows.push({ name, category, tags, link_url: item.link_url, file_path: null, sha: null });
        continue;
      }
      const entry = byName.get(item.file);
      if (!entry) throw new Error(`В архиве нет файла ${item.file}`);
      if (((entry.header.attr >>> 16) & 0o170000) === 0o120000) throw new Error("Символические ссылки в ZIP запрещены");
      if (entry.header.size > MAX_IMAGE_BYTES) throw new Error(`Картинка «${name}» больше 100 МБ`);
      total += entry.header.size;
      if (total > MAX_TOTAL_BYTES) throw new Error("Альбом больше 2 ГБ");
      const data = entry.getData();
      if (data.length !== entry.header.size) throw new Error("Повреждённый ZIP");
      const format = (await sharp(data).metadata().catch(() => null))?.format;
      const ext = format ? IMAGE_FORMATS[format] : undefined;
      if (!ext) throw new Error(`«${name}» — не картинка`);
      const sha = crypto.createHash("sha256").update(data).digest("hex");
      if (known.has(sha)) {
        skipped++;
        continue;
      }
      known.add(sha);
      const base = path.parse(sanitizeName(path.basename(item.file))).name.replace(/^\d{3}-/, "") || "image";
      const target = path.join(vaultAbs(folder), `${base}-${crypto.randomUUID()}${ext}`);
      await storeDeduped(data, target);
      created.push(target);
      rows.push({ name, category, tags, link_url: null, file_path: target, sha });
    }

    // Всё уже есть в галерее — пустой альбом не заводим (поправка владельца к Q7).
    if (!rows.length) return res.json({ album: null, added: 0, skipped });

    const wanted = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim().slice(0, 200) : "Альбом";
    const taken = new Set((db.prepare("SELECT name FROM albums WHERE setting_id = ?").all(settingId) as { name: string }[]).map((a) => a.name));
    let albumName = wanted;
    for (let n = 2; taken.has(albumName); n++) albumName = `${wanted} (${n})`;

    const album = db.transaction(() => {
      const { m } = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM albums WHERE setting_id = ?").get(settingId) as { m: number };
      const albumId = Number(db.prepare("INSERT INTO albums (setting_id, name, position) VALUES (?, ?, ?)").run(settingId, albumName, m + 1).lastInsertRowid);
      const { p } = db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM resources WHERE scope = 'setting' AND setting_id = ?").get(settingId) as { p: number };
      const insert = db.prepare(
        `INSERT INTO resources (uid, name, type, scope, setting_id, file_path, file_sha256, link_url, category, tags, notes, position, album_id)
         VALUES (?, ?, 'image', 'setting', ?, ?, ?, ?, ?, ?, '', ?, ?)`
      );
      rows.forEach((r, i) => insert.run(crypto.randomUUID(), r.name, settingId, r.file_path, r.sha, r.link_url, r.category, r.tags, p + 1 + i, albumId));
      return { id: albumId, name: albumName };
    })();
    res.status(201).json({ album, added: rows.length, skipped });
  } catch (error) {
    for (const file of created) {
      await fs.promises.unlink(file).catch(() => undefined);
      try {
        db.prepare("DELETE FROM vault_files WHERE path = ?").run(vaultRel(file));
      } catch {
        /* строки дедупа могло не быть */
      }
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Альбом не импортирован" });
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => undefined);
  }
});
