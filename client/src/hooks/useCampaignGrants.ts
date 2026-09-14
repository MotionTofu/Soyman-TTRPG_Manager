import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { AccessLevel, PlayerVisibilityGrant, VisibilityTargetType } from "../types";

export type GrantKey = `${VisibilityTargetType}:${number}`;

export interface CampaignGrants {
  /** Map<"target_type:target_id", Set<player_id>> */
  byTarget: Map<GrantKey, Set<number>>;
  /** Map<player_id, Set<"target_type:target_id">> */
  byPlayer: Map<number, Set<GrantKey>>;
  /** Map<"target_type:target_id", Map<player_id, AccessLevel>> */
  byLevel: Map<GrantKey, Map<number, AccessLevel>>;
  loading: boolean;
  error: string | null;
  /** Check if a specific target is granted to a specific player */
  isGranted: (targetType: VisibilityTargetType, targetId: number, playerId: number) => boolean;
  /** Check if a specific target is granted to ANY player */
  isGrantedToAny: (targetType: VisibilityTargetType, targetId: number) => boolean;
  /** Get player IDs that have access to a target */
  getGrantedPlayerIds: (targetType: VisibilityTargetType, targetId: number) => number[];
  /** Access level of one grant, or null if not granted */
  getAccessLevel: (targetType: VisibilityTargetType, targetId: number, playerId: number) => AccessLevel | null;
  /** Levels summary of a target: how many players see it open / mentioned */
  getLevelCounts: (targetType: VisibilityTargetType, targetId: number) => { open: number; mentioned: number };
  /** Change the level of an existing grant (no revoke gap) */
  setAccessLevel: (targetType: VisibilityTargetType, targetId: number, playerId: number, level: AccessLevel) => Promise<boolean>;
  /** Batch grant/revoke — returns true on success */
  batchUpdate: (playerIds: number[], targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke", accessLevel?: AccessLevel) => Promise<boolean>;
  /** Refetch all grants */
  refresh: () => void;
}

function keyOf(targetType: VisibilityTargetType, targetId: number): GrantKey {
  return `${targetType}:${targetId}`;
}

export function useCampaignGrants(campaignId: number | ""): CampaignGrants {
  const [byTarget, setByTarget] = useState<Map<GrantKey, Set<number>>>(new Map());
  const [byPlayer, setByPlayer] = useState<Map<number, Set<GrantKey>>>(new Map());
  const [byLevel, setByLevel] = useState<Map<GrantKey, Map<number, AccessLevel>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setByTarget(new Map());
      setByPlayer(new Map());
      setByLevel(new Map());
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
        const lMap = new Map<GrantKey, Map<number, AccessLevel>>();
        for (const g of grants) {
          const key = keyOf(g.target_type, g.target_id);
          if (!tMap.has(key)) tMap.set(key, new Set());
          tMap.get(key)!.add(g.player_id);
          if (!pMap.has(g.player_id)) pMap.set(g.player_id, new Set());
          pMap.get(g.player_id)!.add(key);
          if (!lMap.has(key)) lMap.set(key, new Map());
          lMap.get(key)!.set(g.player_id, g.access_level === "mentioned" ? "mentioned" : "open");
        }
        setByTarget(tMap);
        setByPlayer(pMap);
        setByLevel(lMap);
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
      return byTarget.get(keyOf(targetType, targetId))?.has(playerId) ?? false;
    },
    [byTarget]
  );

  const isGrantedToAny = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => {
      return (byTarget.get(keyOf(targetType, targetId))?.size ?? 0) > 0;
    },
    [byTarget]
  );

  const getGrantedPlayerIds = useCallback(
    (targetType: VisibilityTargetType, targetId: number) => {
      return Array.from(byTarget.get(keyOf(targetType, targetId)) ?? []);
    },
    [byTarget]
  );

  const getAccessLevel = useCallback(
    (targetType: VisibilityTargetType, targetId: number, playerId: number): AccessLevel | null => {
      return byLevel.get(keyOf(targetType, targetId))?.get(playerId) ?? null;
    },
    [byLevel]
  );

  const getLevelCounts = useCallback(
    (targetType: VisibilityTargetType, targetId: number): { open: number; mentioned: number } => {
      let open = 0;
      let mentioned = 0;
      for (const level of byLevel.get(keyOf(targetType, targetId))?.values() ?? []) {
        if (level === "mentioned") mentioned++;
        else open++;
      }
      return { open, mentioned };
    },
    [byLevel]
  );

  const setAccessLevel = useCallback(
    async (targetType: VisibilityTargetType, targetId: number, playerId: number, level: AccessLevel) => {
      if (!campaignId) return false;
      const key = keyOf(targetType, targetId);
      const prev = byLevel.get(key)?.get(playerId) ?? null;
      setByLevel((old) => {
        const next = new Map(old);
        const inner = new Map(next.get(key));
        inner.set(playerId, level);
        next.set(key, inner);
        return next;
      });
      try {
        await api.put("/visibility-grants", {
          campaign_id: campaignId,
          player_id: playerId,
          target_type: targetType,
          target_id: targetId,
          access_level: level,
        });
        return true;
      } catch {
        setByLevel((old) => {
          const next = new Map(old);
          const inner = new Map(next.get(key));
          if (prev) inner.set(playerId, prev);
          else inner.delete(playerId);
          next.set(key, inner);
          return next;
        });
        return false;
      }
    },
    [campaignId, byLevel]
  );

  const batchUpdate = useCallback(
    async (playerIds: number[], targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke", accessLevel?: AccessLevel) => {
      if (!campaignId || !playerIds.length || !targets.length) return false;
      try {
        await api.post("/visibility-grants/batch", {
          campaign_id: campaignId,
          player_ids: playerIds,
          targets,
          action,
          ...(accessLevel !== undefined ? { access_level: accessLevel } : {}),
        });
        // Optimistic update
        setByTarget((prev) => {
          const next = new Map(prev);
          for (const t of targets) {
            const key = keyOf(t.target_type, t.target_id);
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
              const key = keyOf(t.target_type, t.target_id);
              if (action === "grant") set.add(key);
              else set.delete(key);
            }
            next.set(pid, set);
          }
          return next;
        });
        setByLevel((prev) => {
          const next = new Map(prev);
          for (const t of targets) {
            const key = keyOf(t.target_type, t.target_id);
            const inner = new Map(next.get(key));
            for (const pid of playerIds) {
              if (action === "grant") inner.set(pid, accessLevel ?? inner.get(pid) ?? "open");
              else inner.delete(pid);
            }
            next.set(key, inner);
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

  return { byTarget, byPlayer, byLevel, loading, error, isGranted, isGrantedToAny, getGrantedPlayerIds, getAccessLevel, getLevelCounts, setAccessLevel, batchUpdate, refresh };
}
