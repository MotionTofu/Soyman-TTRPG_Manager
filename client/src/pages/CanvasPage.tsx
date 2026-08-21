import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { EditableTextCard } from "../components/EditableTextCard";
import { SCENE_KINDS, SCENE_KIND_LABELS } from "../sceneKinds";
import { formatByPrecision } from "../inworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { EmptyState } from "../components/EmptyState";
import "../canvas.css";
import type {
  CanvasAnyNode,
  CanvasBoard,
  CanvasGroup,
  CalendarMonth,
  EventStatus,
  ForeignLink,
  LibraryBundle,
  LibraryScene,
  SceneCastRow,
  SceneCheck,
  Setting,
  StoryArc,
  StoryScene,
  StorySceneDetail,
} from "../types";

// «Полотно» — узловой редактор. Первый вид холста: приключение, его сцены
// нодами, переходы рёбрами.
//
// Данных холст не заводит: сцены и переходы живут в story_* и правятся теми
// же эндпоинтами, что и список сцен. Своё у полотна только одно — раскладка
// (/api/canvas), и она намеренно лежит отдельно от строки сцены: иначе сдвиг
// ноды мышкой внутри кампании порождал бы copy-on-write копию сцены.
//
// Решения, из-за которых страница выглядит именно так, записаны в
// docs/node-editor.md.

// Три входа состава, сверху вниз. Порядок не случаен: место сцены одно и
// читается первым, участники следом, предметы последними — так же, как они
// стоят на странице сцены.
// Разъёмы названы ровно так же, как панели пульта сессии: одно имя на весь
// путь, от разметки сцены до стола. Раньше «участники» на пульте оказывались
// в «Препятствиях», и это соответствие Мастеру приходилось держать в голове.
const CAST_HANDLES = [
  { id: "location", label: "Локации" },
  { id: "plot_characters", label: "Сюжетные персонажи" },
  { id: "obstacles", label: "Препятствия" },
  { id: "loot", label: "Потенциальный лут" },
] as const;

interface SceneNodeData extends Record<string, unknown> {
  name: string;
  kind: string;
  /** Вытащить на холст тех, кто к сцене уже подцеплен. */
  onPullCast: () => void;
  isOverride: boolean;
  campaignOnly: boolean;
  /** Имя заготовки, если это ещё не тронутая вставка. */
  libraryName: string | null;
  inLibrary: boolean;
  /** Сколько ссылок ведёт в другой сеттинг. */
  foreignLinks: number;
}

function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
  return (
    <div className={`canvas-node${selected ? " is-selected" : ""}`}>
      {/* Слева всё, из чего сцена собрана. Ромб — «история»: сюда приходит
          переход. Квадраты — состав: место, участники, предметы. Тип разъёма
          передан формой, а не цветом: в палитре ровно три цвета, четвёртый
          под типизацию заводить нельзя (docs/design-system-punk-zine.md §3.2).

          Три отдельных входа, а не один умный: существо бывает и участником,
          и обстановкой («в углу спит дракон, будить не надо»), а локация — и
          местом сцены, и предметом разговора. Роль определяет разъём, а не
          тип воткнутого. */}
      <Handle
        type="target"
        id="story"
        position={Position.Left}
        style={{ top: 18 }}
        className="canvas-handle--story"
      />
      {CAST_HANDLES.map((h, i) => (
        <Handle
          key={h.id}
          type="target"
          id={h.id}
          position={Position.Left}
          style={{ top: 44 + i * 20 }}
          className="canvas-handle--entity"
          title={h.label}
        />
      ))}
      <div className="canvas-node__band">
        <span className="canvas-node__name">{data.name}</span>
        <span className="canvas-node__kind">{SCENE_KIND_LABELS[data.kind] ?? data.kind}</span>
      </div>
      <div className="canvas-node__body">
        <div className="canvas-node__chips">
          {data.campaignOnly && <span className="canvas-node__chip is-solid">Только в кампании</span>}
          {data.isOverride && <span className="canvas-node__chip">Своя правка</span>}
          {/* Без этой пометки Мастер правит текст и не понимает, чинит он одну
              сцену или все шесть, где стоит та же заготовка. */}
          {data.libraryName && (
            <span className="canvas-node__chip" title={`Заготовка: ${data.libraryName}`}>
              По заготовке
            </span>
          )}
          {data.inLibrary && <span className="canvas-node__chip is-solid">Заготовка</span>}
          {data.foreignLinks > 0 && (
            <span className="canvas-node__chip" title="Ссылки на существ и локации другого сеттинга">
              Чужих ссылок: {data.foreignLinks}
            </span>
          )}
        </div>
        {/* Кнопка только у выбранной ноды: богатство органов управления
            считается минусом, а на схеме из тридцати сцен тридцать кнопок —
            это шум, который читается раньше имён. */}
        {selected && (
          <button className="nodrag canvas-node__action" onClick={data.onPullCast}>
            Вытащить состав
          </button>
        )}
      </div>
      {/* Справа вытекает то, что из сцены следует: ход истории (ромб) и след
          в мире (квадрат). Событие не встаёт в ряд входов слева — сцена не
          собрана из падения крепости, она его вызывает. */}
      <Handle
        type="source"
        id="story"
        position={Position.Right}
        style={{ top: 18 }}
        className="canvas-handle--story"
      />
      <Handle
        type="source"
        id="consequences"
        position={Position.Right}
        style={{ top: 44 }}
        className="canvas-handle--entity"
        title="Последствия"
      />
    </div>
  );
}

// Ноды сущностей и наборов. Данные текут СЛЕВА НАПРАВО: у сцены слева то, из
// чего она собрана (место, участники, предметы), справа — что из неё следует.
// Сущность поэтому имеет только выход: она втекает в сцену, а не наоборот —
// обратное направление читалось бы как «сцена порождает гоблина».

interface EntityNodeData extends Record<string, unknown> {
  name: string;
  kind: string | null;
  nodeType: string;
  thumbUrl: string | null;
  mentionedIn: number;
}

// Подписи видов — только там, где вид что-то добавляет к имени. У локации и
// предмета он совпадает с самой нодой и превратился бы в шум.
const ENTITY_TYPE_LABEL: Record<string, string> = {
  being: "Существо",
  location: "Локация",
  artifact: "Предмет",
  community: "Сообщество",
  compendium_entry: "Из книги",
};

function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--entity${selected ? " is-selected" : ""}`}>
      <div className="canvas-node__band">
        {/* Портрет — самый быстрый опознавательный знак: за столом ноду
            опознают, а не читают. */}
        {data.thumbUrl ? (
          <img src={data.thumbUrl} alt="" className="canvas-node__portrait" />
        ) : (
          <div className="canvas-node__portrait canvas-node__portrait--empty" />
        )}
        <span className="canvas-node__name">{data.name}</span>
      </div>
      <div className="canvas-node__body">
        <div className="canvas-node__chips">
          <span className="canvas-node__chip">
            {ENTITY_TYPE_LABEL[data.nodeType] ?? data.nodeType}
          </span>
          {/* Упоминания рёбрами не рисуются — схема утонула бы. Но «упомянут и
              не подцеплен» стоит показать: в текстах существо есть, в составе
              нет. */}
          {data.mentionedIn > 0 && (
            <span className="canvas-node__chip" title="Упомянут в текстах сцен, но не подцеплен">
              Упомянут: {data.mentionedIn}
            </span>
          )}
        </div>
      </div>
      {/* Квадрат — сущность, ромб — история. Тип разъёма передан формой, а не
          цветом: в палитре ровно три цвета. */}
      <Handle type="source" position={Position.Right} className="canvas-handle--entity" />
    </div>
  );
}

interface BundleNodeData extends Record<string, unknown> {
  name: string;
  contentType: string | null;
  members: { link_id: number; name: string; qty: string }[];
  fromLibrary: boolean;
  inLibrary: boolean;
}

function BundleNode({ data, selected }: NodeProps<Node<BundleNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--bundle${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="members" className="canvas-handle--entity" />
      <div className="canvas-node__band">
        <span className="canvas-node__name">{data.name || "Набор"}</span>
        <span className="canvas-node__kind">Набор</span>
      </div>
      <div className="canvas-node__body">
        {data.members.length === 0 ? (
          <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            Пусто — воткните первого, он и задаст вид набора.
          </span>
        ) : (
          <div className="stack" style={{ gap: 2 }}>
            {data.members.map((m) => (
              <span key={m.link_id} className="canvas-node__member">
                {m.qty && <b>{m.qty} </b>}
                {m.name}
              </span>
            ))}
          </div>
        )}
        <div className="canvas-node__chips">
          {data.fromLibrary && <span className="canvas-node__chip">По набору с полки</span>}
          {data.inLibrary && <span className="canvas-node__chip is-solid">На полке</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="canvas-handle--entity" />
    </div>
  );
}

interface EventNodeData extends Record<string, unknown> {
  title: string;
  date: string;
  status: EventStatus;
  important: boolean;
}

// Нода события. Опознаётся, а не читается: название, дата по-человечески и
// статус. Описание живёт в профиле события — на схеме оно съело бы место у
// имён соседей.
function EventNode({ data, selected }: NodeProps<Node<EventNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--event${selected ? " is-selected" : ""}`}>
      {/* Событие — единственная нода, у которой вход СПРАВА нечего было бы
          делать: последствие втекает в него слева, от сцены. */}
      <Handle type="target" position={Position.Left} id="in" className="canvas-handle--entity" />
      <div className="canvas-node__band">
        {/* Отменённое — зачёркнутым: это единственный статус, меняющий смысл
            всей ноды, и различать его по мелкому слову за столом не выйдет. */}
        <span
          className="canvas-node__name"
          style={data.status === "cancelled" ? { textDecoration: "line-through" } : undefined}
        >
          {data.title}
        </span>
      </div>
      <div className="canvas-node__body">
        <span className="canvas-node__date">{data.date}</span>
        <div className="canvas-node__chips">
          {data.status === "upcoming" && <span className="canvas-node__chip">Предстоит</span>}
          {data.important && <span className="canvas-node__chip is-solid">Важное</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Рамка главы.
 *
 * Приключение состоит из глав, и до этого холст их не видел: у каждой главы
 * был свой холст, а переход между главами вёл в никуда. Теперь главы — рамки
 * на холсте приключения, и все 13 переходов через границу главы стали видимы.
 *
 * Рамка не ловит щелчки: тащат её за заголовок, а по телу проходят к сценам и
 * к самому полотну — иначе рамка размером в пол-экрана съела бы и выделение
 * рамкой, и щелчок по сцене под ней.
 */
interface ChapterNodeData extends Record<string, unknown> {
  name: string;
}

function ChapterNode({ data }: NodeProps<Node<ChapterNodeData>>) {
  return (
    <div className="canvas-frame">
      <div className="canvas-frame__title">{data.name}</div>
    </div>
  );
}

// Module-level: React Flow сравнивает nodeTypes по ссылке и перестраивает всё
// дерево нод, если объект новый на каждый рендер.
const NODE_TYPES = {
  scene: SceneNode,
  entity: EntityNode,
  bundle: BundleNode,
  event: EventNode,
  chapter: ChapterNode,
};

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };

const EDGE_CLASS: Record<string, string | undefined> = {
  transition: undefined,
  outcome: "canvas-edge--outcome",
  cast: "canvas-edge--cast",
  member: "canvas-edge--cast",
};

type CanvasNodeData =
  | SceneNodeData
  | EntityNodeData
  | BundleNodeData
  | EventNodeData
  | ChapterNodeData;

/** Рамки лежат в том же массиве нод — отличать их надо по ключу. */
function isFrame(id: string): boolean {
  return id.startsWith("chapter:");
}

/** «being:41» → ["being", 41]. Ключ ноды приходит с сервера строкой. */
function splitKey(key: string): [string, number] {
  const at = key.indexOf(":");
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

// Одна нода холста → нода React Flow. Ключ приходит с сервера строкой
// «вид:номер»: голого номера мало с тех пор, как рядом со сценами стоят
// существа — сцена 41 и существо 41 получили бы один ключ.
function toFlowNode(
  n: CanvasAnyNode,
  onPullCast: (sceneId: number) => void,
  months: CalendarMonth[],
  era: string
): Node<CanvasNodeData> {
  const base = { id: n.key, position: { x: n.x, y: n.y } };
  if (n.node_type === "bundle") {
    return {
      ...base,
      type: "bundle",
      data: {
        name: n.bundle.name,
        contentType: n.bundle.content_type,
        members: n.bundle.members,
        fromLibrary: n.bundle.library_bundle_id != null,
        inLibrary: n.bundle.in_library,
      },
    };
  }
  if (n.node_type === "setting_event" || n.node_type === "campaign_event") {
    return {
      ...base,
      type: "event",
      data: {
        title: n.event.title,
        date: formatByPrecision(n.event.year, n.event.month, n.event.day, n.event.precision, months, era),
        status: n.event.status,
        important: n.event.important,
      },
    };
  }
  if (n.node_type === "scene") {
    return {
      ...base,
      type: "scene",
      // Сцену с холста не удаляют: она выводится из приключения, и «удалить»
      // здесь означало бы отправить её в архив — чего Мастер, двигая
      // квадратики и нажимая Delete, не имел в виду.
      deletable: false,
      data: {
        name: n.scene.name,
        kind: n.scene.kind,
        isOverride: n.scene.is_override,
        campaignOnly: n.scene.campaign_only,
        libraryName: n.scene.library_name,
        inLibrary: n.scene.in_library,
        foreignLinks: n.scene.foreign_links,
        onPullCast: () => onPullCast(n.scene.id),
      },
    };
  }
  // Проверка по полю, а не по виду: видов сущностей пять и они будут
  // прибавляться, а `entity` есть ровно у них.
  if (!("entity" in n)) throw new Error(`неизвестный вид ноды: ${n.node_type}`);
  return {
    ...base,
    type: "entity",
    data: {
      name: n.entity.name,
      kind: n.entity.kind,
      nodeType: n.node_type,
      thumbUrl: n.entity.thumbnail_image_url,
      mentionedIn: n.entity.mentioned_in,
    },
  };
}

/** Рамка главы → нода React Flow. Ложится под сцены и тащится за заголовок. */
function toFrameNode(g: CanvasGroup): Node<CanvasNodeData> {
  return {
    id: `chapter:${g.arc_id}`,
    type: "chapter",
    position: { x: g.x, y: g.y },
    width: g.w,
    height: g.h,
    // Рамку с холста не удаляют: она выводится из главы приключения, и Delete
    // над квадратиками не значит «расформировать главу».
    deletable: false,
    // Тащат рамку за заголовок: тело рамки указатель не ловит, иначе рамка в
    // пол-экрана съела бы и щелчок по сцене под ней, и выделение рамкой.
    dragHandle: ".canvas-frame__title",
    // Ниже сцен рамка оказывается порядком в массиве, а не отрицательным
    // z-index: при zIndex: -1 нода уходит ЗА полотно, и заголовок перестаёт
    // ловить мышь — тянется не рамка, а весь холст.
    data: { name: g.name },
  };
}

export function CanvasPage() {
  // Что открыто — в адресе, как окрестность у Графа связей: на холст ведут
  // ссылки со страниц приключений, и такую ссылку можно сохранить.
  const [searchParams, setSearchParams] = useSearchParams();
  const settingId = Number(searchParams.get("setting")) || 0;
  const arcId = Number(searchParams.get("arc")) || 0;

  // Календарь нужен ради дат на нодах событий: месяцы и эра живут в
  // сеттинге, и без них «1492-06-15» осталось бы машинной строкой.
  const calendar = useSettingCalendar(settingId);
  const calendarRef = useRef<{ months: CalendarMonth[]; era: string }>({ months: [], era: "" });
  calendarRef.current = { months: calendar?.months ?? [], era: calendar?.era ?? "" };

  const [settings, setSettings] = useState<Setting[]>([]);
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [board, setBoard] = useState<CanvasBoard | null>(null);
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  // Палитра закрыта по умолчанию: за столом холст нужен целиком, а пополняют
  // его в подготовке.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Полка перечитывается по этому счётчику. Без него галочка «на полку» в
  // свойствах меняла базу, а открытая рядом палитра продолжала показывать
  // старый список — и выглядело это как «галочка не сработала».
  const [shelfVersion, setShelfVersion] = useState(0);

  useEffect(() => {
    api.get<Setting[]>("/settings").then(setSettings);
  }, []);

  useEffect(() => {
    if (!settingId) {
      setArcs([]);
      return;
    }
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setArcs);
  }, [settingId]);

  // Через ref, а не через зависимость: обработчик «вытащить состав» знает
  // позицию ноды, то есть меняется на каждое перетаскивание, и держать его в
  // зависимостях loadBoard значило бы перезагружать холст при каждом сдвиге.
  const pullCastRef = useRef<(sceneId: number) => void>(() => {});

  const loadBoard = useCallback(() => {
    if (!arcId) {
      setBoard(null);
      setNodes([]);
      return;
    }
    api.get<CanvasBoard>(`/canvas/board?arc_id=${arcId}`).then((b) => {
      setBoard(b);
      setNodes([
        // Рамки идут первыми — под сценами: React Flow рисует в порядке
        // массива, и одного zIndex мало, когда ноды перерисовываются.
        ...(b.groups ?? []).map(toFrameNode),
        ...b.nodes.map((n) =>
          toFlowNode(n, pullCastRef.current, calendarRef.current.months, calendarRef.current.era)
        ),
      ]);
    });
  }, [arcId]);

  useEffect(loadBoard, [loadBoard]);
  // Календарь приезжает отдельным запросом и позже холста: без этого даты на
  // нодах событий остались бы пустыми до следующего действия.
  useEffect(() => {
    if (calendar) loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar]);

  // Рёбра держим состоянием, а не выводим из board на лету: React Flow — это
  // управляемый компонент, и без onEdgesChange он не считает набор рёбер
  // живым (выделение и удаление до него не доходят, а вместе с ними и сама
  // отрисовка).
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setEdges(
      (board?.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        targetHandle: e.target_handle,
        label: e.label || undefined,
        markerEnd: EDGE_MARKER,
        // Вид ребра — классом, а не цветом: в палитре ровно три цвета.
        // Исход проверки пунктиром (ведёт туда же, но по броску, а не по
        // решению), состав — тонкой линией: это не ход истории, а из чего
        // сцена собрана. На чёрно-белой печати различие остаётся.
        className: EDGE_CLASS[e.kind],
      }))
    );
  }, [board, setEdges]);

  // Раскладка сохраняется пачкой и с задержкой: перетаскивание рождает
  // событие на каждый кадр, и запрос на кадр превратил бы один жест в сотню
  // записей в базу.
  const saveTimer = useRef<number | null>(null);
  const scheduleSave = useCallback(
    (next: Node<CanvasNodeData>[]) => {
      if (!arcId) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.put("/canvas/board/nodes", {
          arc_id: arcId,
          nodes: next.filter((n) => !isFrame(n.id)).map((n) => {
            const [nodeType, nodeId] = splitKey(n.id);
            return {
              node_type: nodeType,
              node_id: nodeId,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
            };
          }),
        });
      }, 500);
    },
    [arcId]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  // Перерисовать всё, что могло измениться от правки в панели свойств: и
  // холст, и полку.
  const refreshAll = useCallback(() => {
    loadBoard();
    setShelfVersion((v) => v + 1);
  }, [loadBoard]);

  // Кого рамка тащит за собой. Состав считается ОДИН раз, в момент захвата:
  // пересчитывать его на каждом кадре значит терять по дороге сцену, которая
  // на полпути вышла за край рамки, — и половина главы осталась бы позади.
  const nodesRef = useRef<Node<CanvasNodeData>[]>([]);
  nodesRef.current = nodes;
  const frameDragRef = useRef<{ id: string; children: Set<string> } | null>(null);

  const onNodeDragStart = useCallback((_: unknown, node: Node<CanvasNodeData>) => {
    if (!isFrame(node.id)) {
      frameDragRef.current = null;
      return;
    }
    const w = Number(node.width ?? node.style?.width ?? 0);
    const h = Number(node.height ?? node.style?.height ?? 0);
    const { x, y } = node.position;
    frameDragRef.current = {
      id: node.id,
      children: new Set(
        nodesRef.current
          .filter(
            (n) =>
              !isFrame(n.id) &&
              n.position.x >= x &&
              n.position.y >= y &&
              n.position.x <= x + w &&
              n.position.y <= y + h
          )
          .map((n) => n.id)
      ),
    };
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node<CanvasNodeData>) => {
      if (isFrame(node.id) && board) {
        api.put(`/canvas/groups/${splitKey(node.id)[1]}`, {
          board_id: board.board_id,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        });
      }
      frameDragRef.current = null;
    },
    [board]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasNodeData>>[]) => {
      setNodes((current) => {
        let next = applyNodeChanges(changes, current);
        // Рамка тащит своё содержимое: глава — это то, что лежит внутри, и
        // подвинуть рамку, оставив сцены на месте, значит расформировать её.
        const drag = frameDragRef.current;
        if (drag) {
          const before = current.find((n) => n.id === drag.id);
          const after = next.find((n) => n.id === drag.id);
          const dx = after && before ? after.position.x - before.position.x : 0;
          const dy = after && before ? after.position.y - before.position.y : 0;
          if (dx !== 0 || dy !== 0) {
            next = next.map((n) =>
              drag.children.has(n.id)
                ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
                : n
            );
          }
        }
        // Пишем только когда перетаскивание закончилось: промежуточные
        // положения никому не нужны, а выделение и подсветка вообще не
        // касаются раскладки.
        if (changes.some((c) => c.type === "position" && c.dragging === false)) scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  // Что означает протянутая стрелка, решает РАЗЪЁМ, в который её воткнули, а
  // не тип того, что тянули. Существо бывает и участником, и обстановкой; в
  // «место» его тоже можно воткнуть, и это осмысленно.
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const [sourceType, sourceId] = splitKey(connection.source);
      const [targetType, targetId] = splitKey(connection.target);
      const handle = connection.targetHandle ?? "story";

      // Последствие тянут ОТ сцены К событию — единственная связь сцены с
      // таким направлением.
      if (sourceType === "scene" && (targetType === "setting_event" || targetType === "campaign_event")) {
        await api.post(`/story/scenes/${sourceId}/cast`, {
          to_type: targetType,
          to_id: targetId,
          role: "consequences",
        });
      } else if (targetType === "bundle") {
        await api.post(`/canvas/bundles/${targetId}/members`, {
          to_type: sourceType,
          to_id: sourceId,
        });
      } else if (handle === "story") {
        if (sourceType !== "scene" || targetType !== "scene") return;
        await api.post(`/story/scenes/${sourceId}/transitions`, { to_scene_id: targetId });
      } else {
        await api.post(`/story/scenes/${targetId}/cast`, {
          to_type: sourceType,
          to_id: sourceId,
          role: handle,
        });
      }
      loadBoard();
    },
    [loadBoard]
  );

  // Удаление ребра значит разное для двух видов. Переход исчезает совсем.
  // А у исхода проверки снимается только связь: сам разъём остаётся на месте
  // вместе со своей подписью и текстом последствия — «провал больше не ведёт
  // в яму» не то же самое, что «провала больше нет».
  const onEdgesDelete = useCallback(
    async (removed: Edge[]) => {
      await Promise.all(
        removed.map((e) => {
          const [kind, rawId] = e.id.split(":");
          if (kind === "outcome") {
            return api.put(`/story/outcomes/${rawId}`, { target_type: null, target_id: null });
          }
          // Состав и членство в наборе — обычные связи; снимается связь, а
          // нода остаётся на холсте. Обратное («убрал квадратик — выпал из
          // сцены») молча потрошило бы сцены при расчистке схемы.
          if (kind === "cast") return api.del(`/story/cast/${rawId}`);
          if (kind === "member") return api.del(`/links/${rawId}`);
          return api.del(`/story/transitions/${rawId}`);
        })
      );
      loadBoard();
    },
    [loadBoard]
  );

  // Позиция ноды берётся из текущего состояния холста, а не из базы: у
  // неподвинутой ноды строки в базе нет, а состав должен лечь рядом с тем
  // квадратиком, на который Мастер только что нажал.
  const pullCast = useCallback(
    async (sceneId: number) => {
      const node = nodes.find((n) => n.id === `scene:${sceneId}`);
      await api.post("/canvas/board/pull-cast", {
        arc_id: arcId,
        scene_id: sceneId,
        x: Math.round(node?.position.x ?? 0),
        y: Math.round(node?.position.y ?? 0),
      });
      loadBoard();
    },
    [arcId, nodes, loadBoard]
  );
  useEffect(() => {
    pullCastRef.current = pullCast;
  }, [pullCast]);

  // Убрать ноду сущности или набора — значит убрать её С ХОЛСТА. Связи
  // «участник сцены» остаются: их правят и на странице сцены, и расчистка
  // схемы не должна молча выпотрошить сцены. Ноду сцены удалить нельзя
  // вовсе — сцены выводятся из приключения, и «удалить» здесь означало бы
  // архивировать сцену, чего Мастер, двигая квадратики, не имел в виду.
  const onNodesDelete = useCallback(
    async (removed: Node<CanvasNodeData>[]) => {
      const removable = removed.filter((n) => !n.id.startsWith("scene:"));
      await Promise.all(
        removable.map((n) => {
          const [nodeType, nodeId] = splitKey(n.id);
          if (nodeType === "bundle") return api.del(`/canvas/bundles/${nodeId}`);
          return api.del(
            `/canvas/board/node?arc_id=${arcId}&node_type=${nodeType}&node_id=${nodeId}`
          );
        })
      );
      loadBoard();
    },
    [arcId, loadBoard]
  );

  function pickSetting(value: number) {
    // Приключение принадлежит сеттингу, так что смена сеттинга обнуляет выбор.
    setSearchParams(value ? { setting: String(value) } : {});
  }
  function pickArc(value: number) {
    const next: Record<string, string> = { setting: String(settingId) };
    if (value) next.arc = String(value);
    setSearchParams(next);
  }

  return (
    <div className="stack canvas-page">
      <SectionHeading section="canvas">Полотно</SectionHeading>

      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={settingId || ""} onChange={(e) => pickSetting(Number(e.target.value))}>
          <option value="">— сеттинг —</option>
          {settings.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select value={arcId || ""} onChange={(e) => pickArc(Number(e.target.value))} disabled={!settingId}>
          <option value="">— приключение —</option>
          {arcs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {arcId > 0 && (
          <button onClick={() => setPaletteOpen((v) => !v)}>
            {paletteOpen ? "Скрыть палитру" : "Добавить"}
          </button>
        )}

        {board && (
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            {board.nodes.length} сцен · {board.edges.length} переходов
            {board.groups.length > 0 && ` · ${board.groups.length} глав`}
          </span>
        )}
      </div>

      {!arcId ? (
        <EmptyState
          title="Историю видно только целиком"
          hint="Выберите приключение — его сцены лягут схемой: что за чем идёт и где развилки."
        />
      ) : (
        <div className="canvas-body">
          <div className="canvas-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onNodesDelete={onNodesDelete}
              onNodeClick={(_, node) => {
                const [type, id] = splitKey(node.id);
                // Панель свойств пока умеет только сцены. Существо на схеме
                // правится на своей странице, и подменять её усечённой формой
                // в боковой панели — обещание, которого мы не выполним.
                setSelectedSceneId(type === "scene" ? id : null);
              }}
              onPaneClick={() => setSelectedSceneId(null)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={26} size={1.4} color="var(--line)" />
              <Controls showInteractive={false} />
            </ReactFlow>

            {paletteOpen && (
              <CanvasPalette
                arcId={arcId}
                settingId={settingId}
                campaignId={board?.campaign_id ?? null}
                shelfVersion={shelfVersion}
                onClose={() => setPaletteOpen(false)}
                onAdded={(sceneId) => {
                  // Новая сцена сразу выделяется: её положили под разложенным,
                  // и без выделения Мастер ищет глазами, что именно приехало.
                  // Полка тоже перечитывается — у заготовки меняется счётчик
                  // вставок. У ноды сущности выделять нечего: панель свойств
                  // умеет только сцены, и открывать её пустой незачем.
                  refreshAll();
                  if (sceneId != null) setSelectedSceneId(sceneId);
                }}
              />
            )}
          </div>

          <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />
        </div>
      )}
    </div>
  );
}

// Палитра: чем пополнить холст. Плавает над холстом, а не забирает третью
// колонку — при окне в 1000 px полотну и так достаётся меньше пятисот, и
// третья панель не оставила бы от схемы ничего.
// Вкладки палитры. Вид записей компендиума привязан к вкладке: заклинания,
// классовые умения и подклассы на схему приключения не идут — это справочник,
// а не то, что стоит в комнате.
const PALETTE_TABS = [
  { key: "scenes", label: "Сцены" },
  { key: "beings", label: "Существа", entity: "being", compendiumKinds: "monster" },
  { key: "locations", label: "Локации", entity: "location" },
  { key: "items", label: "Предметы", entity: "artifact", compendiumKinds: "magic_item,equipment" },
  { key: "events", label: "События" },
  { key: "bundles", label: "Наборы" },
] as const;

type PaletteTab = (typeof PALETTE_TABS)[number]["key"];

interface PaletteItem {
  type: string;
  id: number;
  name: string;
  note?: string;
}

const ENTITY_LIST_URL: Record<string, string> = {
  being: "/setting-beings",
  location: "/setting-locations",
  artifact: "/artifacts",
};

function CanvasPalette({
  arcId,
  settingId,
  campaignId,
  shelfVersion,
  onClose,
  onAdded,
}: {
  arcId: number;
  settingId: number;
  /** Кампания, в которой открыт холст: у неё свои события. */
  campaignId: number | null;
  /** Меняется, когда сцену положили на полку или сняли с неё. */
  shelfVersion: number;
  onClose: () => void;
  onAdded: (sceneId: number | null) => void;
}) {
  const [tab, setTab] = useState<PaletteTab>("scenes");
  const [shelf, setShelf] = useState<LibraryScene[]>([]);
  const [bundles, setBundles] = useState<LibraryBundle[]>([]);
  const [entities, setEntities] = useState<PaletteItem[]>([]);
  const [events, setEvents] = useState<PaletteItem[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<LibraryScene[]>(`/story/library?setting_id=${settingId}`).then(setShelf);
    api.get<LibraryBundle[]>(`/canvas/bundles?setting_id=${settingId}`).then(setBundles);
  }, [settingId, shelfVersion]);

  // Сущности сеттинга — целиком списком: их сотни, а не тысячи, и держать их
  // в памяти дешевле, чем ходить на сервер на каждую букву. Компендиум иначе:
  // там тысячи записей, и он ищется запросом.
  const active = PALETTE_TABS.find((t) => t.key === tab);
  const entityType = active && "entity" in active ? active.entity : null;
  const compendiumKinds = active && "compendiumKinds" in active ? active.compendiumKinds : null;

  useEffect(() => {
    if (!entityType) {
      setEntities([]);
      return;
    }
    api
      .get<{ id: number; name: string }[]>(`${ENTITY_LIST_URL[entityType]}?setting_id=${settingId}`)
      .then((rows) => setEntities(rows.map((r) => ({ type: entityType, id: r.id, name: r.name }))));
  }, [entityType, settingId]);

  // События сеттинга и кампании вместе: сцена приключения чаще двигает
  // что-то своё, кампанейское («срыв поставки в порту»), чем историю мира,
  // и предложить только хронику значит закрыть основной случай.
  useEffect(() => {
    if (tab !== "events") return;
    const calls: Promise<PaletteItem[]>[] = [
      api
        .get<{ id: number; title: string }[]>(`/settings/${settingId}/calendar-events`)
        .then((rows) =>
          rows.map((r) => ({ type: "setting_event", id: r.id, name: r.title, note: "хроника мира" }))
        ),
    ];
    if (campaignId) {
      calls.push(
        api
          .get<{ id: number; title: string }[]>(`/campaigns/${campaignId}/calendar-events`)
          .then((rows) =>
            rows.map((r) => ({ type: "campaign_event", id: r.id, name: r.title, note: "кампания" }))
          )
      );
    }
    Promise.all(calls).then((lists) => setEvents(lists.flat()));
  }, [tab, settingId, campaignId]);

  const [found, setFound] = useState<PaletteItem[]>([]);
  useEffect(() => {
    const needle = query.trim();
    if (!compendiumKinds || needle.length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ id: number; title: string; owner_label?: string }[]>(
        `/search?q=${encodeURIComponent(needle)}&types=compendium_entry&kind=${compendiumKinds}`
      )
      .then((rows) => {
        if (cancelled) return;
        setFound(
          rows.slice(0, 40).map((r) => ({
            type: "compendium_entry",
            id: r.id,
            name: r.title,
            note: r.owner_label ?? "из книги",
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [query, compendiumKinds]);

  async function createScene() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.post<StoryScene>("/story/scenes", {
        setting_id: settingId,
        arc_id: arcId,
        name: "Новая сцена",
      });
      onAdded(created.id);
    } finally {
      setBusy(false);
    }
  }

  async function insertBlank(blank: LibraryScene) {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.post<StoryScene>(`/story/library/${blank.id}/insert`, {
        arc_id: arcId,
      });
      onAdded(created.id);
    } finally {
      setBusy(false);
    }
  }

  async function place(item: PaletteItem) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/canvas/board/node", {
        arc_id: arcId,
        node_type: item.type,
        node_id: item.id,
        ...freshSpot(),
      });
      onAdded(null);
    } finally {
      setBusy(false);
    }
  }

  async function createBundle() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/canvas/bundles", {
        arc_id: arcId,
        name: "Набор",
        setting_id: settingId,
        ...freshSpot(),
      });
      onAdded(null);
    } finally {
      setBusy(false);
    }
  }

  async function insertBundle(bundle: LibraryBundle) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/canvas/bundles/${bundle.id}/insert`, { arc_id: arcId, ...freshSpot() });
      onAdded(null);
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = <T extends { name: string }>(list: T[]) =>
    needle ? list.filter((i) => i.name.toLowerCase().includes(needle)) : list;

  return (
    <div className="canvas-palette">
      <div className="canvas-palette__head">
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {PALETTE_TABS.map((t) => (
            <button
              key={t.key}
              className={`canvas-palette__tab${t.key === tab ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} title="Закрыть палитру">
          ✕
        </button>
      </div>

      {tab === "scenes" && (
        <button className="primary" onClick={createScene} disabled={busy}>
          Новая сцена
        </button>
      )}
      {tab === "bundles" && (
        <button className="primary" onClick={createBundle} disabled={busy}>
          Новый набор
        </button>
      )}

      <input
        placeholder={compendiumKinds ? "Поиск, в том числе по книгам" : "Поиск"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="canvas-palette__list">
        {tab === "scenes" && (
          <>
            <div className="canvas-palette__label">Заготовки</div>
            {filtered(shelf).map((blank) => (
              <button
                key={blank.id}
                className="canvas-palette__item"
                onClick={() => insertBlank(blank)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{blank.name}</span>
                <span className="canvas-palette__item-meta">
                  {SCENE_KIND_LABELS[blank.kind] ?? blank.kind}
                  {blank.foreign && ` · из «${blank.setting_name ?? "другого сеттинга"}»`}
                  {blank.insertions > 0 && ` · вставок: ${blank.insertions}`}
                </span>
              </button>
            ))}
            {shelf.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Полка пуста. Любую сцену можно положить на неё галочкой в свойствах.
              </p>
            )}
          </>
        )}

        {tab === "bundles" && (
          <>
            {filtered(bundles).map((b) => (
              <button
                key={b.id}
                className="canvas-palette__item"
                onClick={() => insertBundle(b)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{b.name || "Набор"}</span>
                <span className="canvas-palette__item-meta">
                  членов: {b.members}
                  {b.foreign && ` · из «${b.setting_name ?? "другого сеттинга"}»`}
                </span>
              </button>
            ))}
            {bundles.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                На полке пусто. Новый набор кладётся на неё галочкой в свойствах.
              </p>
            )}
          </>
        )}

        {tab === "events" && (
          <>
            {filtered(events).map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                className="canvas-palette__item"
                onClick={() => place(item)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{item.name}</span>
                <span className="canvas-palette__item-meta">{item.note}</span>
              </button>
            ))}
            {events.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Событий пока нет — их заводят в хронике мира и в расписании кампании.
              </p>
            )}
          </>
        )}

        {entityType && (
          <>
            {filtered(entities).map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                className="canvas-palette__item"
                onClick={() => place(item)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{item.name}</span>
              </button>
            ))}
            {found.length > 0 && <div className="canvas-palette__label">Из книг</div>}
            {found.map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                className="canvas-palette__item"
                onClick={() => place(item)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{item.name}</span>
                <span className="canvas-palette__item-meta">{item.note}</span>
              </button>
            ))}
            {compendiumKinds && query.trim().length < 2 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Записи компендиумов ищутся по названию — их тысячи, списком не
                показать.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Куда класть новую ноду. Немного случайности, чтобы две подряд не легли
 * ровно друг на друга: точное место Мастер выберет мышкой, а совпадение в
 * пиксель выглядит как «вторая не добавилась».
 */
function freshSpot(): { x: number; y: number } {
  return { x: -320 + Math.round(Math.random() * 40), y: Math.round(Math.random() * 400) };
}

// Панель свойств, а не модальное окно: холст должен оставаться видимым, пока
// правишь сцену. Тексты сцены нодами не выносятся — они тело ноды, и живут
// здесь (docs/node-editor.md, «Вложенность»).
function SceneProperties({
  sceneId,
  onSaved,
  board,
}: {
  sceneId: number | null;
  onSaved: () => void;
  board: CanvasBoard | null;
}) {
  const [scene, setScene] = useState<StorySceneDetail | null>(null);

  const refresh = useCallback(async () => {
    if (!sceneId) return;
    setScene(await api.get<StorySceneDetail>(`/story/scenes/${sceneId}`));
  }, [sceneId]);

  useEffect(() => {
    if (!sceneId) {
      setScene(null);
      return;
    }
    api.get<StorySceneDetail>(`/story/scenes/${sceneId}`).then(setScene);
  }, [sceneId]);

  // Та же правка, что и на странице сцены: PUT патчем и перечитывание. Холст
  // тоже перерисовывается — иначе подпись ноды осталась бы старой.
  async function save(patch: Record<string, unknown>) {
    if (!scene) return;
    await api.put(`/story/scenes/${scene.id}`, patch);
    const fresh = await api.get<StorySceneDetail>(`/story/scenes/${scene.id}`);
    setScene(fresh);
    onSaved();
  }

  // Отвязка кнопкой — отдельно от автоматики: «эта засада дальше пойдёт своим
  // путём» решают ДО правки, а не в момент.
  async function detach() {
    if (!scene) return;
    await api.post(`/story/scenes/${scene.id}/detach`, {});
    await refresh();
    onSaved();
  }

  async function toggleLibrary(next: boolean) {
    if (!scene) return;
    if (next) await api.post(`/story/scenes/${scene.id}/library`, {});
    else await api.del(`/story/scenes/${scene.id}/library`);
    await refresh();
    onSaved();
  }

  if (!scene) {
    return (
      <div className="canvas-props">
        <div className="canvas-props__head">
          <span className="canvas-props__label">Свойства</span>
        </div>
        <div className="canvas-props__empty">Выберите ноду, чтобы увидеть и поправить её.</div>
      </div>
    );
  }

  return (
    <div className="canvas-props">
      <div className="canvas-props__head">
        <span className="canvas-props__label">Свойства</span>
        <span className="canvas-props__label">{SCENE_KIND_LABELS[scene.kind] ?? scene.kind}</span>
      </div>

      {/* Полка — до текстов, а не после: «эта сцена по заготовке» меняет
          смысл всего, что ниже, и узнать об этом после правки поздно. */}
      <div className="canvas-props__library">
        {scene.library_name ? (
          <>
            <div className="canvas-props__label">По заготовке</div>
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <strong>{scene.library_name}</strong>
              <button onClick={detach}>Отвязать</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
              Правка заготовки доезжает сюда сама. Первая правка этой сцены —
              и она заживёт своей жизнью; вернуть обратно можно только удалив и
              вставив заново.
            </p>
          </>
        ) : scene.campaign_id != null ? (
          // Сцена кампании ложится на полку копией, а не собой: строка
          // кампании умрёт вместе с кампанией, а полка переживает всё
          // остальное. Поэтому здесь кнопка, а не галочка: галочка обещала бы,
          // что её можно снять, — а снимать будет уже нечего, копия своя.
          <>
            <div className="canvas-props__label">Полка заготовок</div>
            <button onClick={() => toggleLibrary(true)}>Скопировать на полку</button>
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
              На полку ляжет копия: сама сцена принадлежит кампании и исчезнет
              вместе с ней.
            </p>
          </>
        ) : (
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={scene.in_library === 1}
              onChange={(e) => toggleLibrary(e.target.checked)}
            />
            <span>На полке заготовок</span>
          </label>
        )}
      </div>

      {/* Те же карточки, что и на странице сцены: разбор @-упоминаний при
          чтении, автодополнение при правке и синхронизация графа ссылок при
          сохранении. Голая textarea всего этого не умела и показывала
          [[location:34|Зияющий Портал]] сырой разметкой.

          key по id сцены обязателен: карточка держит черновик внутри себя, и
          без пересоздания при выборе другой ноды в ней остался бы текст
          предыдущей. */}
      <div className="canvas-props__fields">
        <EditableTextCard
          key={`summary-${scene.id}`}
          title="Описание для мастера"
          value={scene.summary}
          onSave={(v) => save({ summary: v })}
          rows={4}
          entityType="scene"
          entityId={scene.id}
          defaultSettingId={scene.setting_id ?? undefined}
          collapsible
          defaultOpen
          fields={[
            { key: "name", label: "Имя сцены", value: scene.name, required: true },
            {
              key: "kind",
              label: "Вид",
              value: scene.kind,
              options: SCENE_KINDS.map((k) => ({ value: k.key, label: k.label })),
            },
          ]}
          onSaveFields={(v) => save({ name: String(v.name).trim(), kind: v.kind })}
        />

        <EditableTextCard
          key={`read-${scene.id}`}
          title="Зачитать игрокам"
          value={scene.read_aloud}
          onSave={(v) => save({ read_aloud: v })}
          rows={5}
          entityType="scene"
          entityId={scene.id}
          defaultSettingId={scene.setting_id ?? undefined}
          collapsible
        />

        <EditableTextCard
          key={`happening-${scene.id}`}
          title="Что происходит"
          value={scene.whats_happening}
          onSave={(v) => save({ whats_happening: v })}
          rows={5}
          entityType="scene"
          entityId={scene.id}
          defaultSettingId={scene.setting_id ?? undefined}
          collapsible
        />

        <EditableTextCard
          key={`entry-${scene.id}`}
          title="Условие входа"
          value={scene.entry_condition}
          onSave={(v) => save({ entry_condition: v })}
          rows={3}
          entityType="scene"
          entityId={scene.id}
          defaultSettingId={scene.setting_id ?? undefined}
          collapsible
        />

        <EditableTextCard
          key={`outcomes-${scene.id}`}
          title="Возможные исходы"
          value={scene.outcomes}
          onSave={(v) => save({ outcomes: v })}
          rows={4}
          entityType="scene"
          entityId={scene.id}
          defaultSettingId={scene.setting_id ?? undefined}
          collapsible
        />

        <SceneCastCard
          key={`cast-${scene.id}`}
          sceneId={scene.id}
          onChanged={async () => {
            await refresh();
            onSaved();
          }}
        />

        {scene.checks.map((c) => (
          <CheckCard
            key={c.id}
            check={c}
            // Только сцены: исход проверки ведёт в сцену, а не в существо.
            scenes={
              board?.nodes.flatMap((n) => (n.node_type === "scene" ? [n.scene] : [])) ?? []
            }
            currentSceneId={scene.id}
            onChanged={async () => {
              await refresh();
              onSaved();
            }}
          />
        ))}

        <ForeignLinksCard
          key={`foreign-${scene.id}`}
          sceneId={scene.id}
          onChanged={async () => {
            await refresh();
            onSaved();
          }}
        />

        <Link to={`/scenes/${scene.id}`} style={{ fontSize: "var(--fs-meta)" }}>
          Открыть страницу сцены →
        </Link>
      </div>
    </div>
  );
}

// Состав сцены: место, участники, предметы — с количествами.
//
// Количество показывается подписью на ребре (на ноде оно соврало бы: гоблин
// один, а сцен у него три), а правится здесь. Ловить мышкой подпись на
// стрелке — не то, чем занимаются за столом; поле в панели правится с
// клавиатуры и работает даже для тех, кого на схему не вытащили.
const CAST_ROLE_LABEL: Record<string, string> = {
  location: "Локации",
  plot_characters: "Сюжетные персонажи",
  obstacles: "Препятствия",
  loot: "Потенциальный лут",
};

function SceneCastCard({
  sceneId,
  onChanged,
}: {
  sceneId: number;
  onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<SceneCastRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const reload = useCallback(() => {
    api.get<SceneCastRow[]>(`/story/scenes/${sceneId}/cast`).then((r) => {
      setRows(r);
      setDrafts(Object.fromEntries(r.map((row) => [row.link_id, row.qty])));
    });
  }, [sceneId]);

  useEffect(reload, [reload]);

  async function saveQty(linkId: number) {
    const value = drafts[linkId] ?? "";
    if (value === rows.find((r) => r.link_id === linkId)?.qty) return;
    await api.put(`/story/cast/${linkId}`, { qty: value });
    reload();
    await onChanged();
  }

  if (rows.length === 0) return null;

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="canvas-props__label">Состав</div>
      {Object.keys(CAST_ROLE_LABEL).map((role) => {
        const group = rows.filter((r) => r.role === role);
        if (group.length === 0) return null;
        return (
          <div key={role} className="canvas-outcome">
            <div className="canvas-outcome__label">{CAST_ROLE_LABEL[role]}</div>
            {group.map((row) => (
              <div key={row.link_id} className="row" style={{ gap: 6, alignItems: "center" }}>
                <span style={{ flex: 1, minWidth: 0 }}>{row.name}</span>
                {/* Количество только там, где оно осмысленно: у места сцены
                    «1к6» ничего не значит. */}
                {role !== "location" && (
                  <input
                    style={{ width: 76 }}
                    placeholder="1"
                    title="Сколько: 4, 1к6, 2к4+1"
                    value={drafts[row.link_id] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [row.link_id]: e.target.value })}
                    onBlur={() => saveQty(row.link_id)}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Разбор чужих ссылок. Вставленная в другой мир заготовка продолжает
// показывать на существ и локации своего — работает, но лор разъезжается
// молча, и увидеть это можно только здесь.
//
// Кандидаты идут уровнями уверенности, а не флажком «нашлось»: точное
// совпадение имени и совпадение по третьему синониму — разные вещи, и решает
// всё равно Мастер.
const TIER_LABEL: Record<string, string> = {
  exact: "точно",
  likely: "вероятно",
  doubtful: "сомнительно",
};

function ForeignLinksCard({
  sceneId,
  onChanged,
}: {
  sceneId: number;
  onChanged: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<ForeignLink[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.get<ForeignLink[]>(`/story/scenes/${sceneId}/foreign-links`).then(setItems);
  }, [sceneId]);

  useEffect(reload, [reload]);

  async function repoint(item: ForeignLink, toId: number) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/story/scenes/${sceneId}/foreign-links/repoint`, {
        to_type: item.to_type,
        from_id: item.to_id,
        to_id: toId,
      });
      reload();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="canvas-props__label">Чужие ссылки ({items.length})</div>
      {items.map((item) => (
        <div key={`${item.to_type}:${item.to_id}`} className="canvas-outcome">
          <div>
            <strong>{item.name}</strong>{" "}
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              {item.type_label} · из «{item.setting_name ?? "другого сеттинга"}»
            </span>
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            {/* Названо раздельно, потому что чинится по-разному: связь снимают
                галочкой, упоминание живёт внутри абзаца. */}
            {item.links > 0 && `связей: ${item.links}`}
            {item.links > 0 && item.mentions > 0 && " · "}
            {item.mentions > 0 && `упоминаний в тексте: ${item.mentions}`}
          </div>
          {item.candidates.length > 0 ? (
            <div className="stack" style={{ gap: 4 }}>
              {item.candidates.map((c) => (
                <button key={c.id} onClick={() => repoint(item, c.id)} disabled={busy}>
                  {c.name}{" "}
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    — {TIER_LABEL[c.tier] ?? c.tier}, {c.via}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>
              В этом сеттинге такого имени нет. Ссылка остаётся чужой — она
              работает, но ведёт в другой мир.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// Проверка сцены вместе с её исходами. Ради этого блока схема ветвления и
// становится видимой: раньше «провалил — попадает в яму» лежало текстом
// внутри строки, и ни нарисовать это, ни пережить переименование ямы было
// нельзя (docs/node-editor.md, «Проверки»).
//
// Исходов свободный список: два по умолчанию, дальше сколько нужно системе.
// Приложение при этом ничего не решает — оно не бросает кубик и не выбирает
// исход, а только показывает Мастеру, что бывает в обе стороны.
function CheckCard({
  check,
  scenes,
  currentSceneId,
  onChanged,
}: {
  check: SceneCheck;
  scenes: { id: number; name: string }[];
  currentSceneId: number;
  onChanged: () => void | Promise<void>;
}) {
  async function patch(outcomeId: number, body: Record<string, unknown>) {
    await api.put(`/story/outcomes/${outcomeId}`, body);
    await onChanged();
  }

  return (
    <details className="card stack" open>
      <summary>
        <strong className="entry-title">{check.what || "Проверка"}</strong>
        {check.difficulty && <span className="muted"> · {check.difficulty}</span>}
      </summary>

      <div className="canvas-outcomes">
        {check.outcomes.map((o) => (
          <div className="canvas-outcome" key={o.id}>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="canvas-outcome__label"
                defaultValue={o.label}
                key={`label-${o.id}-${o.label}`}
                placeholder="Исход"
                onBlur={(e) => e.target.value !== o.label && patch(o.id, { label: e.target.value })}
              />
              <button
                className="comp-mini"
                title="Убрать исход"
                onClick={async () => {
                  await api.del(`/story/outcomes/${o.id}`);
                  await onChanged();
                }}
              >
                ×
              </button>
            </div>

            <input
              defaultValue={o.consequence}
              key={`cons-${o.id}-${o.consequence}`}
              placeholder="Что при этом происходит"
              onBlur={(e) =>
                e.target.value !== o.consequence && patch(o.id, { consequence: e.target.value })
              }
            />

            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="canvas-props__label">Ведёт в</span>
              <select
                value={o.target_type === "scene" && o.target_id ? String(o.target_id) : ""}
                onChange={(e) =>
                  patch(
                    o.id,
                    e.target.value
                      ? { target_type: "scene", target_id: Number(e.target.value) }
                      : { target_type: null, target_id: null }
                  )
                }
              >
                <option value="">— никуда —</option>
                {scenes
                  .filter((s) => s.id !== currentSceneId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ))}

        <button
          onClick={async () => {
            await api.post(`/story/checks/${check.id}/outcomes`, { label: "Ещё исход" });
            await onChanged();
          }}
        >
          + Исход
        </button>
      </div>
    </details>
  );
}
