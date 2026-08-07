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
  | "navCockpit"
  | "library"
  | "player"
  | "close"
  | "edit"
  | "delete"
  | "search"
  | "menu"
  | "chevron"
  | "link"
  | "eye"
  | "folder"
  | "check"
  | "upload"
  | "download"
  | "die"
  | "arrowRight"
  | "plus"
  | "minus"
  | "star"
  | "image"
  | "document"
  | "book"
  | "map"
  | "palette"
  | "gear"
  | "warning"
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "shuffle"
  | "repeatTrack"
  | "repeatPlaylist"
  | "volume"
  | "stop"
  | "sliders"
  | "sword"
  | "bag"
  | "swap"
  | "fullscreen"
  | "center";

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
  library: (
    <>
      <path d="M4 5.5c1.6-.8 3.6-1 5.5-.3v14c-1.9-.7-3.9-.5-5.5.3V5.5Z" />
      <path d="M9.5 5.2c1.9-.7 3.9-.5 5.5.3v14c-1.6-.8-3.6-1-5.5-.3" />
      <path d="M15 5.5c1.3-1 3-1.4 4.5-.9l.5.2v14l-.5-.2c-1.5-.5-3.2-.1-4.5.9" />
    </>
  ),
  player: (
    <>
      <path d="M9 16.5V6l9-2v10.5" />
      <circle cx="7" cy="17.5" r="2.2" />
      <circle cx="16" cy="15.5" r="2.2" />
    </>
  ),
  close: (
    <>
      <path d="M5.5 5.8 18.3 18.4" />
      <path d="M18.5 5.6 5.7 18.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20.5 4.6 16.3 15.6 5.3a1.8 1.8 0 0 1 2.6 0l1.5 1.5a1.8 1.8 0 0 1 0 2.6L8.7 19.9 4 20.5Z" />
      <path d="M14 6.9 17.1 10" />
    </>
  ),
  delete: (
    <>
      <path d="M4.3 6.5h15.4" />
      <path d="M9 6.5V4.8c0-.6.5-1 1.1-1h3.8c.6 0 1.1.4 1.1 1V6.5" />
      <path d="M6 6.5 6.9 19a1.6 1.6 0 0 0 1.6 1.5h6.9a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5 20 20" />
    </>
  ),
  menu: <path d="M4 6.7h16M4.3 12h15.4M4 17.3h16" />,
  chevron: <path d="M9 5.5 15.5 12 9 18.5" />,
  link: (
    <>
      <path d="M8 15.7a3.6 3.6 0 0 1 0-5.1l2-2a3.6 3.6 0 0 1 5.1 5.1l-1 1" />
      <path d="M16 8.3a3.6 3.6 0 0 1 0 5.1l-2 2a3.6 3.6 0 0 1-5.1-5.1l1-1" />
    </>
  ),
  eye: (
    <>
      <path d="M3.5 12c2-4 5.4-6.2 8.5-6.2s6.5 2.2 8.5 6.2c-2 4-5.4 6.2-8.5 6.2S5.5 16 3.5 12Z" />
      <circle cx="12" cy="12" r="2.3" />
    </>
  ),
  folder: (
    <path d="M3.5 7.3a1.5 1.5 0 0 1 1.5-1.5h5l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7.3Z" />
  ),
  check: <path d="M4.5 12.5 9 17 19.5 6" />,
  upload: (
    <>
      <path d="M12 15.5V4.5" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 18.5h15" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v11" />
      <path d="M7.5 11l4.5 4.5L16.5 11" />
      <path d="M4.5 18.5h15" />
    </>
  ),
  die: (
    <>
      <path d="M4.5 8 12 4l7.5 4v8L12 20l-7.5-4V8Z" />
      <path d="M4.5 8 12 12l7.5-4" />
      <path d="M12 12v8" />
      <circle cx="9" cy="9" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4.5 12h14" />
      <path d="M13 6.5 19 12l-6 5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  star: (
    <path d="M12 3.5 14.6 9.4l6.4.6-4.9 4.2 1.5 6.3-5.6-3.4-5.6 3.4 1.5-6.3-4.9-4.2 6.4-.6L12 3.5Z" />
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.8" />
      <path d="M4.5 17.5 9.5 12.5 13 16 16.5 12 19.5 15.5" />
    </>
  ),
  document: (
    <>
      <path d="M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5v4h4" />
      <path d="M8.5 12h7M8.5 15.5h7" />
    </>
  ),
  book: (
    <>
      <path d="M4.5 5.5a2 2 0 0 1 2-2h9.5v16h-9.5a2 2 0 0 1-2-2V5.5Z" />
      <path d="M16 3.5h1.5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H16" />
      <path d="M7 8h6M7 11.5h6" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5 4 6.3v13.2l5-1.8 6 1.8 5-1.8V4.5l-5 1.8-6-1.8Z" />
      <path d="M9 4.5v13.2M15 6.3v13.2" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8 0 3 2.1 4.3 4 4.3.9 0 1.3-.5 1.3-1.1 0-.6-.4-.9-.4-1.7 0-.9.7-1.6 1.7-1.6h2.3c2.6 0 5.1-1.7 5.1-5C17.5 5.6 15.1 3.5 12 3.5Z" />
      <circle cx="8.3" cy="10.3" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="7.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.5 12h2.2M17.3 12h2.2M6.4 6.4l1.6 1.6M16 16l1.6 1.6M17.6 6.4 16 8M8 16l-1.6 1.6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 21 19.5H3L12 4Z" />
      <path d="M12 10.3v4.3" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M6.5 4.5 19 12 6.5 19.5V4.5Z" />,
  pause: (
    <>
      <rect x="7.3" y="4.5" width="3" height="15" rx=".5" />
      <rect x="13.7" y="4.5" width="3" height="15" rx=".5" />
    </>
  ),
  prev: (
    <>
      <path d="M18.5 4.5 8 12l10.5 7.5V4.5Z" />
      <path d="M6 4.5v15" />
    </>
  ),
  next: (
    <>
      <path d="M5.5 4.5 16 12 5.5 19.5V4.5Z" />
      <path d="M18 4.5v15" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3.5 7h3.6l10 10h3.4" />
      <path d="M14 4.5 20 7l-2.6 5.2" />
      <path d="M3.5 17h3.6l2.7-2.9" />
      <path d="M14 19.5 20 17l-2.6-5.2" />
    </>
  ),
  repeatTrack: (
    <>
      <path d="M4.5 9.5a6 6 0 0 1 6-5.5h5" />
      <path d="M13 2 15.5 4 13 6" />
      <path d="M19.5 14.5a6 6 0 0 1-6 5.5H8" />
      <path d="M11 18l-2.5-2 2.5-2" />
      <path d="M11 10.3h.9v3.7" />
    </>
  ),
  repeatPlaylist: (
    <>
      <path d="M4.5 9.5a6 6 0 0 1 6-5.5h5" />
      <path d="M13 2 15.5 4 13 6" />
      <path d="M19.5 14.5a6 6 0 0 1-6 5.5H8" />
      <path d="M11 18l-2.5-2 2.5-2" />
    </>
  ),
  volume: (
    <>
      <path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3V9.5Z" />
      <path d="M15 9a3.3 3.3 0 0 1 0 6" />
      <path d="M17 6.8a6.3 6.3 0 0 1 0 10.4" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1" />,
  sliders: (
    <>
      <path d="M5 5.5v13M12 5.5v13M19 5.5v13" />
      <circle cx="5" cy="15" r="1.6" />
      <circle cx="12" cy="9" r="1.6" />
      <circle cx="19" cy="12.5" r="1.6" />
    </>
  ),
  sword: (
    <>
      <path d="M14.3 17.6 3.5 6.8V3.8h3l11 10.8" />
      <path d="M12.8 19.1 18.6 13.3" />
      <path d="M15.8 16.1 19.6 19.9" />
      <path d="M18.8 21 20.7 19.1" />
    </>
  ),
  // "В мешок" (scratch tray) — compendium entries and location maps.
  bag: (
    <>
      <path d="M8.5 8V6.3a3.5 3.5 0 0 1 7 0V8" />
      <path d="M5.5 8h13l1 11a1.8 1.8 0 0 1-1.8 2H6.3a1.8 1.8 0 0 1-1.8-2L5.5 8Z" />
      <path d="M5.9 12h12.2" />
    </>
  ),
  // "Перенести карту" — move a location's map to another location.
  swap: (
    <>
      <path d="M4 8h13.5" />
      <path d="M14.3 4.5 17.8 8l-3.5 3.5" />
      <path d="M20 16H6.5" />
      <path d="M9.7 19.5 6.2 16l3.5-3.5" />
    </>
  ),
  // "На весь экран" — expand-to-fullscreen corner brackets.
  fullscreen: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </>
  ),
  // "Центрировать карту" — crosshair.
  center: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3" />
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
