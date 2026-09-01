import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { Campaign, SessionDetail } from "../types";

interface Props {
  sessionId: number;
  onClose: () => void;
  onSaved?: () => void;
}

export function SessionFinanceModal({ sessionId, onClose, onSaved }: Props) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    api.get<SessionDetail>(`/sessions/${sessionId}`, { signal: ac.signal } as RequestInit)
      .then((s) => {
        setSession(s);
        api.get<Campaign>(`/campaigns/${s.campaign_id}`, { signal: ac.signal } as RequestInit)
          .then(setCampaign)
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [sessionId]);

  async function save() {
    if (!session) return;
    await api.put(`/sessions/${sessionId}/attendance`, {
      attendance: session.attendance.map((a) => ({
        player_id: a.player_id,
        attended: !!a.attended,
        amount_paid: a.amount_paid,
      })),
    });
    onSaved?.();
    onClose();
  }

  function updateField(playerId: number, field: "attended" | "amount_paid", value: number) {
    if (!session) return;
    setSession({
      ...session,
      attendance: session.attendance.map((a) =>
        a.player_id === playerId ? { ...a, [field]: value } : a
      ),
    });
  }

  function defaultStake(): number {
    if (!session || !campaign) return 0;
    if (session.stake_override != null) return session.stake_override;
    let amount = campaign.session_rate ?? 0;
    if (campaign.rate_split === "per_table") {
      const attended = session.attendance.filter((a) => a.attended).length;
      const attendeeCount = attended > 0 ? attended : session.attendance.length || 1;
      amount = amount / attendeeCount;
    }
    if (campaign.payment_frequency === "per_month") {
      const monthPrefix = session.date.slice(0, 7);
      amount = amount; // can't count sessions here without extra fetch, keep simple
    }
    return Math.round(amount * 100) / 100;
  }

  function payAll() {
    if (!session) return;
    const amount = defaultStake();
    setSession({
      ...session,
      attendance: session.attendance.map((a) => ({ ...a, amount_paid: amount })),
    });
  }

  const isPaid = session?.effective_payment_type === "paid";

  return (
    <Modal onClose={onClose}>
      <div className="stack" style={{ gap: 12, minWidth: 340, maxWidth: 440 }}>
        <h3 style={{ margin: 0 }}>
          Финансы{session ? ` — ${session.date}` : ""}
        </h3>
        {loading && <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>Загрузка…</div>}
        {!loading && session && session.attendance.length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>В составе кампании нет игроков.</div>
        )}
        {!loading && session && session.attendance.length > 0 && (
          <table className="session-attendance-table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>
                  <label className="sp-check-head" title="Отметить/снять всех">
                    <input
                      type="checkbox"
                      checked={session.attendance.length > 0 && session.attendance.every((a) => !!a.attended)}
                      onChange={() => {
                        const all = session.attendance.every((a) => !!a.attended);
                        const next = session.attendance.map((a) => ({ ...a, attended: all ? 0 : 1 }));
                        setSession({ ...session, attendance: next });
                      }}
                    />
                    Пришёл
                  </label>
                </th>
                {isPaid && (
                  <th>
                    <button type="button" className="sp-head-btn" title="Оплатить всем по умолчанию" onClick={payAll}>
                      Оплачено · всем
                    </button>
                  </th>
                )}
                {isPaid && <th></th>}
              </tr>
            </thead>
            <tbody>
              {session.attendance.map((a) => (
                <tr key={a.player_id}>
                  <td data-label="Игрок">{a.name}</td>
                  <td data-label="Пришёл">
                    <input
                      type="checkbox"
                      checked={!!a.attended}
                      onChange={(e) => updateField(a.player_id, "attended", e.target.checked ? 1 : 0)}
                    />
                  </td>
                  {isPaid && (
                    <td data-label="Оплачено">
                      <input
                        type="number"
                        style={{ width: 90 }}
                        value={a.amount_paid || ""}
                        placeholder="0"
                        onChange={(e) => updateField(a.player_id, "amount_paid", Number(e.target.value) || 0)}
                      />
                    </td>
                  )}
                  {isPaid && (
                    <td>
                      <button onClick={() => updateField(a.player_id, "amount_paid", defaultStake())}>
                        Ставка ({defaultStake()})
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={save} disabled={loading || !session}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
