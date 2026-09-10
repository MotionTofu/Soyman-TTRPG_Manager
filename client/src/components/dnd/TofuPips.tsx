import { NavIcon } from "../NavIcons";

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

// Порог, за которым головы перестают работать: считать их глазом можно до
// десятка, а двадцать три головы шире самой ленты — за край уезжают число и
// условие восстановления, то есть ровно то, ради чего лента и всплывает.
// Порог выводится из максимума, настраивать его негде и незачем.
const POOL_PIPS_MAX = 10;

/** Показывает ли пул с таким максимумом остаток числом — тогда соседний
 *  «N из M» рядом с ним лишний. */
export function poolShowsNumber(max: number): boolean {
  return max > POOL_PIPS_MAX;
}

/** Засечки на шкале: по пять, а когда делений набирается больше восьми —
 *  по десять, иначе шкала рябит. */
function scaleTicks(max: number): number[] {
  const step = max / 5 > 8 ? 10 : 5;
  const out: number[] = [];
  for (let v = step; v < max; v += step) out.push((v / max) * 100);
  return out;
}

/**
 * Пул с большим максимумом: остаток крупным числом (единственное, что
 * читается с метра), максимум рядом мелко, шкала с засечками — «чуть меньше
 * трёх четвертей» видно, не считая. Минус и плюс вместо клика по голове:
 * основная трата и так идёт из строки действия, здесь остаётся поправка.
 */
export function PoolMeter({
  max,
  left,
  label,
  onSetLeft,
}: {
  max: number;
  left: number;
  label: string;
  onSetLeft?: (left: number) => void;
}) {
  if (max <= POOL_PIPS_MAX) {
    return <TofuPips max={max} left={left} label={label} onSetLeft={onSetLeft} />;
  }
  const shown = Math.max(0, Math.min(left, max));
  return (
    <span className="dnd-pool-meter" role="group" aria-label={`${label}: осталось ${shown} из ${max}`}>
      <button
        type="button"
        className="dnd-pool-step"
        disabled={!onSetLeft || shown <= 0}
        aria-label={`${label}: потратить одно`}
        onClick={() => onSetLeft?.(shown - 1)}
      >
        <NavIcon name="minus" />
      </button>
      <span className="dnd-pool-meter-num">
        <span className="dnd-pool-meter-left">{shown}</span>
        <span className="dnd-pool-meter-max">/{max}</span>
      </span>
      <button
        type="button"
        className="dnd-pool-step"
        disabled={!onSetLeft || shown >= max}
        aria-label={`${label}: вернуть одно`}
        onClick={() => onSetLeft?.(shown + 1)}
      >
        <NavIcon name="plus" />
      </button>
      <span className="dnd-pool-scale" aria-hidden="true">
        <span className="dnd-pool-scale-track" />
        <span className="dnd-pool-scale-fill" style={{ width: `${(shown / max) * 100}%` }} />
        {scaleTicks(max).map((pos) => (
          <span key={pos} className="dnd-pool-tick" style={{ left: `${pos}%` }} />
        ))}
      </span>
    </span>
  );
}
