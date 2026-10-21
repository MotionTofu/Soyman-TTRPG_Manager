import { Router, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import AdmZip from "adm-zip";
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 14 },
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
      archived: !!item.archived_at, ...itemData(item.kind, json<Record<string, unknown>>(item.data, {})),
      images: images.filter((image) => image.item_id === item.id).map((image) => ({ id: image.id, uid: image.uid, role: image.role, width: image.width, height: image.height,
        archived: !!image.archived_at, file_url: toFileUrl(image.file_path) })) })) };
}
/** Данные объекта: размер в клетках и свойства для будущего света. */
function objectData(raw: Record<string, unknown>) {
  const cells = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0.25, Math.min(MAX_CELLS, Math.round(value * 4) / 4)) : 1;
  const light = typeof raw.light === "number" && Number.isFinite(raw.light) && raw.light > 0 ? Math.min(60, raw.light) : null;
  return { w: cells(raw.w), h: cells(raw.h), blocks_sight: raw.blocks_sight === true, light };
}
/** Данные поверхности: сколько клеток покрывает один повтор образца и средний цвет — им красится «Чертёж» и то, что ещё грузится. */
function surfaceData(raw: Record<string, unknown>) {
  const cells = typeof raw.cells === "number" && Number.isFinite(raw.cells) ? Math.max(1, Math.min(MAX_CELLS, Math.round(raw.cells))) : 4;
  // Кромка: ширина перехода в клетках, рваность 0–1 и ярус (0 — низ, 2 — верх); по умолчанию край как у встроенных.
  return { cells, fill: typeof raw.fill === "string" && /^#[0-9a-f]{6}$/.test(raw.fill) ? raw.fill : "#8a8a80",
    edge_width: between(raw.edge_width, 0, 1, 0.25), edge_rough: between(raw.edge_rough, 0, 1, 0), tier: Math.round(between(raw.tier, 0, 2, 1)) };
}
const ITEM_KINDS = ["object", "surface", "line", "crossing", "scatter", "door", "liquid"];
const LINE_USES = ["road", "river", "wall"];
const DECKS = ["bridge-wood", "bridge-stone", "ford"];
const between = (value: unknown, min: number, max: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
/** Рецепт жидкости (гриллинг 2026-10-15, В12–В16) — те же ручки, что у своей жидкости карты; картинок у неё нет.
 * Списки рисунков и кромок — как в общем формате карты (`shared/src/maps/core/v6.ts`). */
const LIQUID_PATTERNS = ["ripple", "cracks", "bubbles", "mist", "smooth"], LIQUID_LAYERS = ["ripple", "cracks", "crust", "sheen", "scum", "bubbles", "mist"], LIQUID_RIMS = ["foam", "none", "scorch", "wet", "hatch"];
const WATER_TONES = ["#213e5c", "#2f9c8c", "#eefaf2"];
function liquidData(raw: Record<string, unknown>) {
  const tones = Array.isArray(raw.tones) && raw.tones.length === 3 && raw.tones.every((tone) => typeof tone === "string" && /^#[0-9a-f]{6}$/i.test(tone))
    ? (raw.tones as string[]).map((tone) => tone.toLowerCase()) : WATER_TONES;
  return { tones, pace: between(raw.pace, 0, 2, 1), size: between(raw.size, 0.25, 4, 1), bed: between(raw.bed, 0, 1, 1), glow: between(raw.glow, 0, 1, 0),
    // Рисунок слоями (2026-10-21) вытесняет прежний одиночный: правка со слоями убирает `pattern`.
    ...(raw.layers && typeof raw.layers === "object" && !Array.isArray(raw.layers)
      ? { layers: Object.fromEntries(LIQUID_LAYERS.flatMap((key) => typeof (raw.layers as Record<string, unknown>)[key] === "number" ? [[key, between((raw.layers as Record<string, unknown>)[key], 0, 1, 0)]] : [])) }
      : { pattern: LIQUID_PATTERNS.includes(raw.pattern as string) ? raw.pattern : "ripple" }),
    rim: LIQUID_RIMS.includes(raw.rim as string) ? raw.rim : "foam",
    solid: raw.solid === true, shore: between(raw.shore, 0, 1, 0.4), ragged: between(raw.ragged, 0, 1, 0.4),
    push: between(raw.push, 0, 1, 0.5), blend: between(raw.blend, 0, 1, 0.25) };
}
/** Данные вещи по её виду. Линия: каким инструментом тянется (дорога, река — «течёт», ограда — «преграждает путь») и ширина.
 * Переправа: какой настил заменяет. Россыпь: размер знака и густота по умолчанию. */
function kindData(kind: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (kind === "surface") return surfaceData(raw);
  if (kind === "liquid") return liquidData(raw);
  if (kind === "line") return { use: LINE_USES.includes(raw.use as string) ? raw.use : "road", width: between(raw.width, 0.25, 8, 1) };
  if (kind === "crossing") return { deck: DECKS.includes(raw.deck as string) ? raw.deck : "bridge-wood", width: between(raw.width, 0.25, 8, 2) };
  if (kind === "scatter") return { size: between(raw.size, 0.25, 8, 1), density: between(raw.density, 0.05, 4, 0.8) };
  // Проём: ширина в клетках и «потайной» — таким он встаёт на карту.
  if (kind === "door") return { span: Math.round(between(raw.span, 1, 4, 1)), secret: raw.secret === true || raw.secret === "true" };
  return objectData(raw);
}
const itemData = (kind: string, raw: Record<string, unknown>) => kind === "object" ? objectData(raw) : { w: 1, h: 1, blocks_sight: false, light: null, ...kindData(kind, raw) };
/** Поля формы приходят строками. */
const numbers = (body: Record<string, unknown>) => ({ ...body, ...Object.fromEntries(["w", "h", "cells", "width", "size", "density", "edge_width", "edge_rough", "tier", "span"].map((key) => [key, Number(body[key])])) });
/** Во что вписывается картинка, клеток. `strip` — полоса: высота равна ширине линии, длина — по пропорциям картинки. */
type Box = { w: number; h: number } | { strip: number };
function imageBox(kind: string, data: Record<string, unknown>, role: string): Box {
  // Образец поверхности хранится квадратом не крупнее 1024 точек: на 4 клетки это стандарт, на большее — мельче.
  if (kind === "surface") { const side = Math.min(data.cells as number, 4); return { w: side, h: side }; }
  if (kind === "line" || kind === "crossing") { const width = data.width as number; return role === "post" ? { w: Math.min(MAX_CELLS, width * 2), h: Math.min(MAX_CELLS, width * 2) } : { strip: width }; }
  if (kind === "scatter") { const side = Math.max(1, data.size as number); return { w: side, h: side }; }
  // Проём нарисован сверху: вдоль стены — его ширина, поперёк — одна клетка.
  if (kind === "door") return { w: data.span as number, h: 1 };
  // Сбоку предмет занимает те же клетки, но лежит поперёк.
  const across = role === "w" || role === "e";
  return { w: (across ? data.h : data.w) as number, h: (across ? data.w : data.h) as number };
}
function allPacks() {
  const packs = db.prepare("SELECT * FROM map_asset_packs ORDER BY name COLLATE NOCASE").all() as PackRow[];
  const items = db.prepare("SELECT * FROM map_asset_items ORDER BY name COLLATE NOCASE").all() as ItemRow[];
  const images = db.prepare("SELECT * FROM map_asset_images ORDER BY position, id").all() as ImageRow[];
  return packs.map((pack) => present(pack, items, images));
}
const onePack = (id: number) => allPacks().find((pack) => pack.id === id);

/** Жанры — как у сеттинга: до трёх пар «жанр, поджанр». */
const genresOf = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((entry): { genre: string; subgenre?: string }[] => {
  const genre = text((entry as { genre?: unknown } | null)?.genre, 60), subgenre = text((entry as { subgenre?: unknown } | null)?.subgenre, 60);
  return genre ? [subgenre ? { genre, subgenre } : { genre }] : [];
}).slice(0, 3);
function packInput(body: Record<string, unknown>, res: Response) {
  const name = text(body.name, 80);
  if (!name) { res.status(400).json({ error: "Название набора обязательно" }); return null; }
  const kinds = Array.isArray(body.kinds) ? [...new Set(body.kinds.filter((kind): kind is string => KINDS.includes(kind as string)))] : ["tactical"];
  if (!kinds.length) { res.status(400).json({ error: "Отметьте хотя бы один вид карты" }); return null; }
  return { name, kinds: JSON.stringify(kinds), genres: JSON.stringify(genresOf(body.genres)) };
}

mapPacksRouter.use((req: AuthedRequest, res, next) => req.user?.role === "player" ? res.status(403).json({ error: "forbidden" }) : next());

mapPacksRouter.get("/", (_req, res) => res.json(allPacks()));

mapPacksRouter.post("/", (req, res) => {
  const input = packInput(req.body ?? {}, res);
  if (!input) return;
  const id = Number(db.prepare("INSERT INTO map_asset_packs (uid, name, kinds, genres) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), input.name, input.kinds, input.genres).lastInsertRowid);
  res.status(201).json(onePack(id));
});

mapPacksRouter.put("/:id", (req, res) => {
  const input = packInput(req.body ?? {}, res);
  if (!input) return;
  const done = db.prepare("UPDATE map_asset_packs SET name = ?, kinds = ?, genres = ?, updated_at = datetime('now') WHERE id = ?").run(input.name, input.kinds, input.genres, req.params.id);
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

/* Архив для обмена (гриллинг Q19): один zip — `pack.json` и картинки `images/<uid>.webp` как есть, без пересжатия.
 * Коды набора, вещей и картинок сохраняются: карты, где стоят вещи набора, у получателя рисуются теми же картинками. */
const PACK_FORMAT = "soyman-map-pack", PACK_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARCHIVE_MAX_BYTES = 1024 ** 3, ARCHIVE_MAX_FILES = 5000, IMAGE_MAX_SIDE = MAX_CELLS * MAP_PACK_CELL_PX;
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 1, fields: 2 } }).single("file");
/** Какие картинки бывают у вещи, кроме вариантов: виды по сторонам у объекта, столб у линии, маска кромки у поверхности. */
const roleOf = (kind: string, role: unknown) => kind === "object" && SIDES.includes(role as string) || kind === "line" && role === "post" || kind === "surface" && role === "edge" ? role as string : "variant";

mapPacksRouter.get("/:id/export", (req, res) => {
  const pack = db.prepare("SELECT * FROM map_asset_packs WHERE id = ?").get(req.params.id) as PackRow | undefined;
  if (!pack) return res.status(404).json({ error: "Набор не найден" });
  const items = db.prepare("SELECT * FROM map_asset_items WHERE pack_id = ? ORDER BY id").all(pack.id) as ItemRow[];
  const images = db.prepare("SELECT im.* FROM map_asset_images im JOIN map_asset_items it ON it.id = im.item_id WHERE it.pack_id = ? ORDER BY im.position, im.id")
    .all(pack.id) as (ImageRow & { position: number })[];
  const zip = new AdmZip(), packed = new Set<string>();
  for (const image of images) {
    // Пропавший файл не роняет выгрузку: такой картинки не было и на картах.
    try { zip.addFile(`images/${image.uid}.webp`, fs.readFileSync(vaultAbs(image.file_path))); packed.add(image.uid); } catch { /* файла нет */ }
  }
  // Убранное в архив тоже едет: оно может стоять на картах, которые Мастер передаст вместе с набором.
  const manifest = { format: PACK_FORMAT, version: PACK_VERSION,
    pack: { uid: pack.uid, name: pack.name, kinds: json(pack.kinds, ["tactical"]), genres: json(pack.genres, []), native_style: pack.native_style },
    items: items.map((item) => ({ uid: item.uid, kind: item.kind, name: item.name, section: item.section, tags: item.tags, data: json(item.data, {}), archived: !!item.archived_at,
      images: images.filter((image) => image.item_id === item.id && packed.has(image.uid)).map((image) => ({ uid: image.uid, role: image.role, position: image.position, archived: !!image.archived_at })) })) };
  zip.addFile("pack.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="map-pack.zip"; filename*=UTF-8''${encodeURIComponent(pack.name)}.zip`);
  res.send(zip.toBuffer());
});

interface ArchiveImage { uid: string; role: string; position: number; archived: boolean; data: Buffer; width: number; height: number }
interface ArchiveItem { uid: string; kind: string; name: string; section: string; tags: string; data: Record<string, unknown>; archived: boolean; images: ArchiveImage[] }
interface Archive { pack: { uid: string; name: string; kinds: string[]; genres: ReturnType<typeof genresOf>; native_style: string }; items: ArchiveItem[] }
type Raw = Record<string, unknown>;
const record = (value: unknown): Raw => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};

/** Чужой файл: пути из zip на диск не выкладываются, читаются только `pack.json` и картинки с кодом-uid; картинка проверяется как WebP разумного размера. */
async function readArchive(buffer: Buffer): Promise<Archive> {
  let zip: AdmZip;
  try { zip = new AdmZip(buffer); } catch { throw new Error("Файл не похож на архив набора"); }
  const entries = zip.getEntries();
  if (entries.length > ARCHIVE_MAX_FILES) throw new Error("В архиве слишком много файлов");
  const files = new Map<string, AdmZip.IZipEntry>();
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    total += entry.header.size;
    if (total > ARCHIVE_MAX_BYTES) throw new Error("Архив слишком большой");
    files.set(entry.entryName, entry);
  }
  const read = (name: string) => {
    const entry = files.get(name);
    if (!entry) return null;
    const data = entry.getData();
    if (data.length !== entry.header.size) throw new Error("Архив повреждён");
    return data;
  };
  const manifest = record(json<unknown>(read("pack.json")?.toString("utf8") ?? "", null));
  if (manifest.format !== PACK_FORMAT) throw new Error("В файле нет набора ассетов SoyMan");
  if (typeof manifest.version !== "number" || manifest.version > PACK_VERSION) throw new Error("Набор выгружен более новой версией SoyMan — обновите приложение");
  const pack = record(manifest.pack);
  if (typeof pack.uid !== "string" || !UUID.test(pack.uid)) throw new Error("Архив повреждён: у набора нет кода");
  const kinds = Array.isArray(pack.kinds) ? [...new Set(pack.kinds.filter((kind): kind is string => KINDS.includes(kind as string)))] : [];
  const items: ArchiveItem[] = [];
  for (const raw of (Array.isArray(manifest.items) ? manifest.items : []).slice(0, ARCHIVE_MAX_FILES).map(record)) {
    const kind = ITEM_KINDS.includes(raw.kind as string) ? raw.kind as string : null;
    if (!kind) continue;
    const images: ArchiveImage[] = [];
    for (const image of (Array.isArray(raw.images) ? raw.images : []).map(record)) {
      const data = typeof image.uid === "string" && UUID.test(image.uid) ? read(`images/${image.uid}.webp`) : null;
      if (!data) continue;
      const meta = await sharp(data).metadata().catch(() => null);
      if (meta?.format !== "webp" || !meta.width || !meta.height || meta.width > IMAGE_MAX_SIDE || meta.height > IMAGE_MAX_SIDE) throw new Error(`Картинка вещи «${text(raw.name, 80)}» повреждена`);
      images.push({ uid: image.uid as string, role: roleOf(kind, image.role), position: Number.isInteger(image.position) ? image.position as number : 0,
        archived: image.archived === true, data, width: meta.width, height: meta.height });
    }
    // Вещь без картинок на карту не поставить; жидкость — рецепт, картинок у неё и нет.
    if (!images.length && kind !== "liquid") continue;
    items.push({ uid: typeof raw.uid === "string" && UUID.test(raw.uid) ? raw.uid : crypto.randomUUID(), kind, name: text(raw.name, 80) || "Без названия",
      section: text(raw.section, 40), tags: text(raw.tags, 200), data: kindData(kind, record(raw.data)), archived: raw.archived === true, images });
  }
  return { pack: { uid: pack.uid, name: text(pack.name, 80) || "Набор без названия", kinds: kinds.length ? kinds : ["tactical"], genres: genresOf(pack.genres),
    native_style: text(pack.native_style, 40) || "comic-punk" }, items };
}

/** Запись набора из архива. `target` — свой набор, который заменяется; `copy` — всё под новыми кодами рядом с прежним.
 * Замена обновляет вещи и картинки с теми же кодами (карты продолжают их показывать), а вещи, которых в файле нет, уходят в архив, а не удаляются. */
async function savePack(archive: Archive, target: PackRow | null, copy: boolean): Promise<number> {
  const keep = !copy, packUid = target?.uid ?? (copy ? crypto.randomUUID() : archive.pack.uid);
  const folder = ensureSubfolder(ensureSubfolder(VAULT_ROOT, "MapPacks"), packUid);
  const files = new Map<ArchiveImage, string>(), replaced: string[] = [];
  try {
    for (const item of archive.items) for (const image of item.images) {
      const file = path.join(folder, `${crypto.randomUUID()}.webp`);
      await fs.promises.writeFile(vaultAbs(file), image.data);
      files.set(image, file);
    }
    const id = db.transaction(() => {
      const { name, kinds, genres, native_style } = archive.pack, title = copy ? `${name} (копия)`.slice(0, 80) : name;
      const packId = target ? target.id : Number(db.prepare("INSERT INTO map_asset_packs (uid, name, kinds, genres, native_style) VALUES (?, ?, ?, ?, ?)")
        .run(packUid, title, JSON.stringify(kinds), JSON.stringify(genres), native_style).lastInsertRowid);
      if (target) db.prepare("UPDATE map_asset_packs SET name = ?, kinds = ?, genres = ?, native_style = ?, archived_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(name, JSON.stringify(kinds), JSON.stringify(genres), native_style, packId);
      const seenItems: number[] = [], seenImages: number[] = [];
      const stamp = (archived: boolean) => archived ? "COALESCE(archived_at, datetime('now'))" : "NULL";
      for (const item of archive.items) {
        let uid = keep ? item.uid : crypto.randomUUID();
        const row = db.prepare("SELECT id, pack_id FROM map_asset_items WHERE uid = ?").get(uid) as { id: number; pack_id: number } | undefined;
        let itemId: number;
        if (row && row.pack_id === packId) {
          db.prepare(`UPDATE map_asset_items SET kind = ?, name = ?, section = ?, tags = ?, data = ?, archived_at = ${stamp(item.archived)}, updated_at = datetime('now') WHERE id = ?`)
            .run(item.kind, item.name, item.section, item.tags, JSON.stringify(item.data), row.id);
          itemId = row.id;
        } else {
          // Код занят вещью другого набора — эта получает новый.
          if (row) uid = crypto.randomUUID();
          itemId = Number(db.prepare(`INSERT INTO map_asset_items (uid, pack_id, kind, name, section, tags, data, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${item.archived ? "datetime('now')" : "NULL"})`)
            .run(uid, packId, item.kind, item.name, item.section, item.tags, JSON.stringify(item.data)).lastInsertRowid);
        }
        seenItems.push(itemId);
        for (const image of item.images) {
          let imageUid = keep ? image.uid : crypto.randomUUID();
          const old = db.prepare("SELECT im.id, im.file_path, it.pack_id FROM map_asset_images im JOIN map_asset_items it ON it.id = im.item_id WHERE im.uid = ?")
            .get(imageUid) as { id: number; file_path: string; pack_id: number } | undefined;
          if (old && old.pack_id === packId) {
            db.prepare(`UPDATE map_asset_images SET item_id = ?, role = ?, position = ?, file_path = ?, width = ?, height = ?, archived_at = ${stamp(image.archived)} WHERE id = ?`)
              .run(itemId, image.role, image.position, files.get(image), image.width, image.height, old.id);
            replaced.push(old.file_path);
            seenImages.push(old.id);
          } else {
            if (old) imageUid = crypto.randomUUID();
            seenImages.push(Number(db.prepare(`INSERT INTO map_asset_images (uid, item_id, role, position, file_path, width, height, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${image.archived ? "datetime('now')" : "NULL"})`)
              .run(imageUid, itemId, image.role, image.position, files.get(image), image.width, image.height).lastInsertRowid));
          }
        }
      }
      if (target) {
        db.prepare("UPDATE map_asset_items SET archived_at = datetime('now') WHERE pack_id = ? AND archived_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))").run(packId, JSON.stringify(seenItems));
        db.prepare(`UPDATE map_asset_images SET archived_at = datetime('now') WHERE archived_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))
          AND item_id IN (SELECT id FROM map_asset_items WHERE pack_id = ?)`).run(JSON.stringify(seenImages), packId);
      }
      return packId;
    })();
    for (const file of replaced) await fs.promises.unlink(vaultAbs(file)).catch(() => undefined);
    return id;
  } catch (failure) {
    for (const file of files.values()) await fs.promises.unlink(vaultAbs(file)).catch(() => undefined);
    throw failure;
  }
}

// Набор из файла. Если такой набор уже есть, сервер отвечает 409 и ждёт выбора: `mode=replace` или `mode=copy`.
mapPacksRouter.post("/import", (req: AuthedRequest, res) => importUpload(req, res, (error: unknown) => {
  if (error) return res.status(400).json({ error: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Файл больше 300 МБ" : (error as Error).message });
  if (!req.file) return res.status(400).json({ error: "Нужен файл набора" });
  const mode = req.body?.mode === "replace" || req.body?.mode === "copy" ? req.body.mode as string : null;
  (async () => {
    const archive = await readArchive(req.file!.buffer);
    const existing = db.prepare("SELECT * FROM map_asset_packs WHERE uid = ?").get(archive.pack.uid) as PackRow | undefined;
    if (existing && !mode) return res.status(409).json({ error: `Набор «${existing.name}» уже есть`, code: "pack-exists", name: existing.name, archived: !!existing.archived_at });
    const id = await savePack(archive, existing && mode === "replace" ? existing : null, !!existing && mode === "copy");
    res.status(201).json(onePack(id));
  })().catch((failure: unknown) => res.status(400).json({ error: failure instanceof Error ? failure.message : "Набор не загружен" }));
}));

/** Картинка в стандарт набора: WebP, прозрачные поля вместо обрезки, не крупнее 256 точек на клетку. */
async function storeImage(packUid: string, buffer: Buffer, box: Box, surface = false) {
  const uid = crypto.randomUUID();
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error("Файл не читается как изображение");
  const w = "strip" in box ? Math.min(MAX_CELLS, Math.max(box.strip, box.strip * meta.width / meta.height)) : box.w, h = "strip" in box ? box.strip : box.h;
  const full = { width: Math.round(w * MAP_PACK_CELL_PX), height: Math.round(h * MAP_PACK_CELL_PX) };
  // Мелкая картинка не растягивается до стандарта и не тонет в прозрачных полях: холст сжимается под неё, пропорции клеток те же.
  // У поверхности лишнее обрезается, поэтому меряется короткая сторона.
  const ratios = [meta.width / full.width, meta.height / full.height];
  const fit = Math.min(1, surface ? Math.min(...ratios) : Math.max(...ratios));
  const target = { width: Math.max(1, Math.round(full.width * fit)), height: Math.max(1, Math.round(full.height * fit)) };
  const out = await sharp(buffer, { animated: false }).rotate()
    // Поверхность заполняет квадрат целиком: прозрачные поля дали бы дыры в узоре.
    .resize({ ...target, fit: surface ? "cover" : "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
  const mean = (await sharp(out.data).removeAlpha().stats()).channels.slice(0, 3).map((channel) => Math.round(channel.mean).toString(16).padStart(2, "0"));
  const folder = ensureSubfolder(ensureSubfolder(VAULT_ROOT, "MapPacks"), packUid);
  const file = path.join(folder, `${uid}.webp`);
  await fs.promises.writeFile(vaultAbs(file), out.data);
  return { uid, file, width: out.info.width, height: out.info.height, small: fit < 1, fill: `#${mean.join("")}` };
}
const withUpload = (handler: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: AuthedRequest, res: Response) =>
  upload(req, res, (error: unknown) => {
    if (error) return res.status(400).json({ error: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Файл больше 20 МБ" : (error as Error).message });
    if (!req.file) return res.status(400).json({ error: "Нужен файл изображения" });
    handler(req, res).catch((failure: unknown) => res.status(400).json({ error: failure instanceof Error ? failure.message : "Не удалось сохранить изображение" }));
  });

// Новая вещь набора. Объект: картинка, имя, раздел и размер в клетках, заданный на сетке.
// Поверхность (`kind=surface`): бесшовный квадратный образец и число клеток, которое он покрывает.
mapPacksRouter.post("/:id/items", withUpload(async (req, res) => {
  const pack = db.prepare("SELECT * FROM map_asset_packs WHERE id = ? AND archived_at IS NULL").get(req.params.id) as PackRow | undefined;
  if (!pack) return res.status(404).json({ error: "Набор не найден" });
  const name = text(req.body.name, 80);
  if (!name) return res.status(400).json({ error: "Название обязательно" });
  const kind = ITEM_KINDS.includes(req.body.kind) ? req.body.kind as string : "object";
  const parsed = kindData(kind, numbers(req.body));
  const image = await storeImage(pack.uid, req.file!.buffer, imageBox(kind, parsed, "variant"), kind === "surface");
  const data = kind === "surface" ? { ...parsed, fill: image.fill } : parsed;
  db.transaction(() => {
    const itemId = db.prepare("INSERT INTO map_asset_items (uid, pack_id, kind, name, section, tags, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), pack.id, kind, name, text(req.body.section, 40), text(req.body.tags, 200), JSON.stringify(data)).lastInsertRowid;
    db.prepare("INSERT INTO map_asset_images (uid, item_id, role, position, file_path, width, height) VALUES (?, ?, 'variant', 0, ?, ?, ?)").run(image.uid, itemId, image.file, image.width, image.height);
    db.prepare("UPDATE map_asset_packs SET updated_at = datetime('now') WHERE id = ?").run(pack.id);
  })();
  res.status(201).json({ pack: onePack(pack.id), small: image.small });
}));

// Новая жидкость набора: только рецепт, без картинки.
mapPacksRouter.post("/:id/liquids", (req, res) => {
  const pack = db.prepare("SELECT * FROM map_asset_packs WHERE id = ? AND archived_at IS NULL").get(req.params.id) as PackRow | undefined;
  if (!pack) return res.status(404).json({ error: "Набор не найден" });
  const body = (req.body ?? {}) as Record<string, unknown>, name = text(body.name, 80);
  if (!name) return res.status(400).json({ error: "Название обязательно" });
  const uid = crypto.randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO map_asset_items (uid, pack_id, kind, name, section, tags, data) VALUES (?, ?, 'liquid', ?, ?, ?, ?)")
      .run(uid, pack.id, name, text(body.section, 40), text(body.tags, 200), JSON.stringify(liquidData(body)));
    db.prepare("UPDATE map_asset_packs SET updated_at = datetime('now') WHERE id = ?").run(pack.id);
  })();
  res.status(201).json({ pack: onePack(pack.id), uid });
});

// Ещё один вариант той же вещи (каталог берёт случайный при постановке) или её особая картинка — новая заменяет прежнюю:
// у объекта `role` w / n / e — как предмет выглядит, повёрнутый на 90°, 180° и 270°; у линии `post` — столб на изломах и концах.
mapPacksRouter.post("/items/:itemId/images", withUpload(async (req, res) => {
  const item = db.prepare(`SELECT i.*, p.uid AS pack_uid FROM map_asset_items i JOIN map_asset_packs p ON p.id = i.pack_id
    WHERE i.id = ? AND i.archived_at IS NULL AND p.archived_at IS NULL`).get(req.params.itemId) as (ItemRow & { pack_uid: string }) | undefined;
  if (!item) return res.status(404).json({ error: "Объект не найден" });
  const raw = json<Record<string, unknown>>(item.data, {});
  const role = roleOf(item.kind, req.body.role);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM map_asset_images WHERE item_id = ? AND role = 'variant' AND archived_at IS NULL").get(item.id) as { n: number }).n;
  if (role === "variant" && count >= 12) return res.status(400).json({ error: "У вещи не больше 12 вариантов" });
  const image = await storeImage(item.pack_uid, req.file!.buffer, imageBox(item.kind, kindData(item.kind, raw), role), item.kind === "surface");
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
  const merged = { ...json<Record<string, unknown>>(item.data, {}), ...body };
  const data = kindData(item.kind, merged);
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
