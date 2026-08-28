import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
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
  const [entry, setEntry] = useState<CompendiumEntry | null>(null);
  const [system, setSystem] = useState<System | null>(null);

  function load() {
    api.get<CompendiumEntry>(`/systems/entries/${id}`).then((e) => {
      if (!OWN_PAGE_KINDS.has(e.kind)) {
        navigate(`/systems/${e.system_id}?section=${e.section_id}&entry=${e.id}`, { replace: true });
        return;
      }
      setEntry(e);
      api.get<System>(`/systems/${e.system_id}`).then(setSystem);
    });
  }

  useEffect(load, [id, navigate]);

  if (!entry) return <p className="muted">Загрузка…</p>;
  if (entry.kind === "monster") return <MonsterDetailPage entry={entry} system={system} onChange={load} />;
  return <VehicleDetailPage entry={entry} system={system} onChange={load} />;
}
