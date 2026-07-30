import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api, getAuthToken, setAuthToken } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { SearchPanel } from "./SearchPanel";
import { NavWidget } from "./NavWidget";
import { NavIcon, type NavIconName } from "../components/NavIcons";
import { ParticleField } from "../components/ParticleField";
import { AudioPlayerBar } from "../audioPlayer";

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

  // Below the .app-shell CSS breakpoint the nav and search panel become
  // off-canvas drawers (see index.css) instead of permanent grid columns —
  // these two toggle them. Desktop-width layouts ignore this state (no
  // toggle button renders there, and .open has no effect on a static column).
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button className="mobile-topbar-button" onClick={() => setNavOpen(true)} aria-label="Меню">
          ☰
        </button>
        <img src="/logo.png" alt="SoyMan" className="mobile-topbar-logo" />
        <div className="row" style={{ gap: 4 }}>
          {/* Players never see the audio player at all (see below) — no
              point offering a toggle for a drawer that would open empty. */}
          {!isPlayer && (
            <button className="mobile-topbar-button" onClick={() => setPlayerOpen((v) => !v)} aria-label="Плеер">
              🎵
            </button>
          )}
          <button className="mobile-topbar-button" onClick={() => setSearchOpen(true)} aria-label="Поиск">
            🔍
          </button>
        </div>
      </div>
      {(navOpen || searchOpen || playerOpen) && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => {
            setNavOpen(false);
            setSearchOpen(false);
            setPlayerOpen(false);
          }}
        />
      )}
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
      <main className={`app-content${isPlayer ? "" : " has-player"}`}>
        <Outlet />
      </main>
      <div className={`search-panel-slot${searchOpen ? " open" : ""}`}>
        <SearchPanel />
      </div>
      <NavWidget />
      {/* Players never had a reason to control music — only the GM runs the
          session soundtrack. On mobile this becomes a drawer (playerOpen)
          instead of a permanently docked bar; see index.css. */}
      {!isPlayer && (
        <div className={`audio-player-slot${playerOpen ? " open" : ""}`}>
          <AudioPlayerBar />
        </div>
      )}
    </div>
  );
}
