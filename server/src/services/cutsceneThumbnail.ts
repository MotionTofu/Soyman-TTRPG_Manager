import type { PresentationData } from "@soyman/shared";
import { readCutscene } from "./cutscenes";
import { accessCutsceneMedia } from "./cutsceneMedia";

/** Static preview of the first composition containing an image; no text, notes or audio. */
export function readCutsceneThumbnail(id: number): PresentationData | null {
  const document = readCutscene(id).document;
  for (const step of document.steps) {
    if (step.image.action !== "replace") continue;
    const composition = step.image.composition;
    if (!composition.background && !composition.layers.some(layer => layer.visible)) continue;
    const urls = new Map<string, string>();
    const url = (mediaId: string) => {
      if (!urls.has(mediaId)) urls.set(mediaId, accessCutsceneMedia(id, mediaId).url);
      return urls.get(mediaId)!;
    };
    return { background_path: null, background_url: composition.background ? url(composition.background.id) : null,
      transition: "cut", transition_ms: 0, title: composition.title, title_secs: composition.title_secs, fade_ms: composition.fade_ms,
      layers: composition.layers.flatMap((layer, index) => layer.visible ? [{
        id: index + 1, name: "", image_path: "", image_url: url(layer.image.id), has_button: 0, visible_on_enter: 1,
        position: layer.position, x_pct: layer.x_pct, y_pct: layer.y_pct, w_pct: layer.w_pct, h_pct: layer.h_pct,
      }] : []) };
  }
  return null;
}
