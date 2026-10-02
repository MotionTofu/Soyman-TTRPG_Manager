import type { DragEvent } from "react";
import type { Affect } from "./entities";

// Корабль кампании (спека profiles-paper-2, «Корабль кампании»): запись на
// основе судна компендиума. Сервер — routes/campaignVessels.ts.

export interface VesselCrew {
  id: number;
  kind: "character" | "being";
  ref_id: number;
  name: string;
  avatar_image_url: string | null;
}

export interface VesselPost {
  id: number;
  name: string;
  ac: string;
  hp: number | null;
  hp_max: number | null;
  broken: boolean;
  unnamed: number;
  crew: VesselCrew[];
}

export interface VesselHp {
  hp: number | null;
  max: number | null;
  threshold: number | null;
}

export interface Vessel {
  id: number;
  campaign_id: number;
  name: string;
  archived_at: string | null;
  /** Только у Мастера. */
  notes?: string;
  base: {
    id: number;
    name: string;
    category: string;
    size: string;
    speed: string;
    ac: string;
    cargo: string;
    avatar_image_url: string | null;
  } | null;
  hull: VesselHp;
  crew_total: { named: number; unnamed: number; capacity: number | null };
  blueprint_image_url: string | null;
  pins: { id: number; post_id: number | null; label: string; x: number; y: number }[];
  posts: VesselPost[];
  cargo: { id: number; text: string; amount: string }[];
}

export interface VesselSummary {
  id: number;
  name: string;
  archived_at: string | null;
  base: { id: number; name: string; category: string } | null;
  image_url: string | null;
  hull: VesselHp;
  crew_total: Vessel["crew_total"];
  broken_posts: string[];
  lead: { post: string; names: string[] } | null;
}

export interface VesselBase {
  id: number;
  name: string;
  category: string;
  system_name: string;
}

export interface VesselPeople {
  characters: { id: number; name: string; sub: string; avatar_image_url: string | null }[];
  beings: { id: number; name: string; avatar_image_url: string | null }[];
}

export const vesselPaths = {
  list: (campaignId: number) => `/campaign-vessels/campaign/${campaignId}`,
  bases: (campaignId: number) => `/campaign-vessels/campaign/${campaignId}/bases`,
  detail: (id: number) => `/campaign-vessels/${id}`,
  people: (id: number) => `/campaign-vessels/${id}/people`,
  player: (campaignId: number) => `/player/campaigns/${campaignId}/vessels`,
};

/** Любая правка корабля задевает и строку списка, и страницу. */
export const VESSEL_AFFECTS: Affect[] = [{ path: "/campaign-vessels" }];

/** «420 / 500»; без максимума в основе — «—». */
export function hpText(h: VesselHp): string {
  if (h.max == null) return "—";
  return `${h.hp ?? h.max} / ${h.max}`;
}

/** «34 из 80» — поимённые плюс безымянные против экипажа основы. */
export function crewText(c: Vessel["crew_total"]): string {
  const n = c.named + c.unnamed;
  return c.capacity != null ? `${n} из ${c.capacity}` : String(n);
}

// Перетаскивание человека на пост: из строки поста (перевод) и из «Не на борту».
export const CREW_DRAG_MIME = "application/x-soyman-vessel-crew";

export interface CrewDrag {
  kind: "character" | "being";
  ref_id: number;
}

export function readCrewDrag(e: DragEvent): CrewDrag | null {
  const raw = e.dataTransfer.getData(CREW_DRAG_MIME);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as CrewDrag;
    return (v.kind === "character" || v.kind === "being") && Number.isInteger(v.ref_id) ? v : null;
  } catch {
    return null;
  }
}

export function startCrewDrag(e: DragEvent, item: CrewDrag) {
  e.dataTransfer.setData(CREW_DRAG_MIME, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "move";
}
