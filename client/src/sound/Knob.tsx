import { useRef, useState } from "react";

// Круглый регулятор громкости со стопом канала в середине.
//
// Значение берётся из УГЛА курсора относительно центра, а не из вертикального
// хода мыши: ручку действительно крутят, и стрелка стоит ровно там, куда
// тянут. Дуга — 270° от семи часов по часовой; нижние 90° — мёртвая зона,
// которая липнет к ближнему краю, иначе ручка перескакивала бы через ноль.
//
// Два органа управления, а не один жест с распознаванием: внешнее кольцо с
// делениями крутит громкость, внутренний круг — кнопка стопа. Разводить их
// порогом в несколько пикселей незачем — они и так разведены глазами, а у
// центра к тому же нет угла: atan2(0,0) даёт 0°, то есть щелчок ровно в
// середину раньше выкручивал канал на 83%.

const SWEEP = 270;
const START = 135;
const TICKS: [number, number, number, number][] = [
  [11.85, 52.15, 10.08, 53.92],
  [4.89, 40.81, 2.52, 41.58],
  [3.85, 27.54, 1.38, 27.15],
  [8.94, 15.25, 6.92, 13.78],
  [19.06, 6.61, 17.93, 4.38],
  [32, 3.5, 32, 1],
  [44.94, 6.61, 46.07, 4.38],
  [55.06, 15.25, 57.08, 13.78],
  [60.15, 27.54, 62.62, 27.15],
  [59.11, 40.81, 61.48, 41.58],
  [52.15, 52.15, 53.92, 53.92],
];

export function Knob({
  value,
  onChange,
  label = "Громкость",
  size = 160,
  stopped = false,
  onStop,
  stopDisabled = false,
  stopLabel = "Остановить канал",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  size?: number;
  /** Канал выключен вручную: в центре знак «играть», кольцо приглушено. */
  stopped?: boolean;
  onStop?: () => void;
  /** Останавливать нечего (стингер молчит) — знак виден, но не нажимается. */
  stopDisabled?: boolean;
  stopLabel?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const v = Math.max(0, Math.min(1, value));
  const angle = ((START + SWEEP * v) * Math.PI) / 180;
  const at = (r: number, fn: (n: number) => number) => Math.round((32 + r * fn(angle)) * 10) / 10;

  function valueFromPointer(clientX: number, clientY: number): number {
    const box = boxRef.current;
    if (!box) return v;
    const rect = box.getBoundingClientRect();
    const deg =
      (Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2)) *
        180) /
      Math.PI;
    const a = (deg + 360) % 360;
    let t = (a - START + 360) % 360;
    if (t > SWEEP) t = t < SWEEP + 45 ? SWEEP : 0;
    return t / SWEEP;
  }

  function start(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
    onChange(valueFromPointer(e.clientX, e.clientY));
    const move = (ev: PointerEvent) => onChange(valueFromPointer(ev.clientX, ev.clientY));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const stopSize = Math.round((size * 19 * 2) / 64);
  // Знак занимает треть внутреннего круга: он должен читаться боковым зрением
  // с расстояния вытянутой руки, а не рассматриваться.
  const glyphSize = Math.round(stopSize * 0.8);

  return (
    <div className="sc-knob-row">
      <div
        ref={boxRef}
        className={["sc-knob", dragging ? "dragging" : "", stopped ? "stopped" : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ width: size, height: size }}
        onPointerDown={start}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        tabIndex={0}
      >
        <svg width={size} height={size} viewBox="0 0 64 64">
          {TICKS.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth={1.1}
              strokeLinecap="round"
              opacity={0.32}
            />
          ))}
          <circle
            cx="32"
            cy="32"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeDasharray="113.1 150.8"
            opacity={0.13}
            transform="rotate(135 32 32)"
          />
          <circle
            cx="32"
            cy="32"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeDasharray={`${Math.round(113.1 * v * 10) / 10} 150.8`}
            opacity={0.85}
            transform="rotate(135 32 32)"
          />
          <circle cx="32" cy="32" r="19" fill="rgba(0,0,0,.28)" stroke="currentColor" strokeWidth={1} opacity={0.7} />
          <line
            x1={at(9, Math.cos)}
            y1={at(9, Math.sin)}
            x2={at(23, Math.cos)}
            y2={at(23, Math.sin)}
            stroke="currentColor"
            strokeWidth={3.2}
            strokeLinecap="round"
          />
        </svg>
        {onStop ? (
          <button
            type="button"
            className="sc-knob-stop"
            style={{ width: stopSize, height: stopSize }}
            title={stopLabel}
            aria-label={stopLabel}
            disabled={stopDisabled}
            // Нажатие на кнопку не должно доходить до кольца: иначе стоп
            // заодно присваивал бы громкость по углу.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
          >
            <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} aria-hidden="true">
              {stopped ? (
                <path d="M9 6.5 18 12l-9 5.5V6.5Z" fill="currentColor" />
              ) : (
                <rect x="8" y="8" width="8" height="8" fill="currentColor" />
              )}
            </svg>
          </button>
        ) : (
          <svg width={size} height={size} viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="4.6" fill="currentColor" opacity={0.16} />
          </svg>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="sc-label">{label}</span>
        <span className="sc-knob-value">{Math.round(v * 100)}%</span>
      </div>
    </div>
  );
}
