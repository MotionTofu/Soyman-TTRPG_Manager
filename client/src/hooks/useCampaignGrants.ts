import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { PlayerVisibilityGrant, VisibilityTargetType } from "../types";

export type GrantKey = `${VisibilityTargetType}:${number}`;

export interface CampaignGrants {
  /** Map<"target_type:target_id", Set<player_id>> */
  byTarget: Map<GrantKey, Set<number>>;
  /** Map<player_id, Set<"target_type:target_id">> */
  byPlayer: Map<number, Set<GrantKey>>;
  loading: boolean;
  error: string | null;
  /** Check if a specific target is granted to a specific player */
  isGranted: (targetType: VisibilityTargetType, targetId: number, playerId: number) => boolean;
  /** Check if a specific target is granted to ANY player */
  isGrantedToAny: (targetType: VisibilityTargetType, targetId: number) => boolean;
  /** Get player IDs that have access to a target */
  getGrantedPlayerIds: (targetType: VisibilityTargetType, targetId: number) => number[];
  /** Batch grant/revoke — returns true on success */
  batchUpdate: (playerIds: number[], targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke") => Promise<boolean>;
  /** Refetch all grants */
  refresh: () => void;
}

export function useCampaignGrants(campaignId: number | ""): CampaignGrants {
  const [byTarget, setByTarget] = useState<Map<GrantKey, Set<number>>>(new Map());
  const [byPlayer, setByPlayer] = useState<Map<number, Set<GrantKey>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setByTarget(new Map());
      setByPlayer(new Map());
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    api
      .get<PlayerVisibilityGrant[]>(
        `/visibility-grants?campaign_id=${campaignId}`,
        { signal: controller.signal } as any
      )
      .then((grants) => {
        const tMap = new Map<GrantKey, Set<number>>();
        const pMap = new Map<number, Set<GrantKey>>();
        for (const g of grants) {
          const key: GrantKey = `${g.target_type}:${g.target_id}`;
          if (!tMap.has(key)) tMap.set(key, new Set());
          tMap.get(key)!.add(g.player_id);
          if (!pMap.has(g.player_id)) pMap.set(g.player_id, new Set());
          pMap.get(g.player_id)!.add(key);
        }
        setByTarget(tMap);
        setByPlayer(pMap);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, refreshKey]);

  const isGranted = useCallback(
    (targetType: VisibilityTargetType, targetId: number, playerId: number) => {
      const key = `${targetType}:${targetId}` as GrantKey;
      return byTarget.get(key)?.has(playerId) ?? false;
    },
    [byTarget]
  );

  const isGrantedToAny = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => {
      const key = `${targetType}:${targetId}` as GrantKey;
      return (byTarget.get(key)?.size ?? 0) > 0;
    },
    [byTarget]
  );

  const getGrantedPlayerIds = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => {
      const key = `${targetType}:${targetId}` as GrantKey;
      return Array.from(byTarget.get(key) ?? []);
    },
    [byTarget]
  );

  const batchUpdate = useCallback(
    async (playerIds: number[], targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke") => {
      if (!campaignId || !playerIds.length || !targets.length) return false;
      try {
        await api.post("/visibility-grants/batch", {
          campaign_id: campaignId,
          player_ids: playerIds,
          targets,
          action,
        });
        // Optimistic update
        setByTarget((prev) => {
          const next = new Map(prev);
          for (const t of targets) {
            const key: GrantKey = `${t.target_type}:${t.target_id}`;
            const set = next.get(key) ? new Set(next.get(key)) : new Set<number>();
            for (const pid of playerIds) {
              if (action === "grant") set.add(pid);
              else set.delete(pid);
            }
            next.set(key, set);
          }
          return next;
        });
        setByPlayer((prev) => {
          const next = new Map(prev);
          for (const pid of playerIds) {
            const set = next.get(pid) ? new Set(next.get(pid)) : new Set<GrantKey>();
            for (const t of targets) {
              const key: GrantKey = `${t.target_type}:${t.target_id}`;
              if (action === "grant") set.add(key);
              else set.delete(key);
            }
            next.set(pid, set);
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

  return { byTarget, byPlayer, loading, error, isGranted, isGrantedToAny, getGrantedPlayerIds, batchUpdate, refresh };
}
