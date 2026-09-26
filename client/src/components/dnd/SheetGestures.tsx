import "./sheet-chrome.css";

// Жесты листа (макет 2026-09-25, «как в тиндере»): при первом заходе на
// телефоне лист показывает, как им листать, — свайпов и двойного тапа не
// видно. Один раз на устройство; повторить — «Показать жесты» в меню «⋯».
// Общий для OneShot и основного SoyMan (гриллинг 2026-09-26, Q10).
const SEEN_KEY = "oneshot-sheet-gestures-seen";

export function gesturesSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markGesturesSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}

/** Показывать ли жесты сами: только телефон и только в первый раз. */
export function shouldAutoShowGestures(): boolean {
  return !gesturesSeen() && matchMedia("(max-width: 700px)").matches;
}

export function SheetGestures({ backTo, onClose }: { backTo: string; onClose: () => void }) {
  const gestures: [string, string, string][] = [
    ["⇆", "Свайп влево и вправо", "Соседняя карта: Действия, Магия, Снаряжение…"],
    ["→", "Свайп вправо на этой карте", backTo],
    ["✌", "Двойной тап по портрету", "Вся колода веером — прыгнуть сразу на нужную"],
    ["◢", "Уголок карты", "Оборот: отдых, цитата, постер, правка"],
  ];
  return (
    <div className="sheet-gestures" role="dialog" aria-modal="true" aria-label="Как листать карты">
      <strong className="sheet-gestures-title">Лист — это колода</strong>
      <span className="sheet-gestures-sub">Покажем один раз. Повторить — в меню ⋯</span>
      {gestures.map(([icon, title, text]) => (
        <div key={title} className="sheet-gestures-row">
          <span aria-hidden="true">{icon}</span>
          <span>
            <b>{title}</b>
            {text}
          </span>
        </div>
      ))}
      <button type="button" autoFocus onClick={onClose}>
        Понятно
      </button>
    </div>
  );
}
