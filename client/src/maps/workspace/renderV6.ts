import type { MapDocumentV6 } from "@shared/maps/core";
import { geometryView } from "./editDocument";
import { createV5RenderModel, type RenderGameplayItem } from "../renderModel";
import { tokenSourceKey } from "./tokenPlacement";
import type { TokenDisplay } from "./useTokenPresentations";

export function createWorkspaceRenderModel(document: MapDocumentV6, displays?: ReadonlyMap<string, TokenDisplay>) {
  const result = createV5RenderModel(geometryView(document));
  return { ...result, model: { ...result.model, layers: result.model.layers.map((layer) => {
    const source = document.layers.find((entry) => entry.id === layer.id);
    if (layer.kind !== "gameplay" || source?.kind !== "gameplay") return layer;
    const idOf = (item: RenderGameplayItem): string => {
      switch (item.kind) {
        case "room": return item.room.id;
        case "door": return item.door.id;
        case "trap": return item.trap.id;
        case "marker": return item.marker.id;
        case "start": return item.start.id;
        case "finish": return item.finish.id;
        case "token": return item.token.id;
      }
    };
    const byId = new Map(layer.items.map((item) => [idOf(item), item]));
    const items: RenderGameplayItem[] = [];
    for (const item of source.items) {
      if (item.kind === "token") items.push({ kind: "token", token: item, display: item.sourceRef ? displays?.get(tokenSourceKey(item.sourceRef)) : undefined });
      else { const rendered = byId.get(item.id); if (rendered) items.push(rendered); }
    }
    return { ...layer, items };
  }) } };
}
