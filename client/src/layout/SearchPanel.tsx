import { useEffect, useState, type DragEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import type { SearchResult } from "../types";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { ACCEPT_TYPES as DOCK_ACCEPT_TYPES } from "./PreviewDock";
import { addPreviewDockCard } from "../previewDockStore";
import { ENTITY_TYPES as TYPES, ENTITY_TYPE_SINGULAR, DETAIL_ROUTES } from "../entityTypes";
import { usePinnedPages, buildPageLabel, MAX_PINS } from "../pinnedPages";
import { ParticleField } from "../components/ParticleField";
import { NavIcon } from "../components/NavIcons";
import { BagWidget } from "../components/BagWidget";
import { InitiativeTracker } from "../components/InitiativeTracker";

// Most types deep-link via DETAIL_ROUTES/:id; compendium entries instead
// live inside a System's tab and need system_id+section_id to open at.
function resultLink(r: SearchResult): string | null {
  if (r.type === "compendium_entry") {
    return r.system_id != null ? `/systems/${r.system_id}?section=${r.section_id}&entry=${r.id}` : null;
  }
  return DETAIL_ROUTES[r.type] ? `${DETAIL_ROUTES[r.type]}/${r.id}` : null;
}

interface Props {
  horizontal?: boolean;
}

const LIVE_SESSION_PATH = /^\/sessions\/(\d+)\/live$/;

export function SearchPanel({ horizontal }: Props = {}) {
  const location = useLocation();
  const liveMatch = location.pathname.match(LIVE_SESSION_PATH);
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(TYPES.map((t) => t.key))
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Narrows compendium_entry results to the "D&D 5.5" system — handy when
  // dragging a feat/spell into a DnD statblock and other systems' entries of
  // the same name would otherwise clutter the results.
  const [dndOnly, setDndOnly] = useState(false);
  const [dndSystemId, setDndSystemId] = useState<number | null>(null);
  const { pins, pin, unpin } = usePinnedPages();

  useEffect(() => {
    api
      .get<{ id: number; name: string }[]>("/systems")
      .then((systems) => setDndSystemId(systems.find((s) => s.name === "D&D 5.5")?.id ?? null))
      .catch(() => {});
  }, []);

  function pinCurrentPage() {
    const path = location.pathname + location.search;
    pin(path, buildPageLabel(location.pathname, location.search));
  }

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      let url: string;
      if (isPlayer) {
        // /api/search is a GM-only tool with no visibility scoping (surfaces
        // secrets/GM notes text in results) — players get the separately
        // scoped /api/player/search instead (own characters, world-exploration
        // entries in own campaigns, compendium entries in own campaigns'
        // systems). No type/system filters there — it's already narrow.
        url = `/player/search?q=${encodeURIComponent(query)}`;
      } else {
        const types = Array.from(activeTypes).join(",");
        url = `/search?q=${encodeURIComponent(query)}&types=${types}`;
        if (dndOnly && dndSystemId != null) url += `&system_id=${dndSystemId}`;
      }
      const res = await api.get<SearchResult[]>(url);
      setResults(res);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, activeTypes, dndOnly, dndSystemId, isPlayer]);

  function toggleType(key: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, result: SearchResult) {
    e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(result));
    e.dataTransfer.effectAllowed = "link";
  }

  return (
    <div className={`search-panel${horizontal ? " horizontal" : ""}`}>
      <div className="search-heading">
        <ParticleField count={5} />
        <strong>Поиск</strong>
      </div>
      <div className="row search-input-row">
        <div className="search-input-wrap">
          <input
            placeholder="Например: Гоблин"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="search-input-clear"
              title="Очистить"
              onClick={() => setQuery("")}
            >
              <NavIcon name="close" />
            </button>
          )}
        </div>
        {!isPlayer && (
          <button
            type="button"
            className={filtersOpen ? "active-sort" : ""}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Фильтры
          </button>
        )}
      </div>
      {!isPlayer && filtersOpen && (
        <>
          <div className="row">
            <button onClick={() => setActiveTypes(new Set(TYPES.map((t) => t.key)))}>
              Выбрать всё
            </button>
            <button onClick={() => setActiveTypes(new Set())}>Сбросить фильтры</button>
          </div>
          <div className="filters">
            {TYPES.map((t) => (
              <label key={t.key}>
                <input
                  type="checkbox"
                  checked={activeTypes.has(t.key)}
                  onChange={() => toggleType(t.key)}
                />
                {t.label}
              </label>
            ))}
            {dndSystemId != null && (
              <label>
                <input
                  type="checkbox"
                  checked={dndOnly}
                  onChange={() => setDndOnly((v) => !v)}
                />
                DnD 5,5
              </label>
            )}
          </div>
        </>
      )}
      <div className="stack">
        {query.trim() && results.length === 0 && (
          <span className="muted">Ничего не найдено</span>
        )}
        {results.map((r) => {
          const link = resultLink(r);
          // The pult's PreviewDock only accepts drag-and-drop, which doesn't
          // fire from a touch gesture — this button is the tap equivalent,
          // shown only where the dock is actually the drop target (the live
          // session page) and only for types it accepts.
          const canDock = !!liveMatch && DOCK_ACCEPT_TYPES.includes(r.type);
          return (
            <div
              key={`${r.type}-${r.id}`}
              className="search-result"
              draggable
              onDragStart={(e) => handleDragStart(e, r)}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <div className={`entity-type-chip ${r.type}`}>{ENTITY_TYPE_SINGULAR[r.type] ?? r.type}</div>
                  {r.context && <span className="muted" style={{ fontSize: 12 }}>{r.context}</span>}
                </div>
                <div className="row" style={{ gap: 4, alignItems: "center" }}>
                  {canDock && (
                    <button
                      type="button"
                      className="search-result-dock-add"
                      title="Добавить в докстанцию превью"
                      onClick={() => addPreviewDockCard({ type: r.type, id: r.id })}
                    >
                      <NavIcon name="plus" />
                    </button>
                  )}
                  {link && (
                    <Link to={link} title="Перейти" className="search-result-goto">
                      <NavIcon name="arrowRight" />
                    </Link>
                  )}
                </div>
              </div>
              <div>{r.title}</div>
              {r.subtitle && <div className="muted">{r.subtitle}</div>}
            </div>
          );
        })}
      </div>
      {liveMatch ? <InitiativeTracker sessionId={Number(liveMatch[1])} /> : horizontal ? null : <BagWidget />}
      <div className="search-pins">
        <strong>Закреплённые страницы</strong>
        {pins.map((p) => (
          <div key={p.path} className="search-pin-row row" style={{ justifyContent: "space-between" }}>
            <Link to={p.path} title={p.label}>
              {p.label}
            </Link>
            <button
              type="button"
              className="comp-mini"
              title="Открепить"
              onClick={() => unpin(p.path)}
            >
              <NavIcon name="close" />
            </button>
          </div>
        ))}
        {pins.length < MAX_PINS && (
          <button type="button" onClick={pinCurrentPage}>
            Закрепить текущую страницу
          </button>
        )}
      </div>
    </div>
  );
}
