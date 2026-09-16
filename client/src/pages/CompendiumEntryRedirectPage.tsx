import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoadErrorCard } from "../components/Loadable";
import { useEntity, useResource } from "../data/hooks";
import { MonsterDetailPage } from "./MonsterDetailPage";
import { VehicleDetailPage } from "./VehicleDetailPage";
import type { CompendiumEntry, System } from "../types";

// Compendium entries have no standalone detail page of their own — they
// normally only render inline inside a System's compendium tab. A @-mention
// token still needs somewhere to point, so for every kind except "monster"
// and the Транспорт kinds ("vehicle"/"vehicle_post")
// this resolves the entry's system/section and forwards there with a
// deep-link query param that CompendiumSection uses to auto-expand and
// scroll to it. "monster" entries (Бестиарий) get an actual profile page
// instead — see MonsterDetailPage.
// Виды записей со своей страницей: у существа — досье и карточка, у
// транспорта — статблок поста и список постов судна.
const OWN_PAGE_KINDS = new Set(["monster", "vehicle", "vehicle_post"]);

export function CompendiumEntryRedirectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const entryState = useEntity<CompendiumEntry>("compendium_entry", id ? Number(id) : null);
  const loaded = entryState.data;
  const ownPage = !!loaded && OWN_PAGE_KINDS.has(loaded.kind);
  const system = useResource<System>(loaded && ownPage ? `/systems/${loaded.system_id}` : null).data ?? null;

  useEffect(() => {
    if (!loaded || ownPage) return;
    navigate(`/systems/${loaded.system_id}?section=${loaded.section_id}&entry=${loaded.id}`, { replace: true });
  }, [loaded, ownPage, navigate]);

  if (entryState.error && !loaded) {
    return <LoadErrorCard message={<>Не удалось загрузить запись: {entryState.error}</>} onRetry={entryState.reload} />;
  }
  if (!loaded || !ownPage) return <p className="muted">Загрузка…</p>;
  const entry = loaded;
  if (entry.kind === "monster") return <MonsterDetailPage entry={entry} system={system} />;
  return <VehicleDetailPage entry={entry} system={system} />;
}
