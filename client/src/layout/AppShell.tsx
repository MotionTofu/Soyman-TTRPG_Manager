import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, getAuthToken, setAuthToken } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { SearchPanel } from "./SearchPanel";
import { NavWidget } from "./NavWidget";
import { PreviewDock } from "./PreviewDock";
import { MobileQuickAccess, type QuickAccessContextualAction } from "./MobileQuickAccess";
import { NavIcon, type NavIconName } from "../components/NavIcons";
import { useUpdateAvailable } from "../updateAvailable";
import { ParticleField } from "../components/ParticleField";
import { AudioPlayerBar, MiniPlayerBar } from "../audioPlayer";
import { SoundEngineProvider } from "../sound/engine";
import { SoundBarExtras, SoundSetEmpty } from "../sound/SoundBarExtras";
import { useNearestSessionCockpitId } from "../nearestSessionCockpit";
import { openSecondWindow, openExternalLink } from "../electronApi";
import { UnloadTargetsProvider } from "../unloadTargets";
import { UndoDeleteProvider } from "../hooks/useUndoDelete";
import { brandLogo } from "../brandLogo";
import { ExternalLinkConfirmModal, BOOSTY_URL } from "../components/ExternalLinkConfirmModal";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { useConfirm } from "../hooks/useConfirm";

interface NavItem {
  to?: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
  onClick?: () => void;
}

const GM_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Главная", icon: "home", end: true },
  { to: "/campaigns", label: "Кампании", icon: "campaigns" },
  { to: "/settings", label: "Сеттинги", icon: "settings" },
  { to: "/systems", label: "Системы", icon: "systems" },
  { to: "/players", label: "Игроки", icon: "players" },
  { to: "/mastering", label: "Мастерение", icon: "mastering" },
  { to: "/resources", label: "Ресурсы", icon: "resources" },
  { to: "/canvas", label: "Полотно", icon: "canvas" },
  { to: "/graph", label: "Граф связей", icon: "graph" },
  { to: "/maps", label: "Карты", icon: "map" },
];

// Player role: no GM tooling (Мастерение/Ресурсы/Граф связей). The player's
// own characters live inside "Кабинет" (ticket 13), not a standalone item.
const PLAYER_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Главная", icon: "home", end: true },
  { to: "/campaigns", label: "Кампании", icon: "campaigns" },
  { to: "/settings", label: "Сеттинги", icon: "settings" },
  { to: "/systems", label: "Системы", icon: "systems" },
  { to: "/maps", label: "Карты", icon: "map" },
  { to: "/cabinet", label: "Кабинет", icon: "storages" },
];

const GM_NAV_BOTTOM_ITEMS: NavItem[] = [
  { to: "/storages", label: "Настройки", icon: "storages" },
  { to: "/health", label: "Здоровье", icon: "health" },
  { to: "/invitations", label: "Приглашения", icon: "invite" },
  { to: "/archive", label: "Архив", icon: "archive" },
  { to: "/about", label: "Справка", icon: "about" },
];

const PLAYER_NAV_BOTTOM_ITEMS: NavItem[] = [
  { to: "/storages", label: "Настройки", icon: "storages" },
  { to: "/about", label: "Справка", icon: "about" },
];

// Primary destinations promoted to a persistent bottom bar on mobile
// (<860px, same breakpoint as the off-canvas nav), modeled after D&D
// Beyond's app nav per the user's request — the hamburger menu stays for
// everything else (Настройки/Внешний вид/Архив/etc.), this is just the 3-4
// things worth one tap. GM's "Библиотека" points at the new /library page
// (see LibraryPage.tsx); the player-role variant still points at /campaigns
// as the closest existing equivalent until Phase 7 builds its own read-only
// version. Отдельной страницы «Плеер» больше нет:
// музыкой управляет пульт, а состояние воспроизведения видно в MiniPlayerBar
// (см. AudioPlayerBar/MiniPlayerBar в audioPlayer.tsx).
interface BottomNavItem {
  key: string;
  label: string;
  icon: NavIconName;
  to?: string;
  active?: boolean;
  onClick?: () => void;
}

// Symmetric layout per §7.1/ticket 13: GM gets two flanking slots on each
// side of the raised center button (2 + center + 2 = 5), the player gets one
// on each side (1 + center + 1 = 3). The center button itself is not a nav
// link — it opens the MobileQuickAccess sheet (pins + pin-current +
// contextual action) instead of being a sixth nav destination.
function MobileBottomNav({
  leftItems,
  rightItems,
  onCenterClick,
}: {
  leftItems: BottomNavItem[];
  rightItems: BottomNavItem[];
  onCenterClick: () => void;
}) {
  function renderItem(item: BottomNavItem) {
    return item.to ? (
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
    );
  }

  return (
    <nav className="mobile-bottom-nav">
      {leftItems.map(renderItem)}
      <div className="mobile-bottom-nav-center-wrap">
        <span className="mobile-bottom-nav-halo" aria-hidden="true" />
        <button
          type="button"
          className="mobile-bottom-nav-center"
          onClick={onCenterClick}
          aria-label="Быстрый доступ"
        >
          <NavIcon name="star" />
        </button>
      </div>
      {rightItems.map(renderItem)}
    </nav>
  );
}

function BackupButton() {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [info, setInfo] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [defaultDir, setDefaultDir] = useState<string | null>(null);

  async function openConfirm() {
    setConfirmOpen(true);
    if (defaultDir === null) {
      try {
        const res = await api.get<{ defaultDir: string }>("/backup/info");
        setDefaultDir(res.defaultDir);
      } catch {
        // leave defaultDir null — fallback placeholder will be used
      }
    }
  }

  async function handlePickPath() {
    const electron = window.electronAPI as unknown as { pickSaveFile?: (p: string) => Promise<string | null>; pickFolder?: () => Promise<string | null> } | undefined;
    if (electron?.pickSaveFile) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
      const suggestedName = `rpg-backup-${stamp}.zip`;
      let defaultPath: string | undefined;
      const trimmed = backupPath.trim();
      if (trimmed.toLowerCase().endsWith(".zip")) {
        defaultPath = trimmed;
      } else if (trimmed) {
        const sep = trimmed.includes("\\") ? "\\" : "/";
        defaultPath = trimmed.replace(/[\\/]+$/, "") + sep + suggestedName;
      } else if (defaultDir) {
        const sep = defaultDir.includes("\\") ? "\\" : "/";
        defaultPath = defaultDir.replace(/[\\/]+$/, "") + sep + suggestedName;
      } else {
        defaultPath = suggestedName;
      }
      const picked = await electron.pickSaveFile(defaultPath);
      if (picked) setBackupPath(picked);
      return;
    }
    if (electron?.pickFolder) {
      const picked = await electron.pickFolder();
      if (picked) setBackupPath(picked);
      return;
    }
    // Браузер без Electron — ручной ввод через prompt
    const fallback = window.prompt("Укажите путь сохранения (папка или полный путь к .zip):", backupPath || defaultDir || "");
    if (fallback !== null) setBackupPath(fallback.trim());
  }

  async function runBackup() {
    setConfirmOpen(false);
    setState("working");
    try {
      const trimmed = backupPath.trim();
      let body: Record<string, string> | undefined;
      if (trimmed) {
        if (trimmed.toLowerCase().endsWith(".zip")) body = { filePath: trimmed };
        else body = { dir: trimmed };
      }
      const res = await api.post<{ path: string; size: number }>(
        "/backup",
        body ?? {}
      );
      setInfo(`${res.path} (${(res.size / 1024 / 1024).toFixed(1)} МБ)`);
      setState("done");
    } catch (e) {
      setInfo(String(e));
      setState("error");
    }
  }

  const displayPath = backupPath.trim() || defaultDir || "RPG-Backups (по умолчанию)";

  return (
    <div className="backup-block">
      <button
        className="nav-bottom-button"
        onClick={openConfirm}
        disabled={state === "working"}
      >
        <NavIcon name="backup" />
        {state === "working" ? "Архивирую…" : "Бэкап"}
      </button>
      {state === "done" && <div className="backup-info">Готово: {info}</div>}
      {state === "error" && <div className="backup-info error">Ошибка: {info}</div>}
      {confirmOpen && (
        <Modal onClose={() => setConfirmOpen(false)} closeOnBackdropClick={false}>
          <div className="external-confirm">
            <div className="external-confirm__head" role="heading" aria-level={2}>
              <NavIcon name="backup" />
              <span>Бэкап</span>
            </div>
            <p className="external-confirm__text" style={{ marginBottom: 12 }}>
              Желаете сделать бэкап?
            </p>

            {/* Путь — не инпут, а текст; меняется сразу после «Изменить путь» */}
            <div
              title={displayPath}
              style={{
                marginBottom: 14,
                padding: "8px 10px",
                background: "var(--paper)",
                border: "1px solid var(--line)",
                textAlign: "left",
                // Длинный Windows-путь не должен рвать модалку: режем только внутри слова
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-micro)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                  marginBottom: 3,
                }}
              >
                Сохраняем в:
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-meta)",
                  lineHeight: 1.35,
                  color: "var(--ink)",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {displayPath}
              </div>
            </div>

            <div className="external-confirm__actions">
              <button type="button" className="primary" onClick={runBackup}>
                Да
              </button>
              <button type="button" onClick={handlePickPath}>
                Изменить путь
              </button>
              <button type="button" onClick={() => setConfirmOpen(false)}>
                Нет
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Второе окно на ту же страницу: окна работают с одной базой, «Мешок» у них
// общий — так сущность берут в одном окне и кладут в другом (перетащить
// напрямую между окнами Chromium не позволяет).
function NewWindowButton() {
  return (
    <button
      className="nav-bottom-button"
      onClick={() => openSecondWindow()}
      title="Открыть эту же страницу вторым окном. Перенести сущность между окнами можно через «Мешок»."
    >
      Новое окно
    </button>
  );
}

function LogoutButton({ username }: { username?: string }) {
  const [dialog, confirm] = useConfirm();
  if (!getAuthToken()) return null;
  return (
    <>
      {dialog}
      <button
        className="nav-bottom-button"
        onClick={async () => {
          const ok = await confirm({ title: "Выйти?", message: "Вы выйдете из аккаунта и вернётесь к экрану входа.", confirmLabel: "Выйти", cancelLabel: "Отмена", danger: true });
          if (!ok) return;
          setAuthToken(null);
          window.location.reload();
        }}
      >
        {username ? `Выйти (${username})` : "Выйти"}
      </button>
    </>
  );
}

// Подсказка к погашенному пункту навигации — по разделу, а не одна на всех.
// Ключ — путь без ведущего слэша, как его считает navCounts.
const NAV_EMPTY_HINT: Record<string, string> = {
  campaigns: "Кампаний пока нет — заведи первую на Главной",
  settings: "Сеттингов пока нет — мир создаётся мастером сеттингов",
  players: "Игроков пока нет — добавь их к кампании",
  resources: "Ресурсов пока нет — сюда кладут карты, музыку и файлы",
  mastering: "Заметок мастерения пока нет",
};

const CRUMB_LABEL: Record<string, string> = {
  campaigns: "Кампании",
  library: "Библиотека",
  settings: "Сеттинги",
  systems: "Системы",
  players: "Игроки",
  cabinet: "Кабинет",
  mastering: "Мастерение",
  resources: "Ресурсы",
  canvas: "Полотно",
  graph: "Граф",
  maps: "Карты",
  storages: "Настройки",
  health: "Здоровье",
  about: "Справка",
  archive: "Архив",
  invitations: "Приглашения",
  sessions: "Сессии",
  characters: "Персонажи",
  locations: "Локации",
  beings: "Существа",
  scenes: "Сцены",
  adventures: "Приключения",
  artifacts: "Артефакты",
  communities: "Сообщества",
  events: "События",
  compendium: "Компендиум",
};

function buildCrumbs(pathname: string) {
  if (pathname === "/" || pathname === "") return [{ label: "Главная" }];
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to?: string }[] = [{ label: "Главная", to: "/" }];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    // id segments (numeric) — show as "…" but still linkable via parent? skip label, just keep parent
    if (/^\d+$/.test(seg) && i > 0) {
      // attach id to previous crumb's to
      const prev = crumbs[crumbs.length - 1];
      if (prev.to) prev.to += `/${seg}`;
      continue;
    }
    acc += `/${seg}`;
    const label = CRUMB_LABEL[seg] ?? seg;
    const isLast = i === parts.length - 1 || (i + 1 < parts.length && /^\d+$/.test(parts[i + 1]) && i + 1 === parts.length - 1);
    crumbs.push({ label, to: isLast ? undefined : acc });
  }
  return crumbs;
}

export function AppShell() {
  // Role decides which navigation renders: players get no GM tooling
  // (Мастерение/Ресурсы/Граф связей/Игроки/Бэкап/Приглашения/Архив) and see
  // "Персонажи" (their own characters) instead of the "Игроки" roster.
  const { user, loading: userLoading } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const navItems = isPlayer ? PLAYER_NAV_ITEMS : GM_NAV_ITEMS;
  const updateAvailable = useUpdateAvailable();
  const [activeStorageName, setActiveStorageName] = useState<string | null>(null);
  // 2.1 — серые пункты на пустой БД (badge 0 + muted + disabled tooltip) — не display:none
  const [navCounts, setNavCounts] = useState<Record<string, number | null>>({});

  const refreshNavCounts = () => {
    api.get<{ activeId: string; storages: { id: string; name: string }[] }>("/storages").then((r) => {
      const active = r.storages.find((s) => s.id === r.activeId);
      if (active) setActiveStorageName(active.name);
    }).catch(() => {});
    api.get<unknown[]>("/campaigns").then((a) => setNavCounts((m) => ({ ...m, campaigns: a.length }))).catch(() => {});
    api.get<unknown[]>("/settings").then((a) => setNavCounts((m) => ({ ...m, settings: a.length }))).catch(() => {});
    api.get<unknown[]>("/players").then((a) => setNavCounts((m) => ({ ...m, players: a.length }))).catch(() => {});
    api.get<unknown[]>("/resources").then((a) => setNavCounts((m) => ({ ...m, resources: a.length }))).catch(() => {});
    api.get<unknown[]>("/mastering").then((a) => setNavCounts((m) => ({ ...m, mastering: Array.isArray(a) ? (a as unknown[]).length : 0 }))).catch(() => {});
  };

  useEffect(() => {
    if (isPlayer || userLoading) return;
    refreshNavCounts();
  }, [isPlayer, userLoading]);

  // Обновляем счётчики навигации при событии "nav-refresh" (создание/удаление данных)
  useEffect(() => {
    if (isPlayer || userLoading) return;
    const handler = () => refreshNavCounts();
    window.addEventListener("nav-refresh", handler);
    return () => window.removeEventListener("nav-refresh", handler);
  }, [isPlayer, userLoading]);

  // Нижний список разделов: свои пункты роли плюс Boosty. Пункт уходит за
  // «О программе» и ведёт не в раздел, а в модалку подтверждения — внешняя
  // ссылка без явного согласия не открывается.
  const [boostyOpen, setBoostyOpen] = useState(false);
  const navBottomItems: NavItem[] = [
    ...(isPlayer ? PLAYER_NAV_BOTTOM_ITEMS : GM_NAV_BOTTOM_ITEMS),
    {
      label: "Boosty",
      icon: "boosty",
      onClick: () => setBoostyOpen(true),
    },
  ];

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
  const [quickOpen, setQuickOpen] = useState(false);

  const navigate = useNavigate();
  const cockpitId = useNearestSessionCockpitId();

  // Flanking slots around the raised center button — see MobileBottomNav's
  // comment for the symmetric 2+center+2 / 1+center+1 split. GM's old
  // leftmost slot ("Сессия") and player's old rightmost slot ("Кабинет") are
  // both now "Главная": the center button's quick-access sheet already
  // covers what those used to be one-tap shortcuts for — the GM's session
  // cockpit lives in the sheet's contextual action, and the player's
  // character list now renders at the top of the sheet (see
  // MobileQuickAccess) — so the freed slot goes to the page every session
  // starts on instead of being wasted on a redundant shortcut. Кабинет
  // itself is unchanged and still reachable from the hamburger drawer nav
  // (PLAYER_NAV_ITEMS).
  const bottomNavLeft: BottomNavItem[] = isPlayer
    ? [{ key: "library", label: "Библиотека", icon: "library", to: "/library" }]
    : [
        { key: "home", label: "Главная", icon: "home", to: "/" },
        { key: "library", label: "Библиотека", icon: "library", to: "/library" },
      ];
  const bottomNavRight: BottomNavItem[] = isPlayer
    ? [{ key: "home", label: "Главная", icon: "home", to: "/" }]
    : [
        { key: "players", label: "Игроки", icon: "players", to: "/players" },
      ];

  // Contextual action offered in the quick-access sheet: for the GM, jump to
  // (or start) the nearest upcoming session's live cockpit — a real one-tap
  // shortcut, not a token action. No equally clear candidate exists for the
  // player role across arbitrary screens, so the sheet just omits this slot
  // there rather than inventing a weak one (per ticket 13's guidance).
  const contextualAction: QuickAccessContextualAction | null =
    !isPlayer && cockpitId
      ? {
          label: "Начать сессию",
          icon: "navCockpit",
          onClick: () => navigate(`/sessions/${cockpitId}/live`),
        }
      : null;

  useEffect(() => {
    if (!navOpen && !searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, searchOpen]);

  // Глобальные хоткеи пульта — независимы от раскладки (code + key), не спорят с существующими
  // [ / Х — левая докстанция, ] / Ъ — правый поиск, Ctrl+\ — оба. Игнор когда в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const ae = document.activeElement as HTMLElement | null;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae?.isContentEditable) return;
      const k = e.key.toLowerCase();
      const isLeft = e.code === "BracketLeft" || k === "[" || k === "х";
      const isRight = e.code === "BracketRight" || k === "]" || k === "ъ";
      const isSlash = e.code === "Backslash" || k === "\\" || k === "|" || e.code === "IntlBackslash";
      // Не мешаем системным Ctrl+K, Ctrl+S, Ctrl+Z и т.д. — для скобок требуем без Ctrl/Meta/Alt
      if (isLeft && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        document.body.classList.toggle("live-hide-dock");
      } else if (isRight && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        document.body.classList.toggle("live-hide-search");
      } else if (isSlash && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const hide = !(document.body.classList.contains("live-hide-search") && document.body.classList.contains("live-hide-dock"));
        document.body.classList.toggle("live-hide-search", hide);
        document.body.classList.toggle("live-hide-dock", hide);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, []);

  const [playerHidden, setPlayerHidden] = useState(() => {
    try { return localStorage.getItem("playerHidden") === "1"; } catch { return false; }
  });

  // Alt+F1 — на главную, Alt+F2 — показать/скрыть нижний плеер, Alt+F3 — свернуть/развернуть все <details>
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "F1" && e.key !== "F2" && e.key !== "F3") return;
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae?.isContentEditable) return;
      if (e.key === "F1") {
        e.preventDefault();
        navigate("/");
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        setPlayerHidden((v) => {
          const nv = !v;
          try { localStorage.setItem("playerHidden", nv ? "1" : "0"); } catch {}
          return nv;
        });
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        const nodes = document.querySelectorAll<HTMLDetailsElement>(".app-content details");
        if (nodes.length === 0) return;
        const openCount = [...nodes].filter((d) => d.open).length;
        const shouldOpen = openCount < nodes.length / 2;
        nodes.forEach((d) => {
          d.open = shouldOpen;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    // Движок пульта звука живёт здесь, а не в main.tsx: окно самого пульта
    // рендерится ВНЕ AppShell, и звук в нём заводиться не должен — иначе
    // каналы играли бы в двух окнах сразу (см. sound/engine.tsx).
    <SoundEngineProvider>
    {/* Провайдер обнимает и страницу, и панель поиска с мешком: зоны приёма
        живут на странице, а кнопка «Выгрузить» — в мешке. */}
    <UnloadTargetsProvider>
    {/* Тост «Отменить» живёт здесь, а не на странице: удаление сессии,
        кампании или персонажа уводит с неё, и тост, нарисованный самой
        страницей, уходил вместе с ней. */}
    <UndoDeleteProvider>
    <div className={`app-shell${isLivePult ? " app-shell-live" : ""}`}>
      <div className="mobile-topbar">
        <button className="mobile-topbar-button" onClick={() => setNavOpen(true)} aria-label="Меню" aria-expanded={navOpen} aria-controls="app-nav">
          <NavIcon name="menu" />
        </button>
        <img src={brandLogo} alt="SoyMan" className="mobile-topbar-logo" />
        {/* Плеер toggle used to live here too — it's now one of the bottom
            nav's own buttons (see bottomNavItems above), so this row is just
            search. */}
        <button className="mobile-topbar-button" onClick={() => setSearchOpen(true)} aria-label="Поиск" aria-expanded={searchOpen} aria-controls="search-panel">
          <NavIcon name="search" />
        </button>
      </div>
      {navOpen && (
        <div
          className="mobile-drawer-backdrop"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}
      {searchOpen && (
        <div
          className="mobile-drawer-backdrop"
          aria-hidden="true"
          onClick={() => setSearchOpen(false)}
        />
      )}
      {isLivePult ? (
        <PreviewDock open={navOpen} />
      ) : userLoading ? (
        <nav id="app-nav" className={`app-nav${navOpen ? " open" : ""}`} aria-busy="true" aria-label="Загрузка навигации">
          <div className="brand-logo" style={{ height: 48, background: "var(--bg-elevated)", borderRadius: "var(--card-radius)", opacity: 0.5 }} />
          <div className="stack" style={{ gap: 6, marginTop: 12 }}>
            <div className="card" style={{ height: 36, opacity: 0.35 }} />
            <div className="card" style={{ height: 36, opacity: 0.3 }} />
            <div className="card" style={{ height: 36, opacity: 0.25 }} />
            <div className="card" style={{ height: 36, opacity: 0.2 }} />
            <div className="card" style={{ height: 36, opacity: 0.15 }} />
          </div>
        </nav>
      ) : (
        <nav id="app-nav" className={`app-nav${navOpen ? " open" : ""}`}>
          <ParticleField count={2} className="header-particles" />
          <img src={brandLogo} alt="SoyMan — TTRPG Manager" className="brand-logo" />
          {navItems.map((item) => {
            const key = item.to?.replace(/^\//, "") ?? "";
            const cnt = navCounts[key];
            const isEmpty = cnt === 0;
            // Пустой раздел гасится и ПЕРЕСТАЁТ нажиматься: серый пункт,
            // который всё равно уводит в пустоту, обещает «нельзя» и тут же
            // это обещание нарушает. Подсказка — своя на раздел: одна общая
            // («заведи кампанию») висела и на «Игроках», и на «Ресурсах».
            const emptyLabel = isEmpty ? (NAV_EMPTY_HINT[key] ?? "Пока пусто") : undefined;
            if (isEmpty) {
              return (
                <span
                  key={item.to}
                  className="nav-empty"
                  title={emptyLabel}
                  aria-disabled="true"
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                  <span className="badge tag nav-empty-count">0</span>
                </span>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to!}
                end={item.end}
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={() => setNavOpen(false)}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </NavLink>
            );
          })}
          <div className="nav-bottom">
            <ParticleField count={1} className="footer-particles" />
            {navBottomItems.map((item) =>
              item.onClick ? (
                <button
                  key={item.label}
                  type="button"
                  className="nav-bottom-button nav-bottom-external"
                  onClick={item.onClick}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </button>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to!}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                  {/* Блок «Обновления» ушёл с главной в настройки; точка — всё,
                      что от него осталось снаружи. Появляется, только когда
                      обновление действительно есть. */}
                  {item.to === "/storages" && updateAvailable && (
                    <span className="nav-dot" title="Доступно обновление" aria-label="Доступно обновление" />
                  )}
                </NavLink>
              )
            )}
            {!isPlayer && <BackupButton />}
            <NewWindowButton />
            <LogoutButton username={user?.username} />
          </div>
        </nav>
      )}
      <main className={`app-content${userLoading ? "" : isPlayer ? "" : " has-player"}`}>
        {/* Крошки не рисуются на полноэкранном чарнике: у него своя полоса
            с «назад» и именем, а вторая шапка сверху и есть та самая рамка
            в рамке, ради ухода от которой лист съехал на свой маршрут. */}
        {!userLoading &&
          !/^\/sessions\/\d+\/live\/panel\/\w+/.test(pathname) &&
          !/^\/characters\/\d+\/sheet$/.test(pathname) && (
          <div style={{ marginBottom: pathname === "/" ? 8 : 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <Breadcrumbs items={buildCrumbs(pathname)} />
            {!isPlayer && activeStorageName && (
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", border: "1px solid var(--line)", padding: "2px 6px", background: "var(--paper-2)" }} title="Активное хранилище">
                {activeStorageName}
              </span>
            )}
          </div>
        )}
        <Outlet />
      </main>
      <div id="search-panel" className={`search-panel-slot${searchOpen ? " open" : ""}`}>
        <SearchPanel />
      </div>
      <NavWidget />
      {/* Players never had a reason to control music — only the GM runs the
          session soundtrack. The full bar is desktop-only (hidden on mobile
          via CSS, see index.css); mobile gets MiniPlayerBar below instead —
          a small "now playing" capsule that only exists while something is
          actually playing, tapping it opens NowPlayingPage. */}
      {!userLoading && !isPlayer && !playerHidden && (
        <div className="audio-player-slot">
          <AudioPlayerBar extras={<SoundBarExtras />} empty={<SoundSetEmpty />} />
        </div>
      )}
      {!userLoading && !isPlayer && !playerHidden && pathname !== "/now-playing" && <MiniPlayerBar />}
      {!userLoading && (
        <MobileBottomNav
          leftItems={bottomNavLeft}
          rightItems={bottomNavRight}
          onCenterClick={() => setQuickOpen((open) => !open)}
        />
      )}
      <MobileQuickAccess
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        contextualAction={contextualAction}
        showCharacters={!!isPlayer && !userLoading}
      />
      {boostyOpen && (
        <ExternalLinkConfirmModal
          title="Поддержать проект"
          message="Откроется в вашем браузере. SoyMan продолжит работу в этом окне."
          confirmLabel="Да, конечно"
          cancelLabel="Пожалуй, нет"
          icon="boosty"
          onClose={() => setBoostyOpen(false)}
          onConfirm={() => {
            setBoostyOpen(false);
            openExternalLink(BOOSTY_URL);
          }}
        />
      )}
    </div>
    </UndoDeleteProvider>
    </UnloadTargetsProvider>
    </SoundEngineProvider>
  );
}
