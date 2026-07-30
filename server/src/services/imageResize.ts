import sharp from "sharp";

// Shared caps for the different "kinds" of image this app stores — an
// avatar/thumbnail never displays larger than a few hundred px in the UI,
// so there's no reason to keep a multi-MB phone-camera original on disk.
// Map images (setting_locations.map_image_path) are intentionally excluded
// everywhere this is used — they're meant to be zoomed into, so they stay
// full-resolution.
export const IMAGE_SIZE_PRESETS = {
  avatar: { width: 700, height: 700 },
  thumbnail: { width: 900, height: 675 },
  background: { width: 1920, height: 1080 },
  gallery: { width: 1500, height: 844 },
} as const;

export type ImageSizePreset = keyof typeof IMAGE_SIZE_PRESETS;

// Resizes `buffer` down to fit within the given preset (never upscales) and
// returns the result. Falls back to the original buffer if sharp can't
// decode it (e.g. an already-animated gif, or some other exotic format) —
// callers should treat this as "best effort", not a guarantee.
export async function resizeImageBuffer(buffer: Buffer, preset: ImageSizePreset): Promise<Buffer> {
  const { width, height } = IMAGE_SIZE_PRESETS[preset];
  try {
    return await sharp(buffer)
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}
