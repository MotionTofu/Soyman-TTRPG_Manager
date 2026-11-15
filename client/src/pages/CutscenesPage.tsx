import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import { useCutsceneAction } from "../cutscenes/useCutsceneAction";
import { updateCutsceneCatalogParams, cutscenePaths, cutsceneRoute, cutscenes, parseCutsceneCatalogFilter, type CutsceneSummary, type CutsceneCatalogFilter } from "../data/cutscenes";
import type { CutsceneOriginal } from "@shared/cutscenes/types";
import { Modal } from "../components/Modal";
import { PageFrame } from "../components/PageFrame";
import { RegTiles, useListView } from "../components/ListRegistry";
import { CutsceneReading } from "../components/cutscenes/CutsceneReading";
import type { Campaign } from "../types";
import { useIsMobile } from "../hooks/useIsMobile";
import { ListPage } from "../components/ListPage";
import { Loadable, ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { CutsceneAccess } from "../components/cutscenes/CutsceneAccess";
import { CutsceneCover } from "../components/cutscenes/CutsceneCover";
import { CutsceneArchiveAction } from "../components/cutscenes/CutsceneArchiveAction";
import { CutsceneLaunchActions } from "../components/cutscenes/CutsceneLaunchActions";
import { CreateCutsceneModal } from "../components/cutscenes/CreateCutsceneModal";
import { plural } from "../sceneKinds";
import "./cutscenes.css";
import "../components/cutscenes/cutscene-studio.css";

type CatalogFrame = (actions: ReactNode, content: ReactNode) => ReactNode;
const defaultFrame: CatalogFrame = (actions, content) => <PageFrame title="Катсцены" actions={actions}>{content}</PageFrame>;

function Catalog({ frame }: { frame: CatalogFrame }) {
  const [params, setParams] = useSearchParams(), filter = parseCutsceneCatalogFilter(params);
  const latestParams = useRef(params); latestParams.current = params;
  const navigate = useNavigate(), mobile = useIsMobile(), run = useCutsceneAction();
  const [creating, setCreating] = useState(false), [duplicating, setDuplicating] = useState<number | null>(null);
  const [reading, setReading] = useState<CutsceneSummary | null>(null);
  const [view, setView] = useListView("cutscenes");
  const list = useResource<CutsceneSummary[]>(cutscenePaths.catalog(filter), { keepPrevious: true });
  const total = useResource<CutsceneSummary[]>(cutscenePaths.catalog({ ...filter, search: "", campaignId: null, archive: "all", sort: "updated", order: "desc" }));
  const campaigns = useResource<Campaign[]>("/campaigns");
  const update = (patch: Partial<CutsceneCatalogFilter>) => {
    latestParams.current = updateCutsceneCatalogParams(latestParams.current, patch);
    setParams(latestParams.current, { replace: true });
  };
  const reset = () => update({ search: "", campaignId: null, archive: "active", sort: "updated", order: "desc" });
  const catalogState = { catalogSearch: params.toString() };
  async function duplicate(id: number) {
    if (duplicating !== null) return;
    setDuplicating(id);
    try { const copy = await run("Дублировать катсцену", () => cutscenes.duplicate(id)); if (copy) navigate(cutsceneRoute(copy.id), { state: catalogState }); }
    finally { setDuplicating(null); }
  }
  const rows = list.data ?? [];
  const matchingArchive = total.data?.filter(item => !!item.archivedAt === (filter.archive === "archived")).length;
  const activeCount = total.data?.filter(item => !item.archivedAt).length;
  const archivedCount = total.data?.filter(item => !!item.archivedAt).length;
  const searchActive = !!filter.search || !!filter.campaignId;
  const campaignsInCatalog = total.data?.every(item => item.campaigns !== undefined)
    ? new Set(total.data.flatMap(item => item.campaigns ?? [])) : null;
  const campaignChoices = campaigns.data?.filter(campaign =>
    campaign.id === filter.campaignId || !campaignsInCatalog || campaignsInCatalog.has(campaign.name));
  function orderBy(sort: CutsceneCatalogFilter["sort"]) {
    update({ sort, order: filter.sort === sort ? (filter.order === "asc" ? "desc" : "asc") : sort === "name" ? "asc" : "desc" });
  }
  function card(item: CutsceneSummary) {
    const route = cutsceneRoute(item.id);
    const steps = item.stepCount === undefined ? null : `${item.stepCount} ${plural(item.stepCount, "кадр", "кадра", "кадров")}`;
    return <article key={item.id} className={view === "tiles" ? "reg-tile media-cutscene" : "media-cutscene media-cutscene--row"}>
      {view === "tiles" && <div className="media-cutscene__cover">
        <Link to={route} state={catalogState} aria-label={`Открыть: ${item.name}`} tabIndex={-1}>
          <CutsceneCover id={item.id} savedVersion={item.savedVersion} />
        </Link>
        {steps && <span className="d-plate media-cutscene__steps">{steps}</span>}
      </div>}
      <div className="media-cutscene__copy">
        <h2><Link to={route} state={catalogState}>{item.name}</Link></h2>
        <div className="media-cutscene__campaigns">
          {item.campaigns?.length ? item.campaigns.map(name => <span key={name} className="d-tag">{name}</span>) : <span className="d-tag">Ни в одной</span>}
        </div>
        {item.description && <p className="cutscene-tile__description">{item.description}</p>}
      </div>
      <div className="media-cutscene__actions">
        {view === "rows" && steps && <span className="d-note">{steps}</span>}
        {!mobile && !item.archivedAt && <CutsceneLaunchActions id={item.id} name={item.name} catalog />}
      </div>
      <details className="cs-more media-cutscene__menu">
        <summary aria-label={`Другие действия катсцены «${item.name}»`}>⋯</summary>
        <div>
          {!mobile && <Link to={route} state={catalogState}>Открыть мастерскую</Link>}
          {!mobile && <button type="button" disabled={duplicating !== null} aria-label={`Дублировать катсцену «${item.name}»`}
            onClick={() => void duplicate(item.id)}>{duplicating === item.id ? "Дублирование…" : "Дублировать"}</button>}
          <button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setReading(item); }}>Читать текст</button>
          {!mobile && <CutsceneArchiveAction id={item.id} name={item.name} archived={!!item.archivedAt} />}
        </div>
      </details>
    </article>;
  }
  return frame(!mobile && <button type="button" className="d-btn d-btn--primary" onClick={() => setCreating(true)}>+ Новая катсцена</button>, <>
    <ListPage title="Катсцены" ds embedded groups={[]} activeGroup={filter.archive} allLabel={null} ungroupedLabel={null}
      extraTabs={[{ id: "active", label: "Активные", count: activeCount }, { id: "archived", label: "Архив", count: archivedCount }]}
      onGroupChange={group => update({ archive: group === "archived" ? "archived" : "active" })}
      search={filter.search} onSearch={search => update({ search })} searchLabel="Поиск катсцен" searchPlaceholder="Название или описание…"
      filteredCount={rows.length} totalCount={(filter.archive === "all" ? total.data?.length : matchingArchive) ?? rows.length} onResetSearch={reset}
      showReset={searchActive || filter.archive === "all" || filter.sort !== "updated" || filter.order !== "desc"}
      view={view} onViewChange={setView}
      filters={<div className="media-cutscene__filters">
        <div className="media-chips" role="group" aria-label="Кампания">
          <span className="media-chips__label">Кампания</span>
          <button className="d-tag" type="button" aria-pressed={!filter.campaignId} onClick={() => update({ campaignId: null })}>Все</button>
          {campaignChoices?.map(campaign => <button key={campaign.id} className="d-tag" type="button" aria-pressed={filter.campaignId === campaign.id}
            onClick={() => update({ campaignId: campaign.id })}>{campaign.name}</button>)}
        </div>
        <div className="media-chips" role="group" aria-label="Сортировка">
          <span className="media-chips__label">Порядок</span>
          <button className="d-tag" type="button" aria-pressed={filter.sort === "updated"} onClick={() => orderBy("updated")}>
            {filter.sort === "updated" && filter.order === "asc" ? "Сначала старые" : "Изменённые"}</button>
          <button className="d-tag" type="button" aria-pressed={filter.sort === "name"} onClick={() => orderBy("name")}>
            {filter.sort === "name" && filter.order === "desc" ? "Я–А" : "А–Я"}</button>
        </div>
      </div>}>
      {campaigns.error && <LoadErrorCard message={`Не удалось загрузить кампании: ${campaigns.error}`} onRetry={campaigns.reload} />}
      <Loadable loading={list.loading} error={list.error} errorTitle="Не удалось загрузить катсцены" onRetry={list.reload} skeleton={<ListSkeleton variant="tiles" />}
        empty={!rows.length ? <EmptyState kind={searchActive ? "search" : "primary"}
          title={searchActive ? "Катсцен по этим условиям нет" : filter.archive === "archived" ? "В архиве пока нет катсцен" : "Катсцен пока нет"}
          action={searchActive ? <button className="d-btn" onClick={reset}>Сбросить фильтры</button> : undefined} /> : null}>
        {view === "tiles" ? <RegTiles>{rows.map(card)}</RegTiles> : <div className="media-cutscene__rows" aria-label="Список катсцен">{rows.map(card)}</div>}
      </Loadable>
    </ListPage>
    {creating && !mobile && <CreateCutsceneModal onClose={() => setCreating(false)} onCreated={id => navigate(cutsceneRoute(id), { state: catalogState })} />}
    {reading && <CatalogReading item={reading} onClose={() => setReading(null)} />}
  </>);
}

function CatalogReading({ item, onClose }: { item: CutsceneSummary; onClose: () => void }) {
  const original = useResource<CutsceneOriginal>(cutscenePaths.original(item.id));
  return <Modal wide ariaLabel={item.name} onClose={onClose}>
    <h2>{item.name}</h2>
    <Loadable loading={original.loading} error={original.error} errorTitle="Не удалось открыть текст катсцены" onRetry={original.reload} skeleton={<ListSkeleton variant="paragraph" />}>
      {original.data && <CutsceneReading id={item.id} document={original.data.document} />}
    </Loadable>
  </Modal>;
}

export function CutscenesPage({ frame = defaultFrame }: { frame?: CatalogFrame }) {
  return <CutsceneAccess><Catalog frame={frame} /></CutsceneAccess>;
}
