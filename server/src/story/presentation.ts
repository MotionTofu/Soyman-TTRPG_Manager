// Представление сцены и заглавное кампании (показ игрокам на второй экран):
// чтение, валидация, файлы. Пишущие роуты живут в routes/story.ts (сцены),
// routes/campaigns.ts (заглавное) и routes/sessions.ts (show-state) — здесь
// только общее, чтобы не разъехаться правилами между тремя местами.
//
// Файлы слоёв неизменяемы (создание + удаление строкой, замены нет), поэтому
// копии сцен делят image_path строкой безопасно. Фон — заменяемый, и копия
// обязана получить свой файл (см. duplicateSceneBackgroundFile в library.ts),
// иначе замена фона у оригинала уронила бы фон копии.

import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { db } from "../db/db";
import { ensureSubfolder, toFileUrl, vaultAbs } from "../services/filesystem";
import { resizeImageBuffer } from "../services/imageResize";
import { storeDeduped } from "../services/vaultDedup";
import { contentSceneId, withLibraryContent } from "./library";

export const PRESENTATION_TRANSITIONS = ["cut", "fade", "black"] as const;

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "jpg", "png", "gif", "webp", "avif"]);

export const presentationUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `rpg-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Поддерживаются только изображения JPG/PNG/GIF/WebP/AVIF"));
  },
}).single("file");

export function getUploadBuffer(file: Express.Multer.File): Buffer {
  const p = (file as unknown as { path?: string }).path;
  if (p && fs.existsSync(p)) return fs.readFileSync(p);
  return Buffer.alloc(0);
}

export function cleanupUpload(file: Express.Multer.File | undefined): void {
  const p = (file as unknown as { path?: string })?.path;
  if (p) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

// Проверяет магические байты и готовит буфер к записи: статика ужимается до
// фона второго монитора (1920×1080, без апскейла), анимация (pages > 1)
// кладётся как есть — прогон через sharp срезал бы GIF/WebP до первого кадра,
// а птицы и дождь без движения не нужны.
export async function processPresentationImage(file: Express.Multer.File): Promise<{
  buffer: Buffer;
  ext: string;
  width: number;
  height: number;
}> {
  const rawExt = (path.extname(file.originalname) || ".jpg").toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) throw new Error("Недопустимое расширение файла");
  const buf = getUploadBuffer(file);
  if (!buf.length) throw new Error("Пустой файл");
  let animated = false;
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(buf).metadata();
    const fmt = (meta.format || "").toLowerCase();
    if (!ALLOWED_SHARP_FORMATS.has(fmt)) throw new Error("unsupported");
    animated = (meta.pages ?? 1) > 1;
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch (e) {
    if (e instanceof Error && (e.message === "unsupported" || e.message === "Недопустимое расширение файла")) throw e;
    throw new Error("Файл не является изображением JPG/PNG/GIF/WebP/AVIF");
  }
  return { buffer: animated ? buf : await resizeImageBuffer(buf, "background"), ext: rawExt, width, height };
}

// Начальная геометрия слоя: вписать картинку в кадр целиком (contain) по её
// реальным габаритам, отцентрировать. Кадр 16:9, поэтому % ширины и высоты —
// разные масштабы: считаем в условных единицах 16×9. Маленькое растягивается
// до вписывания — для показа игрокам предсказуемость важнее попиксельности.
export function containFitGeometry(iw: number, ih: number): { x_pct: number; y_pct: number; w_pct: number; h_pct: number } {
  if (!iw || !ih) return { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 };
  const wUnits = Math.min(16, (9 * iw) / ih);
  const hUnits = Math.min(9, (16 * ih) / iw);
  const w_pct = (wUnits / 16) * 100;
  const h_pct = (hUnits / 9) * 100;
  return { x_pct: (100 - w_pct) / 2, y_pct: (100 - h_pct) / 2, w_pct, h_pct };
}

export interface PresentationLayer {
  id: number;
  name: string;
  image_path: string;
  image_url: string;
  has_button: number;
  visible_on_enter: number;
  position: number;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
}

export interface PresentationData {
  background_path: string | null;
  background_url: string | null;
  transition: string;
  transition_ms: number;
  title: string;
  title_secs: number;
  fade_ms: number;
  layers: PresentationLayer[];
}

function layersOf(table: string, idCol: string, id: number): PresentationLayer[] {
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE ${idCol} = ? ORDER BY position, id`)
    .all(id) as (Omit<PresentationLayer, "image_url"> & { image_path: string })[];
  return rows.map((r) => ({ ...r, image_url: r.image_path ? toFileUrl(r.image_path) : "" }));
}

// Чтение сквозь заготовку: у нетронутой вставки свои тексты/фон/переход пусты,
// и берутся с полки — тем же withLibraryContent, что и везде.
export function readScenePresentation(sceneId: number): (PresentationData & { scene_id: number; content_scene_id: number }) | null {
  const row = db.prepare("SELECT * FROM story_scenes WHERE id = ? AND archived_at IS NULL").get(sceneId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const shown = withLibraryContent(row as { id: number; library_scene_id: number | null }) as Record<string, unknown>;
  const contentId = contentSceneId(sceneId);
  const background = (shown.presentation_background_path as string | null) ?? null;
  return {
    scene_id: sceneId,
    content_scene_id: contentId,
    background_path: background,
    background_url: background ? toFileUrl(background) : null,
    transition: (shown.presentation_transition as string) ?? "cut",
    transition_ms: (shown.presentation_transition_ms as number) ?? 600,
    title: (shown.presentation_title as string) ?? "",
    title_secs: (shown.presentation_title_secs as number) ?? 3,
    fade_ms: (shown.presentation_fade_ms as number) ?? 600,
    layers: layersOf("scene_presentation_layers", "scene_id", contentId),
  };
}

export function readCampaignCover(campaignId: number): (PresentationData & { campaign_id: number }) | null {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ? AND archived_at IS NULL").get(campaignId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const background = (row.cover_background_path as string | null) ?? null;
  return {
    campaign_id: campaignId,
    background_path: background,
    background_url: background ? toFileUrl(background) : null,
    transition: (row.cover_transition as string) ?? "cut",
    transition_ms: (row.cover_transition_ms as number) ?? 600,
    title: (row.cover_title as string) ?? "",
    title_secs: (row.cover_title_secs as number) ?? 3,
    fade_ms: (row.cover_fade_ms as number) ?? 600,
    layers: layersOf("campaign_presentation_layers", "campaign_id", campaignId),
  };
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

// Частичный патч полей входа. Возвращает ошибку строкой, а не бросает —
// роутам так удобнее отвечать 400.
export function validatePresentationPatch(body: Record<string, unknown>): { patch: Record<string, unknown>; error: string | null } {
  const patch: Record<string, unknown> = {};
  if (body.transition !== undefined) {
    if (typeof body.transition !== "string" || !(PRESENTATION_TRANSITIONS as readonly string[]).includes(body.transition)) {
      return { patch, error: "transition must be cut|fade|black" };
    }
    patch.transition = body.transition;
  }
  // cover_* отображается вызывателем: PUT заглавного шлёт те же ключи.
  const intFields: [string, number, number][] = [
    ["transition_ms", 0, 10000],
    ["title_secs", 0, 120],
    ["fade_ms", 0, 10000],
  ];
  for (const [key, min, max] of intFields) {
    if (body[key] === undefined) continue;
    const n = asInt(body[key]);
    if (n == null || n < min || n > max) return { patch, error: `${key} must be ${min}..${max}` };
    patch[key] = n;
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string") return { patch, error: "title must be a string" };
    if (body.title.length > 500) return { patch, error: "title too long (max 500)" };
    patch.title = body.title;
  }
  return { patch, error: null };
}

export function validateLayerPatch(
  body: Record<string, unknown>,
  isCreate: boolean
): { patch: Record<string, unknown>; error: string | null } {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined || isCreate) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { patch, error: "name is required" };
    if (name.length > 200) return { patch, error: "name too long (max 200)" };
    patch.name = name;
  }
  for (const key of ["has_button", "visible_on_enter"]) {
    if (body[key] === undefined) continue;
    const v = body[key];
    const n = v === true ? 1 : v === false ? 0 : asInt(v);
    if (n !== 0 && n !== 1) return { patch, error: `${key} must be 0|1` };
    patch[key] = n;
  }
  for (const key of ["x_pct", "y_pct"]) {
    if (body[key] === undefined) continue;
    const n = typeof body[key] === "number" ? body[key] : asInt(body[key]);
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
      return { patch, error: `${key} must be 0..100` };
    }
    patch[key] = n;
  }
  for (const key of ["w_pct", "h_pct"]) {
    if (body[key] === undefined) continue;
    const n = typeof body[key] === "number" ? body[key] : asInt(body[key]);
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 300) {
      return { patch, error: `${key} must be 0..300` };
    }
    patch[key] = n;
  }
  return { patch, error: null };
}

// Папка файлов представления сцены: папка сеттинга + Scenes/<id>/Presentation.
// У сцены без сеттинга (бездомная заготовка) папки нет — вызыватель отвечает 400.
export function scenePresentationFolder(sceneId: number): string {
  const scene = db.prepare("SELECT setting_id FROM story_scenes WHERE id = ?").get(sceneId) as
    | { setting_id: number | null }
    | undefined;
  const setting = scene?.setting_id
    ? (db.prepare("SELECT folder_path FROM settings WHERE id = ?").get(scene.setting_id) as
        | { folder_path: string | null }
        | undefined)
    : undefined;
  if (!setting?.folder_path) throw new Error("у сцены нет папки сеттинга");
  return ensureSubfolder(setting.folder_path, `Scenes/${sceneId}/Presentation`);
}

export function campaignPresentationFolder(campaignId: number): string {
  const campaign = db.prepare("SELECT folder_path FROM campaigns WHERE id = ?").get(campaignId) as
    | { folder_path: string | null }
    | undefined;
  if (!campaign?.folder_path) throw new Error("у кампании нет папки");
  return ensureSubfolder(campaign.folder_path, "Presentation");
}

// Записьprocessed-картинки дедупом + удаление старого файла при замене фоном.
export async function storePresentationFile(buffer: Buffer, targetPath: string, oldPath?: string | null): Promise<void> {
  if (oldPath && oldPath !== targetPath) {
    const absOld = vaultAbs(oldPath);
    if (fs.existsSync(absOld)) {
      try {
        fs.unlinkSync(absOld);
      } catch (err) {
        console.error(`Failed to remove old presentation file ${absOld}:`, err);
      }
    }
  }
  await storeDeduped(buffer, targetPath);
}

export function layerFileName(ext: string): string {
  return `layer-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
}
