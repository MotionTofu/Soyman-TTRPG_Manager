import { Link } from "react-router-dom";
import { useAction, useAfterWrite, useEntity, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignFieldsAffects, campaignPaths } from "../../data/campaigns";
import type { Affect } from "../../data/entities";
import { useUndoDelete } from "../../hooks/useUndoDelete";
import { plural } from "../../sceneKinds";
import { sessionLabel } from "../../sessionLabel";
import { SESSION_OUTCOME_FIELDS, SESSION_PASSPORT_FIELDS } from "../sessionPaperFields";
import { NavIcon } from "../NavIcons";
import type { CampaignDebt, SessionDetail, SessionSummary } from "../../types";

// Левая колонка «Обзора» кампании (гриллинг 2026-10-23, Q4, Q22, Q23): с чем
// Мастер готовится — что уже есть к ближайшей сессии, чем кончилась прошлая и
// кто должен. Таблица фактов отсюда ушла в строку шапки.

/** «К сессии №N»: пункты паспорта вечера, заполнено или пусто; ниже — итог прошлой. */
export function NextSessionPrep({ next, last, oneshot }: { next: SessionSummary | undefined; last: SessionSummary | undefined; oneshot: boolean }) {
  const detail = useEntity<SessionDetail>("session", next?.id ?? null).data;
  const lastDetail = useEntity<SessionDetail>("session", last?.id ?? null).data;
  if (!next && !last) return null;
  const values: Record<string, string> = detail ? { ...(detail.passport ?? {}), idea_notes: detail.idea_notes ?? "" } : {};
  const outcomes = lastDetail?.outcomes ?? {};
  const summary = SESSION_OUTCOME_FIELDS.map((f) => outcomes[f.key]?.trim()).find(Boolean)?.split("\n")[0];
  return (
    <section className="campaign-prep" aria-label="К ближайшей сессии">
      {next && (
        <>
          <h3 className="paper-label"><NavIcon name="flag" />{oneshot ? "К прогону" : `К сессии №${next.session_number ?? ""}`}</h3>
          <Link className="campaign-prep__list" to={`/sessions/${next.id}`}>
            {SESSION_PASSPORT_FIELDS.map((f) => {
              const done = !!values[f.key]?.trim();
              return (
                <span key={f.key} className={`campaign-prep__item${done ? " is-done" : ""}`}>
                  <span className="campaign-prep__mark" aria-hidden="true">{done ? "✓" : "○"}</span>
                  {f.label}
                  <span className="sr-only">{done ? " — есть" : " — пусто"}</span>
                </span>
              );
            })}
          </Link>
        </>
      )}
      {last && (
        <p className="campaign-prep__last">
          <span className="paper-label"><NavIcon name="book" />Итог: {sessionLabel(last)}</span>{" "}
          {summary ? <Link to={`/sessions/${last.id}`}>{summary}</Link> : (
            <Link to={`/sessions/${last.id}`} className="muted">«Что изменилось» не заполнено ›</Link>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * «Оплатил»: весь долг игрока полной ставкой — без окна подтверждения, но с
 * «Отменить» в тосте: окно на каждый расчёт — лишний щелчок, а промах
 * исправляется тем же тостом. Им же гасят долг из дела на вкладке «Партия».
 */
export function useSettleDebt(campaignId: number) {
  const run = useAction();
  const touched = useAfterWrite();
  const { offerUndo } = useUndoDelete();
  return async function settle(d: CampaignDebt) {
    const path = `/campaigns/${campaignId}/debts/${d.player_id}`;
    // Сессии, чьи суммы поменялись, известны только из ответа.
    const affects = (before: { session_id: number }[]): Affect[] => [
      ...campaignFieldsAffects(campaignId),
      { path: `/players/${d.player_id}/unpaid` },
      ...before.map((b): Affect => ({ kind: "session", id: b.session_id })),
    ];
    const res = await run(labelled("Оплата", () => write.post<{ before: { session_id: number; amount_paid: number }[] }>(`${path}/settle`, {})), {
      affects: campaignFieldsAffects(campaignId),
    });
    if (!res) return;
    touched(affects(res.before));
    offerUndo({
      entityName: d.player_name,
      message: `${d.player_name}: долг закрыт`,
      restoreFn: async () => {
        await write.post(`${path}/restore`, res);
        touched(affects(res.before));
      },
    });
  };
}

/** «Должники»: только когда долги есть. */
export function CampaignDebtors({ campaignId, currency }: { campaignId: number; currency: string }) {
  const debts = useResource<CampaignDebt[]>(campaignPaths.debts(campaignId)).data;
  const settle = useSettleDebt(campaignId);
  if (!debts?.length) return null;

  return (
    <section className="campaign-debtors" aria-label="Должники">
      <h3 className="paper-label"><NavIcon name="loot" />Должники</h3>
      <ul>
        {debts.map((d) => (
          <li key={d.player_id}>
            <Link to={`/players/${d.player_id}`}>{d.player_name}</Link>
            <span className="campaign-debtors__sum">
              {d.owed} {currency} · {d.sessions} {plural(d.sessions, "игра", "игры", "игр")}
            </span>
            <button type="button" className="campaign-debtors__paid" onClick={() => void settle(d)}>
              <NavIcon name="check" />
              Оплатил
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
