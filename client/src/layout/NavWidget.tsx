import { useLocation, useNavigate } from "react-router-dom";
import { NavIcon } from "../components/NavIcons";
import { useNavWidgetPrefs } from "../navWidgetPrefs";
import { usePinnedPages, buildPageLabel, MAX_PINS } from "../pinnedPages";
import { useNearestSessionCockpitId } from "../nearestSessionCockpit";

// Floating navigation widget: scroll-to-top/bottom, browser back, and pin
// (shares storage with the search panel's pin list — same 7-pin cap).
// Position/label prefs come from Внешний вид → Поисковый виджет; visual
// styling is entirely CSS-var based (.nav-widget in index.css) so it
// automatically matches whatever theme is active, same as every other card.
export function NavWidget() {
  const { prefs } = useNavWidgetPrefs();
  const { pins, pin } = usePinnedPages();
  const location = useLocation();
  const navigate = useNavigate();
  const cockpitId = useNearestSessionCockpitId();

  function scrollTop() {
    document.querySelector(".app-content")?.scrollTo({ top: 0, behavior: "smooth" });
  }
  function scrollBottom() {
    const el = document.querySelector(".app-content");
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
  function goBack() {
    navigate(-1);
  }
  function pinHere() {
    const path = location.pathname + location.search;
    pin(path, buildPageLabel(location.pathname, location.search));
  }

  const atCap = pins.length >= MAX_PINS;
  const alreadyPinned = pins.some((p) => p.path === location.pathname + location.search);

  // `divider` отбивает «Пульт сессии» от утилит: это единственная кнопка-
  // переход в ряду, и без отбивки её приходилось искать чтением подписей.
  // Отбивка стоит с обеих сторон и остаётся видимой, даже когда сессии нет
  // и акцентная заливка погашена — иначе группировка пропадала бы ровно
  // тогда, когда она объясняет, почему кнопка неактивна.
  type WidgetItem =
    | { kind: "divider"; key: string }
    | {
        kind: "button";
        key: string;
        icon: Parameters<typeof NavIcon>[0]["name"];
        label: string;
        onClick: () => void;
        disabled?: boolean;
        title?: string;
        className?: string;
      };

  const items: WidgetItem[] = [
    { kind: "button", key: "up", icon: "navUp", label: "Наверх", onClick: scrollTop },
    { kind: "button", key: "down", icon: "navDown", label: "Вниз", onClick: scrollBottom },
    { kind: "button", key: "back", icon: "navBack", label: "Назад", onClick: goBack },
    { kind: "divider", key: "div-cockpit" },
    {
      kind: "button",
      key: "cockpit",
      icon: "navCockpit",
      label: "Пульт сессии",
      className: "nav-widget-button-cockpit",
      onClick: () => navigate(`/sessions/${cockpitId}/live`),
      disabled: !cockpitId,
      title: cockpitId ? "Перейти к ближайшей сессии" : "Нет запланированных сессий",
    },
    { kind: "divider", key: "div-pin" },
    {
      kind: "button",
      key: "pin",
      icon: "navPin",
      label: "Закрепить",
      onClick: pinHere,
      disabled: atCap || alreadyPinned,
      title: alreadyPinned ? "Страница уже закреплена" : atCap ? `Уже закреплено ${MAX_PINS} страниц` : "Закрепить текущую страницу",
    },
  ];

  return (
    <div className={`nav-widget nav-widget-${prefs.position}${prefs.showLabels ? "" : " nav-widget-compact"}`}>
      {items.map((it) =>
        it.kind === "divider" ? (
          <span key={it.key} className="nav-widget-divider" aria-hidden="true" />
        ) : (
          <button
            key={it.key}
            type="button"
            className={`nav-widget-button${it.className ? ` ${it.className}` : ""}`}
            onClick={it.onClick}
            disabled={it.disabled}
            title={it.title ?? it.label}
          >
            <NavIcon name={it.icon} />
            {prefs.showLabels && <span>{it.label}</span>}
          </button>
        )
      )}
    </div>
  );
}
