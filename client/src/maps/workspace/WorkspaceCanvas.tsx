import { pathNodesFromAnchors } from "./pathAnchors";
import { useEffect, useMemo, useRef, useState, type DragEventHandler, type PointerEventHandler } from "react";
import { shapeBounds } from "../scatter";
import type { Vec2 } from "@shared/maps/core";
import type { MapDocumentV6 } from "@shared/maps/core";
import type { MapFull } from "../mapTypes";
import type { Camera } from "../editor/hooks/useMapCamera";
import { renderMap } from "../render";
import { workspaceDrawingStyle } from "./drawingStyle";
import { createWorkspaceRenderModel } from "./renderV6";
import { retryMapArtwork, cartographyStyleUnavailable, prepareMapImageAssets, prepareCartographyStyle, subscribeMapImageAssets } from "../assets/registry";
import type { TokenDisplay } from "./useTokenPresentations";
import { loadMapImageAsset, resolveMapSymbol } from "../assets/registry";
import { drawCachedMapImage, drawCachedMapSymbol } from "../assets/draw";
import { objectPlacementSize } from "./editorCommands";
import type { WorkspaceSelection } from "./editorCommands";
import { selectableBounds, type SelectionRect } from "./multiSelection";
import { drawWallPolyline } from "../assets/wallArtwork";
import { cryptId } from "../assets/crypt";
import { prepareTokenTape, subscribeTokenTape } from "../assets/tokenTape";
import { cellCorners } from "../grid";
import { WorkspacePerformance } from "./WorkspacePerformance";
import { WorkspacePerformanceMeter } from "./performanceMeter";

export function WorkspaceCanvas({ map, document, camera, canvasRef, wrapRef, showGrid, gridColor, gridOpacity, gridLineWidth, gridLineStyle, selectedId, selectedNodes, selections, marquee, preview, assetPreview, displays, ghost, draftLine, wallDraft, onDoubleClick, cellBrush, brush, onPointerLeave, onDragOver, onDragLeave, onDrop, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  map: MapFull; document: MapDocumentV6; camera: Camera;
  canvasRef: { current: HTMLCanvasElement | null }; wrapRef: { current: HTMLDivElement | null };
  gridColor?: string; gridOpacity?: number; gridLineWidth?: number; gridLineStyle?: "solid" | "dashed";
  showGrid: boolean; selectedId: string | null; preview: { x: number; y: number; w: number; h: number } | null;
  onPointerDown: PointerEventHandler<HTMLCanvasElement>; onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: PointerEventHandler<HTMLCanvasElement>; onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
  draftLine?: readonly Vec2[] | null;
  wallDraft?: { kind?: "wall" | "road" | "river"; points: readonly Vec2[]; pointCount: number; width: number; canClose: boolean; closing: boolean } | null;
  onDoubleClick?: () => void;
  cellBrush?: readonly { x: number; y: number }[] | null;
  selectedNodes?: readonly number[];
  selections?: readonly WorkspaceSelection[]; marquee?: SelectionRect | null;
  assetPreview?: { position: Vec2; assetId: string } | null;
  brush?: { x: number; y: number; radius: number } | null; onPointerLeave?: PointerEventHandler<HTMLCanvasElement>;
  displays?: ReadonlyMap<string, TokenDisplay>; ghost?: { x: number; y: number } | null;
  onDragOver?: DragEventHandler<HTMLCanvasElement>; onDragLeave?: DragEventHandler<HTMLCanvasElement>; onDrop?: DragEventHandler<HTMLCanvasElement>;
}) {
  const [revision, setRevision] = useState(0);
  const [meter] = useState(() => new WorkspacePerformanceMeter());
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { const unsubscribe = subscribeTokenTape(() => setRevision(value => value + 1)); prepareTokenTape(); return unsubscribe; }, []);
  const previewId = assetPreview?.assetId;
  const drawingWall = wallDraft?.kind === "wall";
  useEffect(() => {
    if (drawingWall) for (const key of ["wall-masonry", "wall-masonry-end"]) void loadMapImageAsset(cryptId(key)).catch(() => undefined);
  }, [drawingWall]);
  useEffect(() => {
    const asset = previewId ? resolveMapSymbol({ type: "asset", assetId: previewId }) : null;
    if (previewId && asset && "image" in asset) {
      void loadMapImageAsset(previewId).catch(() => undefined);
    }
  }, [previewId]);
  // Asset decoding announces a revision without changing document/displays.
  const rendered = useMemo(() => {
    void revision; // Asset decoding/resize invalidates this transient read model.
    const started = performance.now();
    const result = createWorkspaceRenderModel(document, displays);
    meter.modelMs = performance.now() - started;
    return result;
  }, [document, displays, revision, meter]);
  useEffect(() => {
    void prepareMapImageAssets(document).catch(() => undefined);
    if (document.appearance?.style !== "blueprint") void prepareCartographyStyle(document.appearance?.style ?? "paper-ink");
  }, [document]);
  useEffect(() => {
    const resize = () => setRevision((value) => value + 1);
    const observer = new ResizeObserver(resize);
    if (wrapRef.current) observer.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    const unsubscribe = subscribeMapImageAssets(resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); unsubscribe(); };
  }, [wrapRef]);
  useEffect(() => {
    const canvas = baseRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawStarted = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderMap(ctx, rect.width, rect.height, { grid: map.grid, width: map.width, height: map.height,
      model: rendered.model, scale: camera.scale, ox: camera.ox, oy: camera.oy,
      showGrid, gridColor, gridOpacity, gridLineWidth, gridLineStyle, showCoords: false, hover: null, ...workspaceDrawingStyle(document), playerView: false, selectedId });
    meter.recordDraw(performance.now() - drawStarted);
  }, [map.grid, map.width, map.height, document, rendered, camera, showGrid, gridColor, gridOpacity, gridLineWidth, gridLineStyle, selectedId, revision, wrapRef, meter]);
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    const X = (x: number) => camera.ox + x * camera.scale, Y = (y: number) => camera.oy + y * camera.scale;
    if (cellBrush?.length) {
      ctx.save(); ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#ff3e9118"; ctx.lineWidth = 1;
      for (const cell of cellBrush) {
        ctx.beginPath(); cellCorners(map.grid, cell.x, cell.y).forEach((p, i) => i ? ctx.lineTo(X(p.px), Y(p.py)) : ctx.moveTo(X(p.px), Y(p.py)));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    if (selections && selections.length > 1) {
      const ids = new Set(selections.map(entry => `${entry.layerId}:${entry.id}`));
      ctx.save(); ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2;
      for (const { selection, bounds: b } of selectableBounds(document)) {
        if (ids.has(`${selection.layerId}:${selection.id}`)) ctx.strokeRect(X(b.x) - 2, Y(b.y) - 2, Math.max(4, b.w * camera.scale + 4), Math.max(4, b.h * camera.scale + 4));
      }
      ctx.restore();
    }
    if (marquee) {
      ctx.save(); ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#ff3e9118"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.fillRect(X(marquee.x), Y(marquee.y), marquee.w * camera.scale, marquee.h * camera.scale);
      ctx.strokeRect(X(marquee.x), Y(marquee.y), marquee.w * camera.scale, marquee.h * camera.scale); ctx.restore();
    }
    if (assetPreview) {
      const asset = resolveMapSymbol({ type: "asset", assetId: assetPreview.assetId });
      if (asset) {
        const size = objectPlacementSize(assetPreview.assetId) * camera.scale;
        ctx.save();
        ctx.translate(X(assetPreview.position.x), Y(assetPreview.position.y));
        ctx.scale(size, size);
        ctx.globalAlpha = 0.5;
        if ("image" in asset && asset.image) drawCachedMapImage(ctx, asset.image, size * dpr);
        else if ("glyph" in asset) drawCachedMapSymbol(ctx, asset);
        else { ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 1.5 / size; ctx.strokeRect(-0.5, -0.5, 1, 1); }
        ctx.restore();
      }
    }
    if (wallDraft) {
      ctx.save(); ctx.globalAlpha = 0.5;
      if (!wallDraft.kind || wallDraft.kind === "wall") drawWallPolyline(ctx, wallDraft.points, wallDraft.width, wallDraft.closing, camera.scale, camera.ox, camera.oy);
      else {
        const points = wallDraft.closing ? wallDraft.points.slice(0, -1) : wallDraft.points;
        const nodes = pathNodesFromAnchors(points, wallDraft.closing);
        const curve = wallDraft.closing && nodes.length ? [...nodes, nodes[0]] : nodes;
        ctx.beginPath(); ctx.lineWidth = wallDraft.width * camera.scale; ctx.strokeStyle = wallDraft.kind === "river" ? "#5097bb" : "#282922"; ctx.lineCap = "round"; ctx.lineJoin = "round";
        curve.forEach((node, i) => {
          if (!i) ctx.moveTo(X(node.position.x), Y(node.position.y));
          else { const prev = curve[i - 1]; if (prev.out && node.in) ctx.bezierCurveTo(X(prev.out.x), Y(prev.out.y), X(node.in.x), Y(node.in.y), X(node.position.x), Y(node.position.y)); else ctx.lineTo(X(node.position.x), Y(node.position.y)); }
        }); ctx.stroke();
      }
      ctx.restore();
      ctx.save(); ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.fillStyle = "#faf8ef";
      wallDraft.points.forEach((p, i) => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), i === 0 && wallDraft.canClose ? 7 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      if (wallDraft.closing) { ctx.fillStyle = "#171717"; ctx.font = '14px "Sofia Sans Semi Condensed", sans-serif'; ctx.fillText(wallDraft.kind && wallDraft.kind !== "wall" ? "Замкнуть линию" : "Замкнуть стену", X(wallDraft.points[0].x) + 12, Y(wallDraft.points[0].y) - 12); }
      ctx.restore();
    }
    if (draftLine?.length && !wallDraft) {
      ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
      draftLine.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke();
    }
    for (const layer of document.layers) {
      if (!layer.visible || layer.locked) continue;
      const path = layer.kind === "path" ? layer.paths.find(p => p.id === selectedId) : undefined;
      if (path?.geometry.type === "spline") {
        ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#faf8ef"; ctx.lineWidth = 1.5;
        if (path.kind === "wall") {
          ctx.beginPath(); ctx.setLineDash([5, 4]);
          path.geometry.nodes.forEach((node, i) => i ? ctx.lineTo(X(node.position.x), Y(node.position.y)) : ctx.moveTo(X(node.position.x), Y(node.position.y)));
          if (path.properties?.closed === true) ctx.closePath(); ctx.stroke();
        }
        for (const [index, node] of path.geometry.nodes.entries()) {
          ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#faf8ef"; ctx.lineWidth = 1.5;
          for (const handle of [node.in, node.out]) if (handle) {
            ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(node.position.x), Y(node.position.y)); ctx.lineTo(X(handle.x), Y(handle.y)); ctx.stroke();
            ctx.setLineDash([]); ctx.beginPath(); ctx.arc(X(handle.x), Y(handle.y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          const chosen = selectedNodes?.includes(index);
          const half = chosen ? 7 : 4;
          ctx.setLineDash([]); ctx.fillStyle = chosen ? "#ffe14a" : "#faf8ef"; ctx.strokeStyle = chosen ? "#111111" : "#ff3e91"; ctx.lineWidth = chosen ? 3 : 1.5;
          ctx.fillRect(X(node.position.x) - half, Y(node.position.y) - half, half * 2, half * 2);
          ctx.strokeRect(X(node.position.x) - half, Y(node.position.y) - half, half * 2, half * 2);
        }
      }
      const area = layer.kind === "scatter" ? layer.areas.find(a => a.id === selectedId) : undefined;
      if (area) {
        const b = shapeBounds(area.shape); ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(X(b.x), Y(b.y), b.w * camera.scale, b.h * camera.scale);
      }
    }
    if (brush) {
      ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
      ctx.arc(X(brush.x), Y(brush.y), brush.radius * camera.scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    if (preview) {
      ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(camera.ox + preview.x * camera.scale, camera.oy + preview.y * camera.scale, preview.w * camera.scale, preview.h * camera.scale);
    }
    if (ghost) {
      ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#ff3e9120"; ctx.lineWidth = 2;
      ctx.arc(camera.ox + ghost.x * camera.scale, camera.oy + ghost.y * camera.scale, camera.scale / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }, [map.grid, document, camera, selectedId, selectedNodes, selections, marquee, preview, assetPreview, ghost, draftLine, wallDraft, cellBrush, brush, revision, canvasRef, wrapRef]);
  const unavailable = document.appearance?.style !== "blueprint" && cartographyStyleUnavailable(document.appearance?.style ?? "paper-ink") || rendered.model.layers.some(layer =>
    (layer.kind === "object" || layer.kind === "scatter") && layer.visible && layer.items.some(item => "failed" in item.asset && item.asset.failed));
  return <><canvas ref={baseRef} className="workspace-canvas-base" aria-hidden="true" />
    <canvas ref={canvasRef} className="workspace-canvas-overlay" aria-label="Холст новой карты" tabIndex={0}
    onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    onDoubleClick={onDoubleClick} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onLostPointerCapture={onPointerCancel} onContextMenu={(event) => event.preventDefault()} />
    <WorkspacePerformance meter={meter} />
    {unavailable && <p className="workspace-editor-artwork-warning" role="status">Часть рисунков недоступна. Правки карты сохраняются. <button type="button" onClick={() => { void retryMapArtwork(); }}>Загрузить рисунки снова</button></p>}</>;
}
