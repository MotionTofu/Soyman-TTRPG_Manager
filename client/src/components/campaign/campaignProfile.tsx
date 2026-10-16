import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { sessionPaths } from "../../data/sessions";
import { recordChains, type EntityRecord, type RecordChain, type RecordOwnerType } from "../../entityRecords";
import { EntityRecordItem } from "../records/EntityRecordItem";
import type { ForceExtras } from "../CreatureCard";
import type { EngagedCampaign, LiveSession } from "../../types";

// Профиль существа, сообщества, места в контексте кампании (ADR-0006, спека
// .scratch/campaign-layer, задача 05). Контекст — параметр `?campaign=<id>`;
// `?campaign=base` — основа сеттинга явно. Без параметра во время идущей
// сессии профиль открывается в её кампании, если сущность там задействована.

const BASE = "base";

/** Какая кампания в контексте: из параметра, иначе — кампания идущей сессии, если сущность там задействована. */
export function resolveCampaign(raw: string | null, liveCampaignId: number | null, engaged: readonly EngagedCampaign[]): EngagedCampaign | null {
  const id = raw === BASE ? null : raw ? Number(raw) : liveCampaignId;
  return id != null ? (engaged.find((c) => c.id === id) ?? null) : null;
}

export function useCampaignContext(engaged: EngagedCampaign[] | undefined) {
  const [params, setParams] = useSearchParams();
  const live = useResource<LiveSession | null>(sessionPaths.live()).data ?? null;
  const campaign = resolveCampaign(params.get("campaign"), live?.campaign_id ?? null, engaged ?? []);
  const select = useCallback(
    (next: number | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("campaign", next == null ? BASE : String(next));
          return p;
        },
        { replace: true }
      ),
    [setParams]
  );
  return { campaign, select };
}

/** «Кампании › <кампания> › Мир кампании › Имя». */
export function campaignCrumbs(campaign: EngagedCampaign, name: string) {
  return [
    { label: "Кампании", to: "/campaigns" },
    { label: campaign.name, to: `/campaigns/${campaign.id}` },
    { label: "Мир кампании", to: `/campaigns/${campaign.id}?tab=${encodeURIComponent("Мир кампании")}` },
    { label: name },
  ];
}

/** Записи кампании об этой сущности — с «Историей замен». */
export function useOwnerRecords(campaignId: number | null, ownerType: RecordOwnerType, ownerId: number): RecordChain[] {
  const path = campaignId ? `${campaignPaths.records(campaignId)}?owner_type=${ownerType}&owner_id=${ownerId}` : null;
  const records = useResource<{ records: EntityRecord[] }>(path).data?.records;
  return useMemo(() => recordChains(records ?? []), [records]);
}

/** Под ячейками «За столом» — записи кампании той же графы, маркером. */
export function forceExtras(chains: RecordChain[], settingId: number | null): ForceExtras {
  const out: ForceExtras = {};
  for (const c of chains) {
    if (c.record.aspect === "note") continue;
    const list = chains.filter((x) => x.record.aspect === c.record.aspect);
    out[c.record.aspect] ??= (
      <div className="campaign-cell">
        {list.map((x) => (
          <EntityRecordItem key={x.record.id} chain={x} settingId={settingId} was />
        ))}
      </div>
    );
  }
  return out;
}
