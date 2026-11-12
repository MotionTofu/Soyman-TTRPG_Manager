import { CAMP_STEPS, type LitmStoryTag } from "@shared/litm/conflict";
import { statusTier, type LitmStatus } from "@shared/litm/status";
import { useCurrentUser } from "../../api/currentUser";
import { useResource } from "../../data/hooks";
import { LitmRich } from "./LitmBook";

interface LitmTable {
  spotlight: number | null;
  tags: LitmStoryTag[];
  statuses: LitmStatus[];
  /** Путешествие: шаги и угроза текущей виньетки, без последствий (пульт v2, Q15). */
  journey?: { name: string; kind: string; steps: number; gap: string; passed: number; now: { name: string; threat: string } | null } | null;
  camp?: { step: number; sojourn: boolean } | null;
}

/** Клетки шагов: пройденные, текущая, впереди (доска Litm-Table-Journey). */
function Dots({ total, done }: { total: number; done: number }) {
  return (
    <span className="litm-trip__dots" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < done ? "is-done" : i === done ? "is-now" : ""} />
      ))}
    </span>
  );
}

/** Полоса путешествия и шаг привала на телефоне игрока (пульт v2, Q15). */
export function LitmTrip({ journey, camp }: Pick<LitmTable, "journey" | "camp">) {
  return (
    <>
      {journey && (
        <div className="litm-trip" role="status">
          <span className="litm-trip__k">Путешествие{journey.kind ? ` · ${journey.kind.toLowerCase()}` : ""}</span>
          <b>{journey.name}</b>
          {journey.steps > 0 && <Dots total={journey.steps} done={journey.passed} />}
          <span className="litm-trip__meta">
            {journey.steps === 0
              ? "Число шагов ещё не выбрано"
              : journey.passed >= journey.steps
                ? "Прибыли"
                : `Шаг ${journey.passed + 1} из ${journey.steps}${journey.gap ? ` · между шагами — ${journey.gap}` : ""}`}
          </span>
        </div>
      )}
      {journey?.now && (
        <div className="litm-trip litm-trip--now">
          <span className="litm-trip__k">Сейчас на пути</span>
          <b>{journey.now.name}</b>
          {journey.now.threat && (
            <p>
              <LitmRich text={journey.now.threat} />
            </p>
          )}
        </div>
      )}
      {camp && (
        <div className="litm-trip litm-trip--camp" role="status">
          <span className="litm-trip__k">{camp.sojourn ? "Передышка" : "Привал"}</span>
          <b>{CAMP_STEPS[camp.step - 1]}</b>
          <Dots total={CAMP_STEPS.length} done={camp.step - 1} />
          <span className="litm-trip__meta">
            Шаг {camp.step} из {CAMP_STEPS.length} · выбор за столом, голосом
          </span>
        </div>
      )}
    </>
  );
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
  const trip = !!(table.journey || table.camp);
  if (!mine && !table.tags.length && !table.statuses.length && !trip) return null;
  return (
    <>
      {trip && <LitmTrip journey={table.journey} camp={table.camp} />}
      {(mine || table.tags.length > 0 || table.statuses.length > 0) && (
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
      )}
    </>
  );
}
