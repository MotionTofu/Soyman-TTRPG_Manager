import { useEffect, useMemo, useRef, useState } from "react";
import type { MapDocumentV6, MapLiquidRecipe, MapWaterLook } from "@shared/maps/core";
import { MAP_WATER_LOOKS } from "@shared/maps/core";
import type { MapDocumentV5 } from "../core/types";
import { paintTerrainMaskStroke } from "../core/mutations/terrainMask";
import { waterCode } from "../assets/village";
import { prepareMapImageAssets } from "../assets/registry";
import { useMapImageRevision } from "../assets/ownPacks";
import { renderMap } from "../render";
import { drawWaterStill } from "../water";
import { createWorkspaceRenderModel } from "./renderV6";
import { WATER_LOOKS, workspaceDrawingStyle } from "./drawingStyle";
import { LIQUID_LAYER } from "./liquids";

const W = 12, H = 8, CELL = 30, KEY = "own1";
const terrain = (key: string) => ({ type: "builtin" as const, key: `terrain/${key}` });
const maskLayer = (id: string, name: string) => ({ id, kind: "terrain" as const, name, visible: true, locked: false, opacity: 1, representation: "mask" as const,
  defaultMaterial: terrain("village-grass"), mask: { origin: { x: 0, y: 0 }, sampleSize: 0.25, materials: [], chunks: [] } });
/** Пруд (В16): трава, песчаный берег, брусчатка у воды и жидкость в две глубины. Земля и вода — отдельные карты: землю рисуем раз. */
function pond(): { ground: MapDocumentV6; water: MapDocumentV6 } {
  let doc = { v: 5, world: { bounds: { minX: 0, minY: 0, maxX: W, maxY: H } }, grid: { type: "square", cellSize: 1, columns: W, rows: H, origin: { x: 0, y: 0 } },
    assetPacks: [], layers: [maskLayer("ground", "Поверхность"), maskLayer("liquid", LIQUID_LAYER)] } as unknown as MapDocumentV5;
  let n = 0;
  const paint = (layer: string, points: { x: number; y: number }[], radius: number, key: string) => {
    const result = paintTerrainMaskStroke(doc, layer, points, radius, terrain(key), () => `pond-${n++}`);
    if (result.ok) doc = result.document;
  };
  for (let y = 0.5; y < H; y += 1) paint("ground", [{ x: 0, y }, { x: W, y }], 0.75, "village-grass");
  paint("ground", [{ x: 4, y: 4 }, { x: 7.5, y: 4.2 }], 2.9, "village-sand");
  // Камень заходит под воду: дно над ним другое, чем над песком.
  paint("ground", [{ x: 7.6, y: 2.4 }, { x: 8.6, y: 3.2 }], 1.3, "village-cobbles");
  paint("liquid", [{ x: 4.3, y: 4.1 }, { x: 7.4, y: 4.3 }], 2.1, waterCode(1, KEY));
  paint("liquid", [{ x: 5.2, y: 4.2 }, { x: 6.6, y: 4.3 }], 1.1, waterCode(3, KEY));
  const full = { ...doc, v: 6 } as unknown as MapDocumentV6;
  return { ground: { ...full, layers: full.layers.filter((layer) => layer.id === "ground") }, water: full };
}

/** Живой пруд с жидкостью по рецепту и язычками четырёх видов воды. */
export function LiquidPond({ recipe }: { recipe: Omit<MapLiquidRecipe, "key" | "name" | "ref"> }) {
  const [look, setLook] = useState<MapWaterLook>("soft"), [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), docs = useMemo(pond, []);
  // Плитки земли догружаются после первого кадра: по сигналу реестра земля перерисовывается.
  const revision = useMapImageRevision();
  const liquids = useMemo((): MapLiquidRecipe[] => [{ ...recipe, key: KEY, name: "Пруд" }], [recipe]);
  const water = useMemo(() => createWorkspaceRenderModel({ ...docs.water, appearance: { style: "comic-punk", liquids } }).model, [docs, liquids]);
  useEffect(() => { let live = true; void prepareMapImageAssets(docs.water).catch(() => undefined).then(() => { if (live) setReady(true); }); return () => { live = false; }; }, [docs]);
  useEffect(() => {
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx || !ready) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1), cssW = W * CELL, cssH = H * CELL;
    target.width = Math.round(cssW * ratio); target.height = Math.round(cssH * ratio);
    const ground = document.createElement("canvas"); ground.width = target.width; ground.height = target.height;
    const pen = ground.getContext("2d")!; pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = workspaceDrawingStyle({ ...docs.ground, appearance: { style: "comic-punk" } });
    renderMap(pen, cssW, cssH, { grid: "square", width: W, height: H, model: createWorkspaceRenderModel(docs.ground).model, scale: CELL, ox: 0, oy: 0,
      showGrid: false, showCoords: false, hover: null, ...style, playerView: false, selectedId: null });
    let frame = 0, last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ground, 0, 0); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawWaterStill(ctx, water, W, H, { mode: MAP_WATER_LOOKS.indexOf(look) as 0 | 1 | 2 | 3, speed: 1, size: 8, shoal: 0, liquids, time: now / 1000 }, cssW, cssH, CELL, 0, 0, ratio);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [ready, docs, water, liquids, look, revision]);
  return <div className="stack" style={{ gap: 6 }}>
    <div className="row" role="tablist" aria-label="Вид воды" style={{ gap: 4, flexWrap: "wrap" }}>
      {WATER_LOOKS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={look === key} className={look === key ? "primary" : undefined} onClick={() => setLook(key)}>{label}</button>)}
    </div>
    <canvas ref={canvas} role="img" aria-label="Пруд: песок, трава, камень и жидкость на мели и на глубине" style={{ width: W * CELL, maxWidth: "100%", border: "2px solid currentColor" }} />
  </div>;
}
