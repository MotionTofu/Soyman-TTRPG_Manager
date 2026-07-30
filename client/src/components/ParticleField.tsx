import { useState } from "react";

// Small decorative field of slowly, randomly drifting dots — colored by the
// active theme's --accent (so it reads as "thematic" per theme with zero
// extra theme config), used behind the nav logo, section headings, and the
// search panel title. Positions/timings are randomized once per mount (not
// per render, and independently per instance) and animated with pure CSS
// transforms/opacity, so this is cheap: no JS runs after mount besides
// React's one-time render.
interface Particle {
  key: number;
  left: number;
  top: number;
  size: number;
  dur: number;
  delay: number;
  dx: number;
  dy: number;
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    left: Math.round(5 + Math.random() * 90),
    top: Math.round(5 + Math.random() * 90),
    size: Number((2 + Math.random() * 2.5).toFixed(1)),
    dur: Number((12 + Math.random() * 12).toFixed(1)),
    delay: Number((Math.random() * -20).toFixed(1)),
    dx: Math.round(-35 + Math.random() * 70),
    dy: Math.round(-35 + Math.random() * 70),
  }));
}

interface Props {
  count?: number;
  className?: string;
}

export function ParticleField({ count = 8, className = "" }: Props) {
  // Lazy initializer runs exactly once per component instance (mount), not
  // on every render — equivalent to useMemo(() => ..., []) but without an
  // unused setter warning.
  const [particles] = useState(() => generateParticles(count));
  return (
    <div className={`particle-field ${className}`} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.key}
          className="particle-field-dot"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
