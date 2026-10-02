import { useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import type { EntityKind } from "../data/entities";
import { campaignPaths } from "../data/campaigns";
import { Modal } from "./Modal";
import { PlayerVisibilityPicker } from "./PlayerVisibilityPicker";
import type { CampaignDetail, VisibilityTargetType } from "../types";

// «Игрокам: …» в фактах профиля сущности сеттинга (спека campaign-paper,
// Q34): кому она открыта по кампаниям; щелчок — выбор игроков. Дерева «Мир» в
// «Выдаче» больше нет, поэтому открывают отсюда.
interface TargetCampaign {
  campaign_id: number;
  campaign_name: string;
  players: { id: number; name: string }[];
  all: boolean;
}

interface TargetVisibility {
  /** Null — у вида нет «Текста игрокам» (артефакт). */
  player_text: string | null;
  campaigns: TargetCampaign[];
}

// «Текст игрокам» правился в дереве «Мир» старой «Выдачи»; теперь — здесь.
const PLAYER_TEXT_TARGETS: Partial<Record<VisibilityTargetType, { base: string; kind: EntityKind }>> = {
  setting_location: { base: "/setting-locations", kind: "location" },
  setting_being: { base: "/setting-beings", kind: "being" },
  setting_community: { base: "/setting-communities", kind: "community" },
  setting_calendar_event: { base: "/settings/calendar-events", kind: "setting_event" },
};

export function PlayerVisibilityFact({ targetType, targetId }: { targetType: VisibilityTargetType; targetId: number }) {
  const data = useResource<TargetVisibility>(`/visibility-grants/target?target_type=${targetType}&target_id=${targetId}`).data;
  const [open, setOpen] = useState(false);
  const rows = data?.campaigns;
  if (!data || !rows || rows.length === 0) return null;
  const seen = rows.filter((r) => r.players.length > 0);
  const text =
    seen.length === 0
      ? "скрыто"
      : seen
          .map((r) => `${rows.length > 1 ? `${r.campaign_name}: ` : ""}${r.all ? "всем" : r.players.map((p) => p.name).join(", ")}`)
          .join("; ");
  return (
    <div>
      <dt className="paper-label">Игрокам</dt>
      <dd>
        <button type="button" className="paper-more player-visibility-fact" onClick={() => setOpen(true)}>
          {text} ›
        </button>
      </dd>
      {open && (
        <Modal onClose={() => setOpen(false)} ariaLabel="Кому открыто">
          <div className="stack">
            <h2>Кому открыто</h2>
            {rows.map((r) => (
              <CampaignRow key={r.campaign_id} row={r} targetType={targetType} targetId={targetId} />
            ))}
            {data.player_text !== null && PLAYER_TEXT_TARGETS[targetType] && (
              <PlayerText targetType={targetType} targetId={targetId} value={data.player_text} />
            )}
            <div className="row">
              <button type="button" className="primary" onClick={() => setOpen(false)}>
                Готово
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CampaignRow({ row, targetType, targetId }: { row: TargetCampaign; targetType: VisibilityTargetType; targetId: number }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(row.campaign_id)).data;
  return (
    <div className="row">
      <strong>{row.campaign_name}</strong>
      <span className="muted">{row.players.length === 0 ? "скрыто" : row.all ? "всем" : row.players.map((p) => p.name).join(", ")}</span>
      {campaign && <PlayerVisibilityPicker campaignId={row.campaign_id} targetType={targetType} targetId={targetId} roster={campaign.roster} />}
    </div>
  );
}

/** Что рассказываем игрокам вместо правды — уходит им вместо описания. */
function PlayerText({ targetType, targetId, value }: { targetType: VisibilityTargetType; targetId: number; value: string }) {
  const [draft, setDraft] = useState(value);
  const run = useAction();
  const target = PLAYER_TEXT_TARGETS[targetType]!;
  async function save() {
    await run(labelled("Текст игрокам", () => write.put(`${target.base}/${targetId}`, { player_text: draft })), {
      affects: [{ kind: target.kind, id: targetId }, { path: "/visibility-grants" }, { path: "/player" }],
    });
  }
  return (
    <label className="stack">
      <span className="paper-label">Текст игрокам</span>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Слух, который знают игроки…" />
      <button type="button" disabled={draft === value} onClick={() => void save()}>
        Сохранить текст
      </button>
    </label>
  );
}
