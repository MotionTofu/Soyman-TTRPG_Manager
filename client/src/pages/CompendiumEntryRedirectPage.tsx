import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { CompendiumEntry } from "../types";

// Compendium entries have no standalone detail page — they only render
// inline inside a System's compendium tab. A @-mention token still needs
// somewhere to point, so this resolves the entry's system/section and
// forwards there with a deep-link query param that CompendiumSection uses
// to auto-expand and scroll to it.
export function CompendiumEntryRedirectPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    api.get<CompendiumEntry>(`/systems/entries/${id}`).then((entry) => {
      navigate(`/systems/${entry.system_id}?section=${entry.section_id}&entry=${entry.id}`, {
        replace: true,
      });
    });
  }, [id, navigate]);

  return <p className="muted">Переход…</p>;
}
