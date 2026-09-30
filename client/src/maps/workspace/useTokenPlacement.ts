import { useEffect, useRef, useState } from "react";
import type { MapDocumentV6, Vec2 } from "@shared/maps/core";
import { mapWorkspaceApi } from "./mapApi";
import { placeToken, tokenTarget, type PlacementSource, type ResolvedTokenSource } from "./tokenPlacement";
import { quantize } from "./editorCommands";
import { cellCenter, pixelToCell } from "../grid";

type PendingPlacement = { position: Vec2; layerId: string; snap: boolean; source: ResolvedTokenSource | null; drop: boolean };
export function useTokenPlacement(args: { mapId: number; enabled: boolean; getDocument: () => MapDocumentV6 | null;
  activeLayer: string; snap: boolean; center: () => Vec2;
  commit: (operation: (document: MapDocumentV6) => MapDocumentV6) => void;
  onPlaced: (id: string, layerId: string) => void; onError: (error: unknown) => void }) {
  const latest = useRef(args); latest.current = args;
  const epoch = useRef(0), pendingRef = useRef<PendingPlacement | null>(null);
  const [pending, setState] = useState<PendingPlacement | null>(null);
  function setPending(value: PendingPlacement | null) { pendingRef.current = value; setState(value); }
  function cancel() { epoch.current++; setPending(null); }
  useEffect(() => {
    const lifecycle = epoch, transient = pendingRef;
    lifecycle.current++; transient.current = null; setState(null);
    return () => { lifecycle.current++; transient.current = null; };
  }, [args.mapId, args.enabled]);
  function confirm(position?: Vec2) {
    const current = pendingRef.current, options = latest.current;
    if (!current?.source || !options.enabled) return;
    const id = crypto.randomUUID();
    try {
      const document = options.getDocument();
      if (!document) return;
      // Recheck the captured target after asynchronous resolution.
      placeToken(document, current.layerId, id, current.source, position ?? current.position, current.snap);
      options.commit((before) => placeToken(before, current.layerId, id, current.source!, position ?? current.position, current.snap));
      cancel(); options.onPlaced(id, current.layerId);
    } catch (error) { cancel(); options.onError(error); }
  }
  async function begin(source: PlacementSource, dropPosition?: Vec2) {
    cancel();
    const options = latest.current, document = options.getDocument();
    if (!options.enabled || !document) return;
    const requestEpoch = epoch.current, mapId = options.mapId;
    try {
      const layerId = tokenTarget(document, options.activeLayer);
      setPending({ position: quantize(document, dropPosition ?? options.center(), options.snap), layerId, snap: options.snap, source: null, drop: !!dropPosition });
      const resolved = await mapWorkspaceApi.resolveSource(mapId, source.type, source.id);
      if (epoch.current !== requestEpoch || latest.current.mapId !== mapId || !latest.current.enabled || !pendingRef.current) return;
      setPending({ ...pendingRef.current, source: resolved });
      if (dropPosition) confirm();
    } catch (error) { if (epoch.current === requestEpoch) { cancel(); latest.current.onError(error); } }
  }
  function move(position: Vec2) {
    const current = pendingRef.current, document = latest.current.getDocument();
    if (current && document && !current.drop) setPending({ ...current, position: quantize(document, position, current.snap) });
  }
  function nudge(dx: number, dy: number) {
    const current = pendingRef.current, document = latest.current.getDocument();
    if (!current) return;
    const grid = current.snap ? document?.grid : null;
    const cell = grid ? pixelToCell(grid.type, current.position.x, current.position.y, grid.columns, grid.rows) : null;
    if (grid && cell) {
      const center = cellCenter(grid.type, Math.max(0, Math.min(grid.columns - 1, cell.x + dx)), Math.max(0, Math.min(grid.rows - 1, cell.y + dy)));
      move({ x: center.cx, y: center.cy });
    } else move({ x: current.position.x + dx, y: current.position.y + dy });
  }
  return { pending, begin, confirm, cancel, move, nudge };
}
