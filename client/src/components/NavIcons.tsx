// Small hand-drawn line-icon set for the sidebar nav. One consistent style
// (24x24 viewBox, currentColor stroke, no fill) so new icons are easy to add
// without importing an icon library.
import type { ReactNode, SVGProps } from "react";

export type NavIconName =
  | "home"
  | "campaigns"
  | "settings"
  | "systems"
  | "players"
  | "mastering"
  | "resources"
  | "graph"
  | "storages"
  | "appearance"
  | "archive"
  | "about"
  | "backup"
  | "invite"
  | "navUp"
  | "navDown"
  | "navBack"
  | "navPin"
  | "navCockpit";

const SHARED_PROPS: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const PATHS: Record<NavIconName, ReactNode> = {
  home: (
    <>
      <path d="M3.5 11.5 12 4l8.5 7.5" />
      <path d="M5.5 10v9.5h5V14h3v5.5h5V10" />
    </>
  ),
  campaigns: (
    <path d="M12 3.5 19 6v6c0 5-3 8.2-7 9.5-4-1.3-7-4.5-7-9.5V6l7-2.5Z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 3 2.6 14 0 17" />
      <path d="M12 3.5c-2.6 3-2.6 14 0 17" />
    </>
  ),
  systems: (
    <>
      <path d="M12 3 20 8v8l-8 5-8-5V8l8-5Z" />
      <path d="M12 3v18M4 8l8 5 8-5" />
    </>
  ),
  players: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 20c0-3.3 2.5-5.7 5.5-5.7s5.5 2.4 5.5 5.7" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M14.8 14.6c2.2.3 3.7 2.3 3.7 5" />
    </>
  ),
  mastering: (
    <>
      <path d="M4.5 19.5 15 9" />
      <path d="M16 8l1.3 1.3L16 10.6l-1.3-1.3L16 8Z" />
      <path d="M19.5 4.5 20.4 6l1.5.9-1.5.9-.9 1.5-.9-1.5-1.5-.9 1.5-.9.9-1.5Z" />
      <path d="M5 4.3 5.7 5.6 7 6.3 5.7 7 5 8.3 4.3 7 3 6.3 4.3 5.6 5 4.3Z" />
    </>
  ),
  resources: (
    <>
      <path d="M3.5 7 5.5 3.5h13L20.5 7" />
      <rect x="3.5" y="7" width="17" height="13.5" rx="1.5" />
      <path d="M9.5 11.5h5" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="17" r="2.2" />
      <circle cx="18" cy="17" r="2.2" />
      <circle cx="12" cy="5.5" r="2.2" />
      <path d="M10.3 7.2 7.5 15M13.7 7.2l2.8 7.8M8.2 17h7.6" />
    </>
  ),
  storages: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
      <circle cx="8" cy="6.5" r="1.7" />
      <circle cx="16" cy="12" r="1.7" />
      <circle cx="10" cy="17.5" r="1.7" />
    </>
  ),
  appearance: (
    <>
      <path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8 0 3 2.1 4.3 4 4.3.9 0 1.3-.5 1.3-1.1 0-.6-.4-.9-.4-1.7 0-.9.7-1.6 1.7-1.6h2.3c2.6 0 5.1-1.7 5.1-5C17.5 5.6 15.1 3.5 12 3.5Z" />
      <circle cx="8.3" cy="10.3" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="7.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4" rx="1" />
      <path d="M4.5 8v10.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M10 13h4" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  backup: (
    <>
      <path d="M7 17.5A4 4 0 0 1 7.6 9.6 5.5 5.5 0 0 1 18 11a3.5 3.5 0 0 1-.6 6.5H7Z" />
      <path d="M12 10.5v6.5M9.3 14.3l2.7 2.7 2.7-2.7" />
    </>
  ),
  invite: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="M4 6.5 12 13l8-6.5" />
    </>
  ),
  navUp: (
    <>
      <path d="M12 19V6" />
      <path d="M6 11.5 12 5.5 18 11.5" />
    </>
  ),
  navDown: (
    <>
      <path d="M12 5v13" />
      <path d="M6 12.5 12 18.5 18 12.5" />
    </>
  ),
  navBack: (
    <>
      <path d="M19 12H6" />
      <path d="M11 6.5 5 12l6 5.5" />
    </>
  ),
  navPin: (
    <>
      <path d="M9 4.5h6l-.8 6L17 13v1.5H7V13l2.8-2.5-.8-6Z" />
      <path d="M12 14.5v5" />
    </>
  ),
  navCockpit: (
    <>
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg {...SHARED_PROPS} className={className ?? "nav-icon"} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
