import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import {
  findLitmSystemId,
  loadLitmMagicWays,
  type LitmMagicWay,
} from "./litmCompendium";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (magicWay: LitmMagicWay) => void;
}

export function MagicWayPickerModal({ isOpen, onClose, onPick }: Props) {
  const [magicWays, setMagicWays] = useState<LitmMagicWay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      setLoading(true);
      try {
        const sysId = await findLitmSystemId();
        if (sysId) {
          const m = await loadLitmMagicWays(sysId);
          setMagicWays(m);
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
      <h3 style={{ marginBottom: 12 }}>Выбрать путь магии</h3>
      {loading ? (
        <div className="muted" style={{ textAlign: "center", padding: 20 }}>Загрузка…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {magicWays.map(m => (
            <button
              key={m.id}
              onClick={() => { onPick(m); onClose(); }}
              style={{
                textAlign: "left", cursor: "pointer",
                border: "2px solid var(--ink)", background: "var(--paper)",
                padding: 12, borderRadius: 0, fontFamily: "inherit",
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>
                {m.name}
              </div>
              {m.description && (
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
                  {m.description}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                Станет типом темы "Магия"
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}