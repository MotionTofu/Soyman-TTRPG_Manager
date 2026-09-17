import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { campaignPaths, grantAffects } from "../data/campaigns";
import { labelled } from "../data/notices";
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

const NO_GRANTS: PlayerVisibilityGrant[] = [];

/**
 * Все доступы кампании — один ресурс слоя (группа «кампании», часть 2). Его же
 * читает глаз «Кому видно» у каждой строки, поэтому глаз больше не ходит за
 * доступами своей цели отдельно, а число «видят» есть до открытия.
 */
export function useCampaignGrantList(campaignId: number | "") {
  return useResource<PlayerVisibilityGrant[]>(campaignId ? campaignPaths.grants(campaignId) : null);
}

/**
 * Записи доступов: список меняется на экране сразу, при отказе возвращается
 * прежний и появляется плашка «Не сохранилось». Раньше глаз при отказе молча
 * откатывал галочку, и Мастер не узнавал, что игроку ничего не открылось.
 */
export function useGrantWriter(campaignId: number | "") {
  const client = useQueryClient();
  const run = useAction();

  return useCallback(
    async (
      label: string,
      patch: (grants: PlayerVisibilityGrant[]) => PlayerVisibilityGrant[],
      send: () => Promise<unknown>
    ): Promise<boolean> => {
      if (!campaignId) return false;
      const key = dataKeys.resource(campaignPaths.grants(campaignId));
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PlayerVisibilityGrant[]>(key);
      if (previous) client.setQueryData(key, patch(previous));
      const done = await run(labelled(label, () => send().then(() => true)), { affects: grantAffects(campaignId) });
      if (!done && previous) client.setQueryData(key, previous);
      return done === true;
    },
    [campaignId, client, run]
  );
}

/** Доступ одного игрока к одной цели — строка для оптимистичного списка. */
export function grantRow(
  campaignId: number,
  playerId: number,
  targetType: VisibilityTargetType,
  targetId: number,
  level: AccessLevel = "open"
): PlayerVisibilityGrant {
  return { campaign_id: campaignId, player_id: playerId, target_type: targetType, target_id: targetId, access_level: level } as PlayerVisibilityGrant;
}

export function useCampaignGrants(campaignId: number | ""): CampaignGrants {
  const list = useCampaignGrantList(campaignId);
  const grants = list.data ?? NO_GRANTS;
  const writeGrants = useGrantWriter(campaignId);

  const { byTarget, byPlayer, byLevel } = useMemo(() => {
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
    return { byTarget: tMap, byPlayer: pMap, byLevel: lMap };
  }, [grants]);

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
    (targetType: VisibilityTargetType, targetId: number, playerId: number, level: AccessLevel) => {
      if (!campaignId) return Promise.resolve(false);
      return writeGrants(
        "Ступень выдачи",
        (rows) =>
          rows.map((g) =>
            g.player_id === playerId && g.target_type === targetType && g.target_id === targetId ? { ...g, access_level: level } : g
          ),
        () =>
          write.put("/visibility-grants", {
            campaign_id: campaignId,
            player_id: playerId,
            target_type: targetType,
            target_id: targetId,
            access_level: level,
          })
      );
    },
    [campaignId, writeGrants]
  );

  const batchUpdate = useCallback(
    (playerIds: number[], targets: { target_type: VisibilityTargetType; target_id: number }[], action: "grant" | "revoke", accessLevel?: AccessLevel) => {
      if (!campaignId || !playerIds.length || !targets.length) return Promise.resolve(false);
      const touched = (g: PlayerVisibilityGrant) =>
        playerIds.includes(g.player_id) && targets.some((t) => t.target_type === g.target_type && t.target_id === g.target_id);
      return writeGrants(
        action === "grant" ? "Показать игрокам" : "Скрыть у игроков",
        (rows) => {
          if (action === "revoke") return rows.filter((g) => !touched(g));
          const next = rows.map((g) => (touched(g) && accessLevel ? { ...g, access_level: accessLevel } : g));
          for (const t of targets) {
            for (const pid of playerIds) {
              if (!rows.some((g) => g.player_id === pid && g.target_type === t.target_type && g.target_id === t.target_id)) {
                next.push(grantRow(campaignId, pid, t.target_type, t.target_id, accessLevel ?? "open"));
              }
            }
          }
          return next;
        },
        () =>
          write.post("/visibility-grants/batch", {
            campaign_id: campaignId,
            player_ids: playerIds,
            targets,
            action,
            ...(accessLevel !== undefined ? { access_level: accessLevel } : {}),
          })
      );
    },
    [campaignId, writeGrants]
  );

  return {
    byTarget,
    byPlayer,
    byLevel,
    loading: list.loading,
    error: list.error,
    isGranted,
    isGrantedToAny,
    getGrantedPlayerIds,
    getAccessLevel,
    getLevelCounts,
    setAccessLevel,
    batchUpdate,
    refresh: list.reload,
  };
}
