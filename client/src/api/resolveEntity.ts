import { api } from "./client";

const ENDPOINTS: Record<string, string> = {
  campaign: "/campaigns",
  setting: "/settings",
  player: "/players",
  resource: "/resources",
  mastering: "/mastering",
  session: "/sessions",
  character: "/characters",
  location: "/setting-locations",
  being: "/setting-beings",
  artifact: "/artifacts",
  community: "/setting-communities",
  compendium_entry: "/systems/entries",
  scene: "/story/scenes",
  adventure: "/story/arcs",
};

// Same endpoint resolveEntityLabel below already hits for the full detail
// payload — that function just reduces it to a label string and throws the
// rest away. This returns the raw object instead, for callers (e.g. an
// entity preview) that want more than the label.
export async function fetchEntityDetail(type: string, id: number): Promise<Record<string, unknown> | null> {
  const base = ENDPOINTS[type];
  if (!base) return null;
  try {
    return await api.get<Record<string, unknown>>(`${base}/${id}`);
  } catch {
    return null;
  }
}

// Same lookup as resolveEntityLabel, but for the four entity types that can
// carry an optional short_name (used to keep map-pin labels compact) —
// prefers it over the full name when set, otherwise falls back identically.
const SHORT_NAME_TYPES = new Set(["being", "character", "location", "artifact"]);
export async function resolveEntityMapLabel(type: string, id: number): Promise<string> {
  if (!SHORT_NAME_TYPES.has(type)) return resolveEntityLabel(type, id);
  const base = ENDPOINTS[type];
  if (!base) return `${type} #${id}`;
  try {
    const entity = await api.get<Record<string, unknown>>(`${base}/${id}`);
    if (entity.short_name) return String(entity.short_name);
    if (type === "character") return String(entity.character_name ?? id);
    return String(entity.name ?? id);
  } catch {
    return `${type} #${id} (не найдено)`;
  }
}

export async function resolveEntityLabel(type: string, id: number): Promise<string> {
  if (type === "preproduction") {
    try {
      const campaign = await api.get<Record<string, unknown>>(`/campaigns/${id}`);
      return `${campaign.name ?? id} — Препродакшен`;
    } catch {
      return `Препродакшен #${id} (не найдено)`;
    }
  }
  const base = ENDPOINTS[type];
  if (!base) return `${type} #${id}`;
  try {
    const entity = await api.get<Record<string, unknown>>(`${base}/${id}`);
    if (type === "mastering") return String(entity.title ?? id);
    if (type === "session")
      return `${entity.campaign_name ?? "Сессия"} — ${entity.date ?? id}`;
    if (type === "character") return String(entity.character_name ?? id);
    return String(entity.name ?? id);
  } catch {
    return `${type} #${id} (не найдено)`;
  }
}
