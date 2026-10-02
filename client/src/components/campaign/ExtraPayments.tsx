import { useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import { formatDateKeyRu, toLocalDateKey } from "../../utils/date";
import type { RosterPlayer } from "../../types";

// «Сверх сессий» в свёртке «Оплата» (спека campaign-paper, Q33/Q37; доска
// 45): деньги кампании мимо сессий — за распечатки, перенос из отменённой
// игры. Входят в заработок, долг не гасят.
interface ExtraPayment {
  id: number;
  player_id: number | null;
  player_name: string | null;
  date: string;
  amount: number;
  comment: string;
}

export function ExtraPayments({ campaignId, roster, currency }: { campaignId: number; roster: RosterPlayer[]; currency: string }) {
  const path = `/campaigns/${campaignId}/extra-payments`;
  const rows = useResource<ExtraPayment[]>(path).data ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ date: toLocalDateKey(), amount: "", player_id: "", comment: "" });
  const run = useAction();
  const affects = [{ path }, { path: campaignPaths.detail(campaignId) }, { path: "/finance" }];

  async function add() {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return;
    const done = await run(
      labelled("Сверх сессий", () =>
        write.post(path, {
          date: draft.date,
          amount,
          player_id: draft.player_id ? Number(draft.player_id) : null,
          comment: draft.comment,
        })
      ),
      { affects, retry: false }
    );
    if (done !== undefined) {
      setAdding(false);
      setDraft({ date: toLocalDateKey(), amount: "", player_id: "", comment: "" });
    }
  }

  return (
    <section className="paper-list-group">
      <h3 className="paper-group__head">
        Сверх сессий <span className="paper-group__count">· {rows.length}</span>
      </h3>
      {rows.length > 0 && (
        <ul className="paper-rows">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="paper-rows__main">
                {formatDateKeyRu(r.date)}
                {r.player_name ? ` · ${r.player_name}` : ""}
                {r.comment ? ` — ${r.comment}` : ""}
              </span>
              <span className="paper-rows__sub">
                {r.amount} {currency}
              </span>
              <button
                type="button"
                className="comp-mini"
                title="Убрать запись"
                onClick={() => void run(labelled("Сверх сессий", () => write.del(`/campaigns/extra-payments/${r.id}`)), { affects })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="extra-payment-form">
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Дата" />
          <input
            type="number"
            min="0"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            placeholder={`Сумма, ${currency}`}
            aria-label="Сумма"
          />
          <select value={draft.player_id} onChange={(e) => setDraft({ ...draft, player_id: e.target.value })} aria-label="От кого">
            <option value="">от кого — не важно</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} placeholder="За что" aria-label="Комментарий" />
          <button type="button" className="primary" disabled={!(Number(draft.amount) > 0)} onClick={() => void add()}>
            Записать
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button type="button" className="editable-card-add" onClick={() => setAdding(true)}>
          + Сверх сессий
        </button>
      )}
    </section>
  );
}
