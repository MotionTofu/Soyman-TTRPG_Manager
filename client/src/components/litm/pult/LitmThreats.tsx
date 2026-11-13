import { Consequence, LitmRich } from "../LitmBook";
import type { LitmThreat } from "../litmChallenge";
import { actionLabel, consequenceTextActions, type ConsequenceAction } from "./consequence";

/**
 * Угрозы гнезда с кнопками (Q12): зачин — «объявить» (плашка «⚠» над лентой
 * до развязки), под последствием — то, что пульт выполнит по разметке.
 * Последствия для Героя открывают параметры, ПКМ открывает параметры и для Вызова.
 * `offset` — номер первой угрозы в общем списке гнезда (надстройки идут следом).
 */
export function LitmThreats({
  threats,
  offset,
  declared,
  onDeclare,
  onAction,
  onOwn,
}: {
  threats: LitmThreat[];
  offset: number;
  declared: number | null;
  onDeclare: (index: number | null, lead: string) => void;
  onAction: (action: ConsequenceAction, threat: number | null, edit: boolean) => void;
  onOwn: () => void;
}) {
  return (
    <>
      {threats.map((t, i) => {
        const n = offset + i;
        const on = !t.withoutThreat && declared === n;
        return (
          <div key={i} className={`lb-thr lp-thr${on ? " is-on" : ""}`}>
            <h4>
              {t.withoutThreat ? <b>Последствия без Угрозы</b> : <button type="button" className="lp-thr__h" aria-pressed={on} title={on ? "Снять объявление" : "Объявить угрозу"} onClick={() => onDeclare(on ? null : n, t.lead)}>
                {t.name && <b>{t.name}</b>}
                <span>
                  <LitmRich text={t.lead} />
                </span>
                <i className="lp-thr__mk" aria-hidden="true">
                  ⚠
                </i>
              </button>}
            </h4>
            <ul>
              {t.consequences.map((c, k) => {
                const actions = t.effects?.[c] ?? consequenceTextActions(c);
                return (
                  <li key={k}>
                    <Consequence text={c} />
                    {actions.length > 0 && (
                      <span className="lp-acts">
                        {actions.map((a, j) => (
                          <button
                            key={j}
                            type="button"
                            className="lp-act"
                            title="ПКМ — открыть параметры Последствия"
                            onClick={() => onAction(a, t.withoutThreat ? null : n, false)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onAction(a, t.withoutThreat ? null : n, true);
                            }}
                          >
                            → {actionLabel(a)}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="lp-act lp-act--own" onClick={onOwn}>
              Своё…
            </button>
          </div>
        );
      })}
    </>
  );
}
