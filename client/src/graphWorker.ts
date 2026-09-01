// Graph layout worker — off-main-thread simulateGraph (см. Этап 3a).
// Vite: new Worker(new URL("./graphWorker.ts", import.meta.url), { type: "module" })
import { simulateGraph, type GraphEdge, type GraphNode, type NodePositions } from "./graphTypes";

export interface WorkerRequest {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  seed?: [string, { x: number; y: number; vx: number; vy: number }][];
  pinned?: string[];
}

export interface WorkerResponse {
  positions: [string, { x: number; y: number; vx: number; vy: number }][];
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { nodes, edges, width, height, seed, pinned } = e.data;
  const seedMap: NodePositions | undefined = seed ? new Map(seed) as NodePositions : undefined;
  const pinnedSet: Set<string> | undefined = pinned ? new Set(pinned) : undefined;
  const result = simulateGraph(nodes, edges, width, height, seedMap, pinnedSet);
  const positions: WorkerResponse["positions"] = Array.from(result.entries()).map(([k, v]) => [k, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }]);
  (self as unknown as Worker).postMessage({ positions } as WorkerResponse);
};
