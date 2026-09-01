import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { RelationGraph } from "../components/RelationGraph";
import { TYPE_LABELS, type GraphData } from "../graphTypes";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import type { Campaign, Setting } from "../types";

const DEPTH_OPTIONS = [1, 2, 3];

export function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Окрестность одной сущности живёт в адресе, а не в состоянии: на неё ведут
  // ссылки «Показать в графе» с карточек, и такую ссылку можно сохранить.
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get("focus");
  const depth = Number(searchParams.get("depth")) || 2;
  const [activeTypes] = useState<Set<string>>(
    () => new Set(Object.keys(TYPE_LABELS))
  );
  const [settings, setSettings] = useState<Setting[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settingId, setSettingId] = useState<number | "">("");
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Setting[]>("/settings")
      .then((v) => { if (!cancelled) setSettings(v); })
      .catch((e: unknown) => { if (!cancelled) setScopeError(e instanceof Error ? e.message : "Не удалось загрузить сеттинги"); });
    api.get<Campaign[]>("/campaigns")
      .then((v) => { if (!cancelled) setCampaigns(v); })
      .catch((e: unknown) => { if (!cancelled) setScopeError(e instanceof Error ? e.message : "Не удалось загрузить кампании"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const types = Array.from(activeTypes).join(",");
    const params = new URLSearchParams({ types });
    if (campaignId) params.set("campaign_id", String(campaignId));
    else if (settingId) params.set("setting_id", String(settingId));
    if (focus) {
      params.set("focus", focus);
      params.set("depth", String(depth));
    }
    api.get<GraphData>(`/links/graph?${params.toString()}`, { signal: controller.signal })
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки графа");
      });
    return () => controller.abort();
  }, [activeTypes, settingId, campaignId, focus, depth]);

  // Campaigns belong to a setting, so narrowing by campaign only makes sense
  // within the currently chosen setting (or "any" if none chosen yet).
  const campaignsInScope = settingId
    ? campaigns.filter((c) => c.setting_id === settingId)
    : campaigns;

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <SectionHeading section="graph">Граф связей</SectionHeading>
      {scopeError && (
        <div className="error-banner">
          {scopeError}
          <button type="button" onClick={() => setScopeError(null)}>Закрыть</button>
        </div>
      )}
      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>Повторить</button>
        </div>
      )}
      {focus && (
        <div className="row relation-graph-focus-panel">
          <strong>
            Окрестность: {data?.nodes.find((n) => n.key === focus)?.title ?? "выбранная сущность"}
          </strong>
          <span className="muted">шагов от центра:</span>
          {DEPTH_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={depth === d ? "active-sort" : ""}
              onClick={() =>
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("focus", focus);
                  next.set("depth", String(d));
                  return next;
                })
              }
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("focus");
                next.delete("depth");
                return next;
              })
            }
          >
            Показать весь граф
          </button>
        </div>
      )}
      <RelationGraph
        data={data}
        layoutKey={campaignId ? `campaign:${campaignId}` : settingId ? `setting:${settingId}` : "global"}
        emptyMessage={
          activeTypes.size === 0
            ? "Все типы сняты в фильтрах — отметьте хотя бы один."
            : undefined
        }
        scopeBar={
          <>
            <select
              value={settingId}
              onChange={(e) => {
                setSettingId(e.target.value ? Number(e.target.value) : "");
                setCampaignId("");
              }}
            >
              <option value="">Все сеттинги ({settings.length})</option>
              {settings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Все кампании ({campaignsInScope.length})</option>
              {campaignsInScope.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}
