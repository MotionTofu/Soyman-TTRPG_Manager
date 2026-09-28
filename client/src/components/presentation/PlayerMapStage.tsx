import { useEffect, useMemo, useRef, useState } from "react";
import { prepareMapImageAssets, registerMapImageResources, subscribeMapImageAssets, type MapImageResource } from "../../maps/assets/registry";
import { useResource } from "../../data/hooks";
import { worldBounds } from "../../maps/grid";
import { loadStoredEditorDocument } from "../../maps/editor/loadDocument";
import type { MapFull } from "../../maps/mapTypes";
import { readChrome, renderMap } from "../../maps/render";
import { createV5RenderModel } from "../../maps/renderModel";

/** Общий кадр карты для превью пульта и второго экрана. Данные всегда
 * приходят с серверного player-view, в том числе для мастера. */
export function PlayerMapStage({ mapId }: { mapId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapState = useResource<MapFull>(`/maps/${mapId}/player-view`, { pollMs: 2000 });
  const assetsState = useResource<MapImageResource[]>(`/maps/${mapId}/assets?player_view=1`, { pollMs: 2000 });
  const [, refreshImages] = useState(0);
  const [assetLoadError, setAssetLoadError] = useState(false);
  const map = mapState.data;
  const loaded = useMemo(() => map ? loadStoredEditorDocument(map) : null, [map]);
  useEffect(() => subscribeMapImageAssets(() => refreshImages((revision) => revision + 1)), []);
  useEffect(() => {
    if (!assetsState.data || !loaded) return;
    let active = true;
    registerMapImageResources(assetsState.data);
    void prepareMapImageAssets(loaded.document).then(() => {
      if (active) setAssetLoadError(false);
    }).catch(() => {
      if (active) setAssetLoadError(true);
    });
    refreshImages((revision) => revision + 1);
    return () => { active = false; };
  }, [assetsState.data, loaded]);
  const rendered = loaded && !loaded.corrupt && assetsState.data
    ? createV5RenderModel(loaded.document) : null;
  const unsupported = !!rendered?.diagnostics.length || !!loaded?.compatibility.reasons.some((r) => r.code === "grid-geometry");
  const model = unsupported ? null : rendered?.model;

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
        showGrid: true, showCoords: false, hover: null, chrome: readChrome(),
        playerView: true, selectedId: null,
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [map, model]);

  if (mapState.error || assetsState.error || assetLoadError || loaded?.corrupt || (assetsState.data && unsupported)) return <div className="muted" role="alert">Карту не удалось показать.</div>;
  return <canvas ref={canvasRef} aria-label={map ? `Карта ${map.name}` : "Загрузка карты"}
    style={{ display: "block", width: "100%", height: "100%", background: "#000" }} />;
}
