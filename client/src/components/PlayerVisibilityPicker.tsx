import { useEffect, useState } from "react";
import { api } from "../api/client";
import { NavIcon } from "./NavIcons";
import type { AccessLevel, PlayerVisibilityGrant, RosterPlayer, VisibilityTargetType } from "../types";

// Small "глаз / Кому видно" toggle used by both the campaign and setting "Для
// игроков" tabs — per (campaign, target) grant list, one checkbox per
// roster player. Adding/removing content never reveals it; this is the only
// UI that grants visibility (see player_visibility_grants).
//
// Для выдачи из сеттинга (setting_*) у каждого открытого игрока выбирается
// ступень: «упомянута» (имя, вид, картинка) или «открыта». Раздатке
// (campaign_player_*) ступень не предлагается: выданная статья читается
// целиком, упоминать её вполсилы нечего.
interface Props {
  campaignId: number;
  targetType: VisibilityTargetType;
  targetId: number;
  roster: RosterPlayer[];
  onChanged?: () => void;
}

const SETTING_TARGETS: ReadonlySet<string> = new Set([
  "setting_location",
  "setting_being",
  "setting_community",
  "setting_calendar_event",
]);

export function PlayerVisibilityPicker({ campaignId, targetType, targetId, roster, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<PlayerVisibilityGrant[] | null>(null);
  const withLevel = SETTING_TARGETS.has(targetType);

  function refresh(signal?: AbortSignal) {
    api
      .get<PlayerVisibilityGrant[]>(
        `/visibility-grants?campaign_id=${campaignId}&target_type=${targetType}&target_id=${targetId}`,
        { signal } as any
      )
      .then(setGrants)
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        // keep previous grants on error — silent retry on next open
      });
  }
  useEffect(() => {
    if (!open || grants !== null) return;
    const c = new AbortController();
    refresh(c.signal);
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggle(playerId: number, granted: boolean) {
    const prev = grants ? [...grants] : [];
    const optimistic = granted
      ? prev.filter((g) => g.player_id !== playerId)
      : [...prev, { campaign_id: campaignId, player_id: playerId, target_type: targetType, target_id: targetId, access_level: "open" } as PlayerVisibilityGrant];
    setGrants(optimistic as PlayerVisibilityGrant[]);
    try {
      if (granted) {
        await api.del(`/visibility-grants?campaign_id=${campaignId}&player_id=${playerId}&target_type=${targetType}&target_id=${targetId}`);
      } else {
        await api.post("/visibility-grants", { campaign_id: campaignId, player_id: playerId, target_type: targetType, target_id: targetId });
      }
      onChanged?.();
    } catch {
      setGrants(prev);
    }
  }

  async function changeLevel(playerId: number, level: AccessLevel) {
    const prev = grants ? [...grants] : [];
    setGrants(prev.map((g) => (g.player_id === playerId ? { ...g, access_level: level } : g)));
    try {
      await api.put("/visibility-grants", {
        campaign_id: campaignId,
        player_id: playerId,
        target_type: targetType,
        target_id: targetId,
        access_level: level,
      });
      onChanged?.();
    } catch {
      setGrants(prev);
    }
  }

  async function batchToggle(playerIds: number[], grant: boolean) {
    if (!playerIds.length) return;
    const prev = grants ? [...grants] : [];
    const optimistic = grant
      ? [
          ...prev,
          ...playerIds
            .filter((pid) => !prev.some((g) => g.player_id === pid))
            .map((pid) => ({ campaign_id: campaignId, player_id: pid, target_type: targetType, target_id: targetId, access_level: "open" } as PlayerVisibilityGrant)),
        ]
      : prev.filter((g) => !playerIds.includes(g.player_id));
    setGrants(optimistic as PlayerVisibilityGrant[]);
    try {
      await api.post("/visibility-grants/batch", {
        campaign_id: campaignId,
        player_ids: playerIds,
        targets: [{ target_type: targetType, target_id: targetId }],
        action: grant ? "grant" : "revoke",
      });
      onChanged?.();
    } catch {
      setGrants(prev);
    }
  }

  const grantedCount = grants?.length ?? 0;

  return (
    <div className="visibility-picker">
      <button className="btn-capsule" onClick={() => setOpen((v) => !v)} title="Кому видно" aria-label={`Кому видно — ${grantedCount} игроков`}>
        <NavIcon name="eye" /> <span className="btn-capsule-count">{grantedCount > 0 ? grantedCount : ""}</span>
      </button>
      {open && (
        <div className="visibility-picker-panel card stack">
          {roster.length > 1 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const missing = roster.filter((p) => !grants?.some((g) => g.player_id === p.id)).map((p) => p.id);
                  void batchToggle(missing, true);
                }}
                style={{ fontSize: "var(--fs-meta)", padding: "2px 6px" }}
              >
                Выбрать всех
              </button>
              <button
                onClick={() => {
                  const present = roster.filter((p) => grants?.some((g) => g.player_id === p.id)).map((p) => p.id);
                  void batchToggle(present, false);
                }}
                style={{ fontSize: "var(--fs-meta)", padding: "2px 6px" }}
              >
                Снять всех
              </button>
            </div>
          )}
          {roster.length === 0 && <span className="muted">В составе кампании нет игроков.</span>}
          {roster.map((p) => {
            const grant = grants?.find((g) => g.player_id === p.id);
            const granted = !!grant;
            const level: AccessLevel = grant?.access_level === "mentioned" ? "mentioned" : "open";
            return (
              <div key={p.id} className="row" style={{ gap: 6, justifyContent: "space-between" }}>
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={granted} onChange={() => toggle(p.id, granted)} />
                  {p.name}
                </label>
                {withLevel && granted && (
                  <select
                    value={level}
                    onChange={(e) => void changeLevel(p.id, e.target.value as AccessLevel)}
                    title="Ступень выдачи"
                    style={{ fontSize: "var(--fs-meta)", padding: "2px 4px" }}
                  >
                    <option value="open">Открыта</option>
                    <option value="mentioned">Упомянута</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
