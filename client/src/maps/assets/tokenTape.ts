import { rasterAsset } from "../../rasterAssets";

let image: HTMLImageElement | null = null;
const listeners = new Set<() => void>();
export function prepareTokenTape() {
  if (image || typeof Image === "undefined") return;
  image = new Image();
  image.onload = () => { for (const listener of listeners) listener(); };
  image.src = rasterAsset("ui/fantasy-punk/decorative/profile", "tape")!;
}
export function tokenTapeImage() {
  prepareTokenTape();
  return image?.complete && image.naturalWidth > 48 ? image : null;
}
export function subscribeTokenTape(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
