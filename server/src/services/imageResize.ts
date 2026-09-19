import sharp from "sharp";

// Shared caps for the different "kinds" of image this app stores — an
// avatar/thumbnail never displays larger than a few hundred px in the UI,
// so there's no reason to keep a multi-MB phone-camera original on disk.
// Map images (setting_locations.map_image_path) are intentionally excluded
// everywhere this is used — they're meant to be zoomed into, so they stay
// full-resolution.
export const IMAGE_SIZE_PRESETS = {
  avatar: { width: 700, height: 700 },
  thumbnail: { width: 900, height: 562 },
  background: { width: 1920, height: 1080 },
  gallery: { width: 1500, height: 844 },
  // Карта вида/класса/подкласса: исходники 1024×1536 (2:3), хранится WebP.
  card: { width: 1024, height: 1536 },
} as const;

export type ImageSizePreset = keyof typeof IMAGE_SIZE_PRESETS;

// Resizes `buffer` down to fit within the given preset (never upscales) and
// returns the result. Falls back to the original buffer if sharp can't
// decode it (e.g. an already-animated gif, or some other exotic format) —
// callers should treat this as "best effort", not a guarantee.
export async function resizeImageBuffer(buffer: Buffer, preset: ImageSizePreset): Promise<Buffer> {
  const { width, height } = IMAGE_SIZE_PRESETS[preset];
  try {
    const img = sharp(buffer).resize({ width, height, fit: "inside", withoutEnlargement: true });
    // PNG карты весит ~3 МБ, WebP того же размера — в десять раз меньше.
    return await (preset === "card" ? img.webp({ quality: 85 }) : img).toBuffer();
  } catch {
    return buffer;
  }
}

// Превью для плитки карт: `/files/...?w=320`. Ширины — только из списка,
// иначе любой `?w=` плодил бы записи в кэше. Ключ — путь + mtime: замена
// карты даёт новый mtime и, значит, свежее превью.
// ponytail: кэш в памяти без вытеснения — сотни превью по ~20 КБ; LRU, если
// карт станут тысячи.
export const THUMB_WIDTHS = new Set([160, 320]);
const thumbCache = new Map<string, Buffer>();

export async function thumbnailOf(absPath: string, mtimeMs: number, width: number): Promise<Buffer> {
  const key = `${absPath}|${mtimeMs}|${width}`;
  let buf = thumbCache.get(key);
  if (!buf) {
    buf = await sharp(absPath).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    thumbCache.set(key, buf);
  }
  return buf;
}
