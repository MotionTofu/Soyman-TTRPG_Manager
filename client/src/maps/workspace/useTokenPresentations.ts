import { useEffect, useMemo, useState } from "react";
import { tokensOf, type MapDocumentV6 } from "@shared/maps/core";
import { onDataChangedElsewhere } from "../../dataSync";
import { queryClient } from "../../data/queryClient";
import { getAuthToken } from "../../api/client";
import { mapWorkspaceApi } from "./mapApi";
import { tokenSourceKey, type TokenPresentation } from "./tokenPlacement";

export type TokenDisplay = TokenPresentation & { portrait?: HTMLImageElement | null };
export function useTokenPresentations(mapId: number, document: MapDocumentV6 | null) {
  const keys = JSON.stringify(document ? [...new Map(tokensOf(document).flatMap((token) => token.sourceRef ? [[tokenSourceKey(token.sourceRef), token.sourceRef] as const] : [])).values()] : []);
  const sources = useMemo(() => JSON.parse(keys) as TokenPresentation["sourceRef"][], [keys]);
  const [displays, setDisplays] = useState<ReadonlyMap<string, TokenDisplay>>(new Map());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => setRevision((n) => n + 1), 100); };
    window.addEventListener("focus", refresh);
    const off = onDataChangedElsewhere((payload) => {
      if (!payload.affects || payload.affects.some((affect) => "kind" in affect && ["being", "location", "setting", "compendium_entry"].includes(affect.kind))) refresh();
    });
    const offCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate" && ["being", "location", "setting", "compendium_entry"].includes(String(event.query.queryKey[1]))) refresh();
    });
    return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); off(); offCache(); };
  }, []);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController(), blobs: string[] = [];
    setDisplays(new Map());
    if (sources.length) void mapWorkspaceApi.presentations(mapId, sources).then(async (rows) => {
      if (!alive) return;
      setDisplays(new Map(rows.map((row) => [tokenSourceKey(row.sourceRef), row])));
      await Promise.allSettled(rows.map(async (row) => {
        if (!row.portrait_url?.startsWith("/files/") || !getAuthToken()) return;
        const response = await fetch(row.portrait_url, { signal: controller.signal, headers: { Authorization: `Bearer ${getAuthToken()}` } });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!alive) return;
        const url = URL.createObjectURL(blob); blobs.push(url);
        const image = new Image(); image.src = url; await image.decode();
        if (alive) setDisplays((before) => new Map(before).set(tokenSourceKey(row.sourceRef), { ...row, portrait: image }));
      }));
    }).catch(() => {
      if (alive) setDisplays(new Map(sources.map((ref) => [tokenSourceKey(ref), { sourceRef: ref, id: null, name: "Источник не загружен", state: "missing", portrait_url: null }])));
    });
    return () => { alive = false; controller.abort(); blobs.forEach((url) => URL.revokeObjectURL(url)); };
  }, [mapId, sources, revision]);
  return displays;
}
