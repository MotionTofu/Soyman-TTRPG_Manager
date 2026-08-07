import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, getAuthToken, setAuthToken } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { SearchPanel } from "./SearchPanel";
import { NavWidget } from "./NavWidget";
import { PreviewDock } from "./PreviewDock";
import { NavIcon, type NavIconName } from "../components/NavIcons";
import { ParticleField } from "../components/ParticleField";
import { AudioPlayerBar, MiniPlayerBar } from "../audioPlayer";
import { useNearestSessionCockpitId } from "../nearestSessionCockpit";

interface NavItem {
  to: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
}

const GM_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Главная", icon: "home", end: true },
  { to: "/campaigns", label: "Кампании", icon: "campaigns" },
  { to: "/settings", label: "Сеттинги", icon: "settings" },
  { to: "/systems", label: "Системы", icon: "systems" },
  { to: "/players", label: "Игроки", icon: "players" },
  { to: "/mastering", label: "Мастерение", icon: "mastering" },
  { to: "/resources", label: "Ресурсы", icon: "resources" },
  { to: "/graph", label: "Граф связей", icon: "graph" },
];

// Player role: no GM tooling (Мастерение/Ресурсы/Граф связей), and "Игроки"
// becomes "Персонажи" — the player's own characters instead of the roster.
const PLAYER_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Главная", icon: "home", end: true },
  { to: "/campaigns", label: "Кампании", icon: "campaigns" },
  { to: "/settings", label: "Сеттинги", icon: "settings" },
  { to: "/systems", label: "Системы", icon: "systems" },
  { to: "/my-characters", label: "Персонажи", icon: "players" },
  { to: "/cabinet", label: "Кабинет", icon: "storages" },
];

const GM_NAV_BOTTOM_ITEMS: NavItem[] = [
  { to: "/storages", label: "Настройки", icon: "storages" },
  { to: "/appearance", label: "Внешний вид", icon: "appearance" },
  { to: "/invitations", label: "Приглашения", icon: "invite" },
  { to: "/archive", label: "Архив", icon: "archive" },
  { to: "/about", label: "О программе", icon: "about" },
];

const PLAYER_NAV_BOTTOM_ITEMS: NavItem[] = [
  { to: "/storages", label: "Настройки", icon: "storages" },
  { to: "/appearance", label: "Внешний вид", icon: "appearance" },
  { to: "/about", label: "О программе", icon: "about" },
];

// Primary destinations promoted to a persistent bottom bar on mobile
// (<860px, same breakpoint as the off-canvas nav), modeled after D&D
// Beyond's app nav per the user's request — the hamburger menu stays for
// everything else (Настройки/Внешний вид/Архив/etc.), this is just the 3-4
// things worth one tap. GM's "Библиотека" points at the new /library page
// (see LibraryPage.tsx); the player-role variant still points at /campaigns
// as the closest existing equivalent until Phase 7 builds its own read-only
// version. "Плеер" is a plain link to the full-screen /player library
// (GmMusicPage.tsx) — there's no drawer to toggle anymore, playback status
// lives in MiniPlayerBar instead (see AudioPlayerBar/MiniPlayerBar in
// audioPlayer.tsx).
interface BottomNavItem {
  key: string;
  label: string;
  icon: NavIconName;
  to?: string;
  active?: boolean;
  onClick?: () => void;
}

function MobileBottomNav({ items }: { items: BottomNavItem[] }) {
  return (
    <nav className="mobile-bottom-nav">
      {items.map((item) =>
        item.to ? (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ) : (
          <button
            key={item.key}
            type="button"
            className={item.active ? "active" : ""}
            onClick={item.onClick}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </button>
        )
      )}
    </nav>
  );
}

function BackupButton() {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [info, setInfo] = useState("");

  async function runBackup() {
    setState("working");
    try {
      const res = await api.post<{ path: string; size: number }>("/backup");
      setInfo(`${res.path} (${(res.size / 1024 / 1024).toFixed(1)} МБ)`);
      setState("done");
    } catch (e) {
      setInfo(String(e));
      setState("error");
    }
  }

  return (
    <div className="backup-block">
      <button className="nav-bottom-button" onClick={runBackup} disabled={state === "working"}>
        <NavIcon name="backup" />
        {state === "working" ? "Архивирую…" : "Бэкап"}
      </button>
      {state === "done" && <div className="backup-info">Готово: {info}</div>}
      {state === "error" && <div className="backup-info error">Ошибка: {info}</div>}
    </div>
  );
}

function LogoutButton({ username }: { username?: string }) {
  if (!getAuthToken()) return null;
  return (
    <button
      className="nav-bottom-button"
      onClick={() => {
        setAuthToken(null);
        window.location.reload();
      }}
    >
      {username ? `Выйти (${username})` : "Выйти"}
    </button>
  );
}

export function AppShell() {
  // Role decides which navigation renders: players get no GM tooling
  // (Мастерение/Ресурсы/Граф связей/Игроки/Бэкап/Приглашения/Архив) and see
  // "Персонажи" (their own characters) instead of the "Игроки" roster.
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const navItems = isPlayer ? PLAYER_NAV_ITEMS : GM_NAV_ITEMS;
  const navBottomItems = isPlayer ? PLAYER_NAV_BOTTOM_ITEMS : GM_NAV_BOTTOM_ITEMS;

  // Пульт сессии swaps the main nav sidebar for a drag-and-drop preview
  // dock (see PreviewDock) instead — a GM running a live session gets a
  // place to keep creature/location previews visible instead of the app
  // nav they're not using mid-session.
  const { pathname } = useLocation();
  const isLivePult = /^\/sessions\/\d+\/live$/.test(pathname);

  // Below the .app-shell CSS breakpoint the nav and search panel become
  // off-canvas drawers (see index.css) instead of permanent grid columns —
  // these two toggle them. Desktop-width layouts ignore this state (no
  // toggle button renders there, and .open has no effect on a static column).
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const navigate = useNavigate();
  const cockpitId = useNearestSessionCockpitId();
  const bottomNavItems: BottomNavItem[] = isPlayer
    ? [
        { key: "library", label: "Библиотека", icon: "library", to: "/library" },
        { key: "characters", label: "Персонажи", icon: "players", to: "/my-characters" },
        { key: "cabinet", label: "Кабинет", icon: "storages", to: "/cabinet" },
      ]
    : [
        {
          key: "session",
          label: "Сессия",
          icon: "navCockpit",
          active: pathname.startsWith("/sessions/"),
          onClick: () => navigate(cockpitId ? `/sessions/${cockpitId}/live` : "/campaigns"),
        },
        { key: "library", label: "Библиотека", icon: "library", to: "/library" },
        { key: "players", label: "Игроки", icon: "players", to: "/players" },
        { key: "player", label: "Плеер", icon: "player", to: "/player" },
      ];

  return (
    <div className={`app-shell${isLivePult ? " app-shell-live" : ""}`}>
      <div className="mobile-topbar">
        <button className="mobile-topbar-button" onClick={() => setNavOpen(true)} aria-label="Меню">
          <NavIcon name="menu" />
        </button>
        <img src="/logo.png" alt="SoyMan" className="mobile-topbar-logo" />
        {/* Плеер toggle used to live here too — it's now one of the bottom
            nav's own buttons (see bottomNavItems above), so this row is just
            search. */}
        <button className="mobile-topbar-button" onClick={() => setSearchOpen(true)} aria-label="Поиск">
          <NavIcon name="search" />
        </button>
      </div>
      {(navOpen || searchOpen) && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => {
            setNavOpen(false);
            setSearchOpen(false);
          }}
        />
      )}
      {isLivePult ? (
        <PreviewDock open={navOpen} />
      ) : (
        <nav className={`app-nav${navOpen ? " open" : ""}`}>
          <ParticleField count={10} className="header-particles" />
          <img src="/logo.png" alt="SoyMan — TTRPG Manager" className="brand-logo" />
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "active" : "")}
              onClick={() => setNavOpen(false)}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          <div className="nav-bottom">
            <ParticleField count={10} className="footer-particles" />
            {navBottomItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
            {!isPlayer && <BackupButton />}
            <LogoutButton username={user?.username} />
          </div>
        </nav>
      )}
      <main className={`app-content${isPlayer ? "" : " has-player"}`}>
        <Outlet />
      </main>
      <div className={`search-panel-slot${searchOpen ? " open" : ""}`}>
        <SearchPanel />
      </div>
      <NavWidget />
      {/* Players never had a reason to control music — only the GM runs the
          session soundtrack. The full bar is desktop-only (hidden on mobile
          via CSS, see index.css); mobile gets MiniPlayerBar below instead —
          a small "now playing" capsule that only exists while something is
          actually playing, tapping it opens NowPlayingPage. */}
      {!isPlayer && (
        <div className="audio-player-slot">
          <AudioPlayerBar />
        </div>
      )}
      {!isPlayer && pathname !== "/now-playing" && <MiniPlayerBar />}
      <MobileBottomNav items={bottomNavItems} />
    </div>
  );
}
