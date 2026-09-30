import { useEffect, useMemo, useState, type DragEventHandler, type PointerEventHandler } from "react";
import { shapeBounds } from "../scatter";
import type { Vec2 } from "@shared/maps/core";
import type { MapDocumentV6 } from "@shared/maps/core";
import type { MapFull } from "../mapTypes";
import type { Camera } from "../editor/hooks/useMapCamera";
import { renderMap } from "../render";
import { workspaceDrawingStyle } from "./drawingStyle";
import { createWorkspaceRenderModel } from "./renderV6";
import { cartographyStyleUnavailable, prepareMapImageAssets, prepareCartographyStyle, subscribeMapImageAssets } from "../assets/registry";
import type { TokenDisplay } from "./useTokenPresentations";

export function WorkspaceCanvas({ map, document, camera, canvasRef, wrapRef, showGrid, selectedId, preview, displays, ghost, draftLine, brush, onPointerLeave, onDragOver, onDragLeave, onDrop, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  map: MapFull; document: MapDocumentV6; camera: Camera;
  canvasRef: { current: HTMLCanvasElement | null }; wrapRef: { current: HTMLDivElement | null };
  showGrid: boolean; selectedId: string | null; preview: { x: number; y: number; w: number; h: number } | null;
  onPointerDown: PointerEventHandler<HTMLCanvasElement>; onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: PointerEventHandler<HTMLCanvasElement>; onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
  draftLine?: readonly Vec2[] | null;
  brush?: { x: number; y: number; radius: number } | null; onPointerLeave?: PointerEventHandler<HTMLCanvasElement>;
  displays?: ReadonlyMap<string, TokenDisplay>; ghost?: { x: number; y: number } | null;
  onDragOver?: DragEventHandler<HTMLCanvasElement>; onDragLeave?: DragEventHandler<HTMLCanvasElement>; onDrop?: DragEventHandler<HTMLCanvasElement>;
}) {
  const [revision, setRevision] = useState(0);
  // Asset decoding announces a revision without changing document/displays.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rendered = useMemo(() => createWorkspaceRenderModel(document, displays), [document, displays, revision]);
  useEffect(() => {
    void prepareMapImageAssets(document).catch(() => undefined);
    if (document.appearance?.style !== "blueprint") void prepareCartographyStyle();
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
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderMap(ctx, rect.width, rect.height, { grid: map.grid, width: map.width, height: map.height,
      model: rendered.model, scale: camera.scale, ox: camera.ox, oy: camera.oy,
      showGrid, showCoords: false, hover: null, ...workspaceDrawingStyle(document), playerView: false, selectedId });
    ctx.save();
    const X = (x: number) => camera.ox + x * camera.scale, Y = (y: number) => camera.oy + y * camera.scale;
    if (draftLine?.length) {
      ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
      draftLine.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke();
    }
    for (const layer of document.layers) {
      if (!layer.visible || layer.locked) continue;
      const path = layer.kind === "path" ? layer.paths.find(p => p.id === selectedId) : undefined;
      if (path?.geometry.type === "spline") {
        ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#faf8ef"; ctx.lineWidth = 1.5;
        for (const node of path.geometry.nodes) {
          for (const handle of [node.in, node.out]) if (handle) {
            ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(node.position.x), Y(node.position.y)); ctx.lineTo(X(handle.x), Y(handle.y)); ctx.stroke();
            ctx.setLineDash([]); ctx.beginPath(); ctx.arc(X(handle.x), Y(handle.y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          ctx.setLineDash([]); ctx.fillRect(X(node.position.x) - 4, Y(node.position.y) - 4, 8, 8); ctx.strokeRect(X(node.position.x) - 4, Y(node.position.y) - 4, 8, 8);
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
  }, [map, document, rendered, camera, showGrid, selectedId, preview, displays, ghost, draftLine, brush, revision, canvasRef, wrapRef]);
  const unavailable = document.appearance?.style !== "blueprint" && cartographyStyleUnavailable() || rendered.model.layers.some(layer =>
    (layer.kind === "object" || layer.kind === "scatter") && layer.visible && layer.items.some(item => "failed" in item.asset && item.asset.failed));
  return <><canvas ref={canvasRef} aria-label="Холст новой карты" tabIndex={0}
    onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onLostPointerCapture={onPointerCancel} onContextMenu={(event) => event.preventDefault()} />
    {unavailable && <p className="workspace-editor-artwork-warning" role="status">Часть рисунков недоступна. Правки карты сохраняются.</p>}</>;
}
