import { useEffect, useRef, useState, type ReactNode } from "react";
import { GridStack, GridStackItem, useGridStack } from "gridstack/dist/react";
import type { GridStackOptions, GridStackWidget } from "gridstack";
import "gridstack/dist/gridstack.css";
import "./PultGrid.css";
import { PultGridForceOpenContext } from "../pultForceOpen";
import { PULT_GRID_RESET_EVENT } from "../pultGridReset";
import { FloatWindow } from "../components/FloatWindow";
import { NavIcon } from "../components/NavIcons";
import {
  setWidgetFloatMode,
  useWidgetFloatMode,
  type PultWidgetId,
} from "../widgetFloatStore";
import type {
  CampaignDetail,
  Character,
  SessionDetail,
  SessionUnionRow,
} from "../types";
import {
  CompendiumPanel,
  LocationsPanel,
  LootPanel,
  ObstaclesPanel,
  PlotCharactersPanel,
  RemindersPanel,
  RosterPanel,
  SecretsPanel,
  SESSION_PANEL_TITLES,
} from "./sessionLivePanels";

// Сетка блоков пульта: 10 виджетов (2 текстовые карточки + 8 панелей), которые
// Мастер таскает за шапку и тянет за угол. Остальное (время, сцены, показ) —
// вне сетки, статично.
//
// Позиции живут в движке GridStack после монтирования: React задаёт их один
// раз (старт), дальше только запоминает (change → localStorage) и сбрасывает
// (кнопка → дефолт). Обвес сравнивает опции по значению (JSON), поэтому
// ререндеры от игровых данных позиции не трогают — лишь бы значения в стейте
// не менялись.
//
// Высота — подгонкой GridSync под содержимое (схлопнутые панели дыр не
// оставляют, раскрытые не вываливаются). Флаг sizeToContent движка не
// используем: он меряет в момент addWidget, когда порталов ещё нет.

interface SavedCell {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const KEY = "rpgManagerPultGrid";

interface WidgetDef extends SavedCell {
  minW: number;
  minH: number;
  maxW: number;
}

// Дефолт повторяет старую вёрстку: пары по полряда.
const DEFAULTS: WidgetDef[] = [
  { id: "idea", x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 3, maxW: 12 },
  { id: "events", x: 6, y: 0, w: 6, h: 8, minW: 3, minH: 3, maxW: 12 },
  { id: "plot", x: 0, y: 8, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "locations", x: 6, y: 8, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "obstacles", x: 0, y: 18, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "loot", x: 6, y: 18, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "reminders", x: 0, y: 28, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "compendium", x: 6, y: 28, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "roster", x: 0, y: 38, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
  { id: "secrets", x: 6, y: 38, w: 6, h: 10, minW: 3, minH: 3, maxW: 12 },
];

function validCell(v: Partial<SavedCell> | null | undefined): v is SavedCell {
  return (
    !!v &&
    typeof v.id === "string" &&
    [v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function loadLayout(): WidgetDef[] {
  let saved: SavedCell[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) saved = parsed.filter(validCell);
  } catch {
    /* приватный режим — раскладка просто не переживёт перезагрузку */
  }
  const byId = new Map(saved.map((s) => [s.id, s]));
  // Дефолт — основа: неизвестные id из прошлого игнорируем, новые виджеты
  // будущих версий встают на свои места, а не теряются.
  return DEFAULTS.map((d) => {
    const s = byId.get(d.id);
    return s ? { ...d, x: s.x, y: s.y, w: s.w, h: s.h } : d;
  });
}

const GRID_OPTIONS: GridStackOptions = {
  column: 12,
  cellHeight: 10,
  // Отступ вокруг каждого виджета: видимый просвет между соседями двойной,
  // итого 8px. Мобильная стопка живёт своим gap (PultGrid.css).
  margin: 4,
  resizable: { handles: "se" },
  // Таскают за шапку карточки (маркер ставят LazyDetails/EditableTextCard),
  // тело свободно: выделение текста и ссылки работают как раньше. Кнопки,
  // поля и ссылки драг не начинают.
  draggable: {
    handle: ".pult-drag-handle",
    cancel: "input,textarea,button,select,option,a,[contenteditable]",
  },
  // Без sizeToContent намеренно: движок меряет виджет в момент addWidget, а
  // порталы React встают позже — замер падает с console.error, а высота
  // остаётся стартовой. Высотой владеет GridSync ниже: тот же resizeToContent,
  // но когда контент уже в DOM (и с проверкой).
};

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Мост движок ↔ React: запоминает раскладку, подгоняет высоту под растущий
 * контент и исполняет внешний сброс (кнопка в крошках AppShell).
 * Null-компонент (ничего не рисует) — жить обязан внутри <GridStack>.
 */
function GridSync({ onChanged, onReset }: { onChanged: (cells: SavedCell[]) => void; onReset: () => void }) {
  const { grid } = useGridStack();
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  });

  // Запоминание раскладки. Отписка через флаг, а не grid.off(): off() снимает
  // ВСЕ слушатели события, включая внутренние самого обвеса.
  useEffect(() => {
    if (!grid) return;
    let alive = true;
    const onChange = () => {
      if (!alive) return;
      const saved = grid.save(false);
      if (!Array.isArray(saved)) return;
      onChangedRef.current(
        (saved as GridStackWidget[])
          .filter(
            (n): n is GridStackWidget & SavedCell =>
              typeof n.id === "string" &&
              [n.x, n.y, n.w, n.h].every((v) => typeof v === "number" && Number.isFinite(v))
          )
          .map((n) => ({ id: n.id as string, x: n.x as number, y: n.y as number, w: n.w as number, h: n.h as number }))
      );
    };
    grid.on("change", onChange);
    return () => {
      alive = false;
    };
  }, [grid]);

  // Внешний сброс из крошек: только пока сетка смонтирована (на узких,
  // где стопка, слушать некому — и не надо). После сброса сразу подгоняем
  // высоту: setLayout возвращает стартовые h, а мутаций при этом нет
  // (меняются только стили) — без пинка виджеты остались бы мелкими.
  useEffect(() => {
    const onReset = () => {
      onResetRef.current();
      setTimeout(() => refitAllRef.current(), 250);
    };
    window.addEventListener(PULT_GRID_RESET_EVENT, onReset);
    return () => window.removeEventListener(PULT_GRID_RESET_EVENT, onReset);
  }, []);

  // Подгонка высоты: данные приходят позже монтирования, раскрыли details,
  // дописали текст — карточка выросла, а движок сам меряет только по своим
  // событиям (sizeToContent). Следим мутациями за всем гридом: ловят и
  // монтирование порталов, и приход данных, и раскрытия. Атрибуты (стили
  // от драга/ресайза) не слушаем — иначе подгонка спорила бы с руками.
  // Та же подгонка вызывается пинком после сброса (см. выше).
  const refitAllRef = useRef(() => {});
  refitAllRef.current = () => {
    if (!grid) return;
    grid.el.querySelectorAll(":scope > .grid-stack-item").forEach((el) => {
      // Порталы React могут ещё не встать (движок добавил виджет раньше):
      // таких пропускаем, их доберёт следующая мутация.
      const content = el.querySelector(":scope > .grid-stack-item-content");
      if (!content?.firstElementChild) return;
      grid.resizeToContent(el as HTMLElement);
    });
  };
  useEffect(() => {
    if (!grid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refitAllRef.current(), 150);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(grid.el, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      mo.disconnect();
    };
  }, [grid]);

  return null;
}

export interface PultPanelProps {
  sessionId: number;
  session: SessionDetail;
  campaign: CampaignDetail;
  characters: Character[];
  union?: SessionUnionRow[];
}

interface PultGridProps {
  ideaCard: ReactNode;
  eventsCard: ReactNode;
  panelProps: PultPanelProps;
}

export function PultGrid({ ideaCard, eventsCard, panelProps }: PultGridProps) {
  // На узких — обычная стопка, как была: таскать пальцем нечего, сетка там
  // только мешала бы. Тот же порог 860, что у остального пульта.
  const narrow = useMediaQuery("(max-width: 860px)");
  const [layout, setLayout] = useState<WidgetDef[]>(loadLayout);

  function persist(cells: SavedCell[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(cells));
    } catch {
      /* приватный режим — см. loadLayout */
    }
  }

  function resetLayout() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    // Новые объекты — обвес видит другие значения и двигает виджеты.
    setLayout(DEFAULTS.map((d) => ({ ...d })));
  }

  const widgets: { id: PultWidgetId; title: string; node: ReactNode }[] = [
    { id: "idea", title: "Задумка на сессию", node: ideaCard },
    { id: "events", title: "Основные события сессии", node: eventsCard },
    { id: "plot", title: SESSION_PANEL_TITLES.plotCharacters, node: <PlotCharactersPanel {...panelProps} /> },
    { id: "locations", title: SESSION_PANEL_TITLES.locations, node: <LocationsPanel {...panelProps} /> },
    { id: "obstacles", title: SESSION_PANEL_TITLES.obstacles, node: <ObstaclesPanel {...panelProps} /> },
    { id: "loot", title: SESSION_PANEL_TITLES.loot, node: <LootPanel {...panelProps} /> },
    { id: "reminders", title: SESSION_PANEL_TITLES.reminders, node: <RemindersPanel {...panelProps} /> },
    { id: "compendium", title: SESSION_PANEL_TITLES.compendium, node: <CompendiumPanel {...panelProps} /> },
    { id: "roster", title: SESSION_PANEL_TITLES.roster, node: <RosterPanel {...panelProps} /> },
    { id: "secrets", title: SESSION_PANEL_TITLES.secrets, node: <SecretsPanel {...panelProps} /> },
  ];

  if (narrow) {
    return (
      <div className="stack pult-stack">
        {widgets.map((w) => (
          <div key={w.id}>{w.node}</div>
        ))}
      </div>
    );
  }

  const byId = new Map(layout.map((c) => [c.id, c]));
  return (
    <div className="pult-grid-wrap">
      <GridStack options={GRID_OPTIONS} className="pult-grid">
        {/* В сетке всё раскрыто (см. pultForceOpen): схлопнутое и таскать
            не за что, и мерить нечего. Мобильная стопка выше — без
            провайдера, там как было. */}
        <PultGridForceOpenContext.Provider value>
          <GridSync onChanged={persist} onReset={resetLayout} />
          {widgets.map((w) => {
          const cell = byId.get(w.id) ?? DEFAULTS.find((d) => d.id === w.id)!;
          return (
            <PultWidget key={w.id} id={w.id} title={w.title} cell={cell} node={w.node} />
          );
          })}
        </PultGridForceOpenContext.Provider>
      </GridStack>
    </div>
  );
}

/**
 * Один виджет в трёх местах: сетка, окно, док-станция. В доке не рисуем
 * ничего (там плашка PreviewDock), в окне — тот же узел, поэтому выбор,
 * правка и черновики переживают переезд.
 */
function PultWidget({ id, title, cell, node }: { id: PultWidgetId; title: string; cell: WidgetDef; node: ReactNode }) {
  const mode = useWidgetFloatMode(id);
  if (mode === "dock") return null;
  if (mode === "float") {
    return (
      <FloatWindow
        title={title}
        storageKey={`rpgManagerFloat:${id}`}
        defaultSize={{ w: 560, h: 480 }}
        onDock={() => setWidgetFloatMode(id, "grid")}
        onToDockStation={() => setWidgetFloatMode(id, "dock")}
      >
        {node}
      </FloatWindow>
    );
  }
  return (
    <GridStackItem
      id={id}
      options={{ x: cell.x, y: cell.y, w: cell.w, h: cell.h, minW: cell.minW, minH: cell.minH, maxW: cell.maxW }}
    >
      <div className="pult-widget">
        <div className="pult-widget-actions">
          <button
            type="button"
            className="pult-widget-popout"
            title="Убрать плашкой в док-станцию"
            aria-label={`Убрать «${title}» плашкой в док-станцию`}
            onClick={() => setWidgetFloatMode(id, "dock")}
          >
            <NavIcon name="dockLeft" />
          </button>
          <button
            type="button"
            className="pult-widget-popout"
            title="Открыть в отдельном окне"
            aria-label={`Открыть «${title}» в отдельном окне`}
            onClick={() => setWidgetFloatMode(id, "float")}
          >
            <NavIcon name="fullscreen" />
          </button>
        </div>
        {node}
      </div>
    </GridStackItem>
  );
}
