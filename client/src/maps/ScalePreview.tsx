import { formatMeters } from "./mapTypes";

/** Знакомые вещи и их поперечник в метрах: по ним видно, что помещается в клетку.
 * Существа — по месту, которое они занимают в бою: человек — клетку 1,5 м, лошадь — две. */
const LADDER: [string, number][] = [
  ["человек", 1.5], ["лошадь", 3], ["телега", 4.5], ["дом", 10], ["двор", 20], ["храм", 40], ["усадьба", 60], ["хутор", 150], ["деревня", 400],
  ["городок", 2000], ["город", 4000], ["столица", 8000], ["долина", 20_000], ["большое озеро", 50_000], ["графство", 100_000],
  ["горный хребет", 300_000], ["королевство", 500_000], ["море", 1_500_000], ["материк", 4_000_000],
];
const COLS = 10, ROWS = 4, CELL = 34;
/** Пеший день пути, км. */
const DAY = 30;

/** Вещи из лесенки не мельче клетки: клетка — единица измерения, и у каждой заготовки есть вещь ровно в клетку. */
export function scaleMarks(metres: number): { name: string; cells: number }[] {
  return LADDER.map(([name, size]) => ({ name, cells: size / metres })).filter((item) => item.cells >= 1 && item.cells <= ROWS);
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
      <rect x={0} y={h - CELL} width={CELL} height={CELL} fill="none" stroke="currentColor" strokeWidth={3} />
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
