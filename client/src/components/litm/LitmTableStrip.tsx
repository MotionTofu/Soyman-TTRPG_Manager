import type { LitmStoryTag } from "@shared/litm/conflict";
import { statusTier, type LitmStatus } from "@shared/litm/status";
import { useCurrentUser } from "../../api/currentUser";
import { useResource } from "../../data/hooks";

interface LitmTable {
  spotlight: number | null;
  tags: LitmStoryTag[];
  statuses: LitmStatus[];
}

/**
 * Стол на листе игрока (Д33, Q19): «Вы в спотлайте» и сюжетные теги сцены
 * идущей сессии. Вызовы игрокам не показываются; Мастер видит всё на пульте.
 * Сигнал кампании перечитывает полосу, когда Мастер правит сцену.
 */
export function LitmTableStrip({ campaignId, characterId }: { campaignId?: number; characterId?: number }) {
  const isPlayer = useCurrentUser().user?.role === "player";
  const table = useResource<LitmTable | null>(isPlayer && campaignId ? `/player/campaigns/${campaignId}/litm-table` : null).data;
  if (!table) return null;
  const mine = characterId != null && table.spotlight === characterId;
  if (!mine && !table.tags.length && !table.statuses.length) return null;
  return (
    <div className="litm-table" role="status" aria-label="Сцена за столом">
      {mine && <b className="litm-table__spot">Вы в спотлайте</b>}
      {table.tags.map((t, i) => (
        <span key={`${t.name}-${i}`} className={`litm-tag${t.hindering ? " litm-tag-weak" : ""}`}>
          {t.name}
          {t.hindering && " · мешает"}
          {t.singleUse && " · 1×"}
        </span>
      ))}
      {table.statuses.map((s) => (
        <span key={s.name} className="litm-tag litm-table__status">
          {s.name}-{statusTier(s.marks)}
        </span>
      ))}
    </div>
  );
}
