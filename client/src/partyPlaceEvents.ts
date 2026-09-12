/**
 * «Мы здесь» ставится из докстанции, а панели пульта живут в странице и о доке
 * не знают. Событие окна — тот же приём, что у previewDockStore: сказать
 * странице «перечитай панели», не протаскивая колбэк через AppShell.
 */
export const PARTY_PLACE_CHANGED = "party-place-changed";

/** Ответ `GET /sessions/:id/party-place` (server/src/services/partyPlace.ts). */
export interface PartyPlaceView {
  location: { id: number; name: string; role: string; parent_id: number | null } | null;
  path: { id: number; name: string }[];
  source: "scene" | "manual" | null;
  scene: { id: number; name: string } | null;
  also: { id: number; name: string }[];
  set_at: string | null;
}
