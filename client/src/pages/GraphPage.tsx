import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import { RelationGraph } from "../components/RelationGraph";
import { TYPE_LABELS, GRAPH_VIEW_EDGE_KINDS, type GraphData, type GraphView, type EdgeKind } from "../graphTypes";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import type { Campaign, Setting } from "../types";

const DEPTH_OPTIONS = [1, 2, 3];

// Типы, отключённые по умолчанию — не несут полезной структуры для графа связей,
// но засоряют его (сцены, приключения, кампании — операционные сущности, а не то,
// что ищет пользователь при просмотре связей).
const DEFAULT_DISABLED_TYPES = new Set(["scene", "adventure", "campaign"]);
const DEFAULT_ACTIVE_TYPES = new Set(Object.keys(TYPE_LABELS).filter((t) => !DEFAULT_DISABLED_TYPES.has(t)));

// Виды рёбер, включённые по умолчанию для каждого графа.
function defaultEdgeKinds(view: GraphView): Set<EdgeKind> {
  return new Set(GRAPH_VIEW_EDGE_KINDS[view].filter((k) => k !== "mention"));
}

const NO_SETTINGS: Setting[] = [];
const NO_CAMPAIGNS: Campaign[] = [];

export function GraphPage() {
  const { view: viewParam } = useParams<{ view?: string }>();
  const view: GraphView = viewParam === "adventures" ? "adventures" : "world";
  // Окрестность одной сущности живёт в адресе, а не в состоянии: на неё ведут
  // ссылки «Показать в графе» с карточек, и такую ссылку можно сохранить.
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get("focus");
  const depth = Number(searchParams.get("depth")) || 2;
  const activeTypes = DEFAULT_ACTIVE_TYPES;
  const settingsState = useResource<Setting[]>("/settings");
  const campaignsState = useResource<Campaign[]>("/campaigns");
  const settings = settingsState.data ?? NO_SETTINGS;
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  const [settingId, setSettingId] = useState<number | "">("");
  const [campaignId, setCampaignId] = useState<number | "">("");
  const scopeError = settingsState.error ?? campaignsState.error;
  // Точки (`role=spot`) в граф по умолчанию не идут: 25 комнат данжа давали
  // паутину (план «Зоны», этап 10). Обитание перепривязано на родителя.
  const [showSpots, setShowSpots] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<EdgeKind>>(() => defaultEdgeKinds(view));

  // Смена графа сбрасывает виды рёбер на умолчания нового графа.
  useEffect(() => {
    setActiveKinds(defaultEdgeKinds(view));
  }, [view]);

  const types = Array.from(activeTypes).join(",");
  const params = new URLSearchParams({ types, view });
  if (campaignId) params.set("campaign_id", String(campaignId));
  else if (settingId) params.set("setting_id", String(settingId));
  if (showSpots) params.set("spots", "1");
  if (focus) {
    params.set("focus", focus);
    params.set("depth", String(depth));
  }
  // Прежний граф держится, пока грузится граф с новыми фильтрами.
  const graph = useResource<GraphData>(`/links/graph?${params.toString()}`, { keepPrevious: true });
  const data = graph.data ?? null;
  const error = graph.error;

  // Campaigns belong to a setting, so narrowing by campaign only makes sense
  // within the currently chosen setting (or "any" if none chosen yet).
  const campaignsInScope = settingId
    ? campaigns.filter((c) => c.setting_id === settingId)
    : campaigns;

  const viewTitle = view === "adventures" ? "Граф приключений" : "Граф мира";

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <SectionHeading section="graph">{viewTitle}</SectionHeading>
      {scopeError && (
        <div className="error-banner">
          {scopeError}
          <button type="button" onClick={() => { settingsState.reload(); campaignsState.reload(); }}>Повторить</button>
        </div>
      )}
      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={graph.reload}>Повторить</button>
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
        layoutKey={`${view}:${campaignId ? `campaign:${campaignId}` : settingId ? `setting:${settingId}` : "global"}`}
        emptyMessage={undefined}
        activeKinds={activeKinds}
        onActiveKindsChange={setActiveKinds}
        edgeKinds={GRAPH_VIEW_EDGE_KINDS[view]}
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
            <label className="row" style={{ gap: 6, alignItems: "center" }} title="Показывать точки (комнаты) как узлы">
              <input
                type="checkbox"
                checked={showSpots}
                onChange={(e) => setShowSpots(e.target.checked)}
              />
              Точки
            </label>
          </>
        }
      />
    </div>
  );
}
