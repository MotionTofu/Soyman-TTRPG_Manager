import type { CSSProperties, ReactNode } from "react";

// Reusable "number lives on a die silhouette" component (design doc §6.5,
// ticket 12). Purely presentational — callers own click handling, flip
// state, etc. The silhouette is inline SVG (not a background-image) so it
// scales cleanly and its fill/stroke can be themed with currentColor/tokens.
export type DiceKind = "d20" | "d8" | "d6";
export type DiceState = "filled" | "outline" | "muted";
export type DiceSize = "sm" | "md";

export interface DiceProps {
  /** Main number/text, centered inside the die in the Display face. */
  value: ReactNode;
  /** Small secondary text under the value, still inside the silhouette
   *  (e.g. an ability modifier, or "спас" marking what the number means). */
  sub?: ReactNode;
  /** Micro-caps caption BELOW the die shape — never inside it. */
  label?: ReactNode;
  kind?: DiceKind;
  /** filled = active/used, outline = normal, muted = unavailable. Don't mix
   *  filled and outline dice within one row — see design doc §6.5. */
  state?: DiceState;
  size?: DiceSize;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onClick?: () => void;
}

// d20 -> hexagon with internal facet lines, d8 -> diamond, d6 -> square with
// a dot in each corner. All drawn on a shared 0..100 viewBox so they can
// share sizing/positioning CSS.
function DiceShape({ kind }: { kind: DiceKind }) {
  switch (kind) {
    case "d8":
      return <polygon className="dice-shape-outline" points="50,3 97,50 50,97 3,50" />;
    case "d6":
      return (
        <>
          <rect className="dice-shape-outline" x="8" y="8" width="84" height="84" />
          <circle className="dice-dot" cx="18" cy="18" r="3.5" />
          <circle className="dice-dot" cx="82" cy="18" r="3.5" />
          <circle className="dice-dot" cx="18" cy="82" r="3.5" />
          <circle className="dice-dot" cx="82" cy="82" r="3.5" />
        </>
      );
    case "d20":
    default:
      return (
        <>
          <polygon className="dice-shape-outline" points="50,3 93,26.5 93,73.5 50,97 7,73.5 7,26.5" />
          <path className="dice-shape-facet" d="M50,3 L50,97 M7,26.5 L93,73.5 M93,26.5 L7,73.5" />
        </>
      );
  }
}

export function Dice({
  value,
  sub,
  label,
  kind = "d20",
  state = "outline",
  size = "md",
  className,
  style,
  title,
  onClick,
}: DiceProps) {
  const classes = ["dice", `dice-${kind}`, `dice-${state}`, `dice-${size}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={style} onClick={onClick} title={title}>
      <div className="dice-shape-box">
        <svg viewBox="0 0 100 100" className="dice-shape" aria-hidden="true">
          <DiceShape kind={kind} />
        </svg>
        <div className="dice-content">
          <span className="dice-value">{value}</span>
          {sub != null && sub !== "" && <span className="dice-sub">{sub}</span>}
        </div>
      </div>
      {label != null && label !== "" && <span className="dice-label">{label}</span>}
    </div>
  );
}
