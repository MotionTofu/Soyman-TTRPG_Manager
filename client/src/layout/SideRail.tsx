import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useEntity, useResource } from "../data/hooks";
import { isEntityKind } from "../data/entities";
import { sessionPaths } from "../data/sessions";
import { DETAIL_ROUTES } from "../entityTypes";
import { addToBag, useBag } from "../bag";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { NavIcon, type NavIconName } from "../components/NavIcons";
import { ContextMenu } from "../components/ContextMenu";
import { isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { PinnedPage } from "../pinnedPages";
import type { LiveSession, SearchResult } from "../types";
import type { SideModule, SideModuleId } from "./SideModules";
import { useRailTip } from "./RailTip";

// Узкая правая панель (гриллинг 2026-10-23, Q16–Q19): столбик значков вместо
// модулей. Щелчок по значку выдвигает окно одного модуля, панель остаётся
// узкой; закреплённое — аватарками-ссылками. Модули те же, что в широкой
// панели: состояние поиска и мешка живёт выше и при смене вида не теряется.

const MODULE_ICONS: Partial<Record<SideModuleId, NavIconName>> = { search: "search", bag: "bag", chat: "chat" };

// Знак раздела у закрепа без картинки — по первому сегменту пути.
const SECTION_ICONS: Record<string, NavIconName> = {
  campaigns: "campaigns", settings: "settings", systems: "systems", players: "players",
  canvas: "canvas", graph: "graph", maps: "map", mastering: "mastering", gallery: "image",
  "audio-library": "volume", sessions: "calendar", locations: "globe", beings: "adventurers",
  characters: "card", artifacts: "loot", adventures: "book", scenes: "document",
};

interface Props {
  modules: SideModule[];
  open: SideModuleId | null;
  setOpen: (id: SideModuleId | null) => void;
  live: LiveSession | null;
  pins: PinnedPage[];
  canPin: boolean;
  onPin: () => void;
  onUnpin: (path: string) => void;
  onExpand: () => void;
}

export function SideRail({ modules, open, setOpen, live, pins, canPin, onPin, onUnpin, onExpand }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const tip = useRailTip(true, "left");
  const { items } = useBag();
  const [bagOver, setBagOver] = useState(false);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const unread = useUnreadNotes(live?.id ?? null, open === "chat");
  const current = modules.find((m) => m.id === open);

  // Окно закрывается щелчком мимо и Esc. Перетаскивание щелчков не даёт —
  // пока несут из поиска, окно стоит. Окна-модалки (карточка из поиска)
  // живут в body: щелчок по ним «мимо» не считается, иначе модалка, нарисованная
  // самим модулем, закрылась бы вместе с окном.
  useEffect(() => {
    if (!open) return;
    const outside = (t: EventTarget | null) =>
      t instanceof Node && !rail.current?.contains(t) && !fly.current?.contains(t) && !(t instanceof Element && t.closest(".modal-backdrop, .context-menu"));
    const onDown = (e: PointerEvent) => { if (outside(e.target)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) setOpen(null); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (open === "search") requestAnimationFrame(() => fly.current?.querySelector<HTMLInputElement>("input")?.focus());
  }, [open]);

  function bagDrop(e: DragEvent) {
    e.preventDefault();
    setBagOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    try { addToBag(JSON.parse(raw) as SearchResult); } catch { /* не наш груз */ }
  }

  return (
    <div className="search-panel side-rail" ref={rail} {...tip.handlers}>
      <button type="button" className="side-rail__btn side-rail__expand" onClick={onExpand} aria-label="Развернуть панель">
        <NavIcon name="chevron" />
      </button>
      {modules.map((m) => {
        const icon = MODULE_ICONS[m.id];
        if (!icon) return null;
        const isBag = m.id === "bag";
        const badge = isBag ? items.length : m.id === "chat" ? unread : 0;
        return (
          <button
            key={m.id}
            type="button"
            className={`side-rail__btn${open === m.id ? " is-open" : ""}${isBag && bagOver ? " is-drop" : ""}`}
            aria-label={m.id === "chat" && live ? `Лента · Сессия №${live.session_number}` : m.title}
            aria-expanded={open === m.id}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            {...(isBag && {
              onDragOver: (e: DragEvent) => {
                if (!e.dataTransfer.types.includes(SEARCH_DRAG_MIME)) return;
                e.preventDefault();
                setBagOver(true);
              },
              onDragLeave: () => setBagOver(false),
              onDrop: bagDrop,
            })}
          >
            <NavIcon name={icon} />
            {badge > 0 && <span className="side-rail__badge">{badge}</span>}
          </button>
        );
      })}
      <div className="side-rail__pins">
        {pins.map((p) => (
          <PinAvatar
            key={p.path}
            pin={p}
            onMenu={(x, y) => setMenu({ path: p.path, x, y })}
          />
        ))}
        {canPin && (
          <button type="button" className="side-rail__btn side-rail__add" onClick={onPin} aria-label="Закрепить текущую страницу">
            <NavIcon name="plus" />
          </button>
        )}
      </div>
      {current && (
        <div className={`side-rail__fly side-module--${current.id}`} ref={fly} role="dialog" aria-label={current.title}>
          {current.node}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={pins.find((p) => p.path === menu.path)?.label}
          items={[{ label: "Открепить", onClick: () => onUnpin(menu.path) }]}
          onClose={() => setMenu(null)}
        />
      )}
      {tip.node}
    </div>
  );
}

// Закреп хранит только путь и подпись; картинку выводим из пути (Q11):
// у сущности — её обложка или портрет, у остальных — знак раздела и буква.
function PinAvatar({ pin, onMenu }: { pin: PinnedPage; onMenu: (x: number, y: number) => void }) {
  const m = pin.path.match(/^(\/[a-z-]+)\/(\d+)/);
  const type = m ? Object.keys(DETAIL_ROUTES).find((t) => DETAIL_ROUTES[t] === m[1]) : undefined;
  const kind = type && isEntityKind(type) ? type : null;
  const data = useEntity<Record<string, unknown>>(kind ?? "campaign", kind && m ? Number(m[2]) : null).data;
  const raw = data ? ((data.thumbnail_image_url ?? data.avatar_image_url ?? data.background_image_url) as string | null | undefined) : null;
  const safe = raw && isSafeImageUrl(raw) ? raw : null;
  const authed = useAuthenticatedFileUrl(safe?.startsWith("/files/") ? safe : null);
  const src = safe?.startsWith("/files/") ? authed : safe;
  const section = pin.path.split(/[/?]/)[1] ?? "";
  return (
    <Link
      to={pin.path}
      className="side-rail__pin"
      aria-label={pin.label}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <>
          <span className="side-rail__pin-letter" aria-hidden="true">{pin.label.trim().slice(0, 1).toUpperCase()}</span>
          {SECTION_ICONS[section] && <NavIcon name={SECTION_ICONS[section]} className="nav-icon side-rail__pin-icon" />}
        </>
      )}
    </Link>
  );
}

// Новые записи ленты с тех пор, как её последний раз видели. Старт — то, что
// уже было при появлении панели: прошлое вечера новым не считается.
function useUnreadNotes(sessionId: number | null, viewing: boolean): number {
  const count = useResource<{ notes: unknown[] }>(sessionId ? sessionPaths.notes(sessionId) : null).data?.notes.length;
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    if (count == null) return;
    if (seen == null || viewing) setSeen(count);
  }, [count, seen, viewing]);
  return count != null && seen != null ? Math.max(0, count - seen) : 0;
}
