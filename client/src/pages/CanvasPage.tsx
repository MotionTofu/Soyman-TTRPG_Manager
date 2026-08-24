import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  applyNodeChanges,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
// SectionHeading not used after breadcrumb — kept for other pages if needed
// import { SectionHeading } from "../components/SectionHeading";
import { EditableTextCard } from "../components/EditableTextCard";
import { SCENE_KINDS, SCENE_KIND_LABELS } from "../sceneKinds";
import { formatByPrecision } from "../inworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { EmptyState } from "../components/EmptyState";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import "../canvas.css";
import type {
  CanvasAnyNode,
  CanvasBoard,
  CanvasFrameNode,
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
const AUDIO_HANDLES = [
  { id: "audio", label: "Аудио", color: "#145A32" },
  { id: "battle", label: "Боевой плейлист", color: "#E74C3C" },
] as const;

interface SceneNodeData extends Record<string, unknown> {
  name: string;
  kind: string;
  summary: string;
  /** Вытащить на холст тех, кто к сцене уже подцеплен. */
  onPullCast: () => void;
  onAddCheck: () => void;
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
          className={`canvas-handle--entity canvas-handle--${h.id}`}
          title={h.label}
        />
      ))}
      {AUDIO_HANDLES.map((h, i) => (
        <Handle
          key={h.id}
          type="target"
          id={h.id}
          position={Position.Left}
          style={{ top: 124 + i * 20 }}
          className={`canvas-handle--entity canvas-handle--${h.id}`}
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
        {data.summary && (
          <div
            className="canvas-node__summary"
            title={data.summary}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "var(--fs-meta)",
              lineHeight: 1.35,
              color: "var(--muted)",
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              marginTop: 4,
            }}
          >
            {data.summary}
          </div>
        )}
        {/* Кнопка только у выбранной ноды: богатство органов управления
            считается минусом, а на схеме из тридцати сцен тридцать кнопок —
            это шум, который читается раньше имён. */}
        {selected && (
          <>
            <button className="nodrag canvas-node__action" onClick={data.onPullCast}>
              Вытащить состав
            </button>
            <button className="nodrag canvas-node__action" onClick={data.onAddCheck}>
              + Проверка
            </button>
          </>
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
        className="canvas-handle--entity canvas-handle--consequences"
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
    <div className={`canvas-node canvas-node--entity canvas-node--${data.nodeType}${selected ? " is-selected" : ""}`}>
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
      <Handle type="source" position={Position.Right} className={`canvas-handle--entity canvas-handle--${data.nodeType}`} />
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
      <Handle type="target" position={Position.Left} id="members" className="canvas-handle--entity canvas-handle--members" />
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
      <Handle type="target" position={Position.Left} id="story" style={{ top: 18 }} className="canvas-handle--story" title="История" />
      <Handle type="target" position={Position.Left} id="in" style={{ top: 44 }} className="canvas-handle--entity canvas-handle--in" title="Последствие" />
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

interface CheckNodeData extends Record<string, unknown> {
  what: string;
  difficulty: string;
  outcomes: { id: number; label: string }[];
}

interface AdventureNodeData extends Record<string, unknown> {
  name: string;
}

function AdventureNode({ data, selected }: NodeProps<Node<AdventureNodeData>>) {
  return (
    <div className={`canvas-node${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="story" className="canvas-handle--story" />
      <div className="canvas-node__band">
        <span className="canvas-node__name">{data.name}</span>
        <span className="canvas-node__kind">Приключение</span>
      </div>
      <Handle type="source" position={Position.Right} id="story" className="canvas-handle--story" />
    </div>
  );
}

interface StickerNodeData extends Record<string, unknown> {
  text: string;
  name: string;
  note: string;
  color: string;
}
const STICKER_COLORS: Record<string, string> = {
  paper: "var(--paper)",
  yellow: "#F2E8C6",
  blue: "#DDE8F0",
  green: "#D8E8D8",
  pink: "#F0DDE8",
  sand: "#E8DDD0",
  lavender: "#E0E0E8",
};
const FRAME_COLORS: Record<string, string> = {
  slate: "#2C3E50",
  plum: "#4A235A",
  navy: "#1A252F",
  teal: "#145A32",
  burgundy: "#7B241C",
  brown: "#6E2C00",
  charcoal: "#17202A",
  graphite: "#283747",
};
interface SoundSetNodeData extends Record<string, unknown> {
  name: string;
  battle_playlist_id: number | null;
}
function SoundSetNode({ data, selected }: NodeProps<Node<SoundSetNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--sound_set${selected ? " is-selected" : ""}`} style={{ borderColor: "#145A32" }}>
      <div className="canvas-node__band" style={{ background: "#145A32", color: "#F8F6F1" }}>
        <span className="canvas-node__name">{data.name || "Набор"}</span>
        <span className="canvas-node__kind">Аудио</span>
      </div>
      <Handle type="source" position={Position.Right} id="audio" style={{ top: 18 }} className="canvas-handle--entity canvas-handle--audio" title="Аудио" />
    </div>
  );
}
interface PlaylistNodeData extends Record<string, unknown> {
  name: string;
}
function PlaylistNode({ data, selected }: NodeProps<Node<PlaylistNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--playlist${selected ? " is-selected" : ""}`} style={{ borderColor: "#E74C3C" }}>
      <div className="canvas-node__band" style={{ background: "#E74C3C", color: "#F8F6F1" }}>
        <span className="canvas-node__name">{data.name || "Плейлист"}</span>
        <span className="canvas-node__kind">Бой</span>
      </div>
      <Handle type="source" position={Position.Right} id="battle" className="canvas-handle--entity canvas-handle--battle" title="Бой" />
    </div>
  );
}
function StickerNode({ data, selected }: NodeProps<Node<StickerNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--sticker${selected ? " is-selected" : ""}`} style={{ background: STICKER_COLORS[data.color] ?? STICKER_COLORS.paper, border: "1.5px solid var(--line)", boxShadow: "0 1px 0 rgba(18,16,14,0.06)" }}>
      <div className="canvas-node__body" style={{ padding: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-body)", fontWeight: 600, whiteSpace: "pre-wrap" }}>{data.name || data.text || "Заметка"}</span>
        {data.note && <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap", opacity: 0.85 }}><MentionText text={data.note} /></span>}
      </div>
    </div>
  );
}

interface ImageNodeData extends Record<string, unknown> {
  fileUrl: string;
  w: number;
  h: number;
}
function ImageNode({ data, selected }: NodeProps<Node<ImageNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--image${selected ? " is-selected" : ""}`} style={{ width: data.w, height: data.h, padding: 0, overflow: "hidden", border: "1.5px solid var(--line)", background: "var(--paper)", boxSizing: "border-box" }}>
      <img src={data.fileUrl} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" as const }} />
    </div>
  );
}

interface FrameNodeData extends Record<string, unknown> {
  name: string;
  w: number;
  h: number;
  color: string;
  isHighlighted?: boolean;
}
function FrameNode({ id, data, selected }: NodeProps<Node<FrameNodeData>>) {
  const col = data.color || "#2C3E50";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name || "Группа");
  useEffect(() => { setDraft(data.name || "Группа"); }, [data.name]);
  const save = async () => {
    const next = draft.trim() || "Группа";
    if (next === data.name) { setEditing(false); return; }
    const fid = Number(id.split(":")[1]);
    await api.put(`/canvas/frames/${fid}`, { name: next });
    setEditing(false);
    // лёгкий рефреш — имя уже в локальном стейте, но база тоже обновлена
  };
  return (
    <div className={`canvas-frame${data.isHighlighted ? " is-highlighted" : ""}`} style={{ borderColor: col }}>
      <NodeResizer isVisible={!!selected} minWidth={200} minHeight={120} lineStyle={{ borderColor: col }} handleStyle={{ width: 30, height: 30, borderColor: col, background: "var(--paper)" }} />
      {editing ? (
        <input
          className="canvas-frame__title-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(data.name || "Группа"); setEditing(false); } }}
          onClick={(e) => e.stopPropagation()}
          style={{ background: col, color: "#F8F6F1", border: "none", outline: "none", fontFamily: "var(--font-display)", fontSize: "var(--fs-meta)", fontWeight: 600, padding: "4px 8px", width: "100%", boxSizing: "border-box" }}
        />
      ) : (
        <div
          className="canvas-frame__title"
          style={{ background: col, color: "#F8F6F1", cursor: selected ? "text" : "default" }}
          onClick={(e) => { if (!selected) return; e.stopPropagation(); setEditing(true); }}
          title={selected ? "Нажмите чтобы переименовать" : undefined}
        >
          {draft}
        </div>
      )}
    </div>
  );
}

// Нода проверки — справа от сцены, исходы — хендлы справа, подпись в чип-рамке Q7 а.
function CheckNode({ data, selected }: NodeProps<Node<CheckNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--check${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="story" style={{ top: 18 }} className="canvas-handle--story" title="История" />
      <div className="canvas-node__band">
        <span className="canvas-node__name">{data.what || "Проверка"}</span>
        <span className="canvas-node__kind">Проверка</span>
      </div>
      <div className="canvas-node__body">
        {data.difficulty && <span className="canvas-node__chip">{data.difficulty}</span>}
        <div className="stack" style={{ gap: 2 }}>
          {data.outcomes.map((o) => (
            <span key={o.id} className="canvas-node__member">
              {o.label}
            </span>
          ))}
        </div>
      </div>
      {data.outcomes.map((o, i) => (
        <Handle
          key={o.id}
          type="source"
          position={Position.Right}
          id={`outcome:${o.id}`}
          style={{ top: 44 + i * 20 }}
          className="canvas-handle--story"
          title={o.label}
        />
      ))}
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
  color: string;
}

function ChapterNode({ data }: NodeProps<Node<ChapterNodeData>>) {
  const col = data.color || "#2C3E50";
  return (
    <div className="canvas-frame" style={{ borderColor: col }}>
      <div className="canvas-frame__title" style={{ background: col, color: "#F8F6F1" }}>{data.name}</div>
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
  check: CheckNode,
  adventure: AdventureNode,
  sticker: StickerNode,
  image: ImageNode,
  frame: FrameNode,
  chapter: ChapterNode,
  sound_set: SoundSetNode,
  playlist: PlaylistNode,
};

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };

const EDGE_CLASS: Record<string, string | undefined> = {
  transition: undefined,
  outcome: "canvas-edge--outcome",
  cast: "canvas-edge--cast",
  member: "canvas-edge--cast",
  check: "canvas-edge--cast",
};

type CanvasNodeData =
  | SceneNodeData
  | EntityNodeData
  | BundleNodeData
  | EventNodeData
  | CheckNodeData
  | AdventureNodeData
  | StickerNodeData
  | ImageNodeData
  | FrameNodeData
  | ChapterNodeData
  | SoundSetNodeData
  | PlaylistNodeData;

/** Рамки лежат в том же массиве нод — отличать их надо по ключу. */
function isFrame(id: string): boolean {
  return id.startsWith("chapter:") || id.startsWith("frame:");
}

function getNodeSize(n: Node<CanvasNodeData>): { w: number; h: number } {
  const w = (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number })?.w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : n.type === "adventure" ? 200 : 200);
  const h = (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number })?.h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
  return { w, h };
}
function applyGroupDepth(all: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  const groups = all.filter((n) => isFrame(n.id));
  const others = all.filter((n) => !isFrame(n.id));
  if (groups.length === 0) return all;
  const depth = new Map<string, number>();
  for (const g of groups) {
    const gx = g.position.x;
    const gy = g.position.y;
    const w = (g as unknown as { width?: number }).width ?? (g.data as unknown as { w?: number })?.w ?? 320;
    const h = (g as unknown as { height?: number }).height ?? (g.data as unknown as { h?: number })?.h ?? 240;
    const inside = others.filter((n) => {
      const { x, y } = n.position;
      const { w: nw, h: nh } = getNodeSize(n);
      // считаем внутри если хотя бы часть перекрывает рамку (центр или угол)
      return x + nw > gx && x < gx + w && y + nh > gy && y < gy + h;
    });
    if (inside.length === 0) depth.set(g.id, -1);
    else {
      const minZ = Math.min(...inside.map((n) => (n as unknown as { zIndex?: number }).zIndex ?? 0));
      depth.set(g.id, minZ - 1);
    }
  }
  return all.map((n) => (isFrame(n.id) ? ({ ...n, zIndex: depth.get(n.id) } as Node<CanvasNodeData>) : n));
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
  onAddCheck: (sceneId: number) => void,
  months: CalendarMonth[],
  era: string
): Node<CanvasNodeData> {
  const base: Node<CanvasNodeData> = { id: n.key, position: { x: n.x, y: n.y }, zIndex: (n as unknown as { z_index?: number }).z_index ?? 0 } as Node<CanvasNodeData>;
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
      deletable: true,
      data: {
        name: n.scene.name,
        kind: n.scene.kind,
        summary: n.scene.summary ?? "",
        isOverride: n.scene.is_override,
        campaignOnly: n.scene.campaign_only,
        libraryName: n.scene.library_name,
        inLibrary: n.scene.in_library,
        foreignLinks: n.scene.foreign_links,
        onPullCast: () => onPullCast(n.scene.id),
        onAddCheck: () => onAddCheck(n.scene.id),
      },
    };
  }
  if (n.node_type === "check") {
    return {
      ...base,
      type: "check",
      data: {
        what: n.check.what,
        difficulty: n.check.difficulty,
        outcomes: n.check.outcomes.map((o) => ({ id: o.id, label: o.label })),
      },
    };
  }
  if (n.node_type === "adventure") {
    return {
      ...base,
      type: "adventure",
      data: { name: n.adventure.name },
    };
  }
  if (n.node_type === "sticker") {
    return { ...base, type: "sticker", data: { text: n.sticker.text, name: n.sticker.name, note: n.sticker.note, color: n.sticker.color } };
  }
  if (n.node_type === "image") {
    return { ...base, type: "image", data: { fileUrl: n.image.file_url, w: n.image.w, h: n.image.h }, width: n.image.w, height: n.image.h };
  }
  if (n.node_type === "frame") {
    return { ...base, type: "frame", data: { name: n.frame.name, color: n.frame.color, w: n.frame.w, h: n.frame.h }, width: n.frame.w, height: n.frame.h };
  }
  if (n.node_type === "sound_set") {
    return { ...base, type: "sound_set", data: { name: n.sound_set.name, battle_playlist_id: n.sound_set.battle_playlist_id } };
  }
  if (n.node_type === "playlist") {
    return { ...base, type: "playlist", data: { name: n.playlist.name } };
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
    deletable: true,
    // Тащат рамку за заголовок: тело рамки указатель не ловит, иначе рамка в
    // пол-экрана съела бы и щелчок по сцене под ней, и выделение рамкой.
    dragHandle: ".canvas-frame__title",
    // Ниже сцен рамка оказывается порядком в массиве, а не отрицательным
    // z-index: при zIndex: -1 нода уходит ЗА полотно, и заголовок перестаёт
    // ловить мышь — тянется не рамка, а весь холст.
    data: { name: g.name, color: g.color ?? "#2C3E50" },
  };
}

export function CanvasPage() {
  // Что открыто — в адресе, как окрестность у Графа связей: на холст ведут
  // ссылки со страниц приключений, и такую ссылку можно сохранить.
  const [searchParams, setSearchParams] = useSearchParams();
  const settingId = Number(searchParams.get("setting")) || 0;
  const arcId = Number(searchParams.get("arc")) || 0;
  const campaignIdParam = Number(searchParams.get("campaign")) || 0;
  const freeId = Number(searchParams.get("free_id")) || 0;
  const focusParam = searchParams.get("focus") || "";

  // Календарь нужен ради дат на нодах событий: месяцы и эра живут в
  // сеттинге, и без них «1492-06-15» осталось бы машинной строкой.
  const calendar = useSettingCalendar(settingId);
  const calendarRef = useRef<{ months: CalendarMonth[]; era: string }>({ months: [], era: "" });
  calendarRef.current = { months: calendar?.months ?? [], era: calendar?.era ?? "" };
  const initialFitDone = useRef(false);

  const [settings, setSettings] = useState<Setting[]>([]);
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: number; name: string }[]>([]);
  void campaigns;
  const [board, setBoard] = useState<CanvasBoard | null>(null);
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const [selectedCheckId, setSelectedCheckId] = useState<number | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<number | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [freeBoards, setFreeBoards] = useState<{ id: number; scope_id: number; name: string; nodes: number; created_at: string }[]>([]);
  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem("canvasPropsCollapsed") === "1");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [showCanvasWizard, setShowCanvasWizard] = useState(false);
  const [showOpenWizard, setShowOpenWizard] = useState(false);
  const [showNodeWizard, setShowNodeWizard] = useState(false);
  // Палитра закрыта по умолчанию: за столом холст нужен целиком, а пополняют
  // его в подготовке.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Полка перечитывается по этому счётчику. Без него галочка «на полку» в
  // свойствах меняла базу, а открытая рядом палитра продолжала показывать
  // старый список — и выглядело это как «галочка не сработала».
  const [shelfVersion, setShelfVersion] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedFrameId, setHighlightedFrameId] = useState<number | null>(null);
  const flowRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const historyRef = useRef<Node<CanvasNodeData>[][]>([]);
  const redoRef = useRef<Node<CanvasNodeData>[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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

  useEffect(() => {
    if (!settingId) {
      setCampaigns([]);
      return;
    }
    api.get<{ id: number; name: string; setting_id: number | null }[]>(`/campaigns?setting_id=${settingId}`).then((rows) => setCampaigns(rows));
  }, [settingId]);

  useEffect(() => {
    if (!settingId && !freeId) api.get<{ id: number; scope_id: number; name: string; nodes: number; created_at: string }[]>("/canvas/free-boards").then(setFreeBoards);
  }, [settingId, freeId]);

  useEffect(() => {
    localStorage.setItem("canvasPropsCollapsed", panelCollapsed ? "1" : "0");
  }, [panelCollapsed]);

  // Через ref, а не через зависимость: обработчик «вытащить состав» знает
  // позицию ноды, то есть меняется на каждое перетаскивание, и держать его в
  // зависимостях loadBoard значило бы перезагружать холст при каждом сдвиге.
  const pullCastRef = useRef<(sceneId: number) => void>(() => {});
  const addCheckRef = useRef<(sceneId: number) => void>(() => {});

  const loadBoard = useCallback(() => {
    // свитч scope (Q5 б + free): free → фриформ, arc → приключение, setting без arc → обзор сеттинга, campaign без arc → сборка
    if (freeId) {
      api.get<CanvasBoard>(`/canvas/board?free_id=${freeId}`).then((b) => {
        setBoard(b);
        const nextNodes = applyGroupDepth([...(b.groups ?? []).map(toFrameNode), ...b.nodes.map((n) => toFlowNode(n, pullCastRef.current, addCheckRef.current, calendarRef.current.months, calendarRef.current.era))]);
        setNodes(nextNodes);
        if (!initialFitDone.current && nextNodes.length) {
          initialFitDone.current = true;
          setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 300 }), 80);
        }
      });
      return;
    }
    if (arcId) {
      const q = campaignIdParam ? `&campaign_id=${campaignIdParam}` : "";
      api.get<CanvasBoard>(`/canvas/board?arc_id=${arcId}${q}`).then((b) => {
      setBoard(b);
      const nextNodes = applyGroupDepth([
        // Рамки идут первыми — под сценами: React Flow рисует в порядке
        // массива, и одного zIndex мало, когда ноды перерисовываются.
        ...(b.groups ?? []).map(toFrameNode),
        ...b.nodes.map((n) =>
          toFlowNode(n, pullCastRef.current, addCheckRef.current, calendarRef.current.months, calendarRef.current.era)
        ),
      ]);
      setNodes(nextNodes);
      if (!initialFitDone.current && nextNodes.length) {
        initialFitDone.current = true;
        setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 300 }), 80);
      }
      // focus из URL — select + панель (без авто-приближения)
      if (focusParam) {
        const [ft, fid] = splitKey(focusParam);
        if (ft === "scene" && Number(fid)) {
          setSelectedSceneId(Number(fid));
          setSelectedCheckId(null);
          setSelectedStickerId(null);
        } else if (ft === "check" && Number(fid)) {
          setSelectedCheckId(Number(fid));
          setSelectedSceneId(null);
          setSelectedStickerId(null);
        } else if (ft === "sticker" && Number(fid)) {
          setSelectedStickerId(Number(fid));
          setSelectedSceneId(null);
          setSelectedCheckId(null);
        } else if (ft === "chapter") {
          setSelectedSceneId(null);
          setSelectedCheckId(null);
          setSelectedStickerId(null);
        }
        // неразложенная нода фокуса — зафиксировать defaultPosition
        const focused = b.nodes.find((n) => n.key === focusParam);
        if (focused && !focused.placed) {
          api.put("/canvas/board/nodes", {
            arc_id: arcId,
            nodes: [{ node_type: focused.node_type, node_id: focused.node_id, x: Math.round(focused.x), y: Math.round(focused.y) }],
          });
        }
      }
    });
    } else if (settingId && !campaignIdParam) {
      // сеттинг-холст: ?setting= без arc
      api.get<CanvasBoard>(`/canvas/board?setting_id=${settingId}`).then((b) => {
        setBoard(b);
        const nextNodes = applyGroupDepth([...(b.groups ?? []).map(toFrameNode), ...b.nodes.map((n) => toFlowNode(n, pullCastRef.current, addCheckRef.current, calendarRef.current.months, calendarRef.current.era))]);
        setNodes(nextNodes);
        if (!initialFitDone.current && nextNodes.length) {
          initialFitDone.current = true;
          setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 300 }), 80);
        }
      });
    } else if (campaignIdParam) {
      api.get<CanvasBoard>(`/canvas/board?campaign_id=${campaignIdParam}`).then((b) => {
        setBoard(b);
        const nextNodes = applyGroupDepth([...(b.groups ?? []).map(toFrameNode), ...b.nodes.map((n) => toFlowNode(n, pullCastRef.current, addCheckRef.current, calendarRef.current.months, calendarRef.current.era))]);
        setNodes(nextNodes);
        if (!initialFitDone.current && nextNodes.length) {
          initialFitDone.current = true;
          setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 300 }), 80);
        }
      });
    } else {
      setBoard(null);
      setNodes([]);
    }
  }, [arcId, settingId, campaignIdParam, freeId, focusParam]);

  // Подсветка новой группы — мягкий отклик «вот ваша новая рамка, она здесь»
  useEffect(() => {
    if (highlightedFrameId == null) return;
    // подсветить + выделить
    setNodes((cur) => cur.map((n) => n.id === `frame:${highlightedFrameId}` ? { ...n, selected: true, data: { ...n.data, isHighlighted: true } } as unknown as Node<CanvasNodeData> : { ...n, selected: false } as Node<CanvasNodeData>));
    // панорама к группе
    const target = nodesRef.current.find((n) => n.id === `frame:${highlightedFrameId}`);
    if (target) {
      const w = (target.data as unknown as { w?: number }).w ?? 320;
      const h = (target.data as unknown as { h?: number }).h ?? 240;
      setTimeout(() => flowRef.current?.setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: 0.9, duration: 420 }), 80);
    }
    const t = setTimeout(() => {
      setNodes((cur) => cur.map((n) => n.id === `frame:${highlightedFrameId}` ? { ...n, data: { ...n.data, isHighlighted: false } } as Node<CanvasNodeData> : n));
      setHighlightedFrameId(null);
    }, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedFrameId]);

  useEffect(() => {
    initialFitDone.current = false;
  }, [freeId, arcId, settingId, campaignIdParam]);
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
        selectable: true,
        deletable: true,
      }))
    );
  }, [board, setEdges]);

  // Раскладка сохраняется пачкой и с задержкой: перетаскивание рождает
  // событие на каждый кадр, и запрос на кадр превратил бы один жест в сотню
  // записей в базу. Для фриформ/кампании arcId=0, используем board_id (Q1 а).
  const saveTimer = useRef<number | null>(null);
  const boardRef = useRef<CanvasBoard | null>(null);
  boardRef.current = board;
  const scheduleSave = useCallback(
    (next: Node<CanvasNodeData>[]) => {
      const b = boardRef.current;
      if (!b?.board_id) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.put("/canvas/board/nodes", {
          board_id: b.board_id,
          nodes: next.filter((n) => !isFrame(n.id)).map((n) => {
            const [nodeType, nodeId] = splitKey(n.id);
            return {
              node_type: nodeType,
              node_id: nodeId,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
              z_index: (n as unknown as { zIndex?: number }).zIndex ?? 0,
            };
          }),
        });
      }, 500);
    },
    []
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

  // undo/redo — только раскладка, не данные
  const pushHistory = useCallback(() => {
    historyRef.current.push(nodesRef.current.map((n) => ({ ...n, position: { ...n.position } })));
    if (historyRef.current.length > 40) historyRef.current.shift();
    setCanUndo(true);
    redoRef.current = [];
    setCanRedo(false);
  }, []);
  const undoLayout = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(nodesRef.current.map((n) => ({ ...n, position: { ...n.position } })));
    setCanRedo(true);
    setNodes(prev);
    scheduleSave(prev);
    setCanUndo(historyRef.current.length > 0);
  }, [scheduleSave]);
  const redoLayout = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(nodesRef.current.map((n) => ({ ...n, position: { ...n.position } })));
    setCanUndo(true);
    setNodes(next);
    scheduleSave(next);
    setCanRedo(redoRef.current.length > 0);
  }, [scheduleSave]);

  const handleQuickCanvas = useCallback(async () => {
    // сосед текущей сцены/главы/приключения, как просил: смотришь сцену в Синий переулок Вотердип → рядом там же
    if (selectedSceneId && arcId) {
      const name = prompt("Название быстрой сцены", "Новая сцена");
      if (!name?.trim()) return;
      // находим arc_id сцены (из board.nodes или из selectedSceneId)
      const sc = board?.nodes.find((n) => n.node_type === "scene" && n.node_id === selectedSceneId) as { scene?: { arc_id: number | null } } | undefined;
      const targetArc = sc?.scene?.arc_id ?? arcId;
      const created = await api.post<{ id: number }>("/story/scenes", { setting_id: settingId, arc_id: targetArc, name: name.trim() });
      // ставим рядом: берём позицию выделенной +20,20 и сохраняем
      const sel = nodes.find((n) => n.id === `scene:${selectedSceneId}`);
      if (sel && board?.board_id) {
        await api.put("/canvas/board/nodes", { board_id: board.board_id, nodes: [{ node_type: "scene", node_id: created.id, x: Math.round(sel.position.x + 20), y: Math.round(sel.position.y + 20) }] });
      }
      loadBoard();
      setSearchParams({ setting: String(settingId), arc: String(arcId), focus: `scene:${created.id}` });
      return;
    }
    if (arcId) {
      const name = prompt("Название быстрой сцены", "Новая сцена");
      if (!name?.trim()) return;
      const created = await api.post<{ id: number }>("/story/scenes", { setting_id: settingId, arc_id: arcId, name: name.trim() });
      loadBoard();
      setSearchParams({ setting: String(settingId), arc: String(arcId), focus: `scene:${created.id}` });
      return;
    }
    if (settingId) {
      const name = prompt("Название быстрого приключения", "Новое приключение");
      if (!name?.trim()) return;
      const created = await api.post<{ id: number }>("/story/arcs", { setting_id: settingId, name: name.trim(), kind: "adventure" });
      setSearchParams({ setting: String(settingId), arc: String(created.id) });
      return;
    }
    const name = prompt("Название быстрой доски", `Быстрый ${new Date().toLocaleDateString()}`);
    if (!name?.trim()) return;
    const created = await api.post<{ id: number; scope_id: number; name: string }>("/canvas/free-boards", { name: name.trim() });
    setSearchParams({ free_id: String(created.scope_id) });
  }, [settingId, arcId, selectedSceneId, nodes, board, loadBoard, setSearchParams]);

  const handleCreateGroupFromSelection = useCallback(async () => {
    if (!board?.board_id) return;
    const selected = nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
    let newId: number | null = null;
    if (!selected.length) {
      const name = prompt("Название группы", "Группа");
      if (!name?.trim()) return;
      const res = await api.post<{ id: number }>("/canvas/frames", { board_id: board.board_id, name: name.trim(), x: 0, y: 0, w: 360, h: 240 });
      newId = res.id;
    } else {
      const getW = (n: Node<CanvasNodeData>) => (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number }).w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : 200);
      const getH = (n: Node<CanvasNodeData>) => (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number }).h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
      const minX = Math.min(...selected.map((n) => n.position.x)) - 16;
      const minY = Math.min(...selected.map((n) => n.position.y)) - 34;
      const maxX = Math.max(...selected.map((n) => n.position.x + getW(n)));
      const maxY = Math.max(...selected.map((n) => n.position.y + getH(n)));
      const name = prompt("Название группы", "Группа");
      if (name == null) return;
      const res = await api.post<{ id: number }>("/canvas/frames", { board_id: board.board_id, name: name?.trim() || "Группа", x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) });
      newId = res.id;
    }
    if (newId) {
      setSelectedFrameId(newId);
      setSelectedChapterId(null);
      setSelectedSceneId(null);
      setSelectedCheckId(null);
      setSelectedStickerId(null);
      loadBoard();
      setTimeout(() => setHighlightedFrameId(newId), 400);
    } else {
      loadBoard();
    }
  }, [board, nodes, loadBoard]);

  // cmd+k — поиск по нодам (имя + foreignLinks)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && canUndo) {
        e.preventDefault();
        undoLayout();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && canRedo) {
        e.preventDefault();
        redoLayout();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canUndo, canRedo, undoLayout, redoLayout]);

  const filteredSearch = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as Node<CanvasNodeData>[];
    return nodes.filter((n) => {
      const d = n.data as Record<string, unknown>;
      const name = String((d.name as string) ?? (d.title as string) ?? (d.what as string) ?? "");
      return name.toLowerCase().includes(q);
    });
  })();

  const autoLayoutUnplaced = useCallback(() => {
    // Только !placed — ручное не трогать (решение Q7)
    const unplacedIds = new Set((board?.nodes ?? []).filter((n) => !n.placed).map((n) => n.key));
    if (unplacedIds.size === 0) return;
    pushHistory();
    setNodes((cur) => {
      // группируем по arc_id для seatInFrame, иначе defaultPosition
      const groupByArc = new Map<string, { x: number; y: number; w: number }>();
      (board?.groups ?? []).forEach((g) => groupByArc.set(String(g.arc_id), g));
      const counter = new Map<string, number>();
      let seq = 0;
      const next = cur.map((n) => {
        if (!unplacedIds.has(n.id)) return n;
        const scene = (board?.nodes ?? []).find((b) => b.key === n.id) as { scene?: { arc_id: number | null } } | undefined;
        const arcKey = scene?.scene?.arc_id != null ? String(scene.scene.arc_id) : "";
        const frame = arcKey ? groupByArc.get(arcKey) : undefined;
        if (frame) {
          const seat = counter.get(arcKey) ?? 0;
          counter.set(arcKey, seat + 1);
          const cols = Math.max(1, Math.floor((frame.w - 32) / 300));
          return { ...n, position: { x: frame.x + 16 + (seat % cols) * 300, y: frame.y + 34 + Math.floor(seat / cols) * 200 } };
        }
        const pos = { x: (seq % 4) * 300, y: Math.max(...cur.map((c) => c.position.y), 0) + 200 + Math.floor(seq / 4) * 200 };
        seq++;
        return { ...n, position: pos };
      });
      scheduleSave(next);
      return next;
    });
  }, [board, pushHistory, scheduleSave]);

  const onNodeDragStart = useCallback((_: unknown, node: Node<CanvasNodeData>) => {
    pushHistory();
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
        const [t, id] = splitKey(node.id);
        if (t === "chapter") {
          api.put(`/canvas/groups/${id}`, {
            board_id: board.board_id,
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          });
        } else if (t === "frame") {
          api.put(`/canvas/frames/${id}`, {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
            w: Math.round((node as unknown as { width?: number }).width ?? (node.data as unknown as { w?: number }).w ?? 320),
            h: Math.round((node as unknown as { height?: number }).height ?? (node.data as unknown as { h?: number }).h ?? 240),
          });
        }
      }
      frameDragRef.current = null;
    },
    [board]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasNodeData>>[]) => {
      const isDrag = changes.some((c) => (c as unknown as { dragging?: boolean }).dragging === true);
      const isDragEnd = changes.some((c) => c.type === "position" && (c as unknown as { dragging?: boolean }).dragging === false);
      const isSelect = changes.some((c) => c.type === "select" || c.type === "dimensions");
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
        // глубина групп — только в конце перетаскивания/выделения, не на каждый кадр
        if (isDragEnd || isSelect || !isDrag) next = applyGroupDepth(next);
        // Пишем только когда перетаскивание закончилось: промежуточные
        // положения никому не нужны, а выделение и подсветка вообще не
        // касаются раскладки.
        if (isDragEnd) scheduleSave(next);
        // ресайз группы — w/h в canvas_frames / canvas_groups
        const dim = changes.find((c) => c.type === "dimensions" && (c as unknown as { dragging?: boolean }).dragging === false) as unknown as { id: string; dimensions?: { width: number; height: number } } | undefined;
        if (dim && isFrame(dim.id) && board) {
          const [t, fid] = splitKey(dim.id);
          const w = Math.round(dim.dimensions?.width ?? 0);
          const h = Math.round(dim.dimensions?.height ?? 0);
          if (t === "frame") api.put(`/canvas/frames/${fid}`, { w, h });
          else if (t === "chapter") api.put(`/canvas/groups/${fid}`, { board_id: board.board_id, w, h });
        }
        return next;
      });
    },
    [scheduleSave, board]
  );

  // Что означает протянутая стрелка, решает РАЗЪЁМ, в который её воткнули, а
  // не тип того, что тянули. Существо бывает и участником, и обстановкой; в
  // «место» его тоже можно воткнуть, и это осмысленно.
  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
    console.log("onConnectStart", params);
  }, []);
  const onConnectEnd = useCallback((event: unknown) => {
    console.log("onConnectEnd", event);
  }, []);
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const [sourceType, sourceId] = splitKey(connection.source);
      const [targetType, targetId] = splitKey(connection.target);
      const handle = connection.targetHandle ?? "story";
      const sourceHandle = connection.sourceHandle ?? "";

      // Исход проверки → сцена (Q2, Q4): хендл outcome:<id> на check-ноде
      if (sourceType === "check" && targetType === "scene") {
        const m = sourceHandle.match(/^outcome:(\d+)$/);
        const outcomeId = m ? Number(m[1]) : null;
        if (outcomeId) {
          await api.put(`/story/outcomes/${outcomeId}`, { target_type: "scene", target_id: targetId });
          loadBoard();
          return;
        }
      }

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
      } else if (sourceType === "adventure" && targetType === "adventure") {
        await api.post(`/story/arcs/${sourceId}/transitions`, { to_arc_id: targetId });
      } else if (sourceType === "sound_set" && targetType === "scene" && handle === "audio") {
        await api.put(`/story/scenes/${targetId}/sound-set`, { sound_set_id: sourceId });
      } else if (sourceType === "playlist" && targetType === "scene" && handle === "battle") {
        await api.post(`/story/scenes/${targetId}/cast`, { to_type: "playlist", to_id: sourceId, role: "battle" });
      } else if (sourceType === "scene" && targetType === "check" && handle === "story") {
        await api.put(`/story/checks/${targetId}`, { scene_id: sourceId });
        const sceneNode = nodes.find((n) => n.id === `scene:${sourceId}`);
        if (sceneNode && board?.board_id) {
          await api.put("/canvas/board/nodes", {
            board_id: board.board_id,
            nodes: [{ node_type: "check", node_id: targetId, x: Math.round(sceneNode.position.x + 240), y: Math.round(sceneNode.position.y) }],
          });
        }
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
    [loadBoard, nodes, board]
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
          if (kind === "arc_transition") return api.del(`/story/arc-transitions/${rawId}`);
          if (kind === "scene_check") return api.del(`/story/checks/${rawId}`);
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

  const addCheck = useCallback(
    async (sceneId: number) => {
      await api.post(`/story/scenes/${sceneId}/checks`, { what: "Проверка", difficulty: "", on_success: "", on_failure: "" });
      loadBoard();
    },
    [loadBoard]
  );
  useEffect(() => {
    addCheckRef.current = addCheck;
  }, [addCheck]);

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      const [kind, rawId] = edge.id.split(":");
      const items: ContextMenuItem[] = [
        {
          label: "Удалить связь",
          danger: true,
          onClick: () => onEdgesDelete([edge]),
        },
        ...(kind === "outcome"
          ? [
              {
                label: "Отцепить от входа",
                onClick: async () => {
                  await api.put(`/story/outcomes/${rawId}`, { target_type: null, target_id: null });
                  loadBoard();
                },
              } as ContextMenuItem,
            ]
          : []),
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [onEdgesDelete, loadBoard]
  );

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node<CanvasNodeData>) => {
      const [type, id] = splitKey(node.id);
      if (type === "adventure" && settingId && !arcId && !freeId) {
        setSearchParams({ setting: String(settingId), arc: String(id) });
      } else if (type === "chapter" && arcId) {
        const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
        if (campaignIdParam) next.campaign = String(campaignIdParam);
        next.focus = `chapter:${id}`;
        setSearchParams(next);
      } else if (type === "scene" && arcId) {
        const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
        if (campaignIdParam) next.campaign = String(campaignIdParam);
        next.focus = `scene:${id}`;
        setSearchParams(next);
      }
    },
    [settingId, arcId, freeId, campaignIdParam, setSearchParams]
  );

  // Контекст-меню: правая кнопка (Q4) — нода Delete/Дублировать/Переименовать, артборд Create
  const handleNodeContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent, node: Node<CanvasNodeData>) => {
      (event as React.MouseEvent).preventDefault();
      const selected = nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
      // мульти-выделение стикер+картинка → меню группы (Q4)
      if (selected.length > 1 && selected.some((n) => n.id === node.id)) {
        const items: ContextMenuItem[] = [
          {
            label: "Сделать группу",
            onClick: async () => {
              try {              if (!board?.board_id) return;
              const getW = (n: Node<CanvasNodeData>) => (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number }).w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : 200);
              const getH = (n: Node<CanvasNodeData>) => (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number }).h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
              const minX = Math.min(...selected.map((n) => n.position.x)) - 16;
              const minY = Math.min(...selected.map((n) => n.position.y)) - 34;
              const maxX = Math.max(...selected.map((n) => n.position.x + getW(n)));
              const maxY = Math.max(...selected.map((n) => n.position.y + getH(n)));
              const payload = { board_id: board.board_id, name: "Группа", x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) };
              const res = await api.post("/canvas/frames", payload);
              const newId = (res as { id: number })?.id;
              if (newId) {
                setSelectedFrameId(newId);
                setSelectedChapterId(null);
                setSelectedSceneId(null);
                setSelectedCheckId(null);
                setSelectedStickerId(null);
                loadBoard();
                setTimeout(() => setHighlightedFrameId(newId), 400);
              } else {
                loadBoard();
              }
              } catch (e) { console.error("group failed", e); alert("Группа не создалась: " + (e as Error).message); }
            },
          },
          { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected as unknown as Node<CanvasNodeData>[]) },
        ];
        setContextMenu({ x: event.clientX, y: event.clientY, items });
        return;
      }
      const [type, id] = splitKey(node.id);
      const items: ContextMenuItem[] = [];
      // Войти — дрилл-даун в подуровень (setting → adventure, arc → chapter/scene)
      if (type === "adventure" && settingId && !arcId && !freeId) {
        items.push({
          label: "Войти",
          onClick: () => setSearchParams({ setting: String(settingId), arc: String(id) }),
        });
      } else if (type === "chapter" && arcId) {
        items.push({
          label: "Войти",
          onClick: () => {
            const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
            if (campaignIdParam) next.campaign = String(campaignIdParam);
            next.focus = `chapter:${id}`;
            setSearchParams(next);
          },
        });
      } else if (type === "scene" && arcId) {
        items.push({
          label: "Войти",
          onClick: () => {
            const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
            if (campaignIdParam) next.campaign = String(campaignIdParam);
            next.focus = `scene:${id}`;
            setSearchParams(next);
          },
        });
      }
      if (type === "sticker" || type === "image" || type === "check" || type === "adventure" || type === "bundle") {
        items.push({
          label: "Переименовать",
          onClick: async () => {
            const cur = (node.data as Record<string, unknown>).name ?? (node.data as Record<string, unknown>).text ?? (node.data as Record<string, unknown>).what ?? "";
            const name = prompt("Новое имя", String(cur));
            if (!name?.trim()) return;
            if (type === "sticker") await api.put(`/canvas/stickers/${id}`, { text: name.trim() });
            else if (type === "adventure") await api.put(`/story/arcs/${id}`, { name: name.trim() });
            else if (type === "check") await api.put(`/story/checks/${id}`, { what: name.trim() });
            else if (type === "bundle") await api.put(`/canvas/bundles/${id}`, { name: name.trim() });
            loadBoard();
          },
        });
        if (type === "sticker") {
          items.push({
            label: "Сменить цвет",
            children: [
              { label: "Бумага", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "paper" }); loadBoard(); } },
              { label: "Жёлтый", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "yellow" }); loadBoard(); } },
              { label: "Голубой", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "blue" }); loadBoard(); } },
              { label: "Зелёный", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "green" }); loadBoard(); } },
              { label: "Розовый", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "pink" }); loadBoard(); } },
              { label: "Песочный", onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: "sand" }); loadBoard(); } },
            ],
          });
        }
        items.push({
          label: "Дублировать",
          onClick: async () => {
            const pos = { x: node.position.x + 20, y: node.position.y + 20 };
            if (type === "sticker") {
              const d = node.data as unknown as { text: string; color: string };
              await api.post("/canvas/stickers", { board_id: board?.board_id, text: d.text, color: d.color, x: pos.x, y: pos.y });
            }
            loadBoard();
          },
        });
        items.push({
          label: "Поднять",
          onClick: () => {
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: ((n as unknown as { zIndex?: number }).zIndex ?? 0) + 1 } : n)));
            setNodes(next);
            // @ts-ignore
            scheduleSave(next);
          },
        });
        items.push({
          label: "Опустить",
          onClick: () => {
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: ((n as unknown as { zIndex?: number }).zIndex ?? 0) - 1 } : n)));
            setNodes(next);
            // @ts-ignore
            scheduleSave(next);
          },
        });
        items.push({
          label: "На передний план",
          onClick: () => {
            const maxZ = Math.max(...nodes.map((n) => (n as unknown as { zIndex?: number }).zIndex ?? 0), 0);
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: maxZ + 1 } : n)));
            setNodes(next);
            // @ts-ignore
            scheduleSave(next);
          },
        });
        items.push({
          label: "На задний план",
          onClick: () => {
            const minZ = Math.min(...nodes.map((n) => (n as unknown as { zIndex?: number }).zIndex ?? 0), 0);
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: minZ - 1 } : n)));
            setNodes(next);
            // @ts-ignore
            scheduleSave(next);
          },
        });
      }
      items.push({
        label: "Удалить",
        danger: true,
        onClick: async () => {
          if (type === "check") await api.del(`/story/checks/${id}`);
          else if (type === "sticker" || type === "image") {
            await api.del(`/canvas/board/node?board_id=${board?.board_id}&node_type=${type}&node_id=${id}`);
          } else if (type === "scene") {
            if (confirm(`Архивировать сцену "${(node.data as Record<string, unknown>).name ?? ""}"?`)) await api.del(`/story/scenes/${id}`);
          } else if (type === "chapter" || type === "adventure") {
            const label = type === "chapter" ? "главу" : "приключение";
            if (confirm(`Архивировать ${label} "${(node.data as Record<string, unknown>).name ?? ""}"?`)) await api.del(`/story/arcs/${id}`);
          } else if (!node.id.startsWith("scene:") && !node.id.startsWith("chapter:")) {
            await api.del(`/canvas/board/node?board_id=${board?.board_id}&node_type=${type}&node_id=${id}`);
          }
          loadBoard();
        },
      });
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [board, loadBoard, settingId, arcId, freeId, campaignIdParam, setSearchParams]
  );

  // Убрать ноду сущности/набора/проверки — значит убрать её С ХОЛСТА или удалить сущность.
  // Сущность — только с холста (связи живут на странице сцены), проверка — удалить совсем
  // (без сцены бессмысленна, Q3 в). Сцену удалить нельзя — архивировали бы.
  const onNodesDelete = useCallback(
    async (removed: Node<CanvasNodeData>[]) => {
      const scenes = removed.filter((n) => n.id.startsWith("scene:"));
      const chapters = removed.filter((n) => n.id.startsWith("chapter:"));
      const others = removed.filter((n) => !n.id.startsWith("scene:") && !n.id.startsWith("chapter:"));
      await Promise.all([
        ...scenes.map((n) => {
          const [, id] = splitKey(n.id);
          return api.del(`/story/scenes/${id}`);
        }),
        ...chapters.map((n) => {
          const [, id] = splitKey(n.id);
          return api.del(`/story/arcs/${id}`);
        }),
        ...others.map((n) => {
          const [nodeType, nodeId] = splitKey(n.id);
          if (nodeType === "bundle") return api.del(`/canvas/bundles/${nodeId}`);
          if (nodeType === "check") return api.del(`/story/checks/${nodeId}`);
          const boardParam = board?.board_id ? `board_id=${board.board_id}` : `arc_id=${arcId}`;
          return api.del(`/canvas/board/node?${boardParam}&node_type=${nodeType}&node_id=${nodeId}`);
        }),
      ]);
      loadBoard();
    },
    [arcId, board, loadBoard]
  );

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedNodes: Node<CanvasNodeData>[]) => {
      event.preventDefault();
      const selected = selectedNodes.length ? selectedNodes : nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
      if (selected.length <= 1) return;
      const items: ContextMenuItem[] = [
        {
          label: "Сделать группу",
          onClick: async () => {
            try {              if (!board?.board_id) return;
            const getW = (n: Node<CanvasNodeData>) => (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number }).w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : 200);
            const getH = (n: Node<CanvasNodeData>) => (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number }).h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
            const minX = Math.min(...selected.map((n) => n.position.x)) - 16;
            const minY = Math.min(...selected.map((n) => n.position.y)) - 34;
            const maxX = Math.max(...selected.map((n) => n.position.x + getW(n)));
            const maxY = Math.max(...selected.map((n) => n.position.y + getH(n)));
            const payload = { board_id: board.board_id, name: "Группа", x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) };
            const res = await api.post("/canvas/frames", payload);
            loadBoard();
            } catch (e) { console.error("group failed", e); alert("Группа не создалась: " + (e as Error).message); }
          },
        },
        { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected as unknown as Node<CanvasNodeData>[]) },
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [board, loadBoard, nodes, onNodesDelete]
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      (event as React.MouseEvent).preventDefault();
      const selected = nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
      if (selected.length > 1) {
        const items: ContextMenuItem[] = [
          {
            label: "Сделать группу",
            onClick: async () => {
              try {              if (!board?.board_id) return;
              const getW = (n: Node<CanvasNodeData>) => (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number }).w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : 200);
              const getH = (n: Node<CanvasNodeData>) => (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number }).h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
              const minX = Math.min(...selected.map((n) => n.position.x)) - 16;
              const minY = Math.min(...selected.map((n) => n.position.y)) - 34;
              const maxX = Math.max(...selected.map((n) => n.position.x + getW(n)));
              const maxY = Math.max(...selected.map((n) => n.position.y + getH(n)));
              const payload = { board_id: board.board_id, name: "Группа", x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) };
              const res = await api.post("/canvas/frames", payload);
              const newId = (res as { id: number })?.id;
              if (newId) {
                setSelectedFrameId(newId);
                setSelectedChapterId(null);
                setSelectedSceneId(null);
                setSelectedCheckId(null);
                setSelectedStickerId(null);
                loadBoard();
                setTimeout(() => setHighlightedFrameId(newId), 400);
              } else {
                loadBoard();
              }
              } catch (e) { console.error("group failed", e); alert("Группа не создалась: " + (e as Error).message); }
            },
          },
          { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected as unknown as Node<CanvasNodeData>[]) },
        ];
        setContextMenu({ x: event.clientX, y: event.clientY, items });
        return;
      }
      const flowPos = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 0, y: 0 };
      const items: ContextMenuItem[] = [
        {
          label: "Создать стикер",
          onClick: async () => {
            const text = prompt("Текст стикера", "Заметка");
            if (text == null) return;
            await api.post("/canvas/stickers", { board_id: board?.board_id, text: text || "Заметка", color: "yellow", x: Math.round(flowPos.x), y: Math.round(flowPos.y) });
            loadBoard();
          },
        },
        {
          label: "Загрузить изображение",
          onClick: () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/png,image/jpeg,image/webp,image/gif";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file || !board?.board_id) return;
              const form = new FormData();
              form.append("file", file);
              form.append("board_id", String(board.board_id));
              form.append("x", String(Math.round(flowPos.x)));
              form.append("y", String(Math.round(flowPos.y)));
              await api.post("/canvas/images/upload", form);
              loadBoard();
            };
            input.click();
          },
        },
        {
          label: "Создать группу",
          onClick: async () => {
            try {              if (!board?.board_id) return;
            let newId: number | null = null;
            if (selected.length) {
              const getW = (n: Node<CanvasNodeData>) => (n as unknown as { width?: number }).width ?? (n.data as unknown as { w?: number }).w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : 200);
              const getH = (n: Node<CanvasNodeData>) => (n as unknown as { height?: number }).height ?? (n.data as unknown as { h?: number }).h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
              const minX = Math.min(...selected.map((n) => n.position.x)) - 16;
              const minY = Math.min(...selected.map((n) => n.position.y)) - 34;
              const maxX = Math.max(...selected.map((n) => n.position.x + getW(n)));
              const maxY = Math.max(...selected.map((n) => n.position.y + getH(n)));
              const payload = { board_id: board.board_id, name: "Группа", x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) };
              const res = await api.post<{ id: number }>("/canvas/frames", payload);
              newId = res.id;
            } else {
              const payload = { board_id: board.board_id, name: "Группа", x: Math.round(flowPos.x), y: Math.round(flowPos.y), w: 360, h: 240 };
              const res = await api.post<{ id: number }>("/canvas/frames", payload);
              newId = res.id;
            }
            if (newId) {
              setSelectedFrameId(newId);
              setSelectedChapterId(null);
              setSelectedSceneId(null);
              setSelectedCheckId(null);
              setSelectedStickerId(null);
              loadBoard();
              setTimeout(() => setHighlightedFrameId(newId), 400);
            } else {
              loadBoard();
            }
            } catch (e) { console.error("group failed", e); alert("Группа не создалась: " + (e as Error).message); }
          },
        },
        { label: "Открыть палитру", onClick: () => setPaletteOpen(true) },
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [board, loadBoard, nodes, onNodesDelete]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      // палитра → холст: перетащил и там где бросил — там и нода
      const paletteRaw = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (paletteRaw && board?.board_id) {
        const flowPos = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 0, y: 0 };
        const x = Math.round(flowPos.x);
        const y = Math.round(flowPos.y);
        try {
          const data = JSON.parse(paletteRaw) as { kind: string; item?: PaletteItem; blankId?: number; bundleId?: number };
          if (data.kind === "entity" && data.item) {
            const item = data.item;
            await api.post("/canvas/board/node", {
              board_id: board.board_id,
              node_type: item.type,
              node_id: item.id,
              x,
              y,
            });
            loadBoard();
            return;
          }
          if (data.kind === "bundle" && data.bundleId) {
            await api.post(`/canvas/bundles/${data.bundleId}/insert`, {
              board_id: board.board_id,
              x,
              y,
            });
            loadBoard();
            return;
          }
          if (data.kind === "shelf" && data.blankId) {
            if (!arcId) return;
            const created = await api.post<{ id: number }>(`/story/library/${data.blankId}/insert`, {
              arc_id: arcId,
            });
            await api.put("/canvas/board/nodes", {
              board_id: board.board_id,
              nodes: [{ node_type: "scene", node_id: created.id, x, y }],
            });
            loadBoard();
            setSelectedSceneId(created.id);
            return;
          }
        } catch {
          // ignore parse errors
        }
      }
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (!files.length || !board?.board_id) return;
      const flowPos = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 0, y: 0 };
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const form = new FormData();
        form.append("file", file);
        form.append("board_id", String(board.board_id));
        form.append("x", String(Math.round(flowPos.x + i * 20)));
        form.append("y", String(Math.round(flowPos.y + i * 20)));
        await api.post("/canvas/images/upload", form);
      }
      loadBoard();
    },
    [board, loadBoard, arcId]
  );

  // Delete клавишей — для фриформ стикеров/картинок (после onNodesDelete, иначе TDZ)
  // Alt+W/S — поднять/опустить выбранную ноду только на полотне
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        const selected = nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
        if (!selected.length) return;
        e.preventDefault();
        onNodesDelete(selected as unknown as Node<CanvasNodeData>[]);
        return;
      }
      if (e.altKey && (e.code === "KeyW" || e.code === "KeyS" || e.key.toLowerCase() === "w" || e.key.toLowerCase() === "s") && !isInput) {
        const selected = nodes.filter((n) => (n as unknown as { selected?: boolean }).selected);
        if (!selected.length) return;
        // только на полотне: фокус внутри .canvas-flow
        const active = document.activeElement?.closest(".canvas-flow");
        if (!active && !selected.length) return;
        e.preventDefault();
        const isUp = e.code === "KeyW" || (!e.code && e.key.toLowerCase() === "w");
        const delta = isUp ? 1 : -1;
        const next = applyGroupDepth(nodes.map((n) => ((n as unknown as { selected?: boolean }).selected ? { ...n, zIndex: ((n as unknown as { zIndex?: number }).zIndex ?? 0) + delta } : n)));
        setNodes(next);
        // @ts-ignore
        scheduleSave(next);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nodes, onNodesDelete]);

  function pickSetting(_value: number) {
    // оставлено для совместимости, навигация теперь через хлебные крошки
  }
  void pickSetting;
  function pickArc(_value: number) {
    // оставлено для совместимости
  }
  void pickArc;
  function pickCampaign(_value: number) {
    // оставлено для совместимости
  }
  void pickCampaign;

  return (
    <div className="stack canvas-page">
      <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap", fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
        {freeId ? (
          <>
            <Link to="/canvas" style={{ color: "var(--muted)" }}>Общие</Link>
            <span style={{ color: "var(--muted)" }}>›</span>
            <span style={{ color: "var(--ink)" }}>{board?.free?.name || `Доска ${freeId}`}</span>
          </>
        ) : settingId ? (
          <>
            <Link to={`/canvas?setting=${settingId}`} style={{ color: arcId ? "var(--muted)" : "var(--ink)" }}>{settings.find((s) => s.id === settingId)?.name || `Сеттинг ${settingId}`}</Link>
            {arcId ? (
              <>
                <span style={{ color: "var(--muted)" }}>›</span>
                <Link to={`/canvas?setting=${settingId}&arc=${arcId}`} style={{ color: focusParam.startsWith("chapter:") || focusParam.startsWith("scene:") ? "var(--muted)" : "var(--ink)" }}>{board?.arc?.name || arcs.find((a) => a.id === arcId)?.name || `Приключение ${arcId}`}</Link>
                {focusParam.startsWith("chapter:") && (
                  <>
                    <span style={{ color: "var(--muted)" }}>›</span>
                    <span style={{ color: "var(--ink)" }}>{(board?.groups.find((g) => `chapter:${g.arc_id}` === focusParam)?.name) || `Глава ${focusParam.split(":")[1]}`}</span>
                  </>
                )}
                {focusParam.startsWith("scene:") && (
                  <>
                    <span style={{ color: "var(--muted)" }}>›</span>
                    <span style={{ color: "var(--ink)" }}>{(board?.nodes.find((n) => n.key === focusParam) as unknown as { scene?: { name: string } })?.scene?.name || `Сцена ${focusParam.split(":")[1]}`}</span>
                  </>
                )}
              </>
            ) : null}
          </>
        ) : (
          <span style={{ color: "var(--ink)" }}>Полотно</span>
        )}
      </div>

      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>

        {(arcId > 0 || (settingId > 0 && !arcId) || freeId > 0) && board && (
          <>
            <div style={{ position: "relative" }}>
              <button onClick={() => setCanvasMenuOpen((v) => !v)}>Полотно ▾</button>
              {canvasMenuOpen && (
                <div className="context-menu" style={{ position: "absolute", top: "100%", left: 0, zIndex: 10 }}>
                  <button onClick={() => { setCanvasMenuOpen(false); setShowCanvasWizard(true); }}>Мастер создания полотна</button>
                  <button onClick={() => { setCanvasMenuOpen(false); handleQuickCanvas(); }}>Быстрое полотно</button>
                  <button onClick={() => { setCanvasMenuOpen(false); setShowOpenWizard(true); }}>Открыть</button>
                  <button disabled title="скоро">Экспортировать текущее полотно (скоро)</button>
                  <button disabled title="скоро">Импорт полотна (скоро)</button>
                </div>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <button onClick={() => setNodeMenuOpen((v) => !v)}>Узлы ▾</button>
              {nodeMenuOpen && (
                <div className="context-menu" style={{ position: "absolute", top: "100%", left: 0, zIndex: 10 }}>
                  <button onClick={() => { setNodeMenuOpen(false); setShowNodeWizard(true); }}>Мастер создания узлов</button>
                  <button onClick={() => { setNodeMenuOpen(false); setPaletteOpen(true); }}>Меню узлов</button>
                  <button onClick={() => { setNodeMenuOpen(false); handleCreateGroupFromSelection(); }}>Создать группу узлов</button>
                  <button onClick={() => { setNodeMenuOpen(false); autoLayoutUnplaced(); }}>Упорядочить узлы</button>
                </div>
              )}
            </div>
            <button disabled={!canUndo} onClick={undoLayout} title="Отменить (Ctrl+Z)" style={{ padding: "6px 8px" }}><span style={{ display: "inline-block", transform: "scaleX(-1)" }}>↷</span></button>
            <button disabled={!canRedo} onClick={redoLayout} title="Повторить (Ctrl+Y)" style={{ padding: "6px 8px" }}>↷</button>
            <button onClick={() => setSearchOpen((v) => !v)} title="Поиск по узлам (Ctrl+K)">
              Поиск
            </button>
          </>
        )}

        {board && (
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            {board.setting ? `${board.nodes.length} приключений` : `${board.nodes.length} узлов`} · {board.edges.length} переходов
            {board.groups.length > 0 && ` · ${board.groups.length} глав`}

          </span>
        )}
      </div>

      {freeId ? (
        !board ? (
          <EmptyState title="Загрузка…" hint="Фриформ-доска" />
        ) : (
          <div className="canvas-body">
            <div className="canvas-flow">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onInit={(inst) => { flowRef.current = inst as unknown as ReactFlowInstance<Node<CanvasNodeData>, Edge>; }}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgesDelete={onEdgesDelete}
                onNodesDelete={onNodesDelete}
                onNodeClick={(_, node) => {
                  const [type, id] = splitKey(node.id);
                  if (type === "scene") { setSelectedSceneId(id); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                  else if (type === "check") { setSelectedCheckId(id); setSelectedSceneId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                  else if (type === "sticker") { setSelectedStickerId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                  else if (type === "frame") { setSelectedFrameId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedChapterId(null); }
                  else if (type === "chapter") { setSelectedChapterId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); }
                  else { setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                  const next: Record<string, string> = {};
                  if (freeId) next.free_id = String(freeId);
                  else { next.setting = String(settingId); if (arcId) next.arc = String(arcId); if (campaignIdParam) next.campaign = String(campaignIdParam); }
                  next.focus = node.id;
                  setSearchParams(next);
                }}
                onPaneClick={() => { setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }}
                onNodeContextMenu={handleNodeContextMenu}
                onPaneContextMenu={handlePaneContextMenu}
                onSelectionContextMenu={handleSelectionContextMenu}
                onEdgeContextMenu={handleEdgeContextMenu}
                onNodeDoubleClick={handleNodeDoubleClick}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                proOptions={{ hideAttribution: true }}
                panOnDrag={[1]}
                selectionOnDrag
                elevateNodesOnSelect={false}
                elevateEdgesOnSelect={false}
              >
                <Background gap={26} size={1.4} color="var(--line)" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable style={{ background: "var(--paper)", border: "2px solid var(--line)" }} maskColor="rgba(18,16,14,0.08)" />
                <CanvasLegend />
                <button onClick={() => setPaletteOpen((v) => !v)} title={paletteOpen ? "Скрыть палитру" : "Показать палитру"} style={{ position: "absolute", top: 12, left: 12, zIndex: 5, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", border: "1.5px solid var(--line)", fontSize: 16 }}>🖼</button>
                <button onClick={() => setPanelCollapsed((v) => !v)} title={panelCollapsed ? "Развернуть панель" : "Свернуть панель"} style={{ position: "absolute", top: 12, right: 12, zIndex: 5, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", border: "1.5px solid var(--line)", fontSize: 16 }}>{panelCollapsed ? "»" : "«"}</button>
              </ReactFlow>

              {paletteOpen && (
                <CanvasPalette
                  arcId={0}
                  settingId={0}
                  boardId={board?.board_id ?? null}
                  campaignId={null}
                  shelfVersion={shelfVersion}
                  flowRef={flowRef}
                  onClose={() => setPaletteOpen(false)}
                  onAdded={() => {
                    refreshAll();
                  }}
                />
              )}
            </div>
            {!panelCollapsed && (selectedFrameId != null ? <FrameProperties frameId={selectedFrameId} board={board} onSaved={refreshAll} nodes={nodes} /> : selectedChapterId != null ? <ChapterProperties chapterId={selectedChapterId} board={board} onSaved={refreshAll} nodes={nodes} /> : selectedStickerId != null ? <StickerProperties stickerId={selectedStickerId} onSaved={refreshAll} board={board} /> : selectedCheckId != null ? <CheckProperties checkId={selectedCheckId} onSaved={refreshAll} board={board} /> : <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />)}
          </div>
        )
      ) : !settingId ? (
        <div className="stack" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h3>Мои доски — фриформ вне сеттингов</h3>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={() => setShowOpenWizard(true)}>Открыть холст…</button>
              <button className="primary" onClick={async () => { const name = prompt("Название доски", "Новая доска"); if (!name?.trim()) return; const created = await api.post<{ id: number; scope_id: number; name: string }>("/canvas/free-boards", { name: name.trim() }); setSearchParams({ free_id: String(created.scope_id) }); }}>
                + Доска
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {freeBoards.map((b) => (
              <button key={b.id} className="card" style={{ textAlign: "left", padding: 12 }} onClick={() => setSearchParams({ free_id: String(b.scope_id) })}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)" }}>{b.name || "Без имени"}</div>
                <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{b.nodes} объектов · {new Date(b.created_at as unknown as string).toLocaleDateString()}</div>
              </button>
            ))}
            {freeBoards.length === 0 && <p className="muted">Пока нет досок — создайте первую, это пустое полотно без сеттинга (сохраняется само).</p>}
          </div>
          <h3 style={{ marginTop: 24 }}>Холсты сеттингов</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {settings.map((s) => (
              <button key={s.id} className="card" style={{ textAlign: "left", padding: 12 }} onClick={() => setSearchParams({ setting: String(s.id) })}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)" }}>{s.name}</div>
                <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>Обзор — приключения</div>
              </button>
            ))}
            {settings.length === 0 && <p className="muted">Нет сеттингов — создайте в разделе Сеттинги.</p>}
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-meta)" }}>Или откройте любой холст через «Открыть холст…» — выбор сеттинга → приключение → глава.</p>
        </div>
      ) : !board ? (
        <EmptyState
          title="Историю видно только целиком"
          hint={settingId && !arcId ? "Обзор сеттинга — приключения как ноды. Выберите приключение для разбора сцен." : "Выберите приключение — его сцены лягут схемой: что за чем идёт и где развилки."}
        />
      ) : (
        <div className="canvas-body">
          <div className="canvas-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onInit={(inst) => {
                flowRef.current = inst as unknown as ReactFlowInstance<Node<CanvasNodeData>, Edge>;
              }}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onNodesDelete={onNodesDelete}
              onNodeClick={(_, node) => {
                const [type, id] = splitKey(node.id);
                if (type === "scene") { setSelectedSceneId(id); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                else if (type === "check") { setSelectedCheckId(id); setSelectedSceneId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                else if (type === "sticker") { setSelectedStickerId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                else if (type === "frame") { setSelectedFrameId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedChapterId(null); }
                else if (type === "chapter") { setSelectedChapterId(id); setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); }
                else { setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }
                // обновить focus в URL без перезагрузки (для шаринга ссылки)
                const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
                if (campaignIdParam) next.campaign = String(campaignIdParam);
                if (freeId) { next.free_id = String(freeId); delete (next as Record<string,string>).setting; delete (next as Record<string,string>).arc; }
                next.focus = node.id;
                setSearchParams(next);
              }}
              onPaneClick={() => { setSelectedSceneId(null); setSelectedCheckId(null); setSelectedStickerId(null); setSelectedFrameId(null); setSelectedChapterId(null); }}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneContextMenu={handlePaneContextMenu}
              onSelectionContextMenu={handleSelectionContextMenu}
              onEdgeContextMenu={handleEdgeContextMenu}
              onNodeDoubleClick={handleNodeDoubleClick}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              proOptions={{ hideAttribution: true }}
              panOnDrag={[1]}
              selectionOnDrag
            >
              <Background gap={26} size={1.4} color="var(--line)" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                style={{ background: "var(--paper)", border: "2px solid var(--line)" }}
                maskColor="rgba(18,16,14,0.08)"
              />
              <CanvasLegend />
              {searchOpen && (
                <div className="canvas-search">
                  <input
                    autoFocus
                    id="canvas-search"
                    name="canvas-search"
                    autoComplete="off"
                    placeholder="Поиск по имени — Enter для фокуса"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && filteredSearch[0]) {
                        const n = filteredSearch[0];
                        flowRef.current?.fitView({ nodes: [n], padding: 0.35, duration: 300 });
                        const [t, id] = splitKey(n.id);
                        if (t === "scene") {
                          setSelectedSceneId(Number(id));
                          setSelectedCheckId(null);
                        } else if (t === "check") {
                          setSelectedCheckId(Number(id));
                          setSelectedSceneId(null);
                        }
                      }
                      if (e.key === "Escape") setSearchOpen(false);
                    }}
                  />
                  <div className="canvas-search__list">
                    {filteredSearch.slice(0, 8).map((n) => (
                      <button
                        key={n.id}
                        className="canvas-search__item"
                        onClick={() => {
                          flowRef.current?.fitView({ nodes: [n], padding: 0.35, duration: 300 });
                          const [t, id] = splitKey(n.id);
                          if (t === "scene") {
                            setSelectedSceneId(Number(id));
                            setSelectedCheckId(null);
                          } else if (t === "check") {
                            setSelectedCheckId(Number(id));
                            setSelectedSceneId(null);
                          }
                        }}
                      >
                        {(n.data as { name?: string; title?: string; what?: string }).name ??
                          (n.data as { title?: string }).title ??
                          (n.data as { what?: string }).what ??
                          n.id}
                      </button>
                    ))}
                    {searchQuery.trim() && filteredSearch.length === 0 && (
                      <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                        Ничего не нашлось
                      </span>
                    )}
                  </div>
                </div>
              )}
                <button onClick={() => setPaletteOpen((v) => !v)} title={paletteOpen ? "Скрыть палитру" : "Показать палитру"} style={{ position: "absolute", top: 12, left: 12, zIndex: 5, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", border: "1.5px solid var(--line)", fontSize: 16 }}>🖼</button>
                <button onClick={() => setPanelCollapsed((v) => !v)} title={panelCollapsed ? "Развернуть панель" : "Свернуть панель"} style={{ position: "absolute", top: 12, right: 12, zIndex: 5, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", border: "1.5px solid var(--line)", fontSize: 16 }}>{panelCollapsed ? "»" : "«"}</button>
            </ReactFlow>

            {paletteOpen && (
              <CanvasPalette
                arcId={arcId}
                settingId={settingId}
                boardId={board?.board_id ?? null}
                campaignId={board?.campaign_id ?? null}
                shelfVersion={shelfVersion}
                flowRef={flowRef}
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

          {!panelCollapsed && (selectedFrameId != null ? <FrameProperties frameId={selectedFrameId} board={board} onSaved={refreshAll} nodes={nodes} /> : selectedChapterId != null ? <ChapterProperties chapterId={selectedChapterId} board={board} onSaved={refreshAll} nodes={nodes} /> : selectedStickerId != null ? (
            <StickerProperties stickerId={selectedStickerId} onSaved={refreshAll} board={board} />
          ) : selectedCheckId != null ? (
            <CheckProperties checkId={selectedCheckId} onSaved={refreshAll} board={board} />
          ) : (
            <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />
          ))}
        </div>
      )}
      {showCanvasWizard && (
        <CanvasWizard
          settings={settings}
          arcs={arcs}
          onClose={() => setShowCanvasWizard(false)}
          onCreated={(params) => {
            setShowCanvasWizard(false);
            if (params.free_id) setSearchParams({ free_id: String(params.free_id) });
            else if (params.arc_id) setSearchParams({ setting: String(params.setting_id), arc: String(params.arc_id) });
            else if (params.setting_id) setSearchParams({ setting: String(params.setting_id) });
          }}
        />
      )}
      {showOpenWizard && (
        <OpenWizard
          settings={settings}
          arcs={arcs}
          onClose={() => setShowOpenWizard(false)}
          onOpen={(params) => {
            setShowOpenWizard(false);
            if (params.free_id) setSearchParams({ free_id: String(params.free_id) });
            else if (params.focus) setSearchParams({ setting: String(params.setting_id), arc: String(params.arc_id), focus: params.focus });
            else if (params.arc_id) setSearchParams({ setting: String(params.setting_id), arc: String(params.arc_id) });
            else if (params.setting_id) setSearchParams({ setting: String(params.setting_id) });
          }}
        />
      )}
      {showNodeWizard && (
        <NodeWizard
          onClose={() => setShowNodeWizard(false)}
          onPlaced={() => {
            setShowNodeWizard(false);
            loadBoard();
          }}
          board={board}
          flowRef={flowRef}
        />
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

function CanvasWizard({ settings, arcs, onClose, onCreated }: { settings: Setting[]; arcs: StoryArc[]; onClose: () => void; onCreated: (p: { setting_id?: number; arc_id?: number; free_id?: number }) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entityKind, setEntityKind] = useState<"free" | "adventure" | "chapter" | "scene">("scene");
  const [settingId, setSettingId] = useState<number | "free">("free");
  const [parentArc, setParentArc] = useState<number | "">("");
  const [parentChapter, setParentChapter] = useState<number | "">("");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"empty" | "recent">("empty");
  const [wizardArcs, setWizardArcs] = useState<StoryArc[]>(arcs);
  useEffect(() => {
    if (settingId === "free") {
      setWizardArcs([]);
      return;
    }
    const same = arcs.length > 0 && arcs[0] ? arcs[0].setting_id === settingId : false;
    if (same) {
      setWizardArcs(arcs);
      return;
    }
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId as number}`).then(setWizardArcs);
  }, [settingId, arcs]);
  const canNext = step === 1 ? !!entityKind : step === 2 ? (entityKind === "free" || settingId !== "free") : !!name.trim();
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }} onClick={onClose}>
      <div className="card" style={{ padding: 16, minWidth: 360, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3>Мастер создания полотна — шаг {step}/3</h3>
        {step === 1 && (
          <div className="stack">
            <label className="row"><input type="radio" checked={entityKind === "free"} onChange={() => setEntityKind("free")} /> Фриформ доска (общие)</label>
            <label className="row"><input type="radio" checked={entityKind === "adventure"} onChange={() => setEntityKind("adventure")} /> Приключение</label>
            <label className="row"><input type="radio" checked={entityKind === "chapter"} onChange={() => setEntityKind("chapter")} /> Глава</label>
            <label className="row"><input type="radio" checked={entityKind === "scene"} onChange={() => setEntityKind("scene")} /> Сцена</label>
          </div>
        )}
        {step === 2 && (
          <div className="stack">
            <label>Куда <select value={String(settingId)} onChange={(e) => { const v = e.target.value === "free" ? "free" : Number(e.target.value); setSettingId(v); setParentArc(""); setParentChapter(""); }}><option value="free">Общие (фриформ)</option>{settings.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></label>
            {entityKind !== "free" && entityKind !== "adventure" && settingId !== "free" && (
              <label>Приключение <select value={parentArc} onChange={(e) => setParentArc(e.target.value ? Number(e.target.value) : "")}><option value="">— выбери —</option>{wizardArcs.filter((a) => !a.parent_id).map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></label>
            )}
            {entityKind === "scene" && parentArc && (
              <label>Глава <select value={parentChapter} onChange={(e) => setParentChapter(e.target.value ? Number(e.target.value) : "")}><option value="">Без главы (в приключение)</option>{wizardArcs.filter((a) => a.parent_id === Number(parentArc)).map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></label>
            )}
            {entityKind === "adventure" && settingId === "free" && <p className="muted" style={{ fontSize: "var(--fs-meta)" }}>Для приключения выбери сеттинг, не Общие.</p>}
          </div>
        )}
        {step === 3 && (
          <div className="stack">
            <label>Имя <input value={name} onChange={(e) => setName(e.target.value)} placeholder={entityKind === "free" ? "Новая доска" : entityKind === "adventure" ? "Новое приключение" : entityKind === "chapter" ? "Новая глава" : "Новая сцена"} autoComplete="off" /></label>
            <label>Шаблон <select value={template} onChange={(e) => setTemplate(e.target.value as "empty" | "recent")}><option value="empty">Пустой</option><option value="recent">Из 3 последних (скоро)</option></select></label>
          </div>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <button onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : onClose())}>{step === 1 ? "Отмена" : "Назад"}</button>
          {step < 3 ? (
            <button className="primary" disabled={!canNext} onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}>Далее</button>
          ) : (
            <button
              className="primary"
              disabled={
                !name.trim() ||
                (entityKind !== "free" && !settingId) ||
                (entityKind !== "free" && settingId === "free") ||
                (entityKind === "chapter" && !parentArc) ||
                (entityKind === "scene" && !parentArc && !parentChapter)
              }
              title={
                entityKind !== "free" && !settingId
                  ? "Выбери сеттинг на шаге 2"
                  : entityKind !== "free" && settingId === "free"
                  ? "Для приключения/главы/сцены выбери сеттинг, не Общие"
                  : entityKind === "chapter" && !parentArc
                  ? "Выбери приключение для главы"
                  : entityKind === "scene" && !parentArc && !parentChapter
                  ? "Выбери приключение для сцены"
                  : undefined
              }
              onClick={async () => {
                if (entityKind === "free") {
                  const created = await api.post<{ scope_id: number }>("/canvas/free-boards", { name: name.trim() });
                  onCreated({ free_id: created.scope_id });
                } else if (entityKind === "adventure") {
                  const sid = Number(settingId);
                  if (!sid) return;
                  const created = await api.post<{ id: number }>("/story/arcs", { setting_id: sid, name: name.trim(), kind: "adventure" });
                  onCreated({ setting_id: sid, arc_id: created.id });
                } else if (entityKind === "chapter") {
                  const pid = Number(parentArc);
                  if (!pid) return;
                  await api.post<{ id: number }>("/story/arcs", { setting_id: Number(settingId), parent_id: pid, name: name.trim(), kind: "chapter" });
                  onCreated({ setting_id: Number(settingId), arc_id: pid });
                } else {
                  const arc = Number(parentChapter || parentArc);
                  if (!arc) return;
                  await api.post<{ id: number }>("/story/scenes", { setting_id: Number(settingId), arc_id: arc, name: name.trim() });
                  onCreated({ setting_id: Number(settingId), arc_id: arc });
                }
              }}
            >
              Создать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OpenWizard({ settings, arcs, onClose, onOpen }: { settings: Setting[]; arcs: StoryArc[]; onClose: () => void; onOpen: (p: { setting_id?: number; arc_id?: number; free_id?: number; focus?: string }) => void }) {
  const [settingId, setSettingId] = useState<number | "free" | "">("");
  const [arcId, setArcId] = useState<number | "">("");
  const [chapterId, setChapterId] = useState<number | "">("");
  const [wizardArcs, setWizardArcs] = useState<StoryArc[]>(arcs);
  // arcs с родителя — только для его setting; в визарде выбор другой → грузим свежие
  useEffect(() => {
    if (settingId === "free" || settingId === "") {
      setWizardArcs([]);
      return;
    }
    // если совпадает с уже загруженными (страница на том же сеттинге) — не дергаем сеть
    const sameSetting = arcs.length > 0 && arcs[0] ? arcs[0].setting_id === settingId : false;
    if (sameSetting) {
      setWizardArcs(arcs);
      return;
    }
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setWizardArcs);
  }, [settingId, arcs]);
  const chapters = wizardArcs.filter((a) => a.parent_id === Number(arcId));
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }} onClick={onClose}>
      <div className="card" style={{ padding: 16, minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <h3>Открыть</h3>
        <div className="stack">
          <label>Сеттинг <select value={String(settingId)} onChange={(e) => { const v = e.target.value; setSettingId(v === "free" ? "free" : v ? Number(v) : ""); setArcId(""); setChapterId(""); }}><option value="">— выбери —</option><option value="free">Общие (фриформ)</option>{settings.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></label>
          {settingId === "free" ? (
            <button className="primary" onClick={async () => { const boards = await api.get<{ scope_id: number; name: string }[]>("/canvas/free-boards"); const first = boards[0]; if (first) onOpen({ free_id: first.scope_id }); else onClose(); }}>Открыть первую фриформ</button>
          ) : (
            <>
              <label>Приключение <select value={arcId} onChange={(e) => { setArcId(e.target.value ? Number(e.target.value) : ""); setChapterId(""); }} disabled={!settingId}><option value="">— приключение —</option>{wizardArcs.filter((a) => !a.parent_id).map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></label>
              <label>Глава <select value={chapterId} onChange={(e) => setChapterId(e.target.value ? Number(e.target.value) : "")} disabled={!arcId}><option value="">— вся —</option>{chapters.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></label>
            </>
          )}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" onClick={() => {
            if (settingId === "free") return;
            if (chapterId) onOpen({ setting_id: Number(settingId), arc_id: Number(arcId), focus: `chapter:${chapterId}` });
            else if (arcId) onOpen({ setting_id: Number(settingId), arc_id: Number(arcId) });
            else if (settingId) onOpen({ setting_id: Number(settingId) });
          }}>Открыть</button>
        </div>
      </div>
    </div>
  );
}

function NodeWizard({ onClose, onPlaced, board, flowRef }: { onClose: () => void; onPlaced: () => void; board: CanvasBoard | null; flowRef: React.RefObject<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null> }) {
  const [tab, setTab] = useState<"sticker" | "image" | "check" | "scene" | "entity">("sticker");
  const [entityPick, setEntityPick] = useState<PaletteItem | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [entityList, setEntityList] = useState<PaletteItem[]>([]);
  // подгружаем существ для текущего сеттинга (как в палитре)
  useEffect(() => {
    if (tab !== "entity" || !board) return;
    const sid = board.setting?.id ?? board.arc?.setting_id ?? null;
    if (!sid) {
      // фриформ — через /search
      api.get<{ id: number; title: string }[]>(`/search?q=&types=being`).then((rows) => setEntityList(rows.slice(0, 20).map((r) => ({ type: "being", id: r.id, name: r.title }))));
      return;
    }
    api.get<{ id: number; name: string }[]>(`/setting-beings?setting_id=${sid}`).then((rows) => setEntityList(rows.slice(0, 20).map((r) => ({ type: "being", id: r.id, name: r.name }))));
  }, [tab, board]);
  const filteredEntity = entityQuery.trim() ? entityList.filter((e) => e.name.toLowerCase().includes(entityQuery.trim().toLowerCase())) : entityList;
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }} onClick={onClose}>
      <div className="card" style={{ padding: 16, minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <h3>Мастер создания узлов</h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {(["sticker", "image", "check", "scene", "entity"] as const).map((k) => (
            <button key={k} className={tab === k ? "primary" : ""} onClick={() => setTab(k)}>{k}</button>
          ))}
        </div>
        <div style={{ marginTop: 12, border: "1.5px solid var(--line)", padding: 12, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper-2)" }}>
          {tab === "sticker" && <div className="canvas-node canvas-node--sticker" style={{ background: "#F2E8C6", border: "1.5px solid var(--line)", width: 190 }}><div className="canvas-node__body">Стикер 190px</div></div>}
          {tab === "image" && <div className="canvas-node canvas-node--image" style={{ width: 190, height: 120, border: "1.5px solid var(--line)", background: "var(--paper)" }}>Картинка</div>}
          {tab === "check" && <div className="canvas-node canvas-node--check" style={{ width: 190 }}><div className="canvas-node__band">Проверка</div></div>}
          {tab === "scene" && <div className="canvas-node" style={{ width: 190 }}><div className="canvas-node__band">Сцена</div></div>}
          {tab === "entity" && <div className="canvas-node canvas-node--entity" style={{ width: 176 }}><div className="canvas-node__band">Существо</div></div>}
        </div>
        {tab === "entity" && (
          <div className="stack" style={{ marginTop: 12, maxHeight: 160, overflow: "auto", border: "1.5px solid var(--line)", padding: 8 }}>
            <input placeholder="Поиск существа" value={entityQuery} onChange={(e) => setEntityQuery(e.target.value)} autoComplete="off" style={{ width: "100%" }} />
            {filteredEntity.map((it) => (
              <button key={`${it.type}:${it.id}`} className={`canvas-palette__item${entityPick?.id === it.id ? " is-active" : ""}`} style={{ textAlign: "left", width: "100%", justifyContent: "flex-start" }} onClick={() => setEntityPick(it)}>{it.name}</button>
            ))}
            {filteredEntity.length === 0 && <p className="muted" style={{ fontSize: "var(--fs-meta)" }}>Нет существ — создайте в сеттинге.</p>}
            {entityPick && <p className="muted" style={{ fontSize: "var(--fs-meta)" }}>Выбрано: {entityPick.name}</p>}
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
          <button onClick={onClose}>Отмена</button>
          <button
            className="primary"
            disabled={tab === "entity" && !entityPick}
            onClick={async () => {
              if (!board?.board_id) return;
              const pos = freshSpotAtCenter(flowRef.current);
              if (tab === "sticker") await api.post("/canvas/stickers", { board_id: board.board_id, text: "Заметка", color: "yellow", x: pos.x, y: pos.y });
              else if (tab === "image") {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/png,image/jpeg,image/webp,image/gif";
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  form.append("board_id", String(board.board_id));
                  form.append("x", String(pos.x));
                  form.append("y", String(pos.y));
                  await api.post("/canvas/images/upload", form);
                  onPlaced();
                };
                input.click();
                return;
              } else if (tab === "check") {
                // проверка привязана к сцене — берём первую сцену на доске
                const sceneNode = board.nodes.find((n) => n.node_type === "scene");
                const sceneId = sceneNode ? (sceneNode as unknown as { scene: { id: number } }).scene.id : null;
                if (!sceneId) { alert("На холсте нет сцен — создайте сцену сначала"); return; }
                await api.post(`/story/scenes/${sceneId}/checks`, { what: "Проверка", difficulty: "" });
              } else if (tab === "scene") {
                const settingId = board.setting?.id ?? board.arc?.setting_id ?? null;
                const arcId = board.arc?.id ?? null;
                if (!settingId || !arcId) { alert("Сцены доступны только на холсте приключения (выбери сеттинг → приключение)"); return; }
                const created = await api.post<{ id: number }>("/story/scenes", { setting_id: settingId, arc_id: arcId, name: "Новая сцена" });
                await api.put("/canvas/board/nodes", { board_id: board.board_id, nodes: [{ node_type: "scene", node_id: created.id, x: pos.x, y: pos.y }] });
              } else if (tab === "entity") {
                if (!entityPick) return;
                await api.post("/canvas/board/node", { board_id: board.board_id, node_type: entityPick.type, node_id: entityPick.id, x: pos.x, y: pos.y });
              }
              onPlaced();
            }}
          >
            Разместить
          </button>
        </div>
      </div>
    </div>
  );
}

// Панель свойств проверки — Q6 б (тот же canvas-props, что у сцены)
function CheckProperties({
  checkId,
  onSaved,
  board,
}: {
  checkId: number;
  onSaved: () => void;
  board: CanvasBoard | null;
}) {
  const [check, setCheck] = useState<{ id: number; what: string; difficulty: string; scene_id: number } | null>(null);
  const [outcomes, setOutcomes] = useState<{ id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[]>([]);
  // бортовые сцены для селекта "Ведёт в"
  const scenes = board?.nodes.flatMap((n) => (n.node_type === "scene" ? [n.scene] : [])) ?? [];
  const refresh = useCallback(async () => {
    const c = await api.get<{ id: number; what: string; difficulty: string; scene_id: number }>(`/story/checks/${checkId}`);
    setCheck(c);
    const o = await api.get<{ id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[]>(`/story/checks/${checkId}/outcomes`);
    setOutcomes(o);
  }, [checkId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  async function save(patch: Record<string, unknown>) {
    await api.put(`/story/checks/${checkId}`, patch);
    await refresh();
    onSaved();
  }
  if (!check) {
    return (
      <div className="canvas-props">
        <div className="canvas-props__head">
          <span className="canvas-props__label">Проверка</span>
        </div>
        <div className="canvas-props__empty">Загрузка…</div>
      </div>
    );
  }
  return (
    <div className="canvas-props">
      <div className="canvas-props__head">
        <span className="canvas-props__label">Проверка</span>
        <button className="danger" onClick={async () => { await api.del(`/story/checks/${checkId}`); onSaved(); }}>
          Удалить
        </button>
      </div>
      <div className="canvas-props__fields">
        <label className="canvas-props__field">
          <span className="canvas-props__label">Что проверяем</span>
          <input id={`check-what-${check.id}`} name={`check-what-${check.id}`} autoComplete="off" defaultValue={check.what} key={`what-${check.id}-${check.what}`} onBlur={(e) => e.target.value !== check.what && save({ what: e.target.value })} />
        </label>
        <label className="canvas-props__field">
          <span className="canvas-props__label">Сложность</span>
          <input id={`check-diff-${check.id}`} name={`check-diff-${check.id}`} autoComplete="off" defaultValue={check.difficulty} key={`diff-${check.id}-${check.difficulty}`} onBlur={(e) => e.target.value !== check.difficulty && save({ difficulty: e.target.value })} />
        </label>
        <div className="canvas-outcomes">
          {outcomes.map((o) => (
            <div className="canvas-outcome" key={o.id}>
              <div className="row" style={{ gap: 6 }}>
                <input className="canvas-outcome__label" defaultValue={o.label} key={`label-${o.id}-${o.label}`} placeholder="Исход" onBlur={(e) => e.target.value !== o.label && api.put(`/story/outcomes/${o.id}`, { label: e.target.value }).then(() => { refresh(); onSaved(); })} />
                <button className="comp-mini" title="Убрать исход" onClick={async () => { await api.del(`/story/outcomes/${o.id}`); refresh(); onSaved(); }}>×</button>
              </div>
              <input defaultValue={o.consequence} key={`cons-${o.id}-${o.consequence}`} placeholder="Что при этом происходит" onBlur={(e) => e.target.value !== o.consequence && api.put(`/story/outcomes/${o.id}`, { consequence: e.target.value }).then(() => { refresh(); onSaved(); })} />
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                <span className="canvas-props__label">Ведёт в</span>
                <select value={o.target_type === "scene" && o.target_id ? String(o.target_id) : ""} onChange={(e) => api.put(`/story/outcomes/${o.id}`, e.target.value ? { target_type: "scene", target_id: Number(e.target.value) } : { target_type: null, target_id: null }).then(() => { refresh(); onSaved(); })}>
                  <option value="">— никуда —</option>
                  {scenes.filter((s) => s.id !== check.scene_id).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
            </div>
          ))}
          <button onClick={async () => { await api.post(`/story/checks/${check.id}/outcomes`, { label: "Ещё исход" }); refresh(); onSaved(); }}>+ Исход</button>
        </div>
      </div>
    </div>
  );
}

function StickerProperties({ stickerId, onSaved, board }: { stickerId: number; onSaved: () => void; board?: CanvasBoard | null }) {
  const [sticker, setSticker] = useState<{ id: number; name: string; note: string; text: string; color: string } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const single = await api.get<{ id: number; text: string; name: string; note: string; color: string }>(`/canvas/stickers/${stickerId}`);
      setSticker(single);
    } catch {
      setSticker({ id: stickerId, name: "", note: "", text: "", color: "paper" });
    }
  }, [stickerId]);
  const [noteDraft, setNoteDraft] = useState("");
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (sticker) setNoteDraft(sticker.note); }, [sticker?.note]);
  async function save(patch: Record<string, unknown>) {
    await api.put(`/canvas/stickers/${stickerId}`, patch);
    await refresh();
    onSaved();
  }
  if (!sticker) return <div className="canvas-props"><div className="canvas-props__head"><span className="canvas-props__label">Стикер</span></div><div className="canvas-props__empty">Загрузка…</div></div>;
  return (
    <div className="canvas-props">
      <div className="canvas-props__head"><span className="canvas-props__label">Стикер</span><button className="danger" onClick={async () => { const bid = board?.board_id ?? 0; await api.del(`/canvas/board/node?board_id=${bid}&node_type=sticker&node_id=${stickerId}`); onSaved(); }}>Удалить</button></div>
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input id={`sticker-name-${sticker.id}`} name={`sticker-name-${sticker.id}`} autoComplete="off" defaultValue={sticker.name || sticker.text} key={`name-${sticker.id}-${sticker.name}`} onBlur={(e) => e.target.value !== (sticker.name || sticker.text) && save({ name: e.target.value })} /></label>
        <div className="canvas-props__field"><span className="canvas-props__label">Заметка</span><MentionTextarea value={noteDraft} onChange={setNoteDraft} rows={4} placeholder="Заметка с @упоминаниями" defaultSettingId={board?.setting?.id ?? board?.campaign?.setting_id ?? undefined} /><button onClick={async () => { if (noteDraft !== sticker.note) { await save({ note: noteDraft }); await syncMentionLinks("sticker", sticker.id, sticker.note, noteDraft); } }}>Сохранить заметку</button></div>
        <div className="canvas-props__field"><span className="canvas-props__label">Цвет</span><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{Object.keys(STICKER_COLORS).map((c) => (<button key={c} title={c} onClick={() => save({ color: c })} style={{ width: 24, height: 24, background: STICKER_COLORS[c], border: c === sticker.color ? "2px solid var(--ink)" : "1.5px solid var(--line)" }} />))}</div></div>
      </div>
    </div>
  );
}

function FrameProperties({ frameId, board, onSaved, nodes }: { frameId: number; board: CanvasBoard | null; onSaved: () => void; nodes: Node<CanvasNodeData>[] }) {
  const frame = (board?.nodes.find((n) => n.node_type === "frame" && (n as CanvasFrameNode).node_id === frameId) as CanvasFrameNode | undefined)?.frame as { id: number; name: string; color: string; w: number; h: number } | undefined;
  const frameNode = nodes.find((n) => n.id === `frame:${frameId}`);
  const [name, setName] = useState(frame?.name ?? "");
  useEffect(() => { setName(frame?.name ?? ""); }, [frame?.name]);
  const color = frame?.color ?? "#2C3E50";
  async function saveName() {
    if (!frame) return;
    if (name.trim() === frame.name) return;
    await api.put(`/canvas/frames/${frameId}`, { name: name.trim() || "Группа" });
    onSaved();
  }
  async function saveColor(c: string) {
    await api.put(`/canvas/frames/${frameId}`, { color: c });
    onSaved();
  }
  // входящие узлы — геометрически внутри рамки (хотя бы частично)
  const members = (() => {
    if (!frameNode || !frame) return [];
    const fx = frameNode.position.x;
    const fy = frameNode.position.y;
    const fw = (frameNode as unknown as { width?: number }).width ?? frame.w;
    const fh = (frameNode as unknown as { height?: number }).height ?? frame.h;
    return nodes.filter((n) => {
      if (n.id.startsWith("frame:") || n.id.startsWith("chapter:")) return false;
      const { x, y } = n.position;
      const { w: nw, h: nh } = getNodeSize(n);
      return x + nw > fx && x < fx + fw && y + nh > fy && y < fy + fh;
    });
  })();
  if (!frame || !frameNode) return <div className="canvas-props"><div className="canvas-props__head"><span className="canvas-props__label">Группа</span></div><div className="canvas-props__empty">Загрузка…</div></div>;
  return (
    <div className="canvas-props">
      <div className="canvas-props__head"><span className="canvas-props__label">Группа</span><button className="danger" onClick={async () => { await api.del(`/canvas/board/node?board_id=${board?.board_id}&node_type=frame&node_id=${frameId}`); onSaved(); }}>Удалить</button></div>
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder="Группа" /></label>
        <div className="canvas-props__field"><span className="canvas-props__label">Цвет</span><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{Object.entries(FRAME_COLORS).map(([k, v]) => (<button key={k} title={k} onClick={() => saveColor(v)} style={{ width: 24, height: 24, background: v, border: v === color ? "2px solid var(--ink)" : "1.5px solid var(--line)" }} />))}</div></div>
        <div className="canvas-props__field"><span className="canvas-props__label">В группе ({members.length})</span>{members.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>Перетащи узлы внутрь рамки — они поедут вместе с ней.</p> : <div className="stack" style={{ gap: 4 }}>{members.map((m) => { const n = m.data as Record<string, unknown>; const title = (n.name as string) ?? (n.text as string) ?? (n.what as string) ?? m.id; return <span key={m.id} className="canvas-node__chip">{String(title)}</span>; })}</div>}</div>
      </div>
    </div>
  );
}

function ChapterProperties({ chapterId, board, onSaved, nodes }: { chapterId: number; board: CanvasBoard | null; onSaved: () => void; nodes: Node<CanvasNodeData>[] }) {
  const group = board?.groups.find((g) => g.arc_id === chapterId);
  const groupNode = nodes.find((n) => n.id === `chapter:${chapterId}`);
  const [name, setName] = useState(group?.name ?? "");
  useEffect(() => { setName(group?.name ?? ""); }, [group?.name]);
  const color = group?.color ?? "#2C3E50";
  async function saveName() {
    if (!group) return;
    if (name.trim() === group.name) return;
    await api.put(`/canvas/groups/${chapterId}`, { board_id: board?.board_id, name: name.trim() || "Глава" });
    onSaved();
  }
  async function saveColor(c: string) {
    await api.put(`/canvas/groups/${chapterId}`, { board_id: board?.board_id, color: c });
    onSaved();
  }
  const members = (board?.nodes.filter((n) => n.node_type === "scene") as unknown as { scene: { arc_id: number | null; name: string }; key: string }[] | undefined)?.filter((n) => n.scene.arc_id === chapterId) ?? [];
  if (!group || !groupNode) return <div className="canvas-props"><div className="canvas-props__head"><span className="canvas-props__label">Глава</span></div><div className="canvas-props__empty">Загрузка…</div></div>;
  return (
    <div className="canvas-props">
      <div className="canvas-props__head"><span className="canvas-props__label">Глава</span></div>
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder="Глава" /></label>
        <div className="canvas-props__field"><span className="canvas-props__label">Цвет</span><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{Object.entries(FRAME_COLORS).map(([k, v]) => (<button key={k} title={k} onClick={() => saveColor(v)} style={{ width: 24, height: 24, background: v, border: v === color ? "2px solid var(--ink)" : "1.5px solid var(--line)" }} />))}</div></div>
        <div className="canvas-props__field"><span className="canvas-props__label">Сцен в главе ({members.length})</span>{members.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>Сцены этой главы лежат внутри рамки.</p> : <div className="stack" style={{ gap: 4 }}>{members.map((m) => <span key={m.key} className="canvas-node__chip">{m.scene.name}</span>)}</div>}</div>
      </div>
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
  { key: "audio", label: "Аудио" },
] as const;

const PALETTE_DRAG_MIME = "application/x-canvas-palette-item";

function CanvasLegend() {
  return (
    <div
      className="canvas-legend"
      style={{
        position: "absolute",
        bottom: 12,
        left: 80,
        zIndex: 5,
        background: "var(--paper)",
        border: "1.5px solid var(--line)",
        padding: "8px 10px",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-micro)",
        letterSpacing: "0.04em",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: 260,
      }}
    >
      <div style={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Входы / Выходы</div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ opacity: 0.6 }}>Сцена ←</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#F0DDE8", border: "1px solid var(--ink)", transform: "rotate(45deg)", display: "inline-block" }} /> история</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#2E86C1", border: "2px solid #2E86C1", display: "inline-block" }} /> локация</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#C0392B", border: "2px solid #C0392B", display: "inline-block" }} /> персонажи</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#6C3483", border: "2px solid #6C3483", display: "inline-block" }} /> препятствия</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#B7950B", border: "2px solid #B7950B", display: "inline-block" }} /> лут</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#145A32", border: "2px solid #145A32", borderRadius: "50%", position: "relative", display: "inline-block" }}><span style={{ position: "absolute", top: "50%", left: "50%", width: 4, height: 4, background: "var(--paper)", borderRadius: "50%", transform: "translate(-50%,-50%)", display: "inline-block" }} /></span> аудио</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#E74C3C", border: "2px solid #E74C3C", borderRadius: "50%", position: "relative", display: "inline-block" }}><span style={{ position: "absolute", top: "50%", left: "50%", width: 4, height: 4, background: "var(--paper)", borderRadius: "50%", transform: "translate(-50%,-50%)", display: "inline-block" }} /></span> бой</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ opacity: 0.6 }}>→ Сцена</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#F0DDE8", border: "1px solid var(--ink)", transform: "rotate(45deg)", display: "inline-block" }} /> дальше</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "#1ABC9C", border: "2px solid #1ABC9C", display: "inline-block" }} /> последствия</div>
        </div>
      </div>

    </div>
  );
}

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
  boardId,
  campaignId,
  shelfVersion,
  onClose,
  onAdded,
  flowRef,
}: {
  arcId: number;
  settingId: number;
  boardId?: number | null;
  /** Кампания, в которой открыт холст: у неё свои события. */
  campaignId: number | null;
  /** Меняется, когда сцену положили на полку или сняли с неё. */
  shelfVersion: number;
  onClose: () => void;
  onAdded: (sceneId: number | null) => void;
  flowRef?: React.RefObject<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>;
}) {
  const [tab, setTab] = useState<PaletteTab>("scenes");
  const [shelf, setShelf] = useState<LibraryScene[]>([]);
  const [bundles, setBundles] = useState<LibraryBundle[]>([]);
  const [entities, setEntities] = useState<PaletteItem[]>([]);
  const [events, setEvents] = useState<PaletteItem[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settingId) {
      api.get<LibraryScene[]>(`/story/library?setting_id=${settingId}`).then(setShelf);
      api.get<LibraryBundle[]>(`/canvas/bundles?setting_id=${settingId}`).then(setBundles);
    } else if (boardId) {
      // фриформ: полка сцен не нужна, но наборы — глобальные
      setShelf([]);
      api.get<LibraryBundle[]>(`/canvas/bundles`).then(setBundles);
    } else {
      setShelf([]);
      setBundles([]);
    }
  }, [settingId, boardId, shelfVersion]);

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
    if (!settingId) {
      if (boardId) {
        // фриформ: существа/локации/предметы из всех сеттингов — через /search (пустой запрос = все)
        api
          .get<{ id: number; title: string }[]>(`/search?q=&types=${entityType}`)
          .then((rows) => setEntities(rows.slice(0, 40).map((r) => ({ type: entityType, id: r.id, name: r.title }))));
      } else {
        setEntities([]);
      }
      return;
    }
    api
      .get<{ id: number; name: string }[]>(`${ENTITY_LIST_URL[entityType]}?setting_id=${settingId}`)
      .then((rows) => setEntities(rows.map((r) => ({ type: entityType, id: r.id, name: r.name }))));
  }, [entityType, settingId, boardId]);

  // События сеттинга и кампании вместе: сцена приключения чаще двигает
  // что-то своё, кампанейское («срыв поставки в порту»), чем историю мира,
  // и предложить только хронику значит закрыть основной случай.
  useEffect(() => {
    if (tab !== "events") return;
    if (!settingId && !campaignId) {
      setEvents([]);
      return;
    }
    const calls: Promise<PaletteItem[]>[] = [];
    if (settingId) {
      calls.push(
        api
          .get<{ id: number; title: string }[]>(`/settings/${settingId}/calendar-events`)
          .then((rows) =>
            rows.map((r) => ({ type: "setting_event", id: r.id, name: r.title, note: "хроника мира" }))
          )
      );
    }
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

  const [audioSets, setAudioSets] = useState<PaletteItem[]>([]);
  const [battlePlaylists, setBattlePlaylists] = useState<PaletteItem[]>([]);
  useEffect(() => {
    if (tab !== "audio") return;
    api.get<{ id: number; name: string; battle_playlist_id: number | null }[]>("/sound-sets").then((rows) => setAudioSets(rows.map((r) => ({ type: "sound_set", id: r.id, name: r.name, note: r.battle_playlist_id ? "с боем" : "" }))));
    api.get<{ id: number; name: string }[]>("/playlists").then((rows) => setBattlePlaylists(rows.map((r) => ({ type: "playlist", id: r.id, name: r.name }))));
  }, [tab]);

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
      const pos = freshSpotAtCenter(flowRef?.current ?? null);
      if (boardId) await api.put("/canvas/board/nodes", { board_id: boardId, nodes: [{ node_type: "scene", node_id: created.id, x: pos.x, y: pos.y }] });
      else await api.put("/canvas/board/nodes", { arc_id: arcId, nodes: [{ node_type: "scene", node_id: created.id, x: pos.x, y: pos.y }] });
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
      const pos = freshSpotAtCenter(flowRef?.current ?? null);
      if (boardId) await api.put("/canvas/board/nodes", { board_id: boardId, nodes: [{ node_type: "scene", node_id: created.id, x: pos.x, y: pos.y }] });
      else await api.put("/canvas/board/nodes", { arc_id: arcId, nodes: [{ node_type: "scene", node_id: created.id, x: pos.x, y: pos.y }] });
      onAdded(created.id);
    } finally {
      setBusy(false);
    }
  }

  async function place(item: PaletteItem) {
    if (busy) return;
    setBusy(true);
    try {
      const pos = freshSpotAtCenter(flowRef?.current ?? null);
      const payload: Record<string, unknown> = boardId
        ? { board_id: boardId, node_type: item.type, node_id: item.id, ...pos }
        : { arc_id: arcId, node_type: item.type, node_id: item.id, ...pos };
      await api.post("/canvas/board/node", payload);
      onAdded(null);
    } finally {
      setBusy(false);
    }
  }

  async function createBundle() {
    if (busy) return;
    setBusy(true);
    try {
      const pos = freshSpotAtCenter(flowRef?.current ?? null);
      const payload: Record<string, unknown> = boardId
        ? { board_id: boardId, name: "Набор", setting_id: settingId || null, ...pos }
        : { arc_id: arcId, name: "Набор", setting_id: settingId, ...pos };
      await api.post("/canvas/bundles", payload);
      onAdded(null);
    } finally {
      setBusy(false);
    }
  }

  async function insertBundle(bundle: LibraryBundle) {
    if (busy) return;
    setBusy(true);
    try {
      const pos = freshSpotAtCenter(flowRef?.current ?? null);
      const payload = boardId ? { board_id: boardId, ...pos } : { arc_id: arcId, ...pos };
      await api.post(`/canvas/bundles/${bundle.id}/insert`, payload);
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

      {tab === "scenes" && settingId > 0 && (
        <button className="primary" onClick={createScene} disabled={busy}>
          Новая сцена
        </button>
      )}
      {tab === "bundles" && arcId > 0 && (
        <button className="primary" onClick={createBundle} disabled={busy}>
          Новый набор
        </button>
      )}

      <input
        id="canvas-palette-search"
        name="canvas-palette-search"
        autoComplete="off"
        placeholder={compendiumKinds ? "Поиск, в том числе по книгам" : "Поиск"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="canvas-palette__list">
        {tab === "scenes" && (
          <>
            {!settingId ? (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                На фриформ-доске сцены — это стикеры/изображения. Выберите сеттинг для сцен из приключений, или создавайте стикеры правым кликом.
              </p>
            ) : (
              <>
                <div className="canvas-palette__label">Заготовки</div>
                {filtered(shelf).map((blank) => (
                  <button
                    key={blank.id}
                    className="canvas-palette__item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "shelf", blankId: blank.id }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
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
          </>
        )}

        {tab === "bundles" && (
          <>
            {filtered(bundles).map((b) => (
              <button
                key={b.id}
                className="canvas-palette__item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "bundle", bundleId: b.id }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "entity", item }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "entity", item }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "entity", item }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
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
        {tab === "audio" && (
          <>
            <div className="canvas-palette__label">Аудионаборы</div>
            {filtered(audioSets).map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                className="canvas-palette__item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "entity", item }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => place(item)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{item.name}</span>
                <span className="canvas-palette__item-meta">{item.note}</span>
              </button>
            ))}
            {audioSets.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Аудионаборов нет — создайте в Звуках.
              </p>
            )}
            <div className="canvas-palette__label">Боевые плейлисты</div>
            {filtered(battlePlaylists).map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                className="canvas-palette__item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "entity", item: { ...item, type: "playlist" } }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => place({ ...item, type: "playlist" } as PaletteItem)}
                disabled={busy}
              >
                <span className="canvas-palette__item-name">{item.name}</span>
              </button>
            ))}
            {battlePlaylists.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Боевых плейлистов нет — создайте в Звуках.
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
function freshSpotAtCenter(flow: ReactFlowInstance<Node<CanvasNodeData>, Edge> | null): { x: number; y: number } {
  if (!flow) return freshSpot();
  const vp = flow.getViewport();
  // центр экрана в flow-координатах
  const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  // небольшая случайность, чтобы две подряд не легли точно друг на друга
  return { x: Math.round(center.x + (Math.random() * 40 - 20) / vp.zoom), y: Math.round(center.y + (Math.random() * 40 - 20) / vp.zoom) };
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