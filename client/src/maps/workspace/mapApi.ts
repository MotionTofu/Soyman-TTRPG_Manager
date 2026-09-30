import { readOnce, readTextOnce } from "../../data/imperative";
import { write } from "../../data/hooks";
import type { MapFull } from "../mapTypes";
import type { MapSaveBody } from "../editor/hooks/useMapAutosave";
import { MAP_VERSION_HEADER, serializeMapDocumentV6, type MapDocumentV6, type TokenSourceRef } from "@shared/maps/core";
import type { ResolvedTokenSource, TokenPresentation } from "./tokenPlacement";

const headers = { [MAP_VERSION_HEADER]: "6" };
/** V6 consumers only; the original editor never claims V6 support. */
export const mapWorkspaceApi = {
  read: (id: number) => readOnce<MapFull>(`/maps/${id}`, { headers }),
  createPrivateCopy: (map: MapFull, document: MapDocumentV6) => write.post<MapFull>("/maps", {
    name: `${map.name} · копия`, scale: map.scale, cell_lore: map.cell_lore,
    document: serializeMapDocumentV6(document), player_visible: 0,
    seed: map.seed, sea: map.sea, mountains: map.mountains, forest: map.forest,
  }, { headers }),
  save: (id: number, document: MapDocumentV6, expectedRevision: number) =>
    write.put<MapFull>(`/maps/${id}`, { document: serializeMapDocumentV6(document), expectedRevision }, { headers }),
  saveBody: (id: number, body: MapSaveBody) => {
    if (!Number.isSafeInteger(body.expectedRevision)) return Promise.reject(new Error("Не удалось определить ревизию карты. Откройте её заново"));
    return write.put<MapFull>(`/maps/${id}`, body, { headers });
  },
  resolveSource: (mapId: number, kind: TokenSourceRef["kind"], id: number) =>
    write.post<ResolvedTokenSource>(
      `/maps/${mapId}/token-source`, { kind, id }, { headers }),
  presentations: (mapId: number, sources: TokenSourceRef[]) => write.post<TokenPresentation[]>(`/maps/${mapId}/token-presentations`, { sources }, { headers }),
};

export async function downloadStoredMapOriginal(id: number): Promise<void> {
  const raw = await readTextOnce(`/maps/${id}/raw`);
  downloadMapJson(raw, `map-${id}-original.json`);
}
export function downloadMapJson(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
