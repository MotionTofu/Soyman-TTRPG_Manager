import { useState } from "react";
import { Modal } from "./Modal";
import { HpCalcPad } from "./HpCalcPad";
import type { VesselHp } from "../data/campaignVessels";

// Калькулятор хитов корпуса или поста (спека profiles-paper-2, «Корабль
// кампании»; доска 40): пад как у персонажа, без временных хитов. Урон
// меньше порога не проходит — окно так и говорит, хиты не трогает.
export function VesselHpModal({
  title,
  hp,
  onSet,
  onClose,
}: {
  title: string;
  hp: VesselHp;
  /** Новые текущие хиты; окно ждёт записи, чтобы показать итог. */
  onSet: (next: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [last, setLast] = useState<{ before: number; text: string } | null>(null);
  const max = hp.max ?? 0;
  const cur = hp.hp ?? max;
  const down = max > 0 && cur <= 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;

  async function apply(next: number, text: string) {
    if (await onSet(next)) setLast({ before: cur, text });
    setAmount("");
  }

  function damage() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    if (hp.threshold != null && n < hp.threshold) {
      setNote(`${n} меньше порога ${hp.threshold} — не прошло`);
      setAmount("");
      return;
    }
    setNote(null);
    const next = Math.max(0, cur - n);
    void apply(next, `−${n} · ${cur} → ${next}`);
  }

  function heal() {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    setNote(null);
    const next = max > 0 ? Math.min(max, cur + n) : cur + n;
    void apply(next, `+${n} · ${cur} → ${next}`);
  }

  async function undo() {
    if (!last) return;
    if (await onSet(last.before)) setLast(null);
  }

  return (
    <Modal onClose={onClose} ariaLabel={`Хиты: ${title}`} autoFocus={false}>
      <div className="dnd-hp-modal">
        <div className="dnd-hp-plate">
          <span className="dnd-hp-plate-title">Хиты · {title}</span>
          <button type="button" className="dnd-hp-close" aria-label="Закрыть" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="dnd-hp-state">
          <div className="dnd-hp-readout">
            <span className={down ? "dnd-hp-cur is-down" : "dnd-hp-cur"}>{cur}</span>
            <span className="dnd-hp-max">/ {hp.max ?? "—"}</span>
            {hp.threshold != null && <span className="dnd-hp-temp-chip">порог {hp.threshold}</span>}
          </div>
          <div className="dnd-hp-bar">
            {/* инлайн-стиль намеренно — доля хитов */}
            <div className="dnd-hp-bar-cur" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {note && (
          <div className="dnd-hp-undo" role="status">
            <span className="dnd-hp-undo-text">{note}</span>
          </div>
        )}

        {last && (
          <div className="dnd-hp-undo">
            <span className="dnd-hp-undo-text">{last.text}</span>
            <button type="button" onClick={() => void undo()}>
              Отменить
            </button>
          </div>
        )}

        {down && <div className="dnd-hp-down">Выведен из строя. Лечение (починка) возвращает в строй.</div>}

        <HpCalcPad amount={amount} onAmount={setAmount} onDamage={damage} onHeal={heal} />
      </div>
    </Modal>
  );
}
