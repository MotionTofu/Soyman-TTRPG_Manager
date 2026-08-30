import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { NavIcon } from "./NavIcons";
import { CampaignWizard } from "./CampaignWizard";
import type { Setting, System } from "../types";

// Плитка «Новая кампания» — занимает четвёртый слот в ряду кампаний на главной.
// Ведёт себя как обычный CampaignCoverTile, но при клике проверяет наличие
// систем и сеттингов и открывает соответствующий визард.
export function CreateCampaignTile() {
  const navigate = useNavigate();
  const [systems, setSystems] = useState<System[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [_loaded, setLoaded] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showMissing, setShowMissing] = useState<"systems" | "settings" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      api.get<System[]>("/systems", { signal: controller.signal } as RequestInit),
      api.get<Setting[]>("/settings", { signal: controller.signal } as RequestInit),
    ]).then(([sysRes, setRes]) => {
      if (sysRes.status === "fulfilled") setSystems(sysRes.value);
      if (setRes.status === "fulfilled") setSettings(setRes.value);
      setLoaded(true);
    });
    return () => controller.abort();
  }, []);

  function handleClick() {
    if (systems.length === 0) {
      setShowMissing("systems");
    } else if (settings.length === 0) {
      setShowMissing("settings");
    } else {
      setShowWizard(true);
    }
  }

  return (
    <>
      <button type="button" className="card campaign-tile campaign-tile-create" onClick={handleClick}>
        <div className="campaign-tile-cover campaign-tile-create-cover">
          <div className="campaign-tile-create-icon">
            <NavIcon name="plus" />
          </div>
        </div>
        <div className="campaign-tile-meta">
          <div className="campaign-tile-system">Новая кампания</div>
          <div className="campaign-tile-next">
            <span>создать</span>
          </div>
        </div>
      </button>

      {showMissing === "systems" && (
        <div className="modal-backdrop" onClick={() => setShowMissing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="stack">
              <h3 style={{ margin: 0 }}>Нет систем</h3>
              <p className="muted" style={{ margin: 0 }}>
                Чтобы создать кампанию, сначала импортируйте или создайте систему правил
                (D&D 5.5, Legend in the Mist и т.д.).
              </p>
              <div className="row">
                <button className="primary" onClick={() => { setShowMissing(null); navigate("/systems"); }}>
                  Перейти к системам
                </button>
                <button onClick={() => setShowMissing(null)}>Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMissing === "settings" && (
        <div className="modal-backdrop" onClick={() => setShowMissing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="stack">
              <h3 style={{ margin: 0 }}>Нет сеттингов</h3>
              <p className="muted" style={{ margin: 0 }}>
                Для кампании нужен сеттинг — мир, в котором она происходит.
                Создайте его или импортируйте из существующего файла.
              </p>
              <div className="row">
                <button className="primary" onClick={() => { setShowMissing(null); navigate("/settings"); }}>
                  Перейти к сеттингам
                </button>
                <button onClick={() => setShowMissing(null)}>Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWizard && (
        <CampaignWizard
          systems={systems}
          settings={settings}
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            navigate(0);
          }}
        />
      )}
    </>
  );
}
