// Сброс раскладки блоков пульта из чужой ветки дерева: кнопка живёт в строке
// хлебных крошек (AppShell), а сетка — в странице. Тем же приёмом, что
// PREVIEW_DOCK_EXPAND_EVENT: событие, без общих пропсов.
export const PULT_GRID_RESET_EVENT = "pult-grid-reset";

export function requestPultGridReset() {
  window.dispatchEvent(new Event(PULT_GRID_RESET_EVENT));
}
