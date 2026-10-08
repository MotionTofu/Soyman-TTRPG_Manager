import { Router, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { db } from "../db/db";
import { ensureSubfolder, toFileUrl, vaultAbs, VAULT_ROOT } from "../services/filesystem";
import type { AuthedRequest } from "../services/auth";

/**
 * Наборы ассетов карт (гриллинг 2026-10-08): общая библиотека Мастера, не привязанная к сеттингу.
 * Картинки попадают в набор только отсюда и хранятся отдельно от галереи. Всё пересчитывается
 * в стандарт — 256 точек на клетку, WebP; исходник не хранится. Версий нет, удаление — в архив.
 */
export const mapPacksRouter = Router();

/** Точек на клетку у картинок набора. */
export const MAP_PACK_CELL_PX = 256;
const MAX_CELLS = 16;
const KINDS = ["tactical", "city", "overview"];
const SIDES = ["w", "n", "e"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 12 },
  fileFilter(_req, file, cb) {
    if (["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Поддерживаются только изображения PNG/JPG/WebP/AVIF/GIF"));
  } }).single("file");

interface PackRow { id: number; uid: string; name: string; kinds: string; genres: string; native_style: string; archived_at: string | null; updated_at: string }
interface ItemRow { id: number; uid: string; pack_id: number; kind: string; name: string; section: string; tags: string; data: string; archived_at: string | null }
interface ImageRow { id: number; uid: string; item_id: number; role: string; file_path: string; width: number; height: number; archived_at: string | null }

const json = <T>(text: string, fallback: T): T => { try { return JSON.parse(text) as T; } catch { return fallback; } };
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

function present(pack: PackRow, items: ItemRow[], images: ImageRow[]) {
  return { id: pack.id, uid: pack.uid, name: pack.name, kinds: json<string[]>(pack.kinds, ["tactical"]), genres: json<unknown[]>(pack.genres, []),
    native_style: pack.native_style, archived: !!pack.archived_at, updated_at: pack.updated_at,
    // Убранные объекты и варианты отдаются с пометкой: в каталоге их нет, но карты, где они стоят, рисуются как раньше.
    items: items.filter((item) => item.pack_id === pack.id).map((item) => ({ id: item.id, uid: item.uid, kind: item.kind, name: item.name, section: item.section, tags: item.tags,
      archived: !!item.archived_at, ...objectData(json<Record<string, unknown>>(item.data, {})),
      images: images.filter((image) => image.item_id === item.id).map((image) => ({ id: image.id, uid: image.uid, role: image.role, width: image.width, height: image.height,
        archived: !!image.archived_at, file_url: toFileUrl(image.file_path) })) })) };
}
/** Данные объекта: размер в клетках и свойства для будущего света. */
function objectData(raw: Record<string, unknown>) {
  const cells = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0.25, Math.min(MAX_CELLS, Math.round(value * 4) / 4)) : 1;
  const light = typeof raw.light === "number" && Number.isFinite(raw.light) && raw.light > 0 ? Math.min(60, raw.light) : null;
  return { w: cells(raw.w), h: cells(raw.h), blocks_sight: raw.blocks_sight === true, light };
}
function allPacks() {
  const packs = db.prepare("SELECT * FROM map_asset_packs ORDER BY name COLLATE NOCASE").all() as PackRow[];
  const items = db.prepare("SELECT * FROM map_asset_items ORDER BY name COLLATE NOCASE").all() as ItemRow[];
  const images = db.prepare("SELECT * FROM map_asset_images ORDER BY position, id").all() as ImageRow[];
  return packs.map((pack) => present(pack, items, images));
}
const onePack = (id: number) => allPacks().find((pack) => pack.id === id);

function packInput(body: Record<string, unknown>, res: Response) {
  const name = text(body.name, 80);
  if (!name) { res.status(400).json({ error: "Название набора обязательно" }); return null; }
  const kinds = Array.isArray(body.kinds) ? [...new Set(body.kinds.filter((kind): kind is string => KINDS.includes(kind as string)))] : ["tactical"];
  if (!kinds.length) { res.status(400).json({ error: "Отметьте хотя бы один вид карты" }); return null; }
  return { name, kinds: JSON.stringify(kinds) };
}

mapPacksRouter.use((req: AuthedRequest, res, next) => req.user?.role === "player" ? res.status(403).json({ error: "forbidden" }) : next());

mapPacksRouter.get("/", (_req, res) => res.json(allPacks()));

mapPacksRouter.post("/", (req, res) => {
  const input = packInput(req.body ?? {}, res);
  if (!input) return;
  const id = Number(db.prepare("INSERT INTO map_asset_packs (uid, name, kinds) VALUES (?, ?, ?)").run(crypto.randomUUID(), input.name, input.kinds).lastInsertRowid);
  res.status(201).json(onePack(id));
});

mapPacksRouter.put("/:id", (req, res) => {
  const input = packInput(req.body ?? {}, res);
  if (!input) return;
  const done = db.prepare("UPDATE map_asset_packs SET name = ?, kinds = ?, updated_at = datetime('now') WHERE id = ?").run(input.name, input.kinds, req.params.id);
  if (!done.changes) return res.status(404).json({ error: "Набор не найден" });
  res.json(onePack(Number(req.params.id)));
});

// Удаление набора — в архив: карты, где он использован, показывают заглушки до восстановления.
mapPacksRouter.put("/:id/archive", (req, res) => {
  const archived = req.body?.archived !== false;
  const done = db.prepare(`UPDATE map_asset_packs SET archived_at = ${archived ? "datetime('now')" : "NULL"}, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  if (!done.changes) return res.status(404).json({ error: "Набор не найден" });
  res.json(onePack(Number(req.params.id)));
});

/** Картинка в стандарт набора: WebP, прозрачные поля вместо обрезки, не крупнее 256 точек на клетку. */
async function storeImage(packUid: string, buffer: Buffer, w: number, h: number) {
  const uid = crypto.randomUUID();
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error("Файл не читается как изображение");
  const full = { width: Math.round(w * MAP_PACK_CELL_PX), height: Math.round(h * MAP_PACK_CELL_PX) };
  // Мелкая картинка не растягивается до стандарта и не тонет в прозрачных полях: холст сжимается под неё, пропорции клеток те же.
  const fit = Math.min(1, Math.max(meta.width / full.width, meta.height / full.height));
  const target = { width: Math.max(1, Math.round(full.width * fit)), height: Math.max(1, Math.round(full.height * fit)) };
  const out = await sharp(buffer, { animated: false }).rotate()
    .resize({ ...target, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
  const folder = ensureSubfolder(ensureSubfolder(VAULT_ROOT, "MapPacks"), packUid);
  const file = path.join(folder, `${uid}.webp`);
  await fs.promises.writeFile(vaultAbs(file), out.data);
  return { uid, file, width: out.info.width, height: out.info.height, small: fit < 1 };
}
const withUpload = (handler: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: AuthedRequest, res: Response) =>
  upload(req, res, (error: unknown) => {
    if (error) return res.status(400).json({ error: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Файл больше 20 МБ" : (error as Error).message });
    if (!req.file) return res.status(400).json({ error: "Нужен файл изображения" });
    handler(req, res).catch((failure: unknown) => res.status(400).json({ error: failure instanceof Error ? failure.message : "Не удалось сохранить изображение" }));
  });

// Новый объект: картинка, имя, раздел и размер в клетках, заданный на сетке.
mapPacksRouter.post("/:id/items", withUpload(async (req, res) => {
  const pack = db.prepare("SELECT * FROM map_asset_packs WHERE id = ? AND archived_at IS NULL").get(req.params.id) as PackRow | undefined;
  if (!pack) return res.status(404).json({ error: "Набор не найден" });
  const name = text(req.body.name, 80);
  if (!name) return res.status(400).json({ error: "Название объекта обязательно" });
  const data = objectData({ w: Number(req.body.w), h: Number(req.body.h) });
  const image = await storeImage(pack.uid, req.file!.buffer, data.w, data.h);
  db.transaction(() => {
    const itemId = db.prepare("INSERT INTO map_asset_items (uid, pack_id, kind, name, section, tags, data) VALUES (?, ?, 'object', ?, ?, ?, ?)")
      .run(crypto.randomUUID(), pack.id, name, text(req.body.section, 40), text(req.body.tags, 200), JSON.stringify(data)).lastInsertRowid;
    db.prepare("INSERT INTO map_asset_images (uid, item_id, role, position, file_path, width, height) VALUES (?, ?, 'variant', 0, ?, ?, ?)").run(image.uid, itemId, image.file, image.width, image.height);
    db.prepare("UPDATE map_asset_packs SET updated_at = datetime('now') WHERE id = ?").run(pack.id);
  })();
  res.status(201).json({ pack: onePack(pack.id), small: image.small });
}));

// Ещё один вариант того же объекта (каталог берёт случайный при постановке) или вид поворотного предмета со стороны:
// `role` w / n / e — как предмет выглядит, повёрнутый на 90°, 180° и 270°. Новый вид стороны заменяет прежний.
mapPacksRouter.post("/items/:itemId/images", withUpload(async (req, res) => {
  const item = db.prepare(`SELECT i.*, p.uid AS pack_uid FROM map_asset_items i JOIN map_asset_packs p ON p.id = i.pack_id
    WHERE i.id = ? AND i.archived_at IS NULL AND p.archived_at IS NULL`).get(req.params.itemId) as (ItemRow & { pack_uid: string }) | undefined;
  if (!item) return res.status(404).json({ error: "Объект не найден" });
  const role = SIDES.includes(req.body.role) ? req.body.role as string : "variant";
  const count = (db.prepare("SELECT COUNT(*) AS n FROM map_asset_images WHERE item_id = ? AND role = 'variant' AND archived_at IS NULL").get(item.id) as { n: number }).n;
  if (role === "variant" && count >= 12) return res.status(400).json({ error: "У объекта не больше 12 вариантов" });
  const data = objectData(json<Record<string, unknown>>(item.data, {}));
  // Сбоку предмет занимает те же клетки, но лежит поперёк.
  const across = role === "w" || role === "e";
  const image = await storeImage(item.pack_uid, req.file!.buffer, across ? data.h : data.w, across ? data.w : data.h);
  db.transaction(() => {
    if (role !== "variant") db.prepare("UPDATE map_asset_images SET archived_at = datetime('now') WHERE item_id = ? AND role = ? AND archived_at IS NULL").run(item.id, role);
    db.prepare("INSERT INTO map_asset_images (uid, item_id, role, position, file_path, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)").run(image.uid, item.id, role, Date.now() % 2147483647, image.file, image.width, image.height);
  })();
  res.status(201).json({ pack: onePack(item.pack_id), small: image.small });
}));

mapPacksRouter.put("/items/:itemId", (req, res) => {
  const item = db.prepare("SELECT * FROM map_asset_items WHERE id = ? AND archived_at IS NULL").get(req.params.itemId) as ItemRow | undefined;
  if (!item) return res.status(404).json({ error: "Объект не найден" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = body.name === undefined ? item.name : text(body.name, 80);
  if (!name) return res.status(400).json({ error: "Название объекта обязательно" });
  const data = objectData({ ...json<Record<string, unknown>>(item.data, {}), ...body });
  db.prepare("UPDATE map_asset_items SET name = ?, section = ?, tags = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name, body.section === undefined ? item.section : text(body.section, 40), body.tags === undefined ? item.tags : text(body.tags, 200), JSON.stringify(data), item.id);
  res.json(onePack(item.pack_id));
});

// Объект из набора убирается в архив: на картах его картинки остаются, в каталоге он пропадает.
mapPacksRouter.delete("/items/:itemId", (req, res) => {
  const item = db.prepare("SELECT * FROM map_asset_items WHERE id = ? AND archived_at IS NULL").get(req.params.itemId) as ItemRow | undefined;
  if (!item) return res.status(404).json({ error: "Объект не найден" });
  db.prepare("UPDATE map_asset_items SET archived_at = datetime('now') WHERE id = ?").run(item.id);
  res.json(onePack(item.pack_id));
});

// Вариант убирается из каталога, файл остаётся: он может стоять на картах. Последний убрать нельзя — объект без картинки не поставить.
mapPacksRouter.delete("/images/:imageId", (req, res) => {
  const image = db.prepare("SELECT * FROM map_asset_images WHERE id = ? AND archived_at IS NULL").get(req.params.imageId) as ImageRow | undefined;
  if (!image) return res.status(404).json({ error: "Картинка не найдена" });
  const count = (db.prepare("SELECT COUNT(*) AS n FROM map_asset_images WHERE item_id = ? AND role = 'variant' AND archived_at IS NULL").get(image.item_id) as { n: number }).n;
  if (image.role === "variant" && count <= 1) return res.status(400).json({ error: "Последний вариант удалить нельзя — уберите объект целиком" });
  db.prepare("UPDATE map_asset_images SET archived_at = datetime('now') WHERE id = ?").run(image.id);
  const item = db.prepare("SELECT pack_id FROM map_asset_items WHERE id = ?").get(image.item_id) as { pack_id: number };
  res.json(onePack(item.pack_id));
});
