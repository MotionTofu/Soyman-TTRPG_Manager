import { useMemo, useState } from "react";
import { write } from "../data/hooks";
import { grantRow, useCampaignGrantList, useGrantWriter } from "../hooks/useCampaignGrants";
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
  // Доступы цели — выборка из общего списка кампании (один запрос на все глаза).
  const all = useCampaignGrantList(campaignId).data;
  const grants = useMemo(
    () => (all ? all.filter((g) => g.target_type === targetType && g.target_id === targetId) : null),
    [all, targetType, targetId]
  );
  const writeGrants = useGrantWriter(campaignId);
  const withLevel = SETTING_TARGETS.has(targetType);
  const ofTarget = (g: PlayerVisibilityGrant) => g.target_type === targetType && g.target_id === targetId;

  async function toggle(playerId: number, granted: boolean) {
    const done = await writeGrants(
      granted ? "Скрыть у игрока" : "Показать игроку",
      (rows) =>
        granted
          ? rows.filter((g) => !(ofTarget(g) && g.player_id === playerId))
          : [...rows, grantRow(campaignId, playerId, targetType, targetId)],
      () =>
        granted
          ? write.del(`/visibility-grants?campaign_id=${campaignId}&player_id=${playerId}&target_type=${targetType}&target_id=${targetId}`)
          : write.post("/visibility-grants", { campaign_id: campaignId, player_id: playerId, target_type: targetType, target_id: targetId })
    );
    if (done) onChanged?.();
  }

  async function changeLevel(playerId: number, level: AccessLevel) {
    const done = await writeGrants(
      "Ступень выдачи",
      (rows) => rows.map((g) => (ofTarget(g) && g.player_id === playerId ? { ...g, access_level: level } : g)),
      () =>
        write.put("/visibility-grants", {
          campaign_id: campaignId,
          player_id: playerId,
          target_type: targetType,
          target_id: targetId,
          access_level: level,
        })
    );
    if (done) onChanged?.();
  }

  async function batchToggle(playerIds: number[], grant: boolean) {
    if (!playerIds.length) return;
    const done = await writeGrants(
      grant ? "Показать игрокам" : "Скрыть у игроков",
      (rows) =>
        grant
          ? [
              ...rows,
              ...playerIds
                .filter((pid) => !rows.some((g) => ofTarget(g) && g.player_id === pid))
                .map((pid) => grantRow(campaignId, pid, targetType, targetId)),
            ]
          : rows.filter((g) => !(ofTarget(g) && playerIds.includes(g.player_id))),
      () =>
        write.post("/visibility-grants/batch", {
          campaign_id: campaignId,
          player_ids: playerIds,
          targets: [{ target_type: targetType, target_id: targetId }],
          action: grant ? "grant" : "revoke",
        })
    );
    if (done) onChanged?.();
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
