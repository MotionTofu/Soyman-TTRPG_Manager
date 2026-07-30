// Loose hand-copies of the shapes server/src/routes/*.ts already return for
// the existing (desktop мастер-клиент) GM endpoints — this app reuses those
// verbatim via the generic apiGet/apiPost bridge (see global.d.ts) rather
// than a dedicated /api/gm/* surface, so these types only declare the fields
// actually rendered here, not every column each route returns.

export interface GmUser {
  id: number;
  username: string;
  role: "gm" | "player";
}

export interface Campaign {
  id: number;
  name: string;
  system_id: number | null;
  setting_id: number | null;
  system_name: string | null;
  setting_name: string | null;
}

export interface CalendarSession {
  id: number;
  campaign_id: number;
  date: string;
  title: string | null;
  status: string;
  campaign_name: string;
}

export interface AttendanceRow {
  player_id: number;
  name: string;
  attended: number;
}

export interface SessionResource {
  id: number;
  name: string;
  type: string;
  category?: string | null;
  file_url?: string | null;
  link_url: string | null;
}

export interface SessionDetail {
  id: number;
  campaign_id: number;
  campaign_name?: string;
  date: string;
  title: string | null;
  session_number?: number;
  status: string;
  idea_notes: string;
  main_events: string;
  attendance: AttendanceRow[];
  resources: SessionResource[];
}

export interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

export interface Playlist {
  id: number;
  name: string;
  scope: "session" | "setting";
  session_id: number | null;
  setting_id: number | null;
  item_count: number;
}

export interface PlaylistItem {
  id: number;
  position: number;
  resource_id: number;
  name: string;
  src: string | null;
}

export interface PlaylistDetail extends Playlist {
  items: PlaylistItem[];
}

export interface SettingBeing {
  id: number;
  name: string;
  category: string;
  avatar_image_path: string | null;
}

export interface Statblock {
  id: number;
  owner_type: string;
  owner_id: number;
  kind: string;
  format: string;
  content: string;
}

export interface CompendiumSection {
  id: number;
  system_id: number;
  position: number;
  name: string;
  kind: string;
}

export interface CompendiumEntry {
  id: number;
  system_id: number;
  section_id: number;
  parent_id: number | null;
  kind: string;
  name: string;
  level: number | null;
  data: string;
  description: string;
  position: number;
}

export interface ImageResource {
  id: number;
  name: string;
  file_url: string | null;
  link_url: string | null;
}

export interface AppState {
  connected: boolean;
  serverUrl: string;
  username: string;
  // Only populated when the user checked "Запомнить пароль" on the connect
  // screen — see webBridge.ts/electron main.js connect().
  savedPassword: string;
  token: string;
  // Keyed by request path — see electron/main.js and webBridge.ts.
  cache: Record<string, unknown>;
}
