import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "../api/currentUser";
import { PageFrame } from "../components/PageFrame";
import { SectionBackground } from "../components/SectionBackground";
import { SoundLibraryTab } from "../components/SoundLibraryTab";
import { SoundSetsTab } from "../components/SoundSetsTab";
import { cutscenePaths, parseCutsceneCatalogFilter, type CutsceneSummary } from "../data/cutscenes";
import { useResource } from "../data/hooks";
import { openSecondWindow } from "../electronApi";
import { MEDIA_TABS, mediaTab, mediaUrl, type MediaTab } from "../media/routes";
import { useAudioOwnership } from "../sound/audioOwnership";
import type { SoundButton, SoundSetSummary } from "../sound/types";
import type { Resource } from "../types";
import { MediaGallery } from "../media/MediaGallery";
import { isGalleryResource } from "../media/galleryImages";
import { CutscenesPage } from "./CutscenesPage";
import "./media-library.css";

const LAST_TAB = "soyman.media.lastTab";

function lastTab(): MediaTab {
  try { return mediaTab(localStorage.getItem(LAST_TAB)) ?? "gallery"; }
  catch { return "gallery"; }
}

export function LegacyMediaRoute({ tab, nowPlaying = false }: { tab?: MediaTab; nowPlaying?: boolean }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  if (nowPlaying) params.set("playing", "1");
  return <Navigate replace to={mediaUrl(tab ?? lastTab(), params, hash)} />;
}

export function MediaLibraryPage() {
  const { user, loading } = useCurrentUser();
  const { search, hash } = useLocation();
  const tab = mediaTab(new URLSearchParams(search).get("tab"));
  const active = tab ?? lastTab();
  useEffect(() => {
    if (tab) {
      try { localStorage.setItem(LAST_TAB, tab); }
      catch { /* The URL still selects the current tab. */ }
    }
  }, [tab]);
  if (loading) return null;
  if (user?.role !== "gm") return <Navigate to="/" replace />;
  if (!tab) return <Navigate to={mediaUrl(active, search, hash)} replace />;
  if (active === "sound") return <MediaSound />;
  if (active === "cutscenes") return <CutscenesPage frame={(actions, content) => <MediaFrame tab="cutscenes" actions={actions}>{content}</MediaFrame>} />;
  return <MediaGallery frame={(actions, content) => <MediaFrame tab="gallery" actions={actions}>{content}</MediaFrame>} />;
}

const activeCutscenes = cutscenePaths.catalog(parseCutsceneCatalogFilter(new URLSearchParams()));

function MediaFrame({ tab, actions, children }: { tab: MediaTab; actions: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resources = useResource<Resource[]>("/resources").data;
  const sounds = useResource<SoundButton[]>("/sounds").data;
  const cutscenes = useResource<CutsceneSummary[]>(activeCutscenes).data;
  const counts = { gallery: resources?.filter(isGalleryResource).length, sound: sounds?.length, cutscenes: cutscenes?.length };
  return <PageFrame section="image" title="Медиатека" actions={actions} className="media-library">
    <SectionBackground />
    <div className="d-tabbed">
      <nav className="tabs d-tabs" aria-label="Разделы Медиатеки">
        {MEDIA_TABS.map(({ id, label }) => <button key={id} type="button" className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}
          onClick={() => {
            if (tab !== id) navigate(mediaUrl(id, params.has("playing") ? "playing=1" : ""));
          }}>{label}{counts[id] !== undefined && <b>{counts[id]}</b>}</button>)}
      </nav>
      <div className="d-sheet media-library__sheet">{children}</div>
    </div>
  </PageFrame>;
}

function MediaSound() {
  const [params, setParams] = useSearchParams();
  const sets = params.get("sound") === "sets" || params.has("set");
  const ownership = useAudioOwnership();
  const sounds = useResource<SoundButton[]>("/sounds");
  const soundSets = useResource<SoundSetSummary[]>("/sound-sets");
  function select(value: "sounds" | "sets") {
    const next = new URLSearchParams(params);
    if (value === "sets") next.set("sound", value);
    else {
      next.delete("sound");
      next.delete("set");
    }
    setParams(next);
  }
  return <MediaFrame tab="sound" actions={<button className="d-btn" type="button" onClick={() => openSecondWindow("/sound-console")}>Открыть пульт</button>}>
    <div className="d-seg media-sound__tabs" role="group" aria-label="Разделы звука">
      <button type="button" className={!sets ? "active" : ""} aria-pressed={!sets} onClick={() => select("sounds")}>Звуки <span>{sounds.data?.length}</span></button>
      <button type="button" className={sets ? "active" : ""} aria-pressed={sets} onClick={() => select("sets")}>Наборы <span>{soundSets.data?.length}</span></button>
    </div>
    {ownership?.scope === "all" && <p className="muted" role="status">Прослушивание приостановлено катсценой. После завершения запустите его заново.</p>}
    {sets ? <SoundSetsTab key={params.get("set") ?? ""} /> : <SoundLibraryTab />}
  </MediaFrame>;
}
