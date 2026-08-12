import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { NavIcon, type NavIconName } from "../components/NavIcons";
import { usePinnedPages, buildPageLabel, MAX_PINS } from "../pinnedPages";

export interface QuickAccessContextualAction {
  label: string;
  icon: NavIconName;
  onClick: () => void;
}

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
}

// The sheet the mobile bottom nav's raised center button opens (ticket 13,
// §7.1 of the design doc + the grilling-resolved functional change in
// spec.md §"Мобильная навигация"): for the player role, their own character
// list on top (replacing the "Кабинет" bottom-nav slot, which now points at
// Главная instead — see AppShell.tsx), then pinned pages (same
// usePinnedPages/MAX_PINS mechanism the desktop NavWidget/SearchPanel use —
// pinning here shows up there too, same localStorage-backed store), a "pin
// current page" action, and an optional contextual action for the current
// screen.
export function MobileQuickAccess({
  open,
  onClose,
  contextualAction,
  showCharacters,
}: {
  open: boolean;
  onClose: () => void;
  contextualAction?: QuickAccessContextualAction | null;
  /** Player role only — fetches and lists the player's own characters above the pins. */
  showCharacters?: boolean;
}) {
  const { pins, pin, unpin } = usePinnedPages();
  const location = useLocation();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<MyCharacter[] | null>(null);

  useEffect(() => {
    if (!open || !showCharacters) return;
    api.get<{ characters: MyCharacter[] }>("/player/me").then((res) => setCharacters(res.characters));
  }, [open, showCharacters]);

  if (!open) return null;

  const path = location.pathname + location.search;
  const alreadyPinned = pins.some((p) => p.path === path);
  const atCap = pins.length >= MAX_PINS;

  return (
    <>
      <div className="mobile-quick-access-backdrop" onClick={onClose} />
      <div className="mobile-quick-access-sheet">
        <strong>Быстрый доступ</strong>
        {showCharacters && (
          <div className="mobile-quick-access-characters">
            <span className="muted">Персонажи</span>
            {characters === null && <p className="muted">Загрузка…</p>}
            {characters?.length === 0 && <p className="muted">У вас пока нет персонажей.</p>}
            {characters?.map((c) => (
              <button
                key={c.id}
                type="button"
                className="mobile-quick-access-link"
                onClick={() => {
                  navigate(`/characters/${c.id}`);
                  onClose();
                }}
              >
                <strong>{c.character_name}</strong>
                <span className="muted">{c.campaign_name ?? "без кампании"}</span>
              </button>
            ))}
          </div>
        )}
        <strong>Закреплённые страницы</strong>
        {pins.length === 0 && <p className="muted">Нет закреплённых страниц.</p>}
        {pins.map((p) => (
          <div key={p.path} className="mobile-quick-access-row">
            <button
              type="button"
              className="mobile-quick-access-link"
              onClick={() => {
                navigate(p.path);
                onClose();
              }}
            >
              {p.label}
            </button>
            <button type="button" className="comp-mini" title="Открепить" onClick={() => unpin(p.path)}>
              <NavIcon name="close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={atCap || alreadyPinned}
          onClick={() => pin(path, buildPageLabel(location.pathname, location.search))}
        >
          <NavIcon name="navPin" />
          {alreadyPinned
            ? "Страница уже закреплена"
            : atCap
              ? `Закреплено максимум (${MAX_PINS})`
              : "Закрепить текущую страницу"}
        </button>
        {contextualAction && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              contextualAction.onClick();
              onClose();
            }}
          >
            <NavIcon name={contextualAction.icon} />
            {contextualAction.label}
          </button>
        )}
      </div>
    </>
  );
}
