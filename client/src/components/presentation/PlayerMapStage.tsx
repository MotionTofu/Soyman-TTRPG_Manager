import { useEffect, useMemo, useRef, useState } from "react";
import { MAP_VERSION_HEADER, parseStoredMapDocument } from "@shared/maps/core";
import { prepareCartographyStyle, prepareMapImageAssets, registerMapImageResources, subscribeMapImageAssets, type MapImageResource } from "../../maps/assets/registry";
import { useResource } from "../../data/hooks";
import { worldBounds } from "../../maps/grid";
import { loadStoredEditorDocument, loadStoredWorkspaceDocument } from "../../maps/editor/loadDocument";
import type { MapFull } from "../../maps/mapTypes";
import { readChrome, renderMap } from "../../maps/render";
import { createV5RenderModel } from "../../maps/renderModel";
import { workspaceDrawingStyle } from "../../maps/workspace/drawingStyle";
import { createWorkspaceRenderModel } from "../../maps/workspace/renderV6";

/** This stage reads the projected V6 document, so it may declare V6. */
const V6_READER = { [MAP_VERSION_HEADER]: "6" };

/** Общий кадр карты для превью пульта и второго экрана. Данные всегда
 * приходят с серверного player-view, в том числе для мастера. */
export function PlayerMapStage({ mapId }: { mapId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapState = useResource<MapFull>(`/maps/${mapId}/player-view`, { pollMs: 2000, headers: V6_READER });
  const assetsState = useResource<MapImageResource[]>(`/maps/${mapId}/assets?player_view=1`, { pollMs: 2000, headers: V6_READER });
  const [imageRevision, refreshImages] = useState(0);
  const [assetLoadError, setAssetLoadError] = useState(false);
  const map = mapState.data;
  // The server already projected the document: V6 comes without private tokens.
  const v6 = useMemo(() => {
    if (!map || parseStoredMapDocument(map.cells).format !== "v6") return null;
    const loaded = loadStoredWorkspaceDocument(map);
    return loaded.status === "supported" ? loaded.document : "corrupt" as const;
  }, [map]);
  const loaded = useMemo(() => map && !v6 ? loadStoredEditorDocument(map) : null, [map, v6]);
  const document = v6 && v6 !== "corrupt" ? v6 : loaded?.document ?? null;
  useEffect(() => subscribeMapImageAssets(() => refreshImages((revision) => revision + 1)), []);
  useEffect(() => {
    if (!assetsState.data || !document) return;
    let active = true;
    registerMapImageResources(assetsState.data);
    if (v6 && v6 !== "corrupt" && v6.appearance?.style !== "blueprint") void prepareCartographyStyle(v6.appearance?.style ?? "paper-ink");
    void prepareMapImageAssets(document).then(() => {
      if (active) setAssetLoadError(false);
    }).catch(() => {
      if (active) setAssetLoadError(true);
    });
    refreshImages((revision) => revision + 1);
    return () => { active = false; };
  }, [assetsState.data, document, v6]);
  const rendered = useMemo(() => !assetsState.data ? null
    : v6 ? (v6 === "corrupt" ? null : createWorkspaceRenderModel(v6))
      : loaded && !loaded.corrupt ? createV5RenderModel(loaded.document) : null,
  // Decoded images change the model without changing the document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [assetsState.data, v6, loaded, imageRevision]);
  const unsupported = !!rendered?.diagnostics.length || !!loaded?.compatibility.reasons.some((r) => r.code === "grid-geometry");
  const model = unsupported ? null : rendered?.model;
  const style = v6 && v6 !== "corrupt" ? workspaceDrawingStyle(v6) : { chrome: readChrome() };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || !model) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const b = worldBounds(map.grid, map.width, map.height);
      const pad = Math.min(24, Math.min(rect.width, rect.height) * 0.025);
      const scale = Math.min((rect.width - 2 * pad) / (b.maxX - b.minX), (rect.height - 2 * pad) / (b.maxY - b.minY));
      renderMap(ctx, rect.width, rect.height, {
        grid: map.grid, width: map.width, height: map.height, model,
        scale, ox: (rect.width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
        oy: (rect.height - (b.maxY - b.minY) * scale) / 2 - b.minY * scale,
        showGrid: true, showCoords: false, hover: null, ...style,
        playerView: true, selectedId: null,
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
    // `style` is derived from the same document as `model`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, model]);

  if (mapState.error || assetsState.error || assetLoadError || loaded?.corrupt || v6 === "corrupt" || (assetsState.data && unsupported)) return <div className="muted" role="alert">Карту не удалось показать.</div>;
  return <canvas ref={canvasRef} aria-label={map ? `Карта ${map.name}` : "Загрузка карты"}
    style={{ display: "block", width: "100%", height: "100%", background: "#000" }} />;
}
