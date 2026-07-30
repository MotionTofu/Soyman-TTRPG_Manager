import type { ReactNode } from "react";
import { ParticleField } from "./ParticleField";

// Wraps a page's top-level <h1> with a small thematic particle field (see
// ParticleField) — used on the main section list pages (Кампании, Сеттинги,
// Системы, etc.), not on entity detail pages.
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="section-heading">
      <ParticleField count={6} />
      <h1>{children}</h1>
    </div>
  );
}
