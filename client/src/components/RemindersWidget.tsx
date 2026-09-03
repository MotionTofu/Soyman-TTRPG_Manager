import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { GmReminder } from "../types";
import { useConfirm } from "../hooks/useConfirm";

interface Props {
  targetType: "player" | "campaign";
  targetId: number;
}

// Напоминание — shown on the player's Главная in player-app. Lifecycle is
// entirely GM-controlled here: deleting it removes it for everyone, that's
// the only dismiss mechanism (see gm_reminders in schema.sql).
export function RemindersWidget({ targetType, targetId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [reminders, setReminders] = useState<GmReminder[]>([]);
  const [draft, setDraft] = useState("");
  const basePath = targetType === "player" ? `/players/${targetId}/reminders` : `/campaigns/${targetId}/reminders`;

  function refresh() {
    api.get<GmReminder[]>(basePath).then(setReminders);
  }
  useEffect(refresh, [targetType, targetId]);

  async function add() {
    if (!draft.trim()) return;
    await api.post(basePath, { message: draft.trim() });
    setDraft("");
    refresh();
  }

  async function remove(reminderId: number) {
    if (!(await confirm({ message: "Удалить напоминание?", confirmLabel: "Удалить", danger: true })))
      return;
    await api.del(`${basePath}/${reminderId}`);
    refresh();
  }

  return (
    <div className="card stack">
      {confirmDialog}
      {reminders.length === 0 ? (
        <div className="card" style={{ padding: "12px" }}>
          <p className="muted" style={{ margin: 0 }}>Нет активных напоминаний — напишите первое, оно появится у игроков на&nbsp;Главной.</p>
        </div>
      ) : (
        reminders.map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
            <span style={{ whiteSpace: "pre-wrap", maxWidth: "62ch" }}>{r.message}</span>
            <button className="danger comp-mini" onClick={() => remove(r.id)} aria-label="Удалить">✕</button>
          </div>
        ))
      )}
      <div className="row">
        <input
          placeholder="Новое напоминание…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button className="primary" onClick={add} disabled={!draft.trim()}>
          Добавить
        </button>
      </div>
    </div>
  );
}
