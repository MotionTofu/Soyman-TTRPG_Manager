import { useRef, useState, type MouseEvent } from "react";
import { CAMPAIGN_ENTITY_STATES, campaignEntityStateLabel, campaignEntityStateTone } from "@shared/campaignWorld";
import { useCurrentUser } from "../../api/currentUser";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { useSetCampaignEntityState, type CampaignWorld, type WorldType } from "../../campaignWorld";
import { ContextMenu } from "../ContextMenu";
import "./campaign-world.css";

/** Состояние в шапке берётся из того же ресурса, что строка мира кампании. */
export function CampaignEntityStateBadge({ campaignId, entityType, entityId }: {
  campaignId: number;
  entityType: WorldType;
  entityId: number;
}) {
  const { user } = useCurrentUser();
  const isGm = user?.role === "gm";
  const world = useResource<CampaignWorld>(isGm ? campaignPaths.world(campaignId) : null).data;
  const entity = world?.entities.find((e) => e.entity_type === entityType && e.entity_id === entityId);
  const setState = useSetCampaignEntityState(campaignId);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!isGm || !entity) return null;
  const label = campaignEntityStateLabel(entityType, entity.state);
  const tone = campaignEntityStateTone(entityType, entity.state) ?? "default";
  function open(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const r = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.type === "contextmenu" ? event.clientX : r.right, y: event.type === "contextmenu" ? event.clientY : r.bottom });
  }
  return <>
    <button ref={trigger} type="button" className={`world-state world-state--${tone}`} aria-label={`Состояние ${entity.name}: ${label}. Изменить`} aria-haspopup="menu" aria-expanded={!!menu} onClick={open} onContextMenu={open}>{label} ▾</button>
    {menu && <ContextMenu x={menu.x} y={menu.y} title={`Состояние: ${entity.name}`} ariaLabel={`Состояние: ${entity.name}`} items={CAMPAIGN_ENTITY_STATES[entityType].map((s) => ({
      label: `${s.key === entity.state ? "✓ " : ""}${s.label}`,
      onClick: () => void setState(entity, s.key),
    }))} onClose={() => { setMenu(null); trigger.current?.focus(); }} />}
  </>;
}
