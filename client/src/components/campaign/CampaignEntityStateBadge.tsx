import type { WorldType } from "../../campaignWorld";
import { useCampaignEntityStateMenu } from "./useCampaignEntityStateMenu";

/** Состояние в шапке берётся из того же ресурса, что строка мира кампании. */
export function CampaignEntityStateBadge({ campaignId, entityType, entityId }: {
  campaignId: number;
  entityType: WorldType;
  entityId: number;
}) {
  const state = useCampaignEntityStateMenu(campaignId, entityType, entityId);
  return <>{state.badge}{state.menu}</>;
}
