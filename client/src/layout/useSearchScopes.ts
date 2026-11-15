import { useLocation } from "react-router-dom";
import { useResource } from "../data/hooks";
import { ENTITY_ENDPOINTS } from "../data/entities";
import type { LiveSession } from "../types";
import type { SearchScope } from "./searchPanelModel";

const ENTITY_PATHS: Record<string, string> = {
  sessions: ENTITY_ENDPOINTS.session, characters: ENTITY_ENDPOINTS.character, adventures: ENTITY_ENDPOINTS.adventure,
  scenes: ENTITY_ENDPOINTS.scene, locations: ENTITY_ENDPOINTS.location, beings: ENTITY_ENDPOINTS.being,
  communities: ENTITY_ENDPOINTS.community, artifacts: ENTITY_ENDPOINTS.artifact, events: ENTITY_ENDPOINTS.setting_event,
};

export function useSearchScopes(enabled: boolean, live: LiveSession | null): SearchScope[] {
  const location = useLocation();
  const [, collection, rawId] = location.pathname.match(/^\/([^/]+)\/(\d+)(?:\/|$)/) ?? [];
  const params = new URLSearchParams(location.search);
  const routeId = Number(rawId) || null;
  const entityBase = ENTITY_PATHS[collection];
  const entity = useResource<{ setting_id?: number; campaign_id?: number }>(enabled && entityBase && routeId ? `${entityBase}/${routeId}` : null).data;
  const campaignId = collection === "campaigns" ? routeId : Number(params.get("campaign")) || entity?.campaign_id || live?.campaign_id;
  const campaign = useResource<{ id: number; name: string; setting_id: number | null }>(enabled && campaignId ? `/campaigns/${campaignId}` : null).data;
  const settingId = collection === "settings" ? routeId : Number(params.get("setting")) || entity?.setting_id || campaign?.setting_id;
  const setting = useResource<{ id: number; name: string }>(enabled && settingId ? `/settings/${settingId}` : null).data;
  const scopes: SearchScope[] = [];
  if (campaign) scopes.push({ kind: "campaign", id: campaign.id, name: campaign.name });
  if (setting) scopes.push({ kind: "setting", id: setting.id, name: setting.name });
  return scopes;
}
