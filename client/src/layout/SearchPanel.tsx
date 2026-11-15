import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { APP_SEARCH_EVENT, entityMark } from "../pageMenu";
import { Link, useLocation } from "react-router-dom";
import { useResource } from "../data/hooks";
import { useSearch } from "../data/search";
import { useCurrentUser } from "../api/currentUser";
import type { LiveSession, SearchResult } from "../types";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { ACCEPT_TYPES as DOCK_ACCEPT_TYPES } from "./PreviewDock";
import { addPreviewDockCard } from "../previewDockStore";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";
import { usePinnedPages, buildPageLabel, MAX_PINS } from "../pinnedPages";
import { NavIcon } from "../components/NavIcons";
import { BagWidget } from "../components/BagWidget";
import { useMapWorkspace } from "../maps/workspace/workspaceContext";
import { placementSource } from "../maps/workspace/tokenPlacement";
import { InitiativeTracker } from "../components/InitiativeTracker";
import { EntityPreviewModal } from "../components/EntityPreviewModal";
import { SessionNotesChat } from "../components/SessionNotesChat";
import { sessionPaths } from "../data/sessions";
import { SideModules, type SideModule, type SideModuleId } from "./SideModules";
import { SideRail } from "./SideRail";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { loadSideLayout, saveSideLayout, SIDE_NARROW_EVENT, type SideLayout } from "./sideLayout";
import { SearchFilters } from "./SearchFilters";
import { SearchResultFragments } from "./SearchResultFragments";
import { DEFAULT_SEARCH_FILTERS, panelSearchPaths, scopeLabel, searchFilterCount, searchResultLink } from "./searchPanelModel";
import { useSearchScopes } from "./useSearchScopes";
import "./search-panel.css";

interface Props {
  workspace?: boolean;
  horizontal?: boolean;
  // Панель живёт в слоте AppShell и сама не знает, открыта ли она оверлеем:
  // по любому уходу в новый раздел просим родителя закрыться.
  onNavigate?: () => void;
}

const LIVE_SESSION_PATH = /^\/sessions\/(\d+)\/live$/;

// Типы, у которых у карточки есть тело — см. EntityPreviewContent. Список тот
// же, что принимает докстанция превью, и это не совпадение: рисует их одна и
// та же функция. Остальным результатам иконки карточки нет — пустая карточка с
// одним лишь именем, которое ты уже прочёл в строке, обещает больше, чем даёт.
const CARD_TYPES = ["being", "character", "location", "artifact", "resource", "compendium_entry"];

export function SearchPanel({ horizontal, workspace = false, onNavigate }: Props = {}) {
  const location = useLocation();
  const liveMatch = location.pathname.match(LIVE_SESSION_PATH);
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const inputRef = useRef<HTMLInputElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filtersId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(DEFAULT_SEARCH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Открытая карточка. Ради неё всё и затевалось: подглядеть правило, не уходя
  // со страницы, — за столом это чаще всего «что делает Опутанный».
  const [card, setCard] = useState<{ type: string; id: number } | null>(null);
  const mapPlacement = useMapWorkspace()?.placement;
  const { pins, pin, unpin } = usePinnedPages();
  // Модули панели: свёрнутые и высоты, заданные ползунками (Q41, Q48).
  const [layout, setLayout] = useState<SideLayout>(loadSideLayout);
  // Идущая сессия — одна на приложение; пока она есть, в панели её лента.
  const live = useResource<LiveSession | null>(isPlayer || horizontal ? null : sessionPaths.live()).data ?? null;
  const scopes = useSearchScopes(!isPlayer && filtersOpen, live);
  // Узкий вид — везде, кроме Пульта: там панели свои и не меняются (Q12′).
  // На телефоне панель — шторка, там узкий вид не нужен.
  const desktop = useMediaQuery("(min-width: 861px)");
  const narrow = !!layout.narrow && desktop && !liveMatch && !horizontal && !workspace;
  const [railOpen, setRailOpen] = useState<SideModuleId | null>(null);

  function setNarrow(value: boolean) {
    setRailOpen(null);
    setLayout((prev) => {
      const next = { ...prev, narrow: value };
      saveSideLayout(next);
      return next;
    });
  }

  function toggleModule(id: SideModuleId) {
    setLayout((prev) => {
      const collapsed = prev.collapsed.includes(id) ? prev.collapsed.filter((c) => c !== id) : [...prev.collapsed, id];
      const next = { ...prev, collapsed };
      saveSideLayout(next);
      return next;
    });
  }
  // Заголовок модуля — он же переключатель: щелчок по названию сворачивает.
  function titleOf(id: SideModuleId, text: string) {
    if (horizontal || workspace || narrow) return <strong>{text}</strong>;
    return (
      <button type="button" className="side-module-title" title="Свернуть" aria-expanded onClick={() => toggleModule(id)}>
        {text}
      </button>
    );
  }

  useEffect(() => {
    function reveal() {
      if (narrow) return setRailOpen("search");
      if (!workspace) setLayout((prev) => {
        if (!prev.collapsed.includes("search")) return prev;
        const next = { ...prev, collapsed: prev.collapsed.filter((c) => c !== "search") };
        saveSideLayout(next);
        return next;
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const ae = document.activeElement as HTMLElement | null;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
        // Не перехватывать "/" внутри набора механик/описаний — только когда фокус на body
        if (ae && ae !== document.body) return;
        e.preventDefault();
        reveal();
      }
    }
    // «Найти в приложении» из ПКМ выделенного текста (§6.12, Q10).
    function onSearch(e: Event) {
      setQuery((e as CustomEvent<string>).detail);
      reveal();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(APP_SEARCH_EVENT, onSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(APP_SEARCH_EVENT, onSearch);
    };
  }, [workspace, narrow]);

  // ] и F4 из оболочки сворачивают панель до значков, а не прячут её.
  useEffect(() => {
    if (horizontal) return;
    const onNarrow = (e: Event) => {
      const want = (e as CustomEvent<boolean | undefined>).detail;
      setRailOpen(null);
      setLayout((prev) => {
        const next = { ...prev, narrow: want ?? !prev.narrow };
        saveSideLayout(next);
        return next;
      });
    };
    window.addEventListener(SIDE_NARROW_EVENT, onNarrow);
    return () => window.removeEventListener(SIDE_NARROW_EVENT, onNarrow);
  }, [horizontal]);

  function pinCurrentPage() {
    const path = location.pathname + location.search;
    pin(path, buildPageLabel(location.pathname, location.search));
  }

  const paths = panelSearchPaths(query, filters);
  const entitySearch = useSearch(isPlayer
    ? (query.trim() ? `/player/search?q=${encodeURIComponent(query)}` : null)
    : paths.entities);
  const bookSearch = useSearch(isPlayer ? null : paths.books, 200, 120_000);
  const isSearching = entitySearch.searching || bookSearch.searching;
  const searchError = entitySearch.error;
  const resultMap = new Map<string, SearchResult>();
  for (const result of entitySearch.searching ? [] : entitySearch.results) resultMap.set(`${result.type}:${result.id}`, result);
  for (const result of bookSearch.searching ? [] : bookSearch.results) resultMap.set(`${result.type}:${result.id}`, result);
  const results = [...resultMap.values()];
  const activeCount = searchFilterCount(filters);

  function handleDragStart(e: DragEvent<HTMLDivElement>, result: SearchResult) {
    e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(result));
    e.dataTransfer.effectAllowed = "link";
  }

  const searchBody = (
    <div className="side-search" onKeyDown={event => {
      if (!filtersOpen || event.key !== "Escape") return;
      event.stopPropagation();
      setFiltersOpen(false);
      filterButton.current?.focus();
    }}>
      <div className="search-heading">
        <div className="side-search-heading-title"><NavIcon name="search" />{titleOf("search", "Поиск")}</div>
        <kbd aria-label="Горячая клавиша: косая черта">/</kbd>
      </div>
      <div className="row search-input-row">
        <div className="search-input-wrap">
          <input
            className="d-input"
            ref={inputRef}
            placeholder="Имя, правило или фраза"
            aria-label="Поиск"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="search-input-clear"
              title="Очистить"
              aria-label="Очистить запрос"
              onClick={() => setQuery("")}
            >
              <NavIcon name="close" />
            </button>
          )}
        </div>
        {!isPlayer && (
          <button
            type="button"
            ref={filterButton}
            className="d-btn d-btn--sm side-search-toggle"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
          >
            Фильтры{activeCount > 0 && <span className="side-search-filter-count">{activeCount}</span>}
          </button>
        )}
      </div>
      {!isPlayer && filtersOpen && (
        <SearchFilters id={filtersId} value={filters} scopes={scopes} onChange={setFilters} />
      )}
      <div className="side-search-results">
        {entitySearch.searching && (
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
        {bookSearch.searching && <span className="side-search-status" role="status">Ищу по тексту книг…</span>}
        {bookSearch.error && !bookSearch.searching && <span className="side-search-status" role="alert">
          Поиск по тексту книг: {bookSearch.error}
        </span>}
        {results.length > 0 && <div className="side-search-status" aria-live="polite">
          <span>Результаты · {results.length}</span>
          {!isPlayer && <span title={filters.scope?.name}>{scopeLabel(filters.scope)}</span>}
        </div>}
        {!isSearching && !searchError && !bookSearch.error && query.trim() && results.length === 0 && (
          <div className="side-search-empty" role="status">
            <span>{filters.scope ? `«${filters.scope.name}» · Ничего не найдено` : "Ничего не найдено"}</span>
            {filters.scope && <button type="button" className="d-btn d-btn--sm side-search-broaden"
              onClick={() => setFilters(previous => ({ ...previous, scope: null }))}>Искать везде →</button>}
          </div>
        )}
        {results.map((r) => {
          const link = searchResultLink(r, r.fragments?.[0]);
          const bestiary = r.type === "compendium_entry" && r.kind === "monster";
          const chip = r.book_format === "pdf" ? "PDF" : r.book_format === "md" ? ".md"
            : bestiary ? "Бестиарий" : filters.group === "creatures" && r.type === "being" ? "Сеттинг" : ENTITY_TYPE_SINGULAR[r.type] ?? r.type;
          // The pult's PreviewDock only accepts drag-and-drop, which doesn't
          // fire from a touch gesture — this button is the tap equivalent,
          // shown only where the dock is actually the drop target (the live
          // session page) and only for types it accepts.
          const canDock = !!liveMatch && DOCK_ACCEPT_TYPES.includes(r.type);
          return (
            <div
              key={`${r.type}-${r.id}`}
              className="search-result"
              {...entityMark(r.type, r.id, r.title)}
              draggable
              onDragStart={(e) => handleDragStart(e, r)}
            >
              <div className="side-search-meta">
                <span className="d-chip side-search-type" data-format={r.book_format}>{chip}</span>
                {r.context && <span className="search-result-context" title={r.context}>{r.context}</span>}
                {r.version && <span className="d-chip side-search-type side-search-version">{r.version}</span>}
              </div>
              <div className="side-search-item-main">
                {link ? <Link className="side-search-title" to={link} onClick={onNavigate}>{r.title}</Link>
                  : <span className="side-search-title">{r.title}</span>}
                <div className="search-result-actions">
                  {mapPlacement && placementSource(r) && <button type="button" className="search-result-card" title="Разместить на карте" aria-label={`Разместить на карте: ${r.title}`}
                    onClick={() => { mapPlacement.place(placementSource(r)!); onNavigate?.(); }}><NavIcon name="plus" /></button>}
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
                  {/* Карточку открывает только эта кнопка, а не щелчок по
                      строке: строка — источник перетаскивания, а короткое
                      перетаскивание браузер отдаёт как щелчок, и окно
                      выскакивало бы поверх того места, куда несут существо. */}
                  {CARD_TYPES.includes(r.type) && (
                    <button
                      type="button"
                      className="search-result-card side-search-preview"
                      title="Показать карточку"
                      onClick={() => { const source = placementSource(r); if (mapPlacement && source) { mapPlacement.preview(source); onNavigate?.(); } else setCard({ type: r.type, id: r.id }); }}
                    >
                      <NavIcon name="card" />
                    </button>
                  )}
                  {link && (
                    <Link to={link} title="Перейти" className="search-result-goto" onClick={onNavigate}>
                      <NavIcon name="arrowRight" />
                    </Link>
                  )}
                </div>
              </div>
              {r.fragments?.length ? <SearchResultFragments result={r} onNavigate={onNavigate} />
                : r.subtitle && !(r.type === "compendium_entry" && r.context) && <div className="side-search-subtitle">{r.subtitle}</div>}
            </div>
          );
        })}
      </div>
      {card && <EntityPreviewModal type={card.type} id={card.id} onClose={() => setCard(null)} />}
    </div>
  );

  const pinsBody = (
      <div className="search-pins">
        {titleOf("pins", "Закреплённые страницы")}
        {pins.map((p) => (
          <div key={p.path} className="search-pin-row row" style={{ justifyContent: "space-between" }}>
            <Link to={p.path} title={p.label} onClick={onNavigate}>
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
  );

  // Полоса у LocationMap — прежняя вёрстка в строку, без модулей.
  if (horizontal) {
    return (
      <div className="search-panel horizontal">
        {searchBody}
        {pinsBody}
      </div>
    );
  }

  // Те же запросы, результаты, drag payload и мешок; независимая компоновка.
  // Общая раскладка (свёрнутые модули/высоты) здесь не меняется.
  if (workspace) {
    return (
      <div className="search-panel map-workspace-sources">
        <section className="map-workspace-source-search" aria-label="Поиск сущностей">{searchBody}</section>
        <section className="map-workspace-source-bag" aria-label="Мешок"><BagWidget title={<strong>Мешок</strong>} onMapPlace={onNavigate} /></section>
      </div>
    );
  }

  const modules: SideModule[] = [
    { id: "search", title: "Поиск", node: searchBody },
    liveMatch
      ? {
          id: "tracker",
          title: "Трекер инициативы",
          node: <InitiativeTracker sessionId={Number(liveMatch[1])} title={titleOf("tracker", "Трекер инициативы")} />,
        }
      : { id: "bag", title: "Мешок", node: <BagWidget title={titleOf("bag", "Мешок")} /> },
    ...(live
      ? [
          {
            id: "chat" as const,
            title: "Лента",
            minHeight: 180,
            node: (
              <div className="side-chat">
                <div className="row side-chat__head">
                  {titleOf("chat", "Лента")}
                  <Link to={`/sessions/${live.id}/live`} className="muted side-chat__session" onClick={onNavigate}>
                    {live.live_mode === "rehearsal" ? "Прогон · " : ""}Сессия №{live.session_number} · {live.campaign_name}
                  </Link>
                </div>
                <SessionNotesChat sessionId={live.id} settingId={live.setting_id} />
              </div>
            ),
          },
        ]
      : []),
    { id: "pins", title: "Закреплённые страницы", node: pinsBody },
  ];

  if (narrow) {
    return (
      <SideRail
        modules={modules}
        open={railOpen}
        setOpen={setRailOpen}
        live={live}
        pins={pins}
        canPin={pins.length < MAX_PINS}
        onPin={pinCurrentPage}
        onUnpin={unpin}
        onExpand={() => setNarrow(false)}
      />
    );
  }

  return (
    <SideModules
      modules={modules}
      layout={layout}
      setLayout={setLayout}
      flexId={live ? "chat" : null}
      onNarrow={liveMatch ? undefined : () => setNarrow(true)}
    />
  );
}
