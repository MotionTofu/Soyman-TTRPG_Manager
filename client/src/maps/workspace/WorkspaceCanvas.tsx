import { useEffect, useState, type DragEventHandler, type PointerEventHandler } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import type { MapFull } from "../mapTypes";
import type { Camera } from "../editor/hooks/useMapCamera";
import { readChrome, renderMap } from "../render";
import { createWorkspaceRenderModel } from "./renderV6";
import { subscribeMapImageAssets } from "../assets/registry";
import type { TokenDisplay } from "./useTokenPresentations";

export function WorkspaceCanvas({ map, document, camera, canvasRef, wrapRef, showGrid, selectedId, preview, displays, ghost, onDragOver, onDragLeave, onDrop, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  map: MapFull; document: MapDocumentV6; camera: Camera;
  canvasRef: { current: HTMLCanvasElement | null }; wrapRef: { current: HTMLDivElement | null };
  showGrid: boolean; selectedId: string | null; preview: { x: number; y: number; w: number; h: number } | null;
  onPointerDown: PointerEventHandler<HTMLCanvasElement>; onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: PointerEventHandler<HTMLCanvasElement>; onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
  displays?: ReadonlyMap<string, TokenDisplay>; ghost?: { x: number; y: number } | null;
  onDragOver?: DragEventHandler<HTMLCanvasElement>; onDragLeave?: DragEventHandler<HTMLCanvasElement>; onDrop?: DragEventHandler<HTMLCanvasElement>;
}) {
  const [revision, setRevision] = useState(0);
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
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const chrome = { ...readChrome(), paper: "#f1eedf", ink: "#171717" };
    renderMap(ctx, rect.width, rect.height, { grid: map.grid, width: map.width, height: map.height,
      model: createWorkspaceRenderModel(document, displays).model, scale: camera.scale, ox: camera.ox, oy: camera.oy,
      showGrid, showCoords: false, hover: null, chrome, playerView: false, selectedId });
    if (preview) {
      ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(camera.ox + preview.x * camera.scale, camera.oy + preview.y * camera.scale, preview.w * camera.scale, preview.h * camera.scale);
    }
    if (ghost) {
      ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff3e91"; ctx.fillStyle = "#ff3e9120"; ctx.lineWidth = 2;
      ctx.arc(camera.ox + ghost.x * camera.scale, camera.oy + ghost.y * camera.scale, camera.scale / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }, [map, document, camera, showGrid, selectedId, preview, displays, ghost, revision, canvasRef, wrapRef]);
  return <canvas ref={canvasRef} aria-label="Холст новой карты" tabIndex={0}
    onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onLostPointerCapture={onPointerCancel} onContextMenu={(event) => event.preventDefault()} />;
}
