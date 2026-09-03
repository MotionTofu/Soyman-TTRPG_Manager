interface Props {
  value: number;
  max: number;
  onChange?: (value: number) => void;
  size?: number;
  // Что именно считает дорожка — «Ячейки 3 круга», «Кости хитов», «Might».
  // Уходит в aria-label каждой пипки: без него скринридер читает подряд
  // десяток безымянных кнопок и не говорит, к чему они относятся.
  label?: string;
}

// A small clickable dot-track for Might / Improve style ratings.
// Clicking a pip sets the value to it; clicking the currently-topmost
// filled pip again clears it, so users can back a rating off.
//
// Пипка — кнопка, а не `<span onClick>`: до этого дорожка не бралась
// табом и не читалась вслух вовсе. Когда `onChange` нет, дорожка только
// показывает значение — тогда это обычные точки, и в фокус им не нужно.
export function PipTrack({ value, max, onChange, size = 16, label }: Props) {
  const pips = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <span
      className="row"
      style={{ gap: 3 }}
      role={onChange ? "group" : undefined}
      aria-label={onChange ? label : undefined}
    >
      {pips.map((n) => {
        const filled = n <= value;
        const dot = {
          width: size,
          height: size,
          borderRadius: "50%",
          display: "inline-block",
          background: filled ? "var(--accent)" : "var(--bg-elevated)",
          border: "1px solid var(--line)",
        } as const;
        if (!onChange) return <span key={n} style={dot} />;
        return (
          <button
            key={n}
            type="button"
            aria-label={label ? `${label}: ${n} из ${max}` : `${n} из ${max}`}
            aria-pressed={filled}
            onClick={() => onChange(value === n ? n - 1 : n)}
            style={{ ...dot, padding: 0, margin: 0, cursor: "pointer" }}
          />
        );
      })}
    </span>
  );
}
