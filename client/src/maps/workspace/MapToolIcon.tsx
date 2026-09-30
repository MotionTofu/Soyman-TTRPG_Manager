import type { PaintTool } from "../editor/editorTypes";

// Компактные пиктограммы карты: одна чернильная линия, смысл без подписи.
const PATHS: Record<PaintTool | "surface" | "scatter", string> = {
  surface: "M3 18c-2-5 2-9 6-7s4-9 10-6c6 3 2 11-3 10s-8 10-13 3z M7 16l2-2 M14 9l2-2",
  scatter: "M5 3l4 7H1z M5 10v3 M16 6l6 10H10z M16 16v5 M4 19h1 M9 22h1 M21 3h1",
  select: "M5 3l14 9-7 1-3 7z M12 13l5 7",
  brush: "M10 14L19 3l3 3-10 10 M10 14c-5-2-3 6-7 6 6 3 10-1 9-4",
  fill: "M5 10l7-7 9 9-7 7z M4 10l9 1 M17 17c0 0 4 3 4 5a2 2 0 0 1-4 0z",
  eraser: "M3 15L14 4l7 7-11 11H7z M8 10l7 7 M10 22h12",
  picker: "M14 4l6 6 M15 3l6 6 M14 6L4 16v4h4L18 10",
  road: "M3 21C1 12 16 16 12 3 M12 21c-3-7 11-6 8-18 M7 19l1-2 M13 12l1-2 M16 6V4",
  river: "M3 3c13 4-8 12 5 18 M10 3c14 4-8 12 5 18 M16 3c15 4-7 12 6 18",
  wall: "M2 5h20v14H2z M2 12h20 M9 5v7 M16 12v7",
  shape: "M3 3h18v18H3z M7 3v4 M3 7h4 M17 21v-4 M21 17h-4",
  ruler: "M3 17L17 3l5 5L8 22z M8 12l3 3 M12 8l3 3 M16 4l3 3",
  label: "M4 5h16 M12 5v16 M8 21h8 M4 5v4 M20 5v4",
  door: "M4 21V3h16v18 M8 21V6h8v15 M13 13h1 M2 21h20",
  trap: "M3 18l3-7 4 5 4-5 4 5 3-7 M3 20h18 M10 3h4 M12 3v6",
  chest: "M3 11c0-10 18-10 18 0v10H3z M3 11h18 M10 9h4v6h-4z",
  altar: "M4 10h16v4H4z M7 14v7 M17 14v7 M4 21h16 M12 3l3 4h-6z",
  marker: "M12 22L5 12a8 8 0 1 1 14 0z M9 9a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  start: "M5 22V3 M5 3h15l-5 5 5 5H5",
  finish: "M5 22V3 M5 3h15v10H5 M10 3v10 M15 3v10 M5 8h15",
  asset: "M12 2l3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z",
  fog: "M3 16c-5-6 2-10 5-7-1-8 12-8 12 0 6-1 6 8 1 8H3 M4 21h16 M8 13h8",
};

export function MapToolIcon({ tool }: { tool: PaintTool | "surface" | "scatter" }) {
  return <svg className="map-tool-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[tool]} /></svg>;
}
