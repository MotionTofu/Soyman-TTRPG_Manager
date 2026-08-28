import { useEffect, useState } from "react";
import { Modal } from "../Modal";
import {
  findLitmSystemId,
  loadLitmTropes,
  loadLitmThemeKits,
  type LitmTrope,
  type LitmThemeKit,
} from "./litmCompendium";
import { emptyTheme } from "./ThemeCard";

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
          const [t, k] = await Promise.all([
            loadLitmTropes(sysId),
            loadLitmThemeKits(sysId),
          ]);
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
    const kitsByThemebook = new Map<string, LitmThemeKit[]>();
    for (const kit of kits) {
      const arr = kitsByThemebook.get(kit.themebookEn) ?? [];
      arr.push(kit);
      kitsByThemebook.set(kit.themebookEn, arr);
    }

    const allTypes = [...trope.data.themes_fixed];
    allTypes.map((themebookEn) => {
      const themebookKits = kitsByThemebook.get(themebookEn) ?? [];
      const kit = themebookKits[0];
      return {
        ...emptyTheme(),
        themeType: themebookEn,
        power: kit?.data.might ?? "",
        name: kit ? `${kit.name.split(" [")[0]} [${themebookEn}]` : themebookEn,
        powerTags: kit?.data.powerTags ?? [],
        weaknessTags: kit?.data.weaknessTags ?? [],
        quest: kit?.data.quest ?? "",
      };
    });

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
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}>
                {t.data.group}
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>
                {t.name.split(" [")[0]}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {t.data.themes_fixed.map((themebookEn: string) => {
                  const kit = kits.find(k => k.themebookEn === themebookEn);
                  return <span key={themebookEn} className={`tg litm-power-${kit?.data.might ?? ""}`} style={{ fontSize: 10 }}>{kit?.name.split(" [")[0] ?? themebookEn}</span>;
                })}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                Рюкзак: {t.data.backpack.join(", ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}