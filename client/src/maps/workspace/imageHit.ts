const masks = new WeakMap<HTMLImageElement, ImageData>();

/** Transparent parts of a frame or wall image must let clicks through. */
export function imageHit(image: HTMLImageElement | null | undefined, u: number, v: number) {
  if (!image?.complete || !image.naturalWidth || typeof document === "undefined") return true;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  let mask = masks.get(image);
  if (!mask) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return true;
      ctx.drawImage(image, 0, 0);
      mask = ctx.getImageData(0, 0, canvas.width, canvas.height);
      masks.set(image, mask);
    } catch { return true; }
  }
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const y = Math.min(mask.height - 1, Math.floor(v * mask.height));
  return mask.data[(y * mask.width + x) * 4 + 3] >= 16;
}
