// Пад калькулятора хитов: «Сколько», цифры и две кнопки «Урон» / «Лечение».
// Вынесен из окна хитов листа D&D (SheetVitals, HpEditModal), чтобы корабль
// кампании считал так же (спека profiles-paper-2, «Корабль кампании»).
// Стили — `.dnd-hp-*` в dnd-sheet.css.

const HP_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function HpBackspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9 5h11v14H9L3 12z" />
      <path d="M13 9.5l5 5M18 9.5l-5 5" />
    </svg>
  );
}

// Пад вместо клавиатуры: на телефоне системная клавиатура закрывала
// половину окна, включая кнопки «Урон» и «Лечение», ради которых его и
// открывали. Три цифры — потолок в 999, больше одним ударом не наносят.
export function HpCalcPad({
  amount,
  onAmount,
  onDamage,
  onHeal,
}: {
  amount: string;
  onAmount: (next: string) => void;
  onDamage: () => void;
  onHeal: () => void;
}) {
  function pressKey(d: number) {
    const next = (amount + String(d)).replace(/^0+(?=\d)/, "");
    if (next.length <= 3) onAmount(next);
  }
  return (
    <div className="dnd-hp-apply">
      <div className="dnd-hp-amount">
        <span className="dnd-hp-caps">Сколько</span>
        <span className={amount === "" ? "dnd-hp-amount-value is-empty" : "dnd-hp-amount-value"}>
          {amount === "" ? "0" : amount}
        </span>
      </div>
      <div className="dnd-hp-pad">
        {HP_KEYS.map((d) => (
          <button type="button" key={d} className="dnd-hp-key" onClick={() => pressKey(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="dnd-hp-key is-aux" aria-label="Стереть цифру" onClick={() => onAmount(amount.slice(0, -1))}>
          <HpBackspaceIcon />
        </button>
        <button type="button" className="dnd-hp-key" onClick={() => pressKey(0)}>
          0
        </button>
        <button type="button" className="dnd-hp-key is-aux is-word" onClick={() => onAmount("")}>
          Сброс
        </button>
      </div>
      <div className="dnd-hp-actions">
        <button type="button" className="danger" onClick={onDamage} disabled={!Number(amount)}>
          Урон
        </button>
        <button type="button" className="primary" onClick={onHeal} disabled={!Number(amount)}>
          Лечение
        </button>
      </div>
    </div>
  );
}
