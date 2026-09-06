// Пипсы пулов — головы тофу (структурность): ресурс есть — голову видно,
// потратили — тофу «съеден», окошко блеклое. Слепок маскота под 18px, а не
// весь SoyMan: детали в таком размере слипнутся, остаются куб, контур
// и глаза. Цвета — канон (§12: контур тёмный, §23: тофу светлый),
// а не тема: пипс обязан читаться и на чёрной ленте, и на светлой бумаге.

export function TofuPips({
  max,
  left,
  label,
  onSetLeft,
}: {
  max: number;
  /** Осталось — целых голов. */
  left: number;
  label: string;
  /** Клик по i-й голове ставит остаток i+1; клик по крайней целой (как у
   *  PipTrack) — снимает её, иначе последнее тофу несъедаемо. */
  onSetLeft?: (left: number) => void;
}) {
  return (
    <span className="dnd-tofu-pips" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => {
        const full = i < left;
        return (
          <button
            key={i}
            type="button"
            className={`dnd-tofu-pip${full ? " is-full" : ""}`}
            aria-label={`${label}: осталось ${i + 1}`}
            aria-pressed={full}
            disabled={!onSetLeft}
            onClick={() => onSetLeft?.(i + 1 === left ? i : i + 1)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              {full ? (
                <>
                  <rect x="1.5" y="1.5" width="15" height="15" className="dnd-tofu-body" />
                  <circle cx="6.5" cy="8" r="2.2" className="dnd-tofu-eye" />
                  <circle cx="11.5" cy="8" r="2.2" className="dnd-tofu-eye" />
                </>
              ) : (
                <rect x="1.5" y="1.5" width="15" height="15" className="dnd-tofu-empty" />
              )}
            </svg>
          </button>
        );
      })}
    </span>
  );
}
