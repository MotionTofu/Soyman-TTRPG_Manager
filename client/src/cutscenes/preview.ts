import type { CutsceneComposition, CutsceneMediaAccess } from "@shared/cutscenes/types";
import type { PresentationData } from "@shared/presentation";
import { readOnce } from "../data/imperative";

/** Adapts the same composition to PresentationStage for a private rehearsal; never publishes it. */
export async function readCutscenePreview(cutsceneId: number, composition: CutsceneComposition, signal: AbortSignal): Promise<PresentationData> {
  const refs = [...(composition.background ? [composition.background] : []), ...composition.layers.filter(l => l.visible).map(l => l.image)];
  const ids = [...new Set(refs.map(ref => ref.id))];
  const access = await Promise.all(ids.map(id => readOnce<CutsceneMediaAccess>(
    `/cutscenes/${cutsceneId}/media/${encodeURIComponent(id)}/access`, { signal })));
  const urls = new Map(access.map(item => [item.ref.id, item.url]));
  return { background_path: null, background_url: composition.background ? urls.get(composition.background.id)! : null,
    title: composition.title, title_secs: composition.title_secs, fade_ms: composition.fade_ms, transition: "cut", transition_ms: 0,
    layers: composition.layers.flatMap((layer, index) => layer.visible ? [{
      id: index + 1, name: "", image_path: "", image_url: urls.get(layer.image.id)!, has_button: 0, visible_on_enter: 1,
      position: layer.position, x_pct: layer.x_pct, y_pct: layer.y_pct, w_pct: layer.w_pct, h_pct: layer.h_pct,
    }] : []) };
}
