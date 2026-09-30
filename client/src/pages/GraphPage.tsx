import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import { RelationGraph } from "../components/RelationGraph";
import { TYPE_LABELS, GRAPH_VIEW_EDGE_KINDS, GRAPH_VIEW_HIDDEN_TYPES, type GraphData, type GraphView, type EdgeKind } from "../graphTypes";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import type { Campaign, Setting } from "../types";

const DEPTH_OPTIONS = [1, 2, 3];

// С сервера приходят все типы: скрытые по умолчанию (GRAPH_VIEW_HIDDEN_TYPES)
// прячет сам граф, иначе их нельзя было бы включить обратно.
const ALL_TYPES = Object.keys(TYPE_LABELS).join(",");

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
  const settingsState = useResource<Setting[]>("/settings");
  const campaignsState = useResource<Campaign[]>("/campaigns");
  const settings = settingsState.data ?? NO_SETTINGS;
  const campaigns = campaignsState.data ?? NO_CAMPAIGNS;
  const [settingId, setSettingId] = useState<number | "">("");
  // null — кампанию ещё не выбирали: граф приключений тогда открывается на
  // кампании с самой свежей сыгранной сессией — со сценами: пустой ваншот на
  // холсте ничего не покажет (Q5), граф мира — на всех.
  const [pickedCampaign, setCampaignId] = useState<number | "" | null>(null);
  const latestCampaign = campaigns.reduce<Campaign | null>(
    (best, c) => (c.last_played_date && (!best || c.last_played_date > (best.last_played_date ?? "")) ? c : best),
    null,
  );
  // «Показать в графе» ведёт к узлу любой кампании — умолчание его не прячет.
  const campaignId = pickedCampaign ?? (view === "adventures" && !settingId && !focus && latestCampaign ? latestCampaign.id : "");
  const scopeError = settingsState.error ?? campaignsState.error;
  // Точки (`role=spot`) в граф по умолчанию не идут: 25 комнат данжа давали
  // паутину (план «Зоны», этап 10). Обитание перепривязано на родителя.
  const [showSpots, setShowSpots] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<EdgeKind>>(() => defaultEdgeKinds(view));

  // Смена графа сбрасывает виды рёбер на умолчания нового графа.
  useEffect(() => {
    setActiveKinds(defaultEdgeKinds(view));
  }, [view]);

  const params = new URLSearchParams({ types: ALL_TYPES, view });
  if (campaignId) params.set("campaign_id", String(campaignId));
  else if (settingId) params.set("setting_id", String(settingId));
  if (showSpots) params.set("spots", "1");
  if (focus) {
    params.set("focus", focus);
    params.set("depth", String(depth));
  }
  // Прежний граф держится, пока грузится граф с новыми фильтрами.
  // Умолчание кампании ещё не известно — не грузить граф всех кампаний зря.
  const waitDefault = view === "adventures" && pickedCampaign === null && !focus && !campaignsState.data;
  const graph = useResource<GraphData>(waitDefault ? null : `/links/graph?${params.toString()}`, { keepPrevious: true });
  const data = graph.data ?? null;
  const error = graph.error;

  // Campaigns belong to a setting, so narrowing by campaign only makes sense
  // within the currently chosen setting (or "any" if none chosen yet).
  const campaignsInScope = settingId
    ? campaigns.filter((c) => c.setting_id === settingId)
    : campaigns;

  const viewTitle = view === "adventures" ? "Связи приключений" : "Связи миров";

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
        key={view}
        view={view}
        layered={view === "adventures"}
        focusKey={focus}
        data={data}
        defaultHiddenTypes={GRAPH_VIEW_HIDDEN_TYPES[view]}
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
            {view === "world" && (
              <label className="row" style={{ gap: 6, alignItems: "center" }} title="Показывать точки (комнаты) как узлы">
                <input
                  type="checkbox"
                  checked={showSpots}
                  onChange={(e) => setShowSpots(e.target.checked)}
                />
                Точки
              </label>
            )}
          </>
        }
      />
    </div>
  );
}
