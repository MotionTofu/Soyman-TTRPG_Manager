import { useEffect, useRef, useState, type DragEvent } from "react";
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
import { EntityPreviewModal } from "../components/EntityPreviewModal";

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

// Типы, у которых у карточки есть тело — см. EntityPreviewContent. Список тот
// же, что принимает докстанция превью, и это не совпадение: рисует их одна и
// та же функция. Остальным результатам иконки карточки нет — пустая карточка с
// одним лишь именем, которое ты уже прочёл в строке, обещает больше, чем даёт.
const CARD_TYPES = ["being", "character", "location", "artifact", "resource", "compendium_entry"];

export function SearchPanel({ horizontal }: Props = {}) {
  const location = useLocation();
  const liveMatch = location.pathname.match(LIVE_SESSION_PATH);
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(TYPES.map((t) => t.key))
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Narrows compendium_entry results to the "D&D 5.5" system — handy when
  // dragging a feat/spell into a DnD statblock and other systems' entries of
  // the same name would otherwise clutter the results.
  const [dndOnly, setDndOnly] = useState(false);
  const [dndSystemId, setDndSystemId] = useState<number | null>(null);
  // Открытая карточка. Ради неё всё и затевалось: подглядеть правило, не уходя
  // со страницы, — за столом это чаще всего «что делает Опутанный».
  const [card, setCard] = useState<{ type: string; id: number } | null>(null);
  const { pins, pin, unpin } = usePinnedPages();

  useEffect(() => {
    api
      .get<{ id: number; name: string }[]>("/systems")
      .then((systems) => setDndSystemId(systems.find((s) => s.name === "D&D 5.5")?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
        // Не перехватывать "/" внутри набора механик/описаний — только когда фокус на body
        if (ae && ae !== document.body) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pinCurrentPage() {
    const path = location.pathname + location.search;
    pin(path, buildPageLabel(location.pathname, location.search));
  }

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      let url: string;
      if (isPlayer) {
        url = `/player/search?q=${encodeURIComponent(query)}`;
      } else {
        const types = Array.from(activeTypes).join(",");
        url = `/search?q=${encodeURIComponent(query)}&types=${types}`;
        if (dndOnly && dndSystemId != null) url += `&system_id=${dndSystemId}`;
      }
      try {
        const res = await api.get<SearchResult[]>(url, { signal: controller.signal } as RequestInit);
        setResults(res);
        setSearchError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResults([]);
        setSearchError(String(e));
      } finally {
        setIsSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
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
        <ParticleField count={2} />
        <strong>Поиск</strong>
      </div>
      <div className="row search-input-row">
        <div className="search-input-wrap">
          <input
            ref={inputRef}
            placeholder="Например: Гоблин (Ctrl+K, /)"
            aria-label="Поиск"
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
            aria-expanded={filtersOpen}
            aria-controls="search-filters"
          >
            Фильтры {activeTypes.size !== TYPES.length ? `· ${activeTypes.size}/${TYPES.length}` : ""}
          </button>
        )}
      </div>
      {!isPlayer && filtersOpen && (
        <div id="search-filters">
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
        </div>
      )}
      <div className="stack">
        {isSearching && (
          <div className="stack search-skeleton" aria-busy="true" aria-label="Загрузка">
            <div className="card search-skeleton-row" />
            <div className="card search-skeleton-row" />
            <div className="card search-skeleton-row" />
          </div>
        )}
        {searchError && !isSearching && (
          <span className="muted" style={{ color: "var(--status-cancelled-fg)", background: "var(--status-cancelled)", padding: "6px 8px", borderRadius: "var(--card-radius)" }}>
            Ошибка поиска: {searchError}
          </span>
        )}
        {!isSearching && !searchError && query.trim() && results.length === 0 && (
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
              {/* Не переносится: столбик действий должен оставаться у правого
                  края. Когда шапка переносилась, в узкой панели пара иконок
                  сваливалась под фишку типа и висела посреди строки ничьей.
                  Уступает длинный контекст — он и так подпись. */}
              <div className="search-result-head">
                <div className="search-result-head__left">
                  <div className={`entity-type-chip ${r.type}`}>{ENTITY_TYPE_SINGULAR[r.type] ?? r.type}</div>
                  {r.context && <span className="muted search-result-context">{r.context}</span>}
                </div>
                {/* Столбиком, а не рядом: ширина в этой колонке — то, чего не
                    хватает, и три мелкие кнопки одна под другой съедают её
                    меньше, чем три в ряд. */}
                <div className="search-result-actions">
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
                  {/* Карточку открывает только эта кнопка, а не щелчок по
                      строке: строка — источник перетаскивания, а короткое
                      перетаскивание браузер отдаёт как щелчок, и окно
                      выскакивало бы поверх того места, куда несут существо. */}
                  {CARD_TYPES.includes(r.type) && (
                    <button
                      type="button"
                      className="search-result-card"
                      title="Показать карточку"
                      onClick={() => setCard({ type: r.type, id: r.id })}
                    >
                      <NavIcon name="card" />
                    </button>
                  )}
                </div>
              </div>
              <div>{r.title}</div>
              {r.subtitle && <div className="muted">{r.subtitle}</div>}
            </div>
          );
        })}
      </div>
      {card && <EntityPreviewModal type={card.type} id={card.id} onClose={() => setCard(null)} />}
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
