import { useEffect, useState } from "react";
import type { CompendiumEntry, CompendiumSection } from "./types";

interface Props {
  systemId: number;
  systemName: string;
}

// Same read-only rendering as player-app's CompendiumView (sections →
// self-nesting entries), just fetching from the existing GM routes
// (GET /api/systems/:id/sections + /:id/entries) instead of the
// player-scoped /api/player/compendium/:id — no new backend needed.
export function CompendiumView({ systemId, systemName }: Props) {
  const [sections, setSections] = useState<CompendiumSection[] | null>(null);
  const [entries, setEntries] = useState<CompendiumEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      window.gmApp.apiGet<CompendiumSection[]>(`/api/systems/${systemId}/sections`),
      window.gmApp.apiGet<CompendiumEntry[]>(`/api/systems/${systemId}/entries`),
    ])
      .then(([s, e]) => {
        setSections(s);
        setEntries(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [systemId]);

  if (error) return <p className="error">{error}</p>;
  if (!sections || !entries) return <p className="muted">Загрузка…</p>;

  const bySection = sections
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((section) => ({
      section,
      topLevel: entries.filter((e) => e.section_id === section.id && !e.parent_id),
    }));

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Компендиум — {systemName}</h2>
      {bySection.map(({ section, topLevel }) => (
        <details key={section.id} className="card">
          <summary>
            <strong className="entry-title">{section.name}</strong>
          </summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {topLevel.length === 0 && <span className="muted">Пусто.</span>}
            {topLevel.map((entry) => (
              <EntryRow key={entry.id} entry={entry} allEntries={entries} />
            ))}
          </div>
        </details>
      ))}
      {sections.length === 0 && <p className="muted">В этой системе пока нет компендиума.</p>}
    </div>
  );
}

function EntryRow({ entry, allEntries }: { entry: CompendiumEntry; allEntries: CompendiumEntry[] }) {
  const children = allEntries.filter((e) => e.parent_id === entry.id);
  return (
    <details className="card" style={{ padding: 8 }}>
      <summary>
        <strong>{entry.name}</strong>
        {entry.level != null && <span className="muted"> — ур. {entry.level}</span>}
      </summary>
      <div className="stack" style={{ marginTop: 6, gap: 4 }}>
        {entry.description && <div style={{ whiteSpace: "pre-wrap" }}>{entry.description}</div>}
        <DataFields data={entry.data} />
        {children.length > 0 && (
          <div className="stack" style={{ marginLeft: 12, marginTop: 4 }}>
            {children.map((child) => (
              <EntryRow key={child.id} entry={child} allEntries={allEntries} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function DataFields({ data }: { data: string }) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data || "{}");
  } catch {
    return null;
  }
  const fields = Object.entries(parsed).filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && v.length === 0));
  if (fields.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 2 }}>
      {fields.map(([key, value]) => (
        <span key={key} className="muted">
          {key}: {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </span>
      ))}
    </div>
  );
}
