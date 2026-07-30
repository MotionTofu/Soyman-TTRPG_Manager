import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PlayerVisibilityGrant, RosterPlayer, VisibilityTargetType } from "../types";

// Small "👁 Кому видно" toggle used by both the campaign and setting "Для
// игроков" tabs — per (campaign, target) grant list, one checkbox per
// roster player. Adding/removing content never reveals it; this is the only
// UI that grants visibility (see player_visibility_grants).
interface Props {
  campaignId: number;
  targetType: VisibilityTargetType;
  targetId: number;
  roster: RosterPlayer[];
}

export function PlayerVisibilityPicker({ campaignId, targetType, targetId, roster }: Props) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<PlayerVisibilityGrant[] | null>(null);

  function refresh() {
    api
      .get<PlayerVisibilityGrant[]>(
        `/visibility-grants?campaign_id=${campaignId}&target_type=${targetType}&target_id=${targetId}`
      )
      .then(setGrants);
  }
  useEffect(() => {
    if (open && grants === null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggle(playerId: number, granted: boolean) {
    if (granted) {
      await api.del(
        `/visibility-grants?campaign_id=${campaignId}&player_id=${playerId}&target_type=${targetType}&target_id=${targetId}`
      );
    } else {
      await api.post("/visibility-grants", { campaign_id: campaignId, player_id: playerId, target_type: targetType, target_id: targetId });
    }
    refresh();
  }

  const grantedCount = grants?.length ?? 0;

  return (
    <div className="visibility-picker">
      <button className="btn-capsule" onClick={() => setOpen((v) => !v)} title="Кому видно">
        👁 {grantedCount > 0 ? grantedCount : ""}
      </button>
      {open && (
        <div className="visibility-picker-panel card stack">
          {roster.length === 0 && <span className="muted">В составе кампании нет игроков.</span>}
          {roster.map((p) => {
            const granted = grants?.some((g) => g.player_id === p.id) ?? false;
            return (
              <label key={p.id} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={granted} onChange={() => toggle(p.id, granted)} />
                {p.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
