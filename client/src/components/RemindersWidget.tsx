import { useEffect, useState } from "react";
import type { GmReminder } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { useAction, useResource, write } from "../data/hooks";
import { remindersPath } from "../data/sessions";

interface Props {
  targetType: "player" | "campaign" | "character";
  targetId: number;
}

const NO_REMINDERS: GmReminder[] = [];

// Напоминание — shown on the player's Главная in player-app. Lifecycle is
// entirely GM-controlled here: deleting it removes it for everyone, that's
// the only dismiss mechanism (see gm_reminders in schema.sql).
// targetType = 'character' — послание персонажу: оно приходит на оборот его
// карты (этап 4), а не на Главную. Пишется из карточки персонажа, открытой
// из профиля игрока.
export function RemindersWidget({ targetType, targetId }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const basePath = remindersPath(targetType, targetId);
  // Список — из кэша слоя данных. Заявку игрока (метка, сглаз) сервер уже
  // положил в напоминалки, и живое событие перечитывает список само
  // (data/syncAffects.ts); здесь остаётся только подсветить новую.
  const reminders = useResource<GmReminder[]>(basePath).data ?? NO_REMINDERS;
  const run = useAction();
  const [draft, setDraft] = useState("");
  const [flashId, setFlashId] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { reminderId?: number } | undefined;
      if (detail?.reminderId != null) setFlashId(detail.reminderId);
    };
    window.addEventListener("hunter-mark", handler);
    return () => window.removeEventListener("hunter-mark", handler);
  }, []);
  const emptyHint =
    targetType === "character"
      ? "Нет посланий — напишите первое, оно придёт на оборот карты персонажа."
      : "Нет активных напоминаний — напишите первое, оно появится у игроков на Главной.";

  async function add() {
    const message = draft.trim();
    if (!message) return;
    const done = await run(
      async () => {
        await write.post(basePath, { message });
        return true;
      },
      // Без повтора: ответ мог потеряться после того, как напоминание уже
      // легло, и повтор завёл бы второе.
      { affects: [{ path: basePath }], retry: false }
    );
    if (done) setDraft("");
  }

  async function remove(reminderId: number) {
    if (!(await confirm({ message: "Удалить напоминание?", confirmLabel: "Удалить", danger: true })))
      return;
    if (flashId === reminderId) setFlashId(null);
    await run(() => write.del(`${basePath}/${reminderId}`), { affects: [{ path: basePath }] });
  }

  return (
    <div className="card stack">
      {confirmDialog}
      {reminders.length === 0 ? (
        <div className="card" style={{ padding: "12px" }}>
          <p className="muted" style={{ margin: 0 }}>{emptyHint}</p>
        </div>
      ) : (
        reminders.map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 6, ...(r.id === flashId ? { background: "var(--mark, #fff3bf)" } : {}) }}>
            <span style={{ whiteSpace: "pre-wrap", maxWidth: "62ch" }}>{r.message}</span>
            <button className="danger comp-mini" onClick={() => remove(r.id)} aria-label="Удалить">✕</button>
          </div>
        ))
      )}
      <div className="row">
        <input
          placeholder={targetType === "character" ? "Новое послание…" : "Новое напоминание…"}
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
