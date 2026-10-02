import { useState, type ReactNode } from "react";

/**
 * Тост карты и чертежа: сообщение на пять секунд, иногда с «Отменить».
 * Живёт у владельца картинки — ядро (PinBoard) и сам владелец шлют в одно
 * место.
 */
export function useMapToast(): [ReactNode, (msg: string, onUndo?: () => void) => void] {
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);

  function show(msg: string, onUndo?: () => void) {
    setToast({ msg, onUndo });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 5000);
  }

  const node = toast && (
    <div className="location-map-toast">
      <span>{toast.msg}</span>
      {toast.onUndo && (
        <button
          type="button"
          className="location-map-toast-undo"
          onClick={() => {
            const cb = toast.onUndo;
            setToast(null);
            cb?.();
          }}
        >
          Отменить
        </button>
      )}
      <button type="button" className="location-map-toast-close" onClick={() => setToast(null)} aria-label="Закрыть">
        ×
      </button>
    </div>
  );
  return [node, show];
}
