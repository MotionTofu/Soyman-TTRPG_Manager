import { useEffect, useState } from "react";
import { api } from "../api/client";
import { RelationGraph } from "../components/RelationGraph";
import { TYPE_LABELS, TYPE_COLORS, type GraphData } from "../graphTypes";
import { SectionHeading } from "../components/SectionHeading";
import type { Campaign, Setting } from "../types";

export function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(Object.keys(TYPE_LABELS))
  );
  const [settings, setSettings] = useState<Setting[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settingId, setSettingId] = useState<number | "">("");
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    api.get<Setting[]>("/settings").then(setSettings);
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  useEffect(() => {
    const types = Array.from(activeTypes).join(",");
    const params = new URLSearchParams({ types });
    if (campaignId) params.set("campaign_id", String(campaignId));
    else if (settingId) params.set("setting_id", String(settingId));
    api.get<GraphData>(`/links/graph?${params.toString()}`).then(setData);
  }, [activeTypes, settingId, campaignId]);

  function toggleType(key: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Campaigns belong to a setting, so narrowing by campaign only makes sense
  // within the currently chosen setting (or "any" if none chosen yet).
  const campaignsInScope = settingId
    ? campaigns.filter((c) => c.setting_id === settingId)
    : campaigns;

  return (
    <div className="stack">
      <SectionHeading section="graph">Граф связей</SectionHeading>
      <p className="muted">
        Визуализация всех связей между сущностями. Тащите фон, чтобы перемещаться, крутите колесо, чтобы
        приближать. Клик по узлу — выделить и приблизить его; поиск — быстро найти и перейти к сущности.
      </p>
      <div className="row">
        <label className="row" style={{ gap: 6 }}>
          Сеттинг
          <select
            value={settingId}
            onChange={(e) => {
              setSettingId(e.target.value ? Number(e.target.value) : "");
              setCampaignId("");
            }}
          >
            <option value="">Все сеттинги</option>
            {settings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          Кампания
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Все кампании</option>
            {campaignsInScope.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className={filtersOpen ? "active-sort" : ""}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Фильтры
        </button>
      </div>
      {filtersOpen && (
        <>
          <div className="row">
            <button onClick={() => setActiveTypes(new Set(Object.keys(TYPE_LABELS)))}>
              Выбрать всё
            </button>
            <button onClick={() => setActiveTypes(new Set())}>Сбросить фильтры</button>
          </div>
          <div className="filters">
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={activeTypes.has(key)}
                  onChange={() => toggleType(key)}
                />
                <span style={{ color: TYPE_COLORS[key] }}>●</span> {label}
              </label>
            ))}
          </div>
        </>
      )}
      <RelationGraph data={data} />
    </div>
  );
}
