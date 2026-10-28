/** Existing presentation DTOs, shared without changing their wire fields. */
export const PRESENTATION_TRANSITIONS = ["cut", "fade", "black"] as const;
export type PresentationTransitionKind = (typeof PRESENTATION_TRANSITIONS)[number];

export interface PresentationLayerGeometry {
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
}

export interface PresentationLayer extends PresentationLayerGeometry {
  id: number;
  name: string;
  image_path: string;
  image_url: string;
  has_button: number;
  visible_on_enter: number;
  position: number;
}

export interface PresentationData {
  background_path: string | null;
  background_url: string | null;
  transition: string;
  transition_ms: number;
  title: string;
  title_secs: number;
  fade_ms: number;
  layers: PresentationLayer[];
}

/** Existing camera/display fields; null retains the monitor preference. */
export interface ShowDisplay {
  rotation: 0 | 90 | 180 | 270 | null;
  fit: "contain" | "cover" | null;
  zoom: number;
  pan_x: number;
  pan_y: number;
  screen_w: number | null;
  screen_h: number | null;
}
