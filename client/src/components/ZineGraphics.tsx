// Small set of hand-drawn, abstract zine-punk decorative marks — the
// mascot/marker vocabulary called for by docs/design-system-punk-zine.md
// §5.6 ("Зинные маркеры": штрихкод, "ISSUE 888", крестики-звёздочки-анархия)
// and §6.5 (die silhouettes). Same conventions as NavIcons.tsx: currentColor
// stroke/fill, no external assets, so they recolor for free with theme
// tokens and never count as "generated/photographic imagery" — they are
// abstract line art, not depictions of the user's actual campaigns/characters.
//
// These are decorative marks for empty states and margins, not a second
// icon system — reach for NavIcons for anything functional/navigational.
import type { SVGProps } from "react";

export type ZineGraphicName = "skullDie" | "anarchyStar" | "splatter" | "barcode" | "issueStamp";

const SHARED: SVGProps<SVGSVGElement> = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/** Skull-and-crossbone motif over a d20-ish hexagon — the "roll of the dice
 * is fatal" joke, doubling as the mascot referenced in the design doc §1
 * ("один крупный маскот... Череп"). */
function SkullDie(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 96 96" {...SHARED} strokeWidth={2.5} {...props}>
      {/* hexagon die silhouette */}
      <path d="M48 4 86 25v46L48 92 10 71V25Z" />
      <path d="M10 25 48 46l38-21M48 46v46" opacity={0.5} />
      {/* skull */}
      <path d="M48 30c-9 0-15 6.5-15 15 0 6 3 9.5 6 12v6h5v-4h3v4h2v-4h3v4h5v-6c3-2.5 6-6 6-12 0-8.5-6-15-15-15Z" />
      <circle cx="42" cy="46" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="54" cy="46" r="3.2" fill="currentColor" stroke="none" />
      <path d="M46 52h4l-2 3Z" fill="currentColor" stroke="none" />
      {/* crossbones */}
      <path d="M20 78 40 66M20 66l20 12" strokeWidth={3} />
      <circle cx="19" cy="65" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="79" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="41" cy="65" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="41" cy="79" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Circled anarchy star / chaos-mark — a rough hand-inked seven-point burst,
 * used as a small margin marker rather than a filled logo. */
function AnarchyStar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" {...SHARED} strokeWidth={2.4} {...props}>
      <circle cx="32" cy="32" r="27" />
      <path
        d="M32 8 36 26 53 15 41 31 60 34 41 37 53 53 36 38 32 56 28 38 11 53 23 37 4 34 23 31 11 15 28 26Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ink-splatter / spray shape — irregular blobs, the "noise layer" texture
 * mark from §5, drawn as a standalone graphic rather than a background tile. */
function Splatter(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 96 72" {...SHARED} fill="currentColor" stroke="none" {...props}>
      <path d="M34 6c9-4 20-2 26 5 7 8 5 18-3 23 8 1 14 8 12 16-2 9-13 13-22 9-2 6-9 10-16 8-6-2-9-8-8-14-8 2-16-3-17-11-1-7 4-13 11-14-6-4-8-12-3-18 4-6 12-7 20-4Z" />
      <circle cx="82" cy="14" r="4" />
      <circle cx="88" cy="26" r="2.4" />
      <circle cx="10" cy="52" r="3.2" />
      <circle cx="4" cy="40" r="2" />
    </svg>
  );
}

/** Barcode strip — §5.6's "штрихкод" marker, a fixed pseudo-random bar
 * pattern (not decorative-only — reads as a genuine barcode silhouette). */
function Barcode(props: SVGProps<SVGSVGElement>) {
  const widths = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 1, 3, 2, 1, 4, 1, 2, 2, 1, 3, 1, 2];
  let x = 0;
  const bars = widths.map((w, i) => {
    const bar = <rect key={i} x={x} y={0} width={w} height={28} fill={i % 2 === 0 ? "currentColor" : "none"} />;
    x += w + 1;
    return bar;
  });
  return (
    <svg viewBox={`0 0 ${x} 34`} {...SHARED} stroke="none" {...props}>
      {bars}
    </svg>
  );
}

/** "ISSUE" number stamp/badge — a rough torn-circle stamp with a slot for a
 * caller-supplied number, echoing §5.6's "номер выпуска". */
function IssueStamp({ number = "01", ...props }: SVGProps<SVGSVGElement> & { number?: string }) {
  return (
    <svg viewBox="0 0 96 96" {...SHARED} strokeWidth={2} {...props}>
      <path d="M48 6c5 3 11 2 15 6s3 10 7 14 6 9 4 15 1 12-3 16-4 10-10 12-9 6-14 6-10-2-15-6-11-2-14-6-3-10-7-14-6-9-4-15-1-12 3-16 4-10 10-12 9-6 14-6Z" />
      <text
        x="48"
        y="52"
        textAnchor="middle"
        fontFamily="var(--font-display, sans-serif)"
        fontSize="20"
        fill="currentColor"
        stroke="none"
      >
        №{number}
      </text>
      <text
        x="48"
        y="68"
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="8"
        letterSpacing="0.14em"
        fill="currentColor"
        stroke="none"
      >
        ISSUE
      </text>
    </svg>
  );
}

export function ZineGraphic({
  name,
  className,
  issueNumber,
}: {
  name: ZineGraphicName;
  className?: string;
  /** Only used by "issueStamp". */
  issueNumber?: string;
}) {
  switch (name) {
    case "skullDie":
      return <SkullDie className={className} aria-hidden="true" />;
    case "anarchyStar":
      return <AnarchyStar className={className} aria-hidden="true" />;
    case "splatter":
      return <Splatter className={className} aria-hidden="true" />;
    case "barcode":
      return <Barcode className={className} aria-hidden="true" />;
    case "issueStamp":
      return <IssueStamp className={className} number={issueNumber} aria-hidden="true" />;
  }
}
