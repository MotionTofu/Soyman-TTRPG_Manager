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
}

// Wraps a page's top-level <h1> with a small thematic particle field (see
// ParticleField) — used on the main section list pages (Кампании, Сеттинги,
// Системы, etc.), not on entity detail pages. Also doubles, via `level:
// "section"`, as the shared "icon, caps-header, все →" pattern for
// sub-sections within a page.
export function SectionHeading({ children, level = "page", icon, action }: SectionHeadingProps) {
  if (level === "section") {
    return (
      <div className="section-heading section-heading-sub">
        <h2 className="section-heading-sub-title">
          {icon && <NavIcon name={icon} className="section-heading-sub-icon" />}
          {children}
        </h2>
        {action && (
          <Link to={action.to} className="section-heading-sub-action">
            {action.label} →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="section-heading">
      <ParticleField count={6} />
      <h1 className="zine-marker-underline">{children}</h1>
    </div>
  );
}
