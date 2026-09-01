import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ParticleField } from "./ParticleField";
import { NavIcon, type NavIconName } from "./NavIcons";

interface SectionHeadingAction {
  label: string;
  to: string;
}

interface SectionHeadingProps {
  children: ReactNode;
  /** "page" (default) is the existing top-of-page <h1> + particle field
   *  treatment. "section" is the compact icon + caps-header + optional
   *  "все →" link pattern used for sub-sections within a page (tile rows,
   *  dense lists, rail widgets) — see design doc §11.6 / ticket 14. */
  level?: "page" | "section";
  /** NavIcons name shown before the title — "section" level only. */
  icon?: NavIconName;
  /** Renders a right-aligned "label →" link — "section" level only. */
  action?: SectionHeadingAction;
  /** Right-aligned custom node (e.g. clock) — "section" level only, renders before/after action. */
  right?: ReactNode;
  /** Which nav destination this page-level heading belongs to (matches the
   *  left-nav icon names) — "page" level only. Lets per-theme CSS (e.g. the
   *  Neon theme) color each section's <h1> without hardcoding routes into
   *  the theme system. See index.css's `[data-theme-id="neon"]
   *  .section-heading h1[data-section=...]` rules. */
  section?: NavIconName;
  /** Compact page heading — keeps h1 but reduces particle count and vertical
   *  padding. Used to reclaim space without removing the landmark heading.
   *  Rollback: remove prop → default 6 particles + normal margins restored. */
  compact?: boolean;
}

// Wraps a page's top-level <h1> with a small thematic particle field (see
// ParticleField) — used on the main section list pages (Кампании, Сеттинги,
// Системы, etc.), not on entity detail pages. Also doubles, via `level:
// "section"`, as the shared "icon, caps-header, все →" pattern for
// sub-sections within a page.
export function SectionHeading({ children, level = "page", icon, action, right, section, compact }: SectionHeadingProps) {
  if (level === "section") {
    return (
      <div className={`section-heading section-heading-sub${compact ? " section-heading--compact" : ""}`}>
        <h2 className="section-heading-sub-title">
          {icon && <NavIcon name={icon} className="section-heading-sub-icon" />}
          {children}
        </h2>
        {(right || action) && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: "auto" }}>
            {right}
            {action && (
              <Link to={action.to} className="section-heading-sub-action">
                {action.label} →
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`section-heading${compact ? " section-heading--compact" : ""}`}>
      <ParticleField count={compact ? 2 : 3} />
      <h1 className="zine-marker-underline" data-section={section}>{children}</h1>
    </div>
  );
}
