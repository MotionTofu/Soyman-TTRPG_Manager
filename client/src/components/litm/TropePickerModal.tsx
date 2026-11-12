import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import {
  findLitmSystemId,
  loadLitmTropes,
  loadLitmThemeKits,
  findKit,
  tropeKitRef,
  type LitmTrope,
  type LitmThemeKit,
} from "./litmCompendium";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (trope: LitmTrope) => void;
}

export function TropePickerModal({ isOpen, onClose, onPick }: Props) {
  const [tropes, setTropes] = useState<LitmTrope[]>([]);
  const [kits, setKits] = useState<LitmThemeKit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      setLoading(true);
      try {
        const sysId = await findLitmSystemId();
        if (sysId) {
          const [t, k] = await Promise.all([loadLitmTropes(sysId), loadLitmThemeKits(sysId)]);
          setTropes(t);
          setKits(k);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isOpen]);

  function applyTrope(trope: LitmTrope) {
    onPick(trope);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose}>
      <h3 style={{ marginBottom: 12 }}>Выберите троп</h3>
      {loading ? (
        <div className="muted" style={{ textAlign: "center", padding: 20 }}>Загрузка…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {tropes.map(t => (
            <button
              key={t.id}
              onClick={() => applyTrope(t)}
              style={{
                textAlign: "left", cursor: "pointer",
                border: "2px solid var(--ink)", background: "var(--paper)",
                padding: 12, borderRadius: 0, fontFamily: "inherit",
              }}
            >
              <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}>
                {t.data.group}
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>
                {t.name.split(" [")[0]}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {t.data.themes_fixed.map((themebookEn: string) => {
                  const kit = findKit(kits, themebookEn, tropeKitRef(t, themebookEn));
                  return <span key={themebookEn} className={`tg litm-power-${kit?.data.might ?? ""}`} style={{ fontSize: "var(--fs-micro)" }}>{kit?.name ?? themebookEn}</span>;
                })}
              </div>
              <div style={{ fontSize: "var(--fs-meta)", color: "var(--ink-soft)" }}>
                Рюкзак: {t.data.backpack.join(", ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}