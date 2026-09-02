import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { stripMentions } from "../mentions";

// Слушает broadcast "show-entries" (GM нажал «Показать игрокам» в справочнике) и
// показывает карточки на устройстве игрока — как «показать изображение», но для записей.
// Работает и у GM, и у игрока: оба получают событие, но GM уже видел карточку, поэтому
// модалка открывается у всех, кто слушает realtime (RealtimeListener расширяет socket).
export function ShowEntriesListener() {
  const [entries, setEntries] = useState<{ id: number; name: string; description: string; kind: string }[] | null>(null);

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent).detail as { entries?: { id: number; name: string; description: string; kind: string }[] };
      if (detail?.entries && Array.isArray(detail.entries) && detail.entries.length > 0) {
        setEntries(detail.entries);
      }
    }
    window.addEventListener("show-entries" as unknown as string, onShow as EventListener);
    return () => window.removeEventListener("show-entries" as unknown as string, onShow as EventListener);
  }, []);

  if (!entries) return null;
  return (
    <Modal onClose={() => setEntries(null)}>
      <div className="stack">
        <h3>Мастер показывает записи</h3>
        {entries.map((en) => (
          <div key={en.id} className="card">
            <h4 style={{ margin: 0 }}>{en.name || "Без названия"}</h4>
            <div className="muted" style={{ fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{en.kind}</div>
            {en.description ? (
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{stripMentions(en.description)}</div>
            ) : (
              <div className="muted" style={{ marginTop: 8 }}>Без описания</div>
            )}
          </div>
        ))}
        <button className="primary" onClick={() => setEntries(null)}>Понятно</button>
      </div>
    </Modal>
  );
}
