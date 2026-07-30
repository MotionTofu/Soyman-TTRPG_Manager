interface Props {
  value: number;
  max: number;
  onChange?: (value: number) => void;
  size?: number;
}

// A small clickable dot-track for Might / Improve style ratings.
// Clicking a pip sets the value to it; clicking the currently-topmost
// filled pip again clears it, so users can back a rating off.
export function PipTrack({ value, max, onChange, size = 16 }: Props) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          onClick={onChange ? () => onChange(value === n ? n - 1 : n) : undefined}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            display: "inline-block",
            cursor: onChange ? "pointer" : "default",
            background: n <= value ? "var(--accent)" : "var(--bg-elevated)",
            border: "1px solid var(--border)",
          }}
        />
      ))}
    </span>
  );
}
