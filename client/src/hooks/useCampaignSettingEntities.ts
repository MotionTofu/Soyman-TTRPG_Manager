import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
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

export function useCampaignSettingEntities(campaignId: number | ""): UseCampaignSettingEntities {
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!campaignId) {
      setIncluded(new Set());
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<CampaignSettingEntity[]>(`/campaign-setting-entities/${campaignId}`, { signal: controller.signal } as any)
      .then((entities) => {
        setIncluded(new Set(entities.map((e) => `${e.entity_type}:${e.entity_id}`)));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, refreshKey]);

  const isIncluded = useCallback(
    (entityType: VisibilityTargetType, entityId: number) => included.has(`${entityType}:${entityId}`),
    [included]
  );

  const add = useCallback(
    async (entityType: VisibilityTargetType, entityId: number) => {
      if (!campaignId) return false;
      try {
        await api.post(`/campaign-setting-entities/${campaignId}`, {
          entity_type: entityType,
          entity_id: entityId,
        });
        setIncluded((prev) => new Set(prev).add(`${entityType}:${entityId}`));
        return true;
      } catch {
        return false;
      }
    },
    [campaignId]
  );

  const remove = useCallback(
    async (entityType: VisibilityTargetType, entityId: number) => {
      if (!campaignId) return false;
      try {
        await api.del(`/campaign-setting-entities/${campaignId}?entity_type=${entityType}&entity_id=${entityId}`);
        setIncluded((prev) => {
          const next = new Set(prev);
          next.delete(`${entityType}:${entityId}`);
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [campaignId]
  );

  const batchUpdate = useCallback(
    async (entities: { entity_type: VisibilityTargetType; entity_id: number }[], action: "add" | "remove") => {
      if (!campaignId || !entities.length) return false;
      try {
        await api.post(`/campaign-setting-entities/${campaignId}/batch`, { entities, action });
        setIncluded((prev) => {
          const next = new Set(prev);
          for (const e of entities) {
            const key = `${e.entity_type}:${e.entity_id}`;
            if (action === "add") next.add(key);
            else next.delete(key);
          }
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [campaignId]
  );

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { included, loading, error, isIncluded, add, remove, batchUpdate, refresh };
}
