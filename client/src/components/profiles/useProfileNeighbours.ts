import { useResource } from "../../data/hooks";
import type { EntityKind } from "../../data/entities";
import { settingPaths } from "../../data/settingEntities";
import { DETAIL_ROUTES } from "../../entityTypes";
import type { ImportantDate } from "../../types";
import { mergeProfileWorld, type ProfileWorldEvent } from "./ProfileChronicle";
import type { ChronicleNow } from "../chronicle/time";

export function useProfileNeighbours(type: EntityKind, id: number, settingId?: number | null) {
  const rows = useResource<{ id: number; name: string }[]>(settingId ? settingPaths.inSetting(type, settingId) : null).data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  const link = (offset: number) => {
    const row = index < 0 ? undefined : rows[index + offset];
    return row ? { name: row.name, href: `${DETAIL_ROUTES[type]}/${row.id}` } : undefined;
  };
  return { id, previous: link(-1), next: link(1) };
}

export function useProfileChronicleCount(type: string, id: number, dates: ImportantDate[] = [], campaignId?: number) {
  const data = useResource<{ events:ProfileWorldEvent[];now:ChronicleNow | null }>(`/links/profile-chronicle?type=${type}&id=${id}${campaignId ? `&campaign_id=${campaignId}` : ""}`).data;
  return mergeProfileWorld(dates,data?.events ?? [],data?.now ?? null).length;
}
