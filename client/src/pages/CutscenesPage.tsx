import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useResource } from "../data/hooks";
import { useCutsceneAction } from "../cutscenes/useCutsceneAction";
import { updateCutsceneCatalogParams, cutscenePaths, cutsceneRoute, cutscenes, parseCutsceneCatalogFilter, type CutsceneSummary, type CutsceneCatalogFilter } from "../data/cutscenes";
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
import "./cutscenes.css";
import "../components/cutscenes/cutscene-studio.css";

function Catalog() {
  const [params, setParams] = useSearchParams(), filter = parseCutsceneCatalogFilter(params);
  const latestParams = useRef(params); latestParams.current = params;
  const navigate = useNavigate(), mobile = useIsMobile(), run = useCutsceneAction();
  const [creating, setCreating] = useState(false), [duplicating, setDuplicating] = useState<number | null>(null);
  const list = useResource<CutsceneSummary[]>(cutscenePaths.catalog(filter), { keepPrevious: true });
  const total = useResource<CutsceneSummary[]>(cutscenePaths.catalog({ ...filter, search: "", campaignId: null, archive: "all", sort: "updated", order: "desc" }));
  const campaigns = useResource<Campaign[]>("/campaigns");
  const update = (patch: Partial<CutsceneCatalogFilter>) => {
    latestParams.current = updateCutsceneCatalogParams(latestParams.current, patch);
    setParams(latestParams.current, { replace: true });
  };
  const reset = () => { latestParams.current = new URLSearchParams(); setParams(latestParams.current, { replace: true }); };
  const catalogState = { catalogSearch: params.toString() };
  async function duplicate(id: number) {
    if (duplicating !== null) return;
    setDuplicating(id);
    try { const copy = await run("Дублировать катсцену", () => cutscenes.duplicate(id)); if (copy) navigate(cutsceneRoute(copy.id), { state: catalogState }); }
    finally { setDuplicating(null); }
  }
  const rows = list.data ?? [];
  return <div className="cutscenes-catalog"><ListPage headingSection="mastering" title="Катсцены" groups={[]} allLabel={null} activeGroup={null} onGroupChange={() => {}}
    actions={<Link to="/mastering" className="button">Библиотека</Link>} createLabel="Новая катсцена" onCreate={mobile ? undefined : () => setCreating(true)}
    search={filter.search} onSearch={search => update({ search })} searchLabel="Поиск катсцен" searchPlaceholder="Название или описание…"
    filteredCount={rows.length} totalCount={total.data?.length ?? rows.length} onResetSearch={reset}
    showReset={!!filter.search || !!filter.campaignId || filter.archive !== "active" || filter.sort !== "updated" || filter.order !== "desc"}
    toolbarExtra={<div className="cutscenes-filters">
      <label>Кампания<select value={filter.campaignId ?? ""} disabled={campaigns.loading || !!campaigns.error} onChange={event => update({ campaignId: event.target.value ? Number(event.target.value) : null })}>
        <option value="">Все кампании</option>{campaigns.data?.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select></label>
      <label>Архив<select value={filter.archive} onChange={event => update({ archive: event.target.value as CutsceneCatalogFilter["archive"] })}>
        <option value="active">Активные</option><option value="archived">В архиве</option><option value="all">Все</option>
      </select></label>
      <label>Сортировка<select value={`${filter.sort}:${filter.order}`} onChange={event => { const [sort, order] = event.target.value.split(":"); update({ sort: sort as CutsceneCatalogFilter["sort"], order: order as CutsceneCatalogFilter["order"] }); }}>
        <option value="updated:desc">Сначала изменённые</option><option value="updated:asc">Сначала старые</option><option value="name:asc">Название: А—Я</option><option value="name:desc">Название: Я—А</option>
      </select></label>
    </div>}>
    {mobile && <p className="muted">На телефоне доступны каталог и тексты. Мастерская и управление показом — на компьютере.</p>}
    {campaigns.error && <LoadErrorCard message={`Не удалось загрузить кампании: ${campaigns.error}`} onRetry={campaigns.reload} />}
    <Loadable loading={list.loading} error={list.error} errorTitle="Не удалось загрузить катсцены" onRetry={list.reload} skeleton={<ListSkeleton variant="tiles" />}
      empty={!rows.length ? <EmptyState kind={filter.search || filter.campaignId || filter.archive !== "active" ? "search" : "primary"}
        title={filter.search || filter.campaignId || filter.archive !== "active" ? "Катсцен по этим условиям нет" : "Место для вашей истории"}
        hint="Подготовьте изображения, музыку и текст для игрового стола."
        action={filter.search || filter.campaignId || filter.archive !== "active" ? <button onClick={reset}>Сбросить фильтры</button> : !mobile ? <button className="primary" onClick={() => setCreating(true)}>Создать катсцену</button> : undefined} /> : null}>
      <div className="grid-cards cutscenes-grid">{rows.map(item => <article key={item.id} className="card cutscene-tile">
        <Link className="cutscene-tile__open" to={cutsceneRoute(item.id)} state={catalogState}>
          <CutsceneCover id={item.id} savedVersion={item.savedVersion} />
          <div className="cutscene-tile__copy"><h2>{item.name}</h2>{item.description && <p className="cutscene-tile__description">{item.description}</p>}
            <span className="muted">Общий оригинал{item.archivedAt ? " · В архиве" : ""}</span>
            <time className="muted" dateTime={item.updatedAt}>Изменено {new Date(item.updatedAt).toLocaleDateString("ru-RU")}</time>
          </div>
        </Link>
        {!mobile && <div className="cutscene-tile__actions">{!item.archivedAt && <CutsceneLaunchActions id={item.id} name={item.name} />}<details className="cs-more"><summary aria-label={`Другие действия катсцены «${item.name}»`}>⋯</summary><div><CutsceneArchiveAction id={item.id} name={item.name} archived={!!item.archivedAt} /><button type="button" disabled={duplicating !== null} aria-label={`Дублировать катсцену «${item.name}»`} onClick={() => { void duplicate(item.id); }}>{duplicating === item.id ? "Дублирование…" : "Дублировать"}</button></div></details></div>}
      </article>)}</div>
    </Loadable>
    {creating && !mobile && <CreateCutsceneModal onClose={() => setCreating(false)} onCreated={id => navigate(cutsceneRoute(id), { state: catalogState })} />}
  </ListPage></div>;
}
export function CutscenesPage() { return <CutsceneAccess><Catalog /></CutsceneAccess>; }
