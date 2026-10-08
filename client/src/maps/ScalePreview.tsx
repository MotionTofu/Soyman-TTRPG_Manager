import { formatMeters } from "./mapTypes";

/** Знакомые вещи и их поперечник в метрах: по ним видно, что помещается в клетку. */
const LADDER: [string, number][] = [
  ["человек", 0.6], ["стол", 2], ["телега", 4], ["дом", 10], ["двор", 25], ["усадьба", 60], ["хутор", 150], ["деревня", 400],
  ["городок", 1200], ["город", 3000], ["столица", 8000], ["долина", 20_000], ["большое озеро", 50_000], ["графство", 120_000],
  ["горный хребет", 300_000], ["королевство", 700_000], ["море", 1_500_000], ["материк", 4_000_000],
];
const COLS = 10, ROWS = 4, CELL = 34;
/** Пеший день пути, км. */
const DAY = 30;

/** Сколько вещей из лесенки помещается в окне предпросмотра при такой клетке. */
export function scaleMarks(metres: number): { name: string; cells: number }[] {
  return LADDER.map(([name, size]) => ({ name, cells: size / metres })).filter((item) => item.cells >= 0.3 && item.cells <= ROWS);
}

/** Предпросмотр масштаба при создании карты: кусок сетки и знакомые вещи в настоящем размере,
 * вложенные друг в друга от общего угла. Меняется клетка — меняется то, что в неё влезает. */
export function ScalePreview({ metres, width, height }: { metres: number; width: number; height: number }) {
  if (!(metres > 0)) return null;
  const marks = scaleMarks(metres), w = COLS * CELL, h = ROWS * CELL;
  const across = Math.max(width, height) * metres, days = across / 1000 / DAY;
  return <figure style={{ margin: 0 }}>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`В клетке ${formatMeters(metres)}: ${marks.map((item) => item.name).join(", ") || "ничего знакомого"}`}
      style={{ display: "block", width: "100%", border: "2px solid currentColor", background: "var(--paper, #f4efe2)" }}>
      {Array.from({ length: COLS - 1 }, (_, i) => <line key={`x${i}`} x1={(i + 1) * CELL} y1={0} x2={(i + 1) * CELL} y2={h} stroke="currentColor" strokeOpacity={0.18} />)}
      {Array.from({ length: ROWS - 1 }, (_, i) => <line key={`y${i}`} x1={0} y1={(i + 1) * CELL} x2={w} y2={(i + 1) * CELL} stroke="currentColor" strokeOpacity={0.18} />)}
      {[...marks].reverse().map((item) => { const side = item.cells * CELL; return <g key={item.name}>
        <rect x={0} y={h - side} width={side} height={side} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth={1.5} />
        <text x={side + 5} y={Math.min(h - 3, h - side + 11)} fontSize={11} fontWeight={600} fill="currentColor">{item.name}</text>
      </g>; })}
    </svg>
    <figcaption className="muted">
      1 клетка = {formatMeters(metres)} · вся карта {formatMeters(width * metres)} × {formatMeters(height * metres)}
      {days >= 0.2 && ` · пешком из края в край ≈ ${days < 1.5 ? "день" : `${Math.round(days)} дн.`}`}
    </figcaption>
  </figure>;
}
