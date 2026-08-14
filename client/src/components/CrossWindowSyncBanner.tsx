import { useCrossWindowDataSync } from "../dataSync";

// Полоска «данные изменились в другом окне». Обычно её не видно: окно
// обновляется само, как только в него возвращаются. Она остаётся, только если
// в этот момент в окне что-то правят — тогда обновление предлагается кнопкой,
// а не выполняется поверх недописанного текста.
export function CrossWindowSyncBanner() {
  const { stale, refresh } = useCrossWindowDataSync();
  if (!stale) return null;
  return (
    <div className="cross-window-banner">
      <span>Данные изменились в другом окне.</span>
      <button className="primary" onClick={refresh}>
        Обновить
      </button>
    </div>
  );
}
