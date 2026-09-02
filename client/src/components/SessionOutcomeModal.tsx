import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { useConfirm } from "../hooks/useConfirm";
import { loadHideFinance } from "../financePrivacy";
import type { Campaign, SessionDetail } from "../types";

// Разбор прошедшей игры одним окном.
//
// Раньше это были две половины одного действия в разных местах меню: «Статус →
// Состоялась» отдельно и «Финансы» отдельно. Из-за этого статус проставлялся, а
// деньги — нет, и сводка «заработано» молча занижала доход: она считает только
// сессии в статусе held и только внесённые суммы. Теперь оба вопроса задаются
// за один заход, и любой из них можно не отвечать.
//
// Для уже состоявшейся сессии окно работает как правка задним числом: кнопок
// исхода нет, заголовок другой, заметка на месте — итог игры часто дописывают
// через день.

interface Props {
  sessionId: number;
  onClose: () => void;
  onSaved?: () => void;
}

export function SessionOutcomeModal({ sessionId, onClose, onSaved }: Props) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [cancelChoice, setCancelChoice] = useState(false);
  const [dialog, confirm] = useConfirm();
  const hideFinance = loadHideFinance();

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    api.get<SessionDetail>(`/sessions/${sessionId}`, { signal: ac.signal } as RequestInit)
      .then((s) => {
        setSession(s);
        // Заметка предзаполняется тем, что уже написано, и правится на месте:
        // Мастер видит, что там есть, и дописывает сам. Автоматическая склейка
        // вслепую однажды приклеила бы абзац к тексту, который он только что
        // дописал в соседнем окне, — а работать в двух окнах здесь штатно.
        setNotes(s.main_events ?? "");
        api.get<Campaign>(`/campaigns/${s.campaign_id}`, { signal: ac.signal } as RequestInit)
          .then(setCampaign)
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [sessionId]);

  const held = session?.status === "held";

  // Деньги показываются, только когда они вообще есть и когда приложение умеет
  // их посчитать. Помесячная оплата — не умеет: ставка там за месяц, а не за
  // вечер, и кнопка «Ставка» подставляла бы месячную сумму за одну игру.
  // Пока помесячная оплата не разобрана отдельно (см. later.md), в таких
  // кампаниях окно спрашивает только про присутствие.
  const perMonth = campaign?.payment_frequency === "per_month";
  const showMoney =
    !hideFinance && session?.effective_payment_type === "paid" && !perMonth;

  function updateField(
    playerId: number,
    field: "attended" | "amount_paid" | "amount_forgiven",
    value: number
  ) {
    if (!session) return;
    setSession({
      ...session,
      attendance: session.attendance.map((a) =>
        a.player_id === playerId ? { ...a, [field]: value } : a
      ),
    });
  }

  // Ожидаемая сумма с игрока. Одинакова для всех: при делении «на стол» она
  // делится на число пришедших, при «с человека» берётся целиком, а
  // stake_override перебивает и то, и другое.
  function expectedPerPlayer(): number {
    if (!session || !campaign) return 0;
    if (session.stake_override != null) return session.stake_override;
    let amount = campaign.session_rate ?? 0;
    if (campaign.rate_split === "per_table") {
      const attended = session.attendance.filter((a) => a.attended).length;
      amount = amount / (attended > 0 ? attended : session.attendance.length || 1);
    }
    return Math.round(amount * 100) / 100;
  }

  function payAll() {
    if (!session) return;
    const amount = expectedPerPlayer();
    setSession({
      ...session,
      attendance: session.attendance.map((a) => ({ ...a, amount_paid: amount })),
    });
  }

  function forgiveRest(playerId: number) {
    if (!session) return;
    const expected = expectedPerPlayer();
    setSession({
      ...session,
      attendance: session.attendance.map((a) =>
        a.player_id === playerId
          ? { ...a, amount_forgiven: Math.max(0, Math.round((expected - a.amount_paid) * 100) / 100) }
          : a
      ),
    });
  }

  const enteredSums =
    session?.attendance.some((a) => a.amount_paid > 0 || a.amount_forgiven > 0) ?? false;

  async function persist(status: SessionDetail["status"] | null, wipeSums = false) {
    if (!session || saving) return;
    setSaving(true);
    try {
      await api.put(`/sessions/${sessionId}/attendance`, {
        attendance: session.attendance.map((a) => ({
          player_id: a.player_id,
          attended: !!a.attended,
          amount_paid: wipeSums ? 0 : a.amount_paid,
          amount_forgiven: wipeSums ? 0 : a.amount_forgiven,
        })),
      });
      const patch: Record<string, unknown> = { main_events: notes };
      if (status) patch.status = status;
      await api.put(`/sessions/${sessionId}`, patch);
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleNotHeld() {
    // Суммы при отмене не стираются молча — но и диалог не выводится там, где
    // терять нечего: спрашиваем, только когда что-то внесено.
    if (enteredSums) {
      setCancelChoice(true);
      return;
    }
    const ok = await confirm({
      title: "Игра не состоялась?",
      message: "Сессия останется в календаре с пометкой «отменена» и получит свой номер в счёте отменённых. В архив она не уйдёт.",
      confirmLabel: "Не состоялась",
      cancelLabel: "Назад",
      danger: true,
    });
    if (ok) await persist("cancelled");
  }

  const expected = expectedPerPlayer();

  return (
    <Modal onClose={onClose}>
      {dialog}
      {/* Ширину задаёт .modal:has(.session-outcome-modal) в index.css — так же,
          как это делают остальные широкие окна приложения. Базовый .modal
          прибит к 420 px, и четыре колонки таблицы в него не влезали. */}
      <div className="stack session-outcome-modal" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>
          {held ? "Оплата и итоги" : "Сессия состоялась?"}
          {session ? ` — ${session.date}` : ""}
        </h3>

        {loading && <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>Загрузка…</div>}

        {!loading && session && (
          <>
            {showMoney && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                Ожидается с игрока: {expected} {session.currency}
              </div>
            )}
            {perMonth && !hideFinance && session.effective_payment_type === "paid" && (
              <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                Оплата помесячная — суммы за отдельную игру здесь не считаются.
              </div>
            )}

            {session.attendance.length === 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                В составе кампании нет игроков.
              </div>
            )}

            {session.attendance.length > 0 && (
              <table className="session-attendance-table">
                <thead>
                  <tr>
                    <th>Игрок</th>
                    <th>
                      <label className="sp-check-head" title="Отметить/снять всех">
                        <input
                          type="checkbox"
                          checked={session.attendance.every((a) => !!a.attended)}
                          onChange={() => {
                            const all = session.attendance.every((a) => !!a.attended);
                            const next = session.attendance.map((a) => ({ ...a, attended: all ? 0 : 1 }));
                            setSession({ ...session, attendance: next });
                          }}
                        />
                        Пришёл
                      </label>
                    </th>
                    {showMoney && (
                      <th>
                        <button type="button" className="sp-head-btn" title="Проставить ставку всем" onClick={payAll}>
                          Оплачено · всем
                        </button>
                      </th>
                    )}
                    {showMoney && <th>Прощено</th>}
                  </tr>
                </thead>
                <tbody>
                  {session.attendance.map((a) => {
                    const owes = Math.round((expected - a.amount_paid - a.amount_forgiven) * 100) / 100;
                    return (
                      <tr key={a.player_id}>
                        <td data-label="Игрок">
                          {a.name}
                          {showMoney && owes > 0 && !!a.attended && (
                            <span className="badge tag" style={{ marginLeft: 6 }} title="Недоплата за эту игру">
                              должен {owes}
                            </span>
                          )}
                        </td>
                        <td data-label="Пришёл">
                          <input
                            type="checkbox"
                            checked={!!a.attended}
                            onChange={(e) => updateField(a.player_id, "attended", e.target.checked ? 1 : 0)}
                          />
                        </td>
                        {showMoney && (
                          <td data-label="Оплачено">
                            <input
                              type="number"
                              style={{ width: 84 }}
                              value={a.amount_paid || ""}
                              placeholder="0"
                              onChange={(e) => updateField(a.player_id, "amount_paid", Number(e.target.value) || 0)}
                            />
                            <button
                              type="button"
                              className="comp-mini"
                              style={{ marginLeft: 4 }}
                              title={`Проставить ставку ${expected}`}
                              onClick={() => updateField(a.player_id, "amount_paid", expected)}
                            >
                              ставка
                            </button>
                          </td>
                        )}
                        {showMoney && (
                          <td data-label="Прощено">
                            {/* Кнопка — для «с Пети не берём» в один клик; поле рядом,
                                потому что списание задним числом приходится править,
                                а без поля его можно было бы только отменить целиком. */}
                            <input
                              type="number"
                              style={{ width: 84 }}
                              value={a.amount_forgiven || ""}
                              placeholder="0"
                              onChange={(e) => updateField(a.player_id, "amount_forgiven", Number(e.target.value) || 0)}
                            />
                            <button
                              type="button"
                              className="comp-mini"
                              style={{ marginLeft: 4 }}
                              title="Списать всю недоплату за эту игру"
                              onClick={() => forgiveRest(a.player_id)}
                            >
                              остаток
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <label className="stack editable-card-field">
              <span>Главные события</span>
              <textarea
                rows={4}
                value={notes}
                placeholder="Что случилось на игре — попадёт в хронику кампании"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {cancelChoice && (
              <div className="card stack" style={{ gap: 8, borderLeft: "1px solid var(--line)" }}>
                <strong>В сессии уже есть внесённые суммы</strong>
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                  Отменённая игра в «заработано» не идёт в любом случае — статус не held. Суммы можно оставить: если вернёте «состоялась», они будут на месте.
                </span>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="danger" disabled={saving} onClick={() => persist("cancelled")}>
                    Отменить, суммы оставить
                  </button>
                  <button disabled={saving} onClick={() => persist("cancelled", true)}>
                    Отменить и обнулить
                  </button>
                  <button disabled={saving} onClick={() => setCancelChoice(false)}>Назад</button>
                </div>
              </div>
            )}
          </>
        )}

        {!cancelChoice && (
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onClose} disabled={saving}>Отмена</button>
            {!held && (
              <button className="danger" disabled={loading || !session || saving} onClick={handleNotHeld}>
                Не состоялась
              </button>
            )}
            <button
              className="primary"
              disabled={loading || !session || saving}
              onClick={() => persist(held ? null : "held")}
            >
              {held ? "Сохранить" : "Состоялась"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
