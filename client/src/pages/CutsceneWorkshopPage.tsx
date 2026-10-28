import { Link, useLocation, useParams } from "react-router-dom";
import type { CutsceneOriginal } from "@shared/cutscenes/types";
import { useResource } from "../data/hooks";
import { CUTSCENE_CATALOG_ROUTE, cutscenePaths, positiveCutsceneId } from "../data/cutscenes";
import { useIsMobile } from "../hooks/useIsMobile";
import { PageFrame } from "../components/PageFrame";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { CutsceneAccess } from "../components/cutscenes/CutsceneAccess";
import { CutsceneCover } from "../components/cutscenes/CutsceneCover";
import { CutsceneWorkshopEditor } from "../components/cutscenes/CutsceneWorkshopEditor";
import { CutsceneReading } from "../components/cutscenes/CutsceneReading";
import "../rich-text.css";
import "./cutscenes.css";
import "../components/cutscenes/cutscene-studio.css";

function Workshop() {
  const id = positiveCutsceneId(useParams().id), location = useLocation(), mobile = useIsMobile();
  const query = useResource<CutsceneOriginal>(id ? cutscenePaths.original(id) : null), original = query.data;
  const catalogSearch = (location.state as { catalogSearch?: string } | null)?.catalogSearch;
  const back = `${CUTSCENE_CATALOG_ROUTE}${catalogSearch ? `?${catalogSearch}` : ""}`;
  return <PageFrame className="cutscene-workshop-page" section="mastering" title={original?.document.name ?? "Катсцена"} actions={<Link className="button" to={back}>Каталог катсцен</Link>}
    state={{ loading: !original && query.loading, error: !id ? "Некорректный адрес катсцены" : !original ? query.error : null,
      errorTitle: "Не удалось открыть катсцену", onRetry: query.reload, skeleton: <ListSkeleton variant="paragraph" /> }}>
    {original && <>
      {query.error && <LoadErrorCard message={`Не удалось обновить катсцену: ${query.error}`} onRetry={query.reload} />}
      {original.archivedAt && <p className="reading-text cutscenes-intro">Катсцена в архиве.</p>}
      {mobile ? <><div className="cutscene-details">
        <CutsceneCover id={original.id} savedVersion={original.savedVersion} />
        <div className="reading-text"><p>{original.document.description || "Без описания."}</p><p className="muted">Редактирование, предпросмотр и показ доступны на компьютере.</p></div>
      </div><CutsceneReading id={original.id} document={original.document} /></>
        : <CutsceneWorkshopEditor key={original.id} original={original} />}
    </>}
  </PageFrame>;
}
export function CutsceneWorkshopPage() { return <CutsceneAccess><Workshop /></CutsceneAccess>; }
