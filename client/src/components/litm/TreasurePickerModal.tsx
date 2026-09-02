import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import {
  findLitmSystemId,
  loadLitmTreasures,
  type LitmTreasure,
} from "./litmCompendium";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (treasure: LitmTreasure) => void;
}

export function TreasurePickerModal({ isOpen, onClose, onPick }: Props) {
  const [treasures, setTreasures] = useState<LitmTreasure[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      setLoading(true);
      try {
        const sysId = await findLitmSystemId();
        if (sysId) {
          const t = await loadLitmTreasures(sysId);
          setTreasures(t);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose}>
      <h3 style={{ marginBottom: 12 }}>Выбрать из сокровищницы</h3>
      {loading ? (
        <div className="muted" style={{ textAlign: "center", padding: 20 }}>Загрузка…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {treasures.map(t => (
            <button
              key={t.id}
              onClick={() => { onPick(t); onClose(); }}
              style={{
                textAlign: "left", cursor: "pointer",
                border: "2px solid var(--ink)", background: "var(--paper)",
                padding: 12, borderRadius: 0, fontFamily: "inherit",
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>
                {t.name}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {t.tags.map((tag, i) => (
                  <span key={i} className="tg tg-story" style={{ fontSize: "var(--fs-meta)" }}>{tag}</span>
                ))}
              </div>
              <div style={{ fontSize: "var(--fs-meta)", color: "var(--ink-soft)" }}>
                Теги станут ключами силы темы
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}