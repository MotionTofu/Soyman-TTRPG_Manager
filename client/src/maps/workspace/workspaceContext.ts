import { createContext, useContext } from "react";
import type { PlacementSource } from "./tokenPlacement";
export type MapPlacementController = { place: (source: PlacementSource) => void; preview: (source: PlacementSource) => void };
export const MapWorkspaceContext = createContext<{ rail: HTMLElement | null; placement?: MapPlacementController | null;
  setPlacement?: (controller: MapPlacementController | null) => void } | null>(null);
export const useMapWorkspace = () => useContext(MapWorkspaceContext);
