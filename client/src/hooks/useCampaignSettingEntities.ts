import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, settingEntityAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
import type { VisibilityTargetType } from "../types";

export interface CampaignSettingEntity {
  entity_type: VisibilityTargetType;
  entity_id: number;
}

export interface UseCampaignSettingEntities {
  /** Set of "entity_type:entity_id" keys that are included */
  included: Set<string>;
  loading: boolean;
  error: string | null;
  /** Check if a specific entity is included */
  isIncluded: (entityType: VisibilityTargetType, entityId: number) => boolean;
  /** Add a single entity */
  add: (entityType: VisibilityTargetType, entityId: number) => Promise<boolean>;
  /** Remove a single entity (also deletes visibility grants) */
  remove: (entityType: VisibilityTargetType, entityId: number) => Promise<boolean>;
  /** Batch add/remove */
  batchUpdate: (entities: { entity_type: VisibilityTargetType; entity_id: number }[], action: "add" | "remove") => Promise<boolean>;
  /** Refetch */
  refresh: () => void;
}

const NONE: CampaignSettingEntity[] = [];

/**
 * Сущности сеттинга, включённые в панель игроков кампании — ресурс слоя.
 * Кнопка «+ Добавить» меняется сразу; при отказе возвращается с плашкой.
 * Раньше отказ не показывался вовсе: кнопка просто оставалась прежней.
 */
export function useCampaignSettingEntities(campaignId: number | ""): UseCampaignSettingEntities {
  const client = useQueryClient();
  const run = useAction();
  const path = campaignId ? campaignPaths.settingEntities(campaignId) : null;
  const state = useResource<CampaignSettingEntity[]>(path);
  const rows = state.data ?? NONE;

  const included = useMemo(() => new Set(rows.map((e) => `${e.entity_type}:${e.entity_id}`)), [rows]);

  const isIncluded = useCallback(
    (entityType: VisibilityTargetType, entityId: number) => included.has(`${entityType}:${entityId}`),
    [included]
  );

  const change = useCallback(
    async (
      label: string,
      entities: { entity_type: VisibilityTargetType; entity_id: number }[],
      action: "add" | "remove",
      send: () => Promise<unknown>
    ): Promise<boolean> => {
      if (!campaignId || !path) return false;
      const key = dataKeys.resource(path);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<CampaignSettingEntity[]>(key);
      if (previous) {
        const same = (a: CampaignSettingEntity, b: CampaignSettingEntity) => a.entity_type === b.entity_type && a.entity_id === b.entity_id;
        const next =
          action === "add"
            ? [...previous, ...entities.filter((e) => !previous.some((p) => same(p, e)))]
            : previous.filter((p) => !entities.some((e) => same(p, e)));
        client.setQueryData(key, next);
      }
      const done = await run(labelled(label, () => send().then(() => true)), { affects: settingEntityAffects(campaignId) });
      if (!done && previous) client.setQueryData(key, previous);
      return done === true;
    },
    [campaignId, path, client, run]
  );

  const add = useCallback(
    (entityType: VisibilityTargetType, entityId: number) =>
      change("В панель игроков", [{ entity_type: entityType, entity_id: entityId }], "add", () =>
        write.post(`/campaign-setting-entities/${campaignId}`, { entity_type: entityType, entity_id: entityId })
      ),
    [campaignId, change]
  );

  const remove = useCallback(
    (entityType: VisibilityTargetType, entityId: number) =>
      change("Из панели игроков", [{ entity_type: entityType, entity_id: entityId }], "remove", () =>
        write.del(`/campaign-setting-entities/${campaignId}?entity_type=${entityType}&entity_id=${entityId}`)
      ),
    [campaignId, change]
  );

  const batchUpdate = useCallback(
    (entities: { entity_type: VisibilityTargetType; entity_id: number }[], action: "add" | "remove") => {
      if (!entities.length) return Promise.resolve(false);
      return change(action === "add" ? "В панель игроков" : "Из панели игроков", entities, action, () =>
        write.post(`/campaign-setting-entities/${campaignId}/batch`, { entities, action })
      );
    },
    [campaignId, change]
  );

  return { included, loading: state.loading, error: state.error, isIncluded, add, remove, batchUpdate, refresh: state.reload };
}
