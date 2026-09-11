/** Ответ `GET /sessions/:id/party-place` (server/src/services/partyPlace.ts). */
export interface PartyPlaceView {
  location: { id: number; name: string; role: string; parent_id: number | null } | null;
  path: { id: number; name: string }[];
  source: "scene" | "manual" | null;
  scene: { id: number; name: string } | null;
  also: { id: number; name: string }[];
  set_at: string | null;
}
