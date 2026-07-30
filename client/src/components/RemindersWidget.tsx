import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { GmReminder } from "../types";

interface Props {
  targetType: "player" | "campaign";
  targetId: number;
}

// Напоминание — shown on the player's Главная in player-app. Lifecycle is
// entirely GM-controlled here: deleting it removes it for everyone, that's
// the only dismiss mechanism (see gm_reminders in schema.sql).
export function RemindersWidget({ targetType, targetId }: Props) {
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
    await api.del(`${basePath}/${reminderId}`);
    refresh();
  }

  return (
    <div className="card stack">
      <h3>Напоминания игроку{targetType === "campaign" ? "ам кампании" : ""}</h3>
      {reminders.length === 0 && <span className="muted">Нет активных напоминаний.</span>}
      {reminders.map((r) => (
        <div key={r.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <span style={{ whiteSpace: "pre-wrap" }}>{r.message}</span>
          <button onClick={() => remove(r.id)}>✕</button>
        </div>
      ))}
      <div className="row">
        <input
          placeholder="Новое напоминание…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary" onClick={add}>
          Добавить
        </button>
      </div>
    </div>
  );
}
