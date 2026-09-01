import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Background,
  ControlButton,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import { EditableTextCard } from "../components/EditableTextCard";
import { SCENE_KINDS, SCENE_KIND_LABELS, plural } from "../sceneKinds";
import { formatByPrecision } from "../inworldCalendar";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { EmptyState } from "../components/EmptyState";
import { createPortal } from "react-dom";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { CreatureCardLoader } from "../components/CreatureCard";
import { NavIcon } from "../components/NavIcons";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { useSoundEngineOptional } from "../sound/engine";
import "../canvas.css";
import {
  NODE_COLORS,
  HANDLE_COLORS,
  STICKER_COLORS,
  STICKER_SWATCHES,
  FRAME_SWATCHES,
  DEFAULT_FRAME_COLOR,
  INK_LIGHT,
  CANVAS_LEGEND_IN,
  CANVAS_LEGEND_OUT,
  type LegendItem,
  type SwatchOption,
} from "../canvasPalette";
import type {
  CanvasBoard,
  CanvasBoardNode,
  CanvasThread,
  CanvasChapterNode,
  CanvasRoute,
  OutsideLink,
  CalendarMonth,
  EventStatus,
  ForeignLink,
  LibraryBundle,
  LibraryScene,
  SceneCastRow,
  SceneCheck,
  DismissedHints,
  SceneHint,
  SceneHintsResponse,
  RehearsalStep,
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
  { id: "audio", label: "Аудио", color: HANDLE_COLORS.audio },
  { id: "battle", label: "Боевой плейлист", color: HANDLE_COLORS.battle },
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
  /** Тихие подсказки (блок G1). Пустой массив — чипа нет. */
  hints: SceneHint[];
  /** Текущая сцена прогона (блок G3): обводка акцентом, своя, не выделение. */
  isRehearsing: boolean;
  /** Щелчок по чипу подсказок: открывает меню там, где щёлкнули. */
  onHints: (x: number, y: number) => void;
  /** Переходы, второй конец которых на другом холсте (блок G6.2, Q17). */
  outside: OutsideLink[];
  /** Уехать на холст чужой сцены. Щелчок делает Мастер — стрелка не шагает. */
  onOutside: (link: OutsideLink) => void;
}

/**
 * Висящий разъём: переход есть, а второго его конца на этом холсте нет.
 *
 * Различие формой, а не цветом, — то же правило, что у чипа подсказки и у
 * разъёмов: пунктир говорит «связь уходит за край холста». Стрелка называет
 * направление, подпись — чужую сцену; чью главу, видно по `title`, иначе
 * карточка сцены превратилась бы в оглавление.
 */
function OutsideChips({ links, onOpen }: { links: OutsideLink[]; onOpen: (l: OutsideLink) => void }) {
  if (links.length === 0) return null;
  return (
    <div className="canvas-node__outside">
      {links.map((l, i) => (
        <button
          key={`${l.dir}:${l.scene_id}:${i}`}
          className="nodrag canvas-node__outlink"
          title={`${l.dir === "out" ? "Отсюда в" : "Сюда из"}: «${l.scene_name}» — ${l.arc_name}${l.label ? ` (${l.label})` : ""}`}
          onClick={(e) => { e.stopPropagation(); onOpen(l); }}
        >
          {l.dir === "out" ? "→" : "←"} {l.scene_name}
        </button>
      ))}
    </div>
  );
}

/**
 * Чип подсказок — ОДИН на все подсказки ноды, приглушённый, той же формы, что
 * соседние метки.
 *
 * Один, а не по чипу на подсказку: ноду читают на скорости взгляда, и один чип
 * читается быстрее двух разных текстов. Приглушённый и без иконки-восклицания:
 * яркая метка на двух десятках нод превратила бы холст в предупреждение о
 * самом себе — отсюда и слово «тихие» в названии блока.
 *
 * Виден ВСЕГДА, а не у выделенной ноды, в отличие от кнопок ниже: подсказка,
 * которую видно только после клика, не попадается на глаза, а в этом весь её
 * смысл.
 */
function HintChip({ hints, onOpen }: { hints: SceneHint[]; onOpen: (x: number, y: number) => void }) {
  if (hints.length === 0) return null;
  return (
    <span
      className="nodrag canvas-node__chip is-hint"
      title={hints.map((h) => h.text).join("\n")}
      role="button"
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.clientX, e.clientY);
      }}
    >
      {hints.length === 1 ? hints[0].text : `Недоделок: ${hints.length}`}
    </span>
  );
}

function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
  return (
    <div
      className={`canvas-node${selected ? " is-selected" : ""}${data.isRehearsing ? " is-rehearsing" : ""}`}
    >
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
          <HintChip hints={data.hints} onOpen={data.onHints} />
        </div>
        <OutsideChips links={data.outside} onOpen={data.onOutside} />
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
  // «Персонаж», а не «Персонаж игрока»: на плашке шириной в чип длинное
  // уточнение обрежется, а спутать его на доске кампании не с чем.
  character: "Персонаж",
};

/**
 * Куда ведёт «Открыть страницу» с узла. Только виды со своей страницей:
 * записи компендиума и события открываются не отдельным адресом, и пункта у
 * них нет — по тому же правилу, что и везде в разделе: орган управления,
 * которому нечего показать, не показывается.
 */
const ENTITY_PAGE_PATH: Record<string, string> = {
  being: "beings",
  location: "locations",
  artifact: "artifacts",
  character: "characters",
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
          цветом: в палитре ровно три цвета.

          У персонажа игрока разъёма нет (блок G7, Q6). Разъём сущности ведёт
          в состав сцены, а партия в состав не входит: она за столом, а не в
          сцене. Связи персонажа на доске кампании рисуются нитями от пинов —
          за ними записи нет и хранить их негде, ровно как у ярлыка
          приключения, которому разъёмы уже отменяли (цикл 6, Q22). */}
      {data.nodeType !== "character" && (
        <Handle type="source" position={Position.Right} className={`canvas-handle--entity canvas-handle--${data.nodeType}`} />
      )}
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
  settingId: number;
  chapterCount: number;
  sceneCount: number;
  /** Разъёмы есть только на схеме сеттинга и на карте кампании (блоки D3, D4):
   *  там связь между приключениями — это строка `story_arc_transitions`. На
   *  свободной доске ярлык остаётся без разъёмов, а связи рисуются нитями и в
   *  данных не отражаются. */
  linkable?: boolean;
  /** Прохождение — только на карте кампании (блок D4). */
  progress?: "done" | "active" | "untouched";
  isOverride?: boolean;
  settingChangedAt?: string | null;
  isNew?: boolean;
}

/**
 * Приключение на доске — ярлык (Q20, Q22).
 *
 * Разъёмы появляются только на схеме сеттинга (`linkable`, блок D3): там
 * протянутая связь пишет строку в `story_arc_transitions` и отвечает на
 * вопрос «что за чем идёт». На свободной доске ярлык остаётся без разъёмов —
 * связи там рисуются нитями, и в `story_arcs` при этом ничего не меняется.
 *
 * Счётчики моношрифтом: это величины, а не часть имени, и приключения по ним
 * сравнимы столбиком. Открывается двойным щелчком, как и глава.
 */
const PROGRESS_LABEL: Record<string, string> = {
  done: "сыграно",
  active: "идёт сейчас",
  untouched: "не дошли",
};

function AdventureNode({ data, selected }: NodeProps<Node<AdventureNodeData>>) {
  return (
    <div
      className={[
        "canvas-node",
        selected ? "is-selected" : "",
        data.progress ? `canvas-node--progress-${data.progress}` : "",
        data.isNew ? "canvas-node--new" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {data.linkable && (
        <Handle type="target" position={Position.Left} id="prev" className="canvas-handle--story" title="Сюда приходят из другого приключения" />
      )}
      <div className="canvas-node__band">
        <span className="canvas-node__name">{data.name}</span>
        <span className="canvas-node__kind">Приключение</span>
      </div>
      <div className="canvas-node__body">
        <span className="canvas-node__count">
          {data.chapterCount > 0 ? `${data.chapterCount} ${plural(data.chapterCount, "глава", "главы", "глав")} · ` : ""}
          {data.sceneCount} {plural(data.sceneCount, "сцена", "сцены", "сцен")}
        </span>
        {/* Прохождение — подписью, а не одним цветом: цветом на холсте уже
            закодирован тип узла, и второй смысл того же канала за столом не
            различить (инвариант 7). Цвет здесь — подсказка, слово — ответ. */}
        {data.progress && (
          <span className={`canvas-node__progress is-${data.progress}`}>{PROGRESS_LABEL[data.progress]}</span>
        )}
        {data.isNew && <span className="canvas-node__mark">новое в кампании</span>}
        {data.isOverride && <span className="canvas-node__mark">изменено в кампании</span>}
      </div>
      {data.linkable && (
        <Handle type="source" position={Position.Right} id="next" className="canvas-handle--story" title="Отсюда идут дальше" />
      )}
    </div>
  );
}

interface StickerNodeData extends Record<string, unknown> {
  text: string;
  name: string;
  note: string;
  color: string;
}
interface SoundSetNodeData extends Record<string, unknown> {
  name: string;
  battle_playlist_id: number | null;
}
function SoundSetNode({ data, selected }: NodeProps<Node<SoundSetNodeData>>) {
  return (
    <div className={`canvas-node canvas-node--sound_set${selected ? " is-selected" : ""}`} style={{ borderColor: NODE_COLORS.sound_set.color }}>
      <div className="canvas-node__band" style={{ background: NODE_COLORS.sound_set.color, color: NODE_COLORS.sound_set.ink }}>
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
    <div className={`canvas-node canvas-node--playlist${selected ? " is-selected" : ""}`} style={{ borderColor: NODE_COLORS.playlist.color }}>
      <div className="canvas-node__band" style={{ background: NODE_COLORS.playlist.color, color: NODE_COLORS.playlist.ink }}>
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

// Хендлы свёрнутой рамки не видны и не ловят мышь: они нужны только чтобы
// сквозному ребру было куда прийти. Видимые ромбики читались бы как часть
// имени и накрывали треугольник свёртки. Переехали сюда с главы (блок G6.3).
const HIDDEN_HANDLE = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 0,
  background: "transparent",
  pointerEvents: "none" as const,
};

interface FrameNodeData extends Record<string, unknown> {
  /** Свёрнута ли рамка (блок G6.3): вместо тела — одна шапка со счётчиком. */
  collapsed: boolean;
  /** Сколько узлов внутри. Одно число, без разбора по видам: разбор — это
   *  отчёт, а Мастеру нужно «тут не пусто и вот столько» (решение Q26). */
  inside: number;
  onToggle: () => void;
  name: string;
  w: number;
  h: number;
  color: string;
  /** Только что созданная рамка: обводка акцентом на пару секунд (блок G2). */
  isFresh?: boolean;
  /** Открыть поле имени сразу, не дожидаясь щелчка (блок G2). */
  autoEdit?: boolean;
  onRename: (name: string) => void;
}

interface PinNodeData extends Record<string, unknown> {
  name: string;
  size: string;
  color: string;
  shape: string;
  z_index: number;
}

const PIN_SIZES: Record<string, number> = { S: 16, M: 24, L: 32 };
const PIN_SHAPES = ["circle", "square", "diamond", "star"] as const;
/** Подписи форм. Ключ уходит в базу и остаётся английским, Мастеру он не виден. */
const PIN_SHAPE_LABEL: Record<string, string> = {
  circle: "Круг",
  square: "Квадрат",
  diamond: "Ромб",
  star: "Звезда",
};

/** Виды реального ребра, которое рвёт рераут («Маршрут»). */
type RouteKind = "transition" | "outcome" | "cast" | "member" | "thread";

/**
 * Имя хендла-выхода рераута-хаба, к которому цеплять сегмент.
 * Сегмент `route:<id> → target` принадлежит тому выходу, чей `to_key`
 * совпал с целью (у хаба их N, у перехода — один). Совпадение по ключу —
 * в новом «каст-носителе» выход это сцена, и её ключ равен адресу цели.
 */
function routeOutHandle(
  source: string,
  target: string,
  routes?: CanvasRoute[]
): string | null {
  const idMatch = /^route:(\d+)$/.exec(source);
  if (!idMatch || !routes) return null;
  const rid = Number(idMatch[1]);
  const route = routes.find((c) => c.id === rid);
  const first = route?.outputs?.[0]?.to_key;
  const matched = route?.outputs?.find((o) => o.to_key === target)?.to_key;
  const chosen = matched ?? first;
  return chosen ? `route-out-${chosen}` : "route-out";
}

function RouteNode({ data }: NodeProps<Node<RouteNodeData>>) {
  const outputs = data.outputs ?? [];
  const hasFrom = !!data.fromKey;
  const hasTo = outputs.length > 0;
  const hasNeighbors = hasFrom && hasTo;
  const isPartial = hasFrom !== hasTo;
  const hint = !data.fromKey && outputs.length === 0
    ? "Подведите слева вход и справа выход — нужно 2 соединения"
    : !data.fromKey
      ? "Подведите вход слева"
      : outputs.length === 0
        ? "Подведите выход справа"
        : "";
  // Шапка — как у прочих нод: две строки откуда/куда, полосы 30deg, текст белый
  const fromText = data.fromLabel || (data.fromKey ? data.fromKey : "—");
  const toText = outputs.length > 0
    ? outputs.map((o) => o.toName ?? o.toKey).join(", ")
    : data.toLabel || "—";
  const bodyText = data.kind === "transition" ? (data.condition ?? "") : "";
  return (
    <div
      className={`canvas-node canvas-node--route${hasNeighbors ? " is-connected" : isPartial ? " is-partial" : " is-empty"}`}
      title={hint || undefined}
    >
      <Handle
        id="route-in"
        type="target"
        position={Position.Left}
        className={`canvas-handle--route${!hasFrom ? " is-missing" : ""}`}
      />
      <div className="canvas-node__band" style={{ background: "repeating-linear-gradient(30deg, #1a1a1a 0 14px, #f4c400 14px 28px)", color: "white", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "6px 8px" }}>
        <span style={{ fontSize: "var(--fs-meta)", lineHeight: 1.2 }}>{fromText}</span>
        <span style={{ fontSize: "var(--fs-meta)", lineHeight: 1.2 }}>{toText}</span>
      </div>
      <div className="canvas-node__body" style={{ padding: bodyText ? "6px 8px" : 0 }}>
        <span className="canvas-node__route-text" style={{ whiteSpace: "normal", wordBreak: "break-word", maxWidth: 220 }}>
          {bodyText}
        </span>
      </div>
      {outputs.length > 0 ? (
        outputs.map((out, i) => (
          <Handle
            key={out.toKey}
            type="source"
            position={Position.Right}
            id={`route-out-${out.toKey}`}
            style={outputs.length > 1 && i > 0 ? { top: `${(i + 1) * 30}%` } : undefined}
            className={`canvas-handle--route`}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="route-out"
          className={`canvas-handle--route is-missing`}
        />
      )}
    </div>
  );
}

interface RouteNodeData extends Record<string, unknown> {
  kind: RouteKind;
  role: string;
  fromKey: string;
  /** Выходы хаба: сцены, куда передаётся носитель (модель «1 вход + N выходов»). */
  outputs?: { toKey: string; role: string; toName?: string }[];
  /** Подпись тела: у перехода — условие, читается с сервера. */
  condition?: string;
  fromLabel?: string;
  toLabel?: string;
}

function PinNode({ data, selected }: NodeProps<Node<PinNodeData>>) {
  const size = PIN_SIZES[data.size] ?? 24;
  const col = data.color || DEFAULT_FRAME_COLOR;
  const shape = data.shape || "circle";
  const style: React.CSSProperties = {
    width: size,
    height: size,
    background: col,
    border: `1.5px solid ${col}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: INK_LIGHT,
    fontSize: size * 0.6,
    boxSizing: "border-box",
    flexShrink: 0,
    aspectRatio: "1 / 1",
    position: "relative",
    zIndex: 1000,
  };
  if (shape === "circle") style.borderRadius = "50%";
  else if (shape === "diamond") {
    style.transform = "rotate(45deg)";
    style.width = size * 0.85;
    style.height = size * 0.85;
    style.aspectRatio = "1 / 1";
  } else if (shape === "star") {
    style.clipPath = "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";
    style.aspectRatio = "1 / 1";
  }
  return (
    <div
      className={`canvas-pin canvas-pin--${shape}${selected ? " is-selected" : ""}`}
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        boxSizing: "border-box",
        // Точка отсчёта для подписи под пином (блок G5).
        position: "relative",
        pointerEvents: "all",
        aspectRatio: "1 / 1",
        zIndex: 1000,
      }}
      title={data.name || "Пин"}
    >
      <div style={style} />
      {/*
        Имя пина видно на холсте, а не только во всплывающей подсказке
        (блок G5). До этого пин был безымянной точкой: имя жило в `title` и в
        панели свойств, и на живой базе это видно по результату — из
        тринадцати пинов девять называются «Пин», а один «Пин А». Имя,
        которого не видно, не пишут.

        Подпись получают только пины с СОБСТВЕННЫМ именем: у пина по
        умолчанию имя «Пин», и подписывать им каждую точку значило бы
        разложить по холсту слово «Пин».

        `pointer-events: none` — подпись не должна перехватывать ни
        перетаскивание пина, ни щелчок по холсту под ней.
      */}
      {data.name && data.name !== "Пин" && (
        <div className="canvas-pin__label">{data.name}</div>
      )}
      {/* Обе точки крепления — в центре пина, чтобы нити шли из центра в центр */}
      <Handle type="source" position={Position.Right} id="pin" style={{ left: "50%", top: "50%", right: "auto", bottom: "auto", transform: "translate(-50%, -50%)", opacity: 0, width: 0, height: 0, border: 0, pointerEvents: "none" }} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="pin" style={{ left: "50%", top: "50%", right: "auto", bottom: "auto", transform: "translate(-50%, -50%)", opacity: 0, width: 0, height: 0, border: 0, pointerEvents: "none" }} isConnectable={false} />
    </div>
  );
}

function FrameNode({ data, selected }: NodeProps<Node<FrameNodeData>>) {
  const col = data.color || DEFAULT_FRAME_COLOR;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name || "Группа");
  useEffect(() => { setDraft(data.name || "Группа"); }, [data.name]);
  // Только что созданная рамка открывает поле имени сама: имя у неё всегда
  // «Группа», и первый жест после создания — переименовать (блок G2).
  // Флаг гаснет вместе с подсветкой, поэтому эффект только включает правку:
  // иначе поле закрывалось бы через две секунды прямо под рукой.
  useEffect(() => { if (data.autoEdit) setEditing(true); }, [data.autoEdit]);
  const save = () => {
    const next = draft.trim() || "Группа";
    setEditing(false);
    if (next === data.name) return;
    data.onRename(next);
  };
  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    data.onToggle();
  };
  // Треугольник свёртки — тот же, что был у главы (блок G6.3). Виден всегда, а
  // не по наведению: на доске с десятком рамок Мастер должен видеть, что
  // свёрнуто, не водя мышью.
  const fold = (
    <span
      className="canvas-frame__fold"
      role="button"
      tabIndex={-1}
      onClick={toggle}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label={data.collapsed ? "Развернуть группу" : "Свернуть группу"}
    >
      {data.collapsed ? "▶" : "▼"}
    </span>
  );
  // Свёрнутая рамка — одна шапка без тела: ни ручек растягивания (размера у неё
  // сейчас нет), ни площади, под которой что-то лежит.
  if (data.collapsed) {
    return (
      <div className={`canvas-chapter-card${selected ? " is-selected" : ""}${data.isFresh ? " is-fresh" : ""}`} style={{ borderColor: col }}>
        <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
        <div
          className="canvas-frame__title"
          style={{ background: col, color: INK_LIGHT }}
          onDoubleClick={toggle}
          title="Развернуть группу"
        >
          {fold}
          <span className="canvas-frame__name">{draft}</span>
          <span className="canvas-frame__count">{data.inside}</span>
        </div>
        <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      </div>
    );
  }
  return (
    <div className={`canvas-frame${data.isFresh ? " is-fresh" : ""}`} style={{ borderColor: col }}>
      {editing ? (
        <input
          className="canvas-frame__title-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(data.name || "Группа"); setEditing(false); } }}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: col, color: INK_LIGHT, border: "none", outline: "none", fontFamily: "var(--font-display)", fontSize: "var(--fs-meta)", fontWeight: 600, padding: "4px 8px", width: "100%", boxSizing: "border-box" }}
        />
      ) : (
        <div
          className="canvas-frame__title"
          style={{ background: col, color: INK_LIGHT, cursor: selected ? "text" : "default" }}
          onClick={(e) => { if (!selected) return; e.stopPropagation(); setEditing(true); }}
          onDoubleClick={toggle}
          title={selected ? "Нажмите чтобы переименовать" : "Двойной щелчок — свернуть"}
        >
          {fold}
          <span className="canvas-frame__name">{draft}</span>
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
  sceneCount: number;
  /** Сколько подсказок внутри главы (блок G1). Сцены главы на этот холст не
   *  приезжают, поэтому число считает сервер — `GET /canvas/hints?chapters_of=`. */
  hintCount: number;
  arcId: number;
  /** Приключение, которому глава принадлежит: адрес «Войти» (блок G6.2). */
  parentArcId: number;
  settingId: number;
  /** Войти в главу — открыть её холст. Двойной щелчок, как у приключения. */
  onEnter: (arcId: number) => void;
  /** Переименование на месте — тот же жест, что у свободной рамки (блок G2). */
  onRename: (name: string) => void;
  /** Только что созданная глава: обводка акцентом на пару секунд (блок G2). */
  isFresh?: boolean;
  /** Открыть поле имени сразу, не дожидаясь щелчка (блок G2). */
  autoEdit?: boolean;
  /** Сцену тащат сюда — обводка акцентом пока кнопку не отпустили (Q21). */
  isDropTarget?: boolean;
}

/**
 * Узел главы (блок G6.2).
 *
 * Раньше здесь была рамка, обнимавшая свои сцены, со свёрткой и скрытыми
 * хендлами для сквозных рёбер. Рамка ушла: глава — контейнер, в который
 * входят, и на холсте приключения от неё видна карточка, а не территория.
 * Отсюда пропало и всё, что обслуживало рамку, — треугольник свёртки,
 * счётчик «сколько спрятано», хендлы-невидимки под сквозное ребро.
 *
 * Устроена как ярлык приключения и по той же причине: это один и тот же жест
 * на двух уровнях, и разная карточка у них означала бы, что уровни разные по
 * сути. Разъёмы `story` — связи между главами (`story_arc_transitions`).
 */
function ChapterNode({ data, selected }: NodeProps<Node<ChapterNodeData>>) {
  const col = data.color || DEFAULT_FRAME_COLOR;
  // Имя правится на месте (блок G2): щелчок по имени выделенной главы
  // открывает поле. Правится `story_arcs.name`, то есть сама запись главы.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name);
  useEffect(() => { setDraft(data.name); }, [data.name]);
  useEffect(() => { if (data.autoEdit) setEditing(true); }, [data.autoEdit]);
  const saveName = () => {
    const next = draft.trim() || "Глава";
    setEditing(false);
    if (next === data.name) return;
    data.onRename(next);
  };
  return (
    <div
      className={[
        "canvas-node",
        "canvas-node--chapter",
        selected ? "is-selected" : "",
        data.isDropTarget ? "is-drop-target" : "",
        data.isFresh ? "is-fresh" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ borderColor: col }}
      onDoubleClick={() => data.onEnter(data.arcId)}
      title="Двойной щелчок — войти в главу"
    >
      <Handle type="target" position={Position.Left} id="prev" className="canvas-handle--story" title="Сюда приходят из другой главы" />
      <div className="canvas-node__band" style={{ background: col, color: INK_LIGHT }}>
        {editing ? (
          <input
            className="canvas-frame__title-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setDraft(data.name); setEditing(false); } }}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{ width: "100%", background: "transparent", color: INK_LIGHT, border: "none", outline: "none", fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit", padding: 0 }}
          />
        ) : (
          <span
            className="canvas-node__name"
            style={{ cursor: selected ? "text" : undefined }}
            onClick={(e) => { if (!selected) return; e.stopPropagation(); setEditing(true); }}
            onDoubleClick={(e) => { if (selected) e.stopPropagation(); }}
            title={selected ? "Нажмите чтобы переименовать" : undefined}
          >
            {data.name}
          </span>
        )}
        <span className="canvas-node__kind">Глава</span>
      </div>
      <div className="canvas-node__body">
        <span className="canvas-node__count">
          {data.sceneCount} {plural(data.sceneCount, "сцена", "сцены", "сцен")}
        </span>
        {/* Счётчик подсказок остаётся на узле (решение Q22): сцены главы с
            холста ушли, а «что я забыл» уезжать вместе с ними не должно —
            ровно за этим холст и открывают утром. */}
        {data.hintCount > 0 && (
          <span className="canvas-frame__hints" title={`Внутри недоделок: ${data.hintCount}`}>
            {data.hintCount}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="next" className="canvas-handle--story" title="Отсюда идут дальше" />
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
  pin: PinNode,
  route: RouteNode,
};

/** Ширина холста, ниже которой палитра и поиск перестают помещаться рядом.
    Арифметика: палитра занимает 12…272 (отступ плюс её 260), поиск — от
    `ширина - 312` до `ширина - 52` (260 плюс отступ и место кнопки свёртки
    панели). Зазор в 12 px между ними остаётся, пока холсту хватает 596.
    Меряется именно холст, а не раздел: порог `@container (max-width: 700px)`
    в canvas.css считает по разделу, и при разделе в 856 холсту достаётся
    564 — панели уже налезали друг на друга, а @container ещё молчал. */
const CANVAS_OVERLAYS_MIN_PX = 596;

const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };

const EDGE_CLASS: Record<string, string | undefined> = {
  transition: undefined,
  outcome: "canvas-edge--outcome",
  cast: "canvas-edge--cast",
  member: "canvas-edge--cast",
  check: "canvas-edge--cast",
  thread: "canvas-edge--thread",
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
  | PlaylistNodeData
  | PinNodeData
  | RouteNodeData;

/** Рамки лежат в том же массиве нод — отличать их надо по ключу. */
/**
 * Рамка — только свободная (блок G6.2).
 *
 * До этого блока сюда входила и глава: она была рамкой, лежала под своими
 * сценами, имела свой размер и своё место в `canvas_groups`. Глава стала
 * узлом, и всё, что здесь про рамку, к ней больше не относится — иначе она
 * уезжала бы под холст порядком слоёв и выпадала из общей записи раскладки.
 */
function isFrame(id: string): boolean {
  return id.startsWith("frame:");
}

function isPin(id: string): boolean {
  return id.startsWith("pin:");
}
/**
 * Размер, заданный самими данными ноды. Есть он только у рамки, главы и
 * картинки: у остальных видов ширину и высоту решает вёрстка. Виды лежат в
 * одном union, поэтому читается это проверкой типа, а не приведением —
 * приведение соврало бы на каждом виде, где полей нет.
 */
function dataSize(data: CanvasNodeData): { w?: number; h?: number } {
  const w = data.w;
  const h = data.h;
  return {
    w: typeof w === "number" ? w : undefined,
    h: typeof h === "number" ? h : undefined,
  };
}

function getNodeSize(n: Node<CanvasNodeData>): { w: number; h: number } {
  const isPin = n.type === "pin";
  const size = typeof n.data.size === "string" ? n.data.size : "M";
  const pinSize = isPin ? PIN_SIZES[size] ?? 24 : 0;
  const own = dataSize(n.data);
  // Порядок: заданное Мастером, потом ЗАМЕРЕННОЕ, потом из данных, и только
  // потом запасное число. Замер стоял в стороне, и в ход шли константы: у
  // стикера 320 против настоящих ~220. Пятьдесят лишних пикселей вправо
  // сдвигали его расчётный центр — по нему выбирается рамка при броске и
  // считается охват группы из выделения.
  const w = isPin ? pinSize : n.width ?? n.measured?.width ?? own.w ?? (n.type === "image" || n.type === "sticker" ? 320 : n.type === "scene" ? 220 : n.type === "adventure" ? 200 : 200);
  const h = isPin ? pinSize : n.height ?? n.measured?.height ?? own.h ?? (n.type === "image" ? 240 : n.type === "sticker" ? 120 : 124);
  return { w, h };
}
/**
 * Родительство нод и перевод координат.
 *
 * В базе координаты ВСЕГДА абсолютные — одна модель на всё хранилище (Q15).
 * Относительные нужны только React Flow: у ноды с `parentId` позиция
 * отсчитывается от начала родителя. Перевод живёт здесь и в `toAbsolute`, и
 * больше нигде: два места, а не разбросанная по файлу арифметика.
 *
 * Кто чей ребёнок:
 *   сцена     — своей главы, по `scene.arc_id` (данные, не перекрытие рамок);
 *   проверка  — той же главы, что её сцена, по `check.scene_id` (Q10);
 *   остальное — по `parent_key`, который проставился в момент броска (Q11).
 * Рамки и главы родителей не имеют — вложенности глубже одного уровня нет (Q3).
 */
/**
 * В какую рамку попадает точка доски.
 *
 * Решает ЦЕНТР перетаскиваемой ноды, а не угол и не факт перекрытия (Q5):
 * сцена шире своего шага между главами, и по перекрытию она была бы в двух
 * главах сразу. Из вложенных друг в друга рамок выигрывает самая мелкая — та,
 * что лежит сверху.
 *
 * Свёрнутая глава целью не бывает: брошенная в неё сцена тут же исчезла бы
 * с глаз — выглядит как потеря, а не как перенос. Для этого есть список
 * «Глава» в свойствах (Q24).
 */
function frameAtPoint(board: CanvasBoard, x: number, y: number): string | null {
  let bestKey: string | null = null;
  let bestArea = Infinity;
  // Глав среди рамок больше нет (блок G6.2): глава — узел, и сцену на неё
  // бросают как на узел, а не как в территорию. Считает это `chapterNodeAt`.
  for (const n of board.nodes) {
    if (n.node_type !== "frame") continue;
    // Свёрнутая рамка целью не бывает (блок G6.3): брошенная в неё нода тут же
    // исчезла бы с глаз — выглядит как потеря, а не как перенос. То же правило
    // действовало у свёрнутой главы, пока она была рамкой.
    if (n.frame.collapsed) continue;
    const { w, h } = n.frame;
    if (x < n.x || x > n.x + w || y < n.y || y > n.y + h) continue;
    const area = w * h;
    if (area < bestArea) { bestArea = area; bestKey = `frame:${n.node_id}`; }
  }
  return bestKey;
}

/**
 * Узел главы под точкой — цель для брошенной сцены (решение Q21).
 *
 * Жест переноса сцены между главами сохранился целиком, изменилась только
 * цель: раньше это была рамка в пол-экрана, теперь карточка. Правило то же,
 * что было у рамки, — решает ЦЕНТР перетаскиваемой ноды, а не перекрытие:
 * сцена шире шага между главами и по перекрытию попадала бы в две сразу.
 */
function chapterNodeAt(nodes: Node<CanvasNodeData>[], x: number, y: number): number | null {
  for (const n of nodes) {
    if (!n.id.startsWith("chapter:")) continue;
    const { w, h } = getNodeSize(n);
    if (x < n.position.x || x > n.position.x + w) continue;
    if (y < n.position.y || y > n.position.y + h) continue;
    return Number(splitKey(n.id)[1]);
  }
  return null;
}

function computeParents(board: CanvasBoard): {
  frameOrigin: Map<string, { x: number; y: number }>;
  parentOf: Map<string, string>;
  collapsed: Set<string>;
} {
  // Рамка теперь только одна — свободная (блок G6.2). У сцены и проверки
  // родителя нет вовсе: их глава была рамкой, а стала узлом, и на холсте
  // главы все сцены и так свои.
  const frameOrigin = new Map<string, { x: number; y: number }>();
  const collapsed = new Set<string>();
  for (const n of board.nodes) {
    if (n.node_type !== "frame") continue;
    frameOrigin.set(`frame:${n.node_id}`, { x: n.x, y: n.y });
    // Свёртка теперь у рамки (блок G6.3): содержимое прячется через
    // `hidden: true`, а не разбором родства — React Flow скрытые ноды не
    // рисует и не обмеряет, и разворот встаёт на место без перезагрузки.
    if (n.frame.collapsed) collapsed.add(`frame:${n.node_id}`);
  }

  const parentOf = new Map<string, string>();
  for (const n of board.nodes) {
    if (n.node_type === "frame") continue;
    const parent = n.parent_key ?? undefined;
    if (parent && frameOrigin.has(parent) && parent !== n.key) parentOf.set(n.key, parent);
  }
  return { frameOrigin, parentOf, collapsed };
}

function applyParenting(
  flow: Node<CanvasNodeData>[],
  board: CanvasBoard
): Node<CanvasNodeData>[] {
  const { frameOrigin, parentOf, collapsed } = computeParents(board);
  return flow.map((node) => {
    const parent = parentOf.get(node.id);
    if (!parent) return node;
    const origin = frameOrigin.get(parent)!;
    return {
      ...node,
      parentId: parent,
      // Свёрнутая глава прячет содержимое, а не разбирает родство: при
      // развороте всё встаёт на свои места без перезагрузки доски.
      hidden: collapsed.has(parent),
      position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
    };
  });
}

/**
 * Куда приходит ребро, если его конец спрятан в свёрнутой главе (Q7):
 * к карточке главы. Сквозной переход остаётся виден с подписью на ребре —
 * именно ради этого главы и попали на один холст. Ребро внутри одной
 * свёрнутой главы исчезает вместе со своими сценами.
 */
function collapsedHost(board: CanvasBoard): (id: string) => string {
  const { parentOf, collapsed } = computeParents(board);
  return (id) => {
    const parent = parentOf.get(id);
    return parent && collapsed.has(parent) ? parent : id;
  };
}

/**
 * Первый fitView — когда все ноды обмерены, а не через фиксированные 80 мс.
 *
 * Раньше задержки хватало: у каждой ноды были явные width/height, и границы
 * считались без замера. Свёрнутая глава шириной в своё имя размера не знает
 * до отрисовки, и fitView по таймеру считал её нулём — холст открывался втрое
 * крупнее нужного, и верхняя глава уходила за край экрана.
 */
function fitWhenMeasured(
  ref: { current: ReactFlowInstance<Node<CanvasNodeData>, Edge> | null },
  tries = 0
): void {
  const inst = ref.current;
  // Скрытая нода не обмеряется и в границы не входит — ждать её нечего.
  // Пустой список проверку проходит (`[].every` — истина), а значит без первого
  // условия мы бы подогнали вид под ноль нод и оставили холст глядеть в пустоту.
  const flowNodes = inst?.getNodes() ?? [];
  const ready = inst && flowNodes.length > 0 && flowNodes.every((n) => n.hidden || !!n.measured?.width);
  if (ready) {
    inst.fitView({ padding: 0.2, duration: 300 });
    return;
  }
  // Потолок — полсекунды: если что-то пошло не так, лучше неточный вид,
  // чем вечный таймер.
  if (tries >= 20) {
    inst?.fitView({ padding: 0.2, duration: 300 });
    return;
  }
  setTimeout(() => fitWhenMeasured(ref, tries + 1), 25);
}

/**
 * Снимок раскладки для undo/redo.
 *
 * Перенос сцены в другую главу — это одно движение рукой, и отменяться оно
 * должно одним шагом (Q12). Поэтому в снимок идёт не только где лежали
 * ноды, но и чьей была каждая сцена. Откат без второго вернул бы сцену
 * на место, оставив её в чужой главе, — хуже, чем не отменять вовсе.
 */
interface LayoutSnapshot {
  nodes: Node<CanvasNodeData>[];
  /** id сцены → её глава на момент снимка. */
  arcs: Map<number, number | null>;
  /** «тип:id» свободного узла → его рамка (`frame:<id>`) или null на момент снимка. */
  parentKeys: Map<string, string | null>;
}

/** Позиция ноды в координатах доски — то, что уходит в базу. */
function toAbsolute(node: Node<CanvasNodeData>, byId: Map<string, Node<CanvasNodeData>>): { x: number; y: number } {
  const parentId = node.parentId;
  if (!parentId) return node.position;
  const parent = byId.get(parentId);
  if (!parent) return node.position;
  // Родитель сам вложенным не бывает (Q3), поэтому одного шага довольно.
  return { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y };
}

/**
 * Рамка ложится под своё содержимое.
 *
 * Кто её содержимое — говорит родство (`parentId`, его проставляет
 * `applyParenting` по `parent_key`), а не перекрытие прямоугольников.
 * Геометрия здесь врала: место ребёнка отсчитывается ОТ РАМКИ, а рамка
 * бралась в координатах доски — свои дети в проверку не попадали, зато
 * попадали чужие ноды, лежащие рядом в абсолютных. Та же ошибка врала в
 * составе группы в панели свойств.
 */
function applyGroupDepth(all: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  const groups = all.filter((n) => isFrame(n.id));
  if (groups.length === 0) return all;
  const depth = new Map<string, number>();
  for (const g of groups) {
    const inside = all.filter((n) => n.parentId === g.id);
    if (inside.length === 0) depth.set(g.id, -1);
    else {
      const minZ = Math.min(...inside.map((n) => n.zIndex ?? 0));
      depth.set(g.id, minZ - 1);
    }
  }
  return all.map((n) => (isFrame(n.id) ? ({ ...n, zIndex: depth.get(n.id) } as Node<CanvasNodeData>) : n));
}

/**
 * Ноды доски одного вида — с сужением типа.
 *
 * `board.nodes` — размеченное объединение по `node_type`, но `find`/`filter`
 * с обычным условием сужения не дают: наружу выходит всё объединение, и до
 * `n.pin` или `n.scene` без приведения не добраться. Предикат написан один
 * раз здесь, вместо приведения на каждом обращении.
 */
function nodeTitle(data: CanvasNodeData): string | undefined {
  for (const key of ["name", "title", "text", "what"] as const) {
    const v = data[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * Как назвать ноду доски в списке. Имя лежит в своей ветке у каждого вида;
 * у картинки имени нет вовсе — её называем видом, а не ключом `image:22`.
 */
function boardNodeTitle(n: CanvasBoardNode): string {
  switch (n.node_type) {
    case "scene": return n.scene.name;
    case "check": return n.check.what || "Проверка";
    case "sticker": return n.sticker.name || n.sticker.text || "Стикер";
    case "image": return "Картинка";
    case "frame": return n.frame.name || "Группа";
    case "pin": return n.pin.name || "Пин";
    case "bundle": return n.bundle.name;
    case "adventure": return n.adventure.name;
    case "chapter": return n.chapter.name;
    case "sound_set": return n.sound_set.name || "Набор";
    case "playlist": return n.playlist.name || "Плейлист";
    case "setting_event":
    case "campaign_event": return n.event.title;
    case "route":
      // Рераут-нода — только память прохода между двумя соседями, у неё нет
      // имени: называем её «A → B», если имена соседей доехали, иначе вид.
      return [n.route.from_name, n.route.to_name].filter(Boolean).join(" → ") || "Маршрут";
    default: return n.entity.name;
  }
}

function boardNodesOfType<K extends CanvasBoardNode["node_type"]>(
  board: CanvasBoard | null | undefined,
  kind: K,
): Extract<CanvasBoardNode, { node_type: K }>[] {
  return (board?.nodes ?? []).filter(
    (n): n is Extract<CanvasBoardNode, { node_type: K }> => n.node_type === kind,
  );
}

/** «being:41» → ["being", 41]. Ключ ноды приходит с сервера строкой. */
function splitKey(key: string): [string, number] {
  const at = key.indexOf(":");
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

// Одна нода холста → нода React Flow. Ключ приходит с сервера строкой
// «вид:номер»: голого номера мало с тех пор, как рядом со сценами стоят
// существа — сцена 41 и существо 41 получили бы один ключ.
/** Стабильная ссылка: новый `[]` на каждую сборку ломал бы memo у нод без
 *  подсказок — тот же счёт, что уже оплачен нестабильным колбэком в вехах. */
const EMPTY_HINTS: SceneHint[] = [];
// Та же причина, что у EMPTY_HINTS: новый массив на каждую ноду ломал бы
// сравнение данных и перерисовывал холст на пустом месте.
const EMPTY_OUTSIDE: OutsideLink[] = [];

function toFlowNode(
  n: CanvasBoardNode,
  hintsByScene: Map<number, SceneHint[]>,
  onOutside: (link: OutsideLink) => void,
  onHints: (sceneId: number, x: number, y: number) => void,
  onPullCast: (sceneId: number) => void,
  onAddCheck: (sceneId: number) => void,
  months: CalendarMonth[],
  era: string,
  /** Переименование рамки на месте (блок G2). */
  onRenameFrame: (frameId: number, name: string) => void,
  /** Свернуть/развернуть рамку (блок G6.3). */
  onToggleFrame: (frameId: number, collapsed: boolean) => void,
  /** Сколько узлов внутри рамки — для счётчика на свёрнутой (блок G6.3). */
  insideCount = 0,
  /** Схема сеттинга: у приключений появляются разъёмы (блок D3). */
  onSettingMap = false
): Node<CanvasNodeData> {
  const base: Node<CanvasNodeData> = { id: n.key, position: { x: n.x, y: n.y }, zIndex: n.z_index ?? 0 } as Node<CanvasNodeData>;
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
        hints: hintsByScene.get(n.scene.id) ?? EMPTY_HINTS,
        isRehearsing: false,
        outside: n.scene.outside ?? EMPTY_OUTSIDE,
        onOutside: onOutside,
        onHints: (x: number, y: number) => onHints(n.scene.id, x, y),
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
      data: {
        name: n.adventure.name,
        settingId: n.adventure.setting_id,
        chapterCount: n.adventure.chapter_count,
        sceneCount: n.adventure.scene_count,
        linkable: onSettingMap,
        progress: n.adventure.progress,
        isOverride: n.adventure.is_override,
        settingChangedAt: n.adventure.setting_changed_at,
        isNew: n.adventure.is_new,
      },
    };
  }
  if (n.node_type === "sticker") {
    return { ...base, type: "sticker", data: { text: n.sticker.text, name: n.sticker.name, note: n.sticker.note, color: n.sticker.color } };
  }
  if (n.node_type === "image") {
    return { ...base, type: "image", data: { fileUrl: n.image.file_url, w: n.image.w, h: n.image.h }, width: n.image.w, height: n.image.h };
  }
  if (n.node_type === "frame") {
    return {
      ...base,
      type: "frame",
      // Тащат за заголовок — тот же жест, что у рамки главы (`toFrameNode`).
      // Без этого перетаскивание ловила вся площадь рамки, и до ноды под ней
      // было не добраться: щелчок по ней двигал рамку.
      dragHandle: ".canvas-frame__title",
      data: {
        name: n.frame.name,
        color: n.frame.color,
        w: n.frame.w,
        h: n.frame.h,
        collapsed: !!n.frame.collapsed,
        inside: insideCount,
        onToggle: () => onToggleFrame(n.frame.id, !n.frame.collapsed),
        onRename: (name: string) => onRenameFrame(n.frame.id, name),
      },
      // У свёрнутой рамки размера нет: его задаёт содержимое шапки. Хранимые
      // w/h остаются в базе нетронутыми и возвращаются при развороте (G6.3).
      ...(n.frame.collapsed ? {} : { width: n.frame.w, height: n.frame.h }),
    };
  }
  if (n.node_type === "sound_set") {
    return { ...base, type: "sound_set", data: { name: n.sound_set.name, battle_playlist_id: n.sound_set.battle_playlist_id } };
  }
  if (n.node_type === "playlist") {
    return { ...base, type: "playlist", data: { name: n.playlist.name } };
  }
  if (n.node_type === "pin") {
    return {
      ...base,
      // Пины всегда выше всех прочих нод: у них недостижимый в обычной
      // раскладке z-index. Нити (рёбра) получают z-index = max(z пинов), что
      // при равенстве оставляет пин выше нити (DOM-порядок), но выносит нить
      // выше обычных нод (у тех z-index куда меньше).
      zIndex: 1000000,
      type: "pin",
      data: {
        name: n.pin.name,
        size: n.pin.size,
        color: n.pin.color,
        shape: n.pin.shape,
        z_index: n.pin.z_index,
      },
    };
  }
  if (n.node_type === "route") {
    return {
      ...base,
      type: "route",
      // Рераут рвёт ребро на сегменты; при Drag & Drop цепляет и их — обычный
      // жест перемещения, выбор nodes/edges сделает React Flow сам.
      data: {
        kind: n.route.kind as RouteKind,
        role: n.route.role,
        fromKey: n.route.from_key,
        toKey: n.route.to_key,
        condition: n.route.transition_label,
        fromLabel: n.route.from_name,
        toLabel: n.route.to_name,
        outputs: (n.route.outputs ?? []).map((o) => ({
          toKey: o.to_key,
          role: o.role,
          toName: o.to_name,
        })),
      },
    };
  }
  // Проверка
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

/**
 * Узел главы → нода React Flow (блок G6.2).
 *
 * Прежний `toFrameNode` строил рамку: свой размер, ручка перетаскивания на
 * заголовке, порядок в массиве под сценами. Ничего этого узлу не нужно — он
 * такая же карточка, как ярлык приключения, и ведёт себя так же.
 */
function toChapterNode(
  n: CanvasChapterNode,
  hintCount: number,
  onEnter: (arcId: number) => void,
  onRename: (arcId: number, name: string) => void
): Node<CanvasNodeData> {
  return {
    id: `chapter:${n.chapter.id}`,
    type: "chapter",
    position: { x: n.x, y: n.y },
    deletable: true,
    data: {
      name: n.chapter.name,
      color: DEFAULT_FRAME_COLOR,
      sceneCount: n.chapter.scene_count,
      hintCount,
      arcId: n.chapter.id,
      parentArcId: n.chapter.arc_id,
      settingId: n.chapter.setting_id,
      onEnter,
      onRename: (name: string) => onRename(n.chapter.id, name),
    },
  };
}

/** Ответ `GET /canvas/index` — всё, что показывает экран выбора полотна. */
interface CanvasIndex {
  free: {
    id: number;
    scope_id: number;
    name: string;
    nodes: number;
    created_at: string;
    /** Владелец доски: 'setting' | 'campaign' | null (ничья). Блок D1. */
    owner_type: string | null;
    owner_id: number | null;
  }[];
  settings: {
    id: number;
    name: string;
    adventures: {
      id: number;
      name: string;
      is_default: number;
      chapter_count: number;
      scene_count: number;
      /** Куда ведёт это приключение дальше — то, что рисовалось разъёмами на
       *  ушедшем холсте сеттинга. */
      next: { id: number; to_arc_id: number; to_name: string; label: string }[];
    }[];
  }[];
  /** Куда доску можно переместить и под чьим именем показать её саму. С блока
   *  D4 у кампании есть и своя карта, поэтому список полный, а не только те,
   *  у кого нашлась доска. `setting_id` — чтобы «+ Приключение» у кампании
   *  знало, в каком сеттинге заводить (блок D5). */
  campaigns: { id: number; name: string; setting_id?: number | null }[];
  /** Все сеттинги, включая те, где ещё нет приключений: список целей для
   *  «Переместить» шире того, что показано группами. */
  all_settings: { id: number; name: string }[];
}

/**
 * «Добавить приключение сеттинга» на карте кампании (блок D4).
 *
 * Список — то, чего в кампании ещё нет: сервер уже умеет его считать
 * (`GET /story/campaign-adventures/available`), и второго списка заводить не
 * надо. Кнопка молчит, когда добавлять нечего: блок, которому нечего
 * показать, не показывается (инвариант 11).
 */
function AddSettingArcButton({ campaignId, onAdded }: { campaignId: number; onAdded: () => void }) {
  // Место меню берётся у кнопки: `ContextMenu` позиционируется fixed, и без
  // якоря он лёг бы в угол экрана, а не под кнопкой.
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [items, setItems] = useState<{ id: number; name: string; scene_count: number }[] | null>(null);

  useEffect(() => {
    api
      .get<{ id: number; name: string; scene_count: number }[]>(
        `/story/campaign-adventures/available?campaign_id=${campaignId}`
      )
      .then(setItems)
      .catch(() => setItems([]));
  }, [campaignId]);

  if (!items || items.length === 0) return null;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOpen((v) => (v ? null : { x: r.left, y: r.bottom }));
        }}
      >
        Добавить приключение сеттинга
      </button>
      {open && (
        <ContextMenu
          x={open.x}
          y={open.y}
          title="Есть в сеттинге, нет в кампании"
          items={items.map((it) => ({
            label: `${it.name} · ${it.scene_count} ${plural(it.scene_count, "сцена", "сцены", "сцен")}`,
            onClick: async () => {
              await api.post("/story/campaign-adventures", { campaign_id: campaignId, arc_id: it.id });
              setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
              onAdded();
            },
          }))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** Одна свободная доска в ответе `GET /canvas/index`. */
type FreeBoard = CanvasIndex["free"][number];

/**
 * Плитка свободной доски на экране выбора (блок D2).
 *
 * Карточка, а не кнопка: внутри живёт кнопка меню, а кнопка внутри кнопки
 * невалидна — та же причина, по которой карточкой стало приключение.
 *
 * Основной путь к действиям — «⋯»: правой кнопки нет на тач-экране, а
 * владелец открывает Полотно и с планшета. ПКМ по плитке открывает то же
 * меню и остаётся ускорителем для мыши.
 */
function BoardTile({
  board,
  settings,
  campaigns,
  onOpen,
  onChanged,
}: {
  board: FreeBoard;
  settings: { id: number; name: string }[];
  campaigns: { id: number; name: string }[];
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const title = board.name || "Без имени";
  const count = `${board.nodes} ${plural(board.nodes, "объект", "объекта", "объектов")}`;

  async function move(owner_type: string | null, owner_id: number | null) {
    await api.put(`/canvas/free-boards/${board.scope_id}/owner`, { owner_type, owner_id });
    onChanged();
  }

  async function archive() {
    // Подтверждение называет доску и её объём, но не пугает необратимостью:
    // «Удалить» здесь означает «в архив», откуда доска возвращается целиком.
    if (!confirm(`Убрать доску «${title}» в архив? На ней ${count}. Вернуть можно в разделе «Архив».`)) return;
    await api.del(`/canvas/free-boards/${board.scope_id}`);
    onChanged();
  }

  const items: ContextMenuItem[] = [
    { label: "Переименовать", onClick: () => setRenaming(board.name) },
    {
      label: "Переместить",
      children: [
        ...(board.owner_type ? [{ label: "Отвязать — доска станет ничьей", onClick: () => void move(null, null) }] : []),
        ...settings
          .filter((s) => !(board.owner_type === "setting" && board.owner_id === s.id))
          .map((s) => ({ label: `Сеттинг «${s.name}»`, onClick: () => void move("setting", s.id) })),
        ...campaigns
          .filter((c) => !(board.owner_type === "campaign" && board.owner_id === c.id))
          .map((c) => ({ label: `Кампания «${c.name}»`, onClick: () => void move("campaign", c.id) })),
      ],
    },
    { label: "Удалить (в архив)", danger: true, onClick: () => void archive() },
  ];

  return (
    <div
      className="card canvas-index__board"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {renaming === null ? (
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <button
            className="canvas-index__open"
            style={{ flex: 1, textAlign: "left" }}
            aria-label={`Доска «${title}», ${count}`}
            onClick={onOpen}
          >
            {title}
          </button>
          <button
            className="canvas-index__more"
            aria-label={`Действия с доской «${title}»`}
            title="Действия"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom });
            }}
          >
            ⋯
          </button>
        </div>
      ) : (
        // Имя правится строкой на месте, а не через prompt(): модальное окно
        // браузера здесь и уродливо, и не показывает, что именно правится.
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const name = renaming.trim();
            if (!name) return;
            await api.put(`/canvas/free-boards/${board.scope_id}`, { name });
            setRenaming(null);
            onChanged();
          }}
        >
          <input
            autoFocus
            aria-label="Название доски"
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" className="primary" disabled={!renaming.trim()}>OK</button>
          <button type="button" onClick={() => setRenaming(null)}>Отмена</button>
        </form>
      )}
      <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
        {count} · {new Date(board.created_at).toLocaleDateString()}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} title={title} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * «+ Приключение» и «+ Доска» у группы на экране выбора (блок D5).
 *
 * Слова «холст» в подписях нет намеренно (решение D0 §15): холста приключения
 * отдельно от приключения не существует, и через месяц никто не свяжет
 * «удалить холст» с тем, что стёрлись сцены со всей подготовкой.
 *
 * Заведённая отсюда доска сразу принадлежит группе, а не падает ничьей в «Мои
 * доски»: иначе Мастеру приходится тем же движением её перемещать, и смысл
 * кнопки «у сеттинга» теряется.
 *
 * Имя спрашивается формой на месте, а не `prompt()`: тот блокирует окно и в
 * части окружений просто не показывается — действие тихо не выполняется.
 */
function GroupAdd({
  ownerType,
  ownerId,
  settingId,
  onCreatedBoard,
  onCreatedArc,
}: {
  ownerType: "setting" | "campaign";
  ownerId: number;
  /** Сеттинг, в котором заводить приключение. У кампании — её сеттинг. */
  settingId: number | null;
  onCreatedBoard: (scopeId: number) => void;
  onCreatedArc: () => void;
}) {
  const [form, setForm] = useState<null | "arc" | "board">(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const label = ownerType === "campaign" ? "Приключение кампании" : "Приключение";

  function open(kind: "arc" | "board") {
    setForm(kind);
    setName("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      if (form === "board") {
        const created = await api.post<{ scope_id: number }>("/canvas/free-boards", {
          name: value,
          owner_type: ownerType,
          owner_id: ownerId,
        });
        setForm(null);
        onCreatedBoard(created.scope_id);
      } else {
        // Приключение кампании живёт ТОЛЬКО в ней и в заготовку сеттинга не
        // попадает (решение D0 §16). На экране выбора его поэтому не видно
        // вовсе — списки там про сеттинг, — и оставлять Мастера смотреть на
        // неизменившийся экран нельзя: уводим на карту, где узел уже стоит.
        await api.post("/story/arcs", {
          setting_id: settingId,
          name: value,
          kind: "adventure",
          ...(ownerType === "campaign" ? { campaign_id: ownerId } : {}),
        });
        setForm(null);
        onCreatedArc();
      }
    } finally {
      setBusy(false);
    }
  }

  if (form) {
    return (
      <form className="row" style={{ gap: 6 }} onSubmit={submit}>
        <input
          autoFocus
          autoComplete="off"
          aria-label={form === "board" ? "Название новой доски" : "Название нового приключения"}
          placeholder={form === "board" ? "Название доски" : "Название приключения"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setForm(null); }}
        />
        <button type="submit" className="primary" disabled={!name.trim() || busy}>
          {busy ? "Создаю…" : "Создать"}
        </button>
        <button type="button" onClick={() => setForm(null)}>Отмена</button>
      </form>
    );
  }

  return (
    <>
      {/* Приключение без сеттинга завести некуда: у кампании сеттинг может быть
          не проставлен, и кнопка тогда не показывается, а не падает ошибкой. */}
      {settingId != null && (
        <button className="canvas-index__map" onClick={() => open("arc")}>+ {label}</button>
      )}
      <button className="canvas-index__map" onClick={() => open("board")}>+ Доска</button>
    </>
  );
}

export function CanvasPage() {
  // Что открыто — в адресе, как окрестность у Графа связей: на холст ведут
  // ссылки со страниц приключений, и такую ссылку можно сохранить.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const settingId = Number(searchParams.get("setting")) || 0;
  const arcId = Number(searchParams.get("arc")) || 0;
  const campaignIdParam = Number(searchParams.get("campaign")) || 0;
  const freeId = Number(searchParams.get("free_id")) || 0;
  const focusParam = searchParams.get("focus") || "";
  // Схема сеттинга (блок D3): тот же `setting`, но со вторым взглядом.
  // Приключение открыто — значит смотрим его холст, а не схему, даже если
  // `view=map` остался в адресе от предыдущего шага.
  const settingMapId = !arcId && searchParams.get("view") === "map" ? settingId : 0;
  // Карта кампании (блок D4): тот же `view=map`, но у кампании. Приключение
  // открыто — значит смотрим его холст, а кампания на нём остаётся параметром
  // входа (Q26), а не своей доской.
  const campaignMapId = !arcId && searchParams.get("view") === "map" ? campaignIdParam : 0;

  const initialFitDone = useRef(false);

  const [settings, setSettings] = useState<Setting[]>([]);
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [board, setBoard] = useState<CanvasBoard | null>(null);

  // Календарь нужен ради дат на нодах событий: месяцы и эра живут в
  // сеттинге, и без них «1492-06-15» осталось бы машинной строкой.
  //
  // На карту кампании входят адресом `?campaign=N&view=map`, без `setting` —
  // и до блока G7 календарь там не грузился вовсе, а событие кампании,
  // положенное на карту, показывало машинную дату. Сеттинг берём у самой
  // кампании: сервер отдаёт его в `campaign_map`.
  const calendar = useSettingCalendar(settingId || board?.campaign_map?.setting_id || 0);
  const calendarRef = useRef<{ months: CalendarMonth[]; era: string }>({ months: [], era: "" });
  calendarRef.current = { months: calendar?.months ?? [], era: calendar?.era ?? "" };
  // Тихие подсказки (блок G1). Отдельным состоянием и отдельным запросом:
  // считать их внутри `GET /board` значило бы утроить время открытия холста
  // (142 мс против 54–91 мс на всю доску).
  const [hintsByScene, setHintsByScene] = useState<Map<number, SceneHint[]>>(() => new Map());
  /** Сколько подсказок внутри каждой главы (блок G6.2, Q22). Считает сервер:
   *  сцен главы на холсте приключения нет, и сложить их здесь не из чего. */
  const [chapterHints, setChapterHints] = useState<Map<number, number>>(() => new Map());
  // Заглушённое (находки Н13, Н14). Держим отдельно от подсказок: подсказка —
  // это то, что горит, а заглушка — то, что не горит намеренно, и список её
  // нужен ровно затем, чтобы её можно было снять.
  const [dismissed, setDismissed] = useState<DismissedHints>({ setting: [], scenes: [] });
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  /**
   * Режим репетиции (блок G3). Живёт ТОЛЬКО в памяти вкладки: прогон — это
   * взгляд Мастера в конкретную минуту, а не факт о приключении, и хранить его
   * значило бы завести состояние, которое кто-то потом увидит чужим.
   */
  const [rehearsalOn, setRehearsalOn] = useState(false);
  const [rehearsal, setRehearsal] = useState<RehearsalStep | null>(null);
  const [rehearsalBusy, setRehearsalBusy] = useState(false);
  const [rehearsalBack, setRehearsalBack] = useState<number[]>([]);
  /** Набор, который прогон поставил своей кнопкой, — чтобы вернуть прежнее. */
  const [rehearsalSetId, setRehearsalSetId] = useState<number | null>(null);
  // Тот же движок, что у пульта: второго проигрывателя в приложении быть не
  // должно, иначе за столом играет не то, что видно на экране. `Optional` —
  // потому что вынесенные окна рендерятся без AppShell, а значит и без него.
  const sound = useSoundEngineOptional();
  const [selectedCheckId, setSelectedCheckId] = useState<number | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<number | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<number | null>(null);
  // Ярлык приключения раньше свойств не имел: на свободной доске у него и
  // править нечего. На карте кампании есть — расхождение с сеттингом и состав
  // кампании (блок D4).
  const [selectedAdventureId, setSelectedAdventureId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [index, setIndex] = useState<CanvasIndex | null>(null);
  const [canvasTab, setCanvasTab] = useState<"campaigns" | "settings" | "boards">("campaigns");
  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem("canvasPropsCollapsed") === "1");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // Карточка существа (шаг 4 ревизии). Нода остаётся компактной, карточка —
  // поповер: 30+ карточек по 200 px это уже не схема. Координаты ЭКРАННЫЕ,
  // масштаб полотна на карточку не действует — на 40% именно в неё и лезут.
  const [creatureCard, setCreatureCard] = useState<{
    type: string;
    id: number;
    x: number;
    y: number;
  } | null>(null);
  const openCreatureCard = useCallback((type: string, id: number, anchor: DOMRect | null) => {
    const width = 300;
    const left = anchor ? Math.min(anchor.right + 8, window.innerWidth - width - 8) : 80;
    const top = anchor ? Math.min(anchor.top, window.innerHeight - 240) : 80;
    setCreatureCard({ type, id, x: Math.max(8, left), y: Math.max(8, top) });
  }, []);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [showCanvasWizard, setShowCanvasWizard] = useState(false);
  const [showOpenWizard, setShowOpenWizard] = useState(false);
  // Палитра закрыта по умолчанию: за столом холст нужен целиком, а пополняют
  // его в подготовке.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Полка перечитывается по этому счётчику. Без него галочка «на полку» в
  // свойствах меняла базу, а открытая рядом палитра продолжала показывать
  // старый список — и выглядело это как «галочка не сработала».
  const [shelfVersion, setShelfVersion] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Имя новой доски правится на месте, а не в системном prompt(). null — форма
  // закрыта. Причин две: prompt() блокирует окно и в части окружений просто не
  // показывается (действие тихо не выполняется), и он выпадает из оформления
  // раздела на самом видном его экране.
  const [newBoardName, setNewBoardName] = useState<string | null>(null);
  // Имя нового приключения со схемы сеттинга — тоже строкой на месте, а не в
  // prompt(): та же причина, что у имени доски (блок D3).
  const [newArcName, setNewArcName] = useState<string | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  // Стартовые наборы пустой доски (блок G5). Список приходит с сервера — там
  // же, где содержимое набора; какой набор сейчас ставится, помним отдельно,
  // чтобы «Ставлю…» встало на нажатую кнопку, а не на все три.
  const [presets, setPresets] = useState<{ key: string; label: string }[]>([]);
  const [startingPreset, setStartingPreset] = useState<string | null>(null);
  // Холсту тесно: палитра и поиск не помещаются рядом (CANVAS_OVERLAYS_MIN_PX).
  const flowElRef = useRef<HTMLDivElement | null>(null);
  const [overlaysTight, setOverlaysTight] = useState(false);
  /**
   * Что только что создано (блок G2).
   *
   * Ключ ноды (`frame:36`, `chapter:41`), а не число: подсветка нужна и
   * рамке, и главе, а их нумерации лежат в разных таблицах и один и тот же
   * `id` значит в них разное.
   *
   * `edit` — открывать ли поле имени сразу. У рамки да: имя ей никто не
   * давал, оно всегда «Группа». У главы из визарда нет — имя Мастер только
   * что набрал сам, и поле поверх набранного было бы шумом.
   */
  const [fresh, setFresh] = useState<{ key: string; edit: boolean } | null>(null);
  // Глава, в которую упадёт сцена, если отпустить сейчас. null — либо тащат не
  // сцену, либо центр над её же главой: подсвечиваем только настоящий перенос.
  const [dropChapter, setDropChapter] = useState<number | null>(null);
  const dropChapterRef = useRef<number | null>(null);
  dropChapterRef.current = dropChapter;
  const flowRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const historyRef = useRef<LayoutSnapshot[]>([]);
  const redoRef = useRef<LayoutSnapshot[]>([]);
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

  // Экран выбора берёт всё одним запросом: свои доски и приключения по
  // сеттингам. Девять запросов «дай приключения этого сеттинга» — это девять
  // кругов за экран, который открывают первым.
  const reloadIndex = useCallback(() => {
    api.get<CanvasIndex>("/canvas/index").then(setIndex);
  }, []);

  // Раскладка досок по владельцам для экрана выбора (блок D2).
  //
  // Доска, чей владелец не нашёлся, показывается среди ничьих, а не пропадает:
  // сеттинг или кампанию могли заархивировать уже после привязки, и тогда
  // доска исчезла бы с экрана целиком — при живых данных в базе. При записи
  // владелец проверяется (`readOwner` на сервере), но это защищает только
  // момент привязки, а не всё, что случится с владельцем потом.
  const boardsOfSetting = useCallback(
    (settingId: number) =>
      (index?.free ?? []).filter((b) => b.owner_type === "setting" && b.owner_id === settingId),
    [index]
  );
  const campaignGroups = useMemo(() => {
    if (!index) return [];
    return index.campaigns
      .map((c) => ({
        ...c,
        boards: index.free.filter((b) => b.owner_type === "campaign" && b.owner_id === c.id),
      }))
      .filter((c) => c.boards.length > 0);
  }, [index]);
  const ownerlessBoards = useMemo(() => {
    if (!index) return [];
    const settingIds = new Set(index.all_settings.map((s) => s.id));
    const campaignIds = new Set(index.campaigns.map((c) => c.id));
    return index.free.filter(
      (b) =>
        !b.owner_type ||
        (b.owner_type === "setting" && !settingIds.has(b.owner_id ?? 0)) ||
        (b.owner_type === "campaign" && !campaignIds.has(b.owner_id ?? 0))
    );
  }, [index]);
  useEffect(() => {
    if (!arcId && !freeId) reloadIndex();
  }, [arcId, freeId, reloadIndex]);

  useEffect(() => {
    localStorage.setItem("canvasPropsCollapsed", panelCollapsed ? "1" : "0");
  }, [panelCollapsed]);

  // Через ref, а не через зависимость: обработчик «вытащить состав» знает
  // позицию ноды, то есть меняется на каждое перетаскивание, и держать его в
  // зависимостях loadBoard значило бы перезагружать холст при каждом сдвиге.
  const pullCastRef = useRef<(sceneId: number) => void>(() => {});
  const addCheckRef = useRef<(sceneId: number) => void>(() => {});
  const enterChapterRef = useRef<(arcId: number) => void>(() => {});
  const toggleFrameRef = useRef<(frameId: number, collapsed: boolean) => void>(() => {});
  const openOutsideRef = useRef<(link: OutsideLink) => void>(() => {});
  const renameFrameRef = useRef<(frameId: number, name: string) => void>(() => {});
  const renameChapterRef = useRef<(arcId: number, name: string) => void>(() => {});
  const openHintsRef = useRef<(sceneId: number, x: number, y: number) => void>(() => {});

  // Какую доску грузить — решает только адрес холста. focus сюда НЕ входит:
  // он говорит, какую ноду выделить, а не какую доску показать. Пока он был
  // в зависимостях, каждый клик по ноде писал focus в адрес и тем самым
  // перезагружал всю схему — запрос к серверу и пересборка всех нод на
  // выделение одной.
  const focusRef = useRef(focusParam);
  focusRef.current = focusParam;

  // Какой `focus` уже применён к выделению. Эффект ниже гоняется и на правке
  // `board` (например, `loadBoard` после сохранения), а повторно навязывать
  // фокус там — это схлопывать Ctrl-мультивыбор до одной ноды: он `focus` в
  // адрес не пишет, и он всё ещё указывает на последний единичный клик.
  const appliedFocusRef = useRef<string | null>(null);

  // Видов доски три: свободная, холст приключения и схема сеттинга (блок D3).
  // Кампания — не свой вид доски, а путь входа: тот же холст приключения, но
  // с её правками (Q26).
  //
  // Схема отличается от списка одним параметром адреса, а не своим маршрутом:
  // «Список / Схема» — это два взгляда на один сеттинг, и ссылка на схему
  // должна отличаться от ссылки на список ровно этим.
  const boardUrl = useMemo(() => {
    if (freeId) return `/canvas/board?free_id=${freeId}`;
    if (arcId) return `/canvas/board?arc_id=${arcId}${campaignIdParam ? `&campaign_id=${campaignIdParam}` : ""}`;
    if (campaignMapId) return `/canvas/board?campaign_id=${campaignMapId}`;
    if (settingMapId) return `/canvas/board?setting_id=${settingMapId}`;
    return null;
  }, [freeId, arcId, campaignIdParam, settingMapId, campaignMapId]);

  const loadBoard = useCallback(() => {
    if (!boardUrl) {
      setBoard(null);
      setNodes([]);
      return;
    }
    api.get<CanvasBoard>(boardUrl).then((b) => {
      setBoard(b);
      setThreads(b.threads ?? []);
      // Нода, на которую пришли по ссылке и которую ещё не двигали, крепится
      // сразу: у scheduleSave задержка в 500 мс, и после перезагрузки фокус
      // уехал бы на другое место. Только на загрузке — клик по такой же ноде
      // писать в базу не должен.
      const focus = focusRef.current;
      if (focus && arcId) {
        const focused = b.nodes.find((n) => n.key === focus);
        if (focused && !focused.placed) {
          api.put("/canvas/board/nodes", {
            arc_id: arcId,
            nodes: [{ node_type: focused.node_type, node_id: focused.node_id, x: Math.round(focused.x), y: Math.round(focused.y) }],
          });
        }
      }
    });
  }, [boardUrl, arcId]);

  /**
   * Полный пересчёт подсказок. Дёргается ТОЛЬКО при открытии доски и по
   * нажатию на счётчик: правка, сделанная на холсте, гасит свой чип на месте,
   * без запроса. Пересчёт на каждую правку — это 142 мс на каждое
   * перетаскивание, то есть возврат к тому, от чего уходили в шаге 2.
   */
  const reloadHints = useCallback((b: CanvasBoard | null) => {
    const ids = (b?.nodes ?? []).filter((n) => n.node_type === "scene").map((n) => n.node_id);
    // Приключение спрашивает ещё и сводку по своим главам: их сцены сюда не
    // приезжают, а счётчик на узле главы без неё был бы всегда нулевым.
    const chaptersOf = b?.nodes.some((n) => n.node_type === "chapter") ? b?.arc?.id ?? 0 : 0;
    if (ids.length === 0 && !chaptersOf) {
      setHintsByScene(new Map());
      setChapterHints(new Map());
      return;
    }
    api
      .get<SceneHintsResponse>(
        `/canvas/hints?ids=${ids.join(",")}${chaptersOf ? `&chapters_of=${chaptersOf}` : ""}`
      )
      .then((r) => {
        setHintsByScene(new Map(r.scenes.map((s) => [s.scene_id, s.hints])));
        setChapterHints(new Map((r.chapters ?? []).map((c) => [c.arc_id, c.count])));
      })
      .catch(() => {
        setHintsByScene(new Map());
        setChapterHints(new Map());
      });
    if (ids.length === 0) return;
    const setting = b?.arc?.setting_id ?? b?.setting?.id ?? null;
    api
      .get<DismissedHints>(`/canvas/hints/dismissed?ids=${ids.join(",")}${setting ? `&setting_id=${setting}` : ""}`)
      .then(setDismissed)
      .catch(() => setDismissed({ setting: [], scenes: [] }));
  }, []);

  // Пересчёт — когда меняется НАБОР сцен на доске, а не когда меняется объект
  // доски. Правки холста зовут `loadBoard()` десятком путей, и пересчёт на
  // каждую стоил бы 142 мс на перетаскивание ноды — ровно та цена, от которой
  // уходили в шаге 2. Сцену добавили или убрали — пересчитываем; всё
  // остальное гасится на месте (`extinguishHint`).
  //
  // Ключ считает и ГЛАВЫ, а не одни сцены (блок G6.2). На холсте приключения
  // сцен теперь нет вовсе, и ключ из одних сцен оставался пустой строкой от
  // монтирования до приезда доски — то есть не менялся, эффект не срабатывал,
  // и счётчик подсказок на узлах глав молчал навсегда. Нашлось проверкой:
  // сервер считал верно, запроса не было ни одного.
  const sceneSetKey = useMemo(
    () =>
      (board?.nodes ?? [])
        .filter((n) => n.node_type === "scene" || n.node_type === "chapter")
        .map((n) => `${n.node_type}:${n.node_id}`)
        .sort()
        .join(","),
    [board]
  );
  useEffect(() => {
    reloadHints(boardRef.current);
  }, [sceneSetKey, reloadHints]);

  /**
   * Заметность созданного (блок G2): привезти к новой рамке глаз и погасить
   * отметку. Сама отметка (`isFresh`/`autoEdit`) ставится не здесь, а в
   * сборке нод: ноды перестраивает и календарь, и приезд подсказок, а
   * переносится со старых нод только выделение — флаг в `data`, поставленный
   * отдельным `setNodes`, первая же пересборка стёрла бы. Тот же урок, что с
   * переносом выделения в блоке G1.
   *
   * Зависимость от `board` нужна для второго случая — когда создание заодно
   * меняет доску (новая глава из визарда): на момент первого срабатывания
   * ноды ещё старые и цели в них нет.
   */
  useEffect(() => {
    if (!fresh) return;
    // Нода ищется внутри таймера, а не снаружи: этот эффект объявлен раньше
    // сборки нод, и в том же кадре `nodesRef` ещё старый.
    const pan = setTimeout(() => {
      const target = nodesRef.current.find((n) => n.id === fresh.key);
      if (!target) return;
      const own = dataSize(target.data);
      const abs = toAbsolute(target, new Map(nodesRef.current.map((n) => [n.id, n])));
      flowRef.current?.setCenter(abs.x + (own.w ?? 320) / 2, abs.y + (own.h ?? 240) / 2, { zoom: 0.9, duration: 420 });
    }, 80);
    const off = setTimeout(() => setFresh(null), 2200);
    return () => { clearTimeout(pan); clearTimeout(off); };
  }, [fresh, board]);

  useEffect(() => {
    initialFitDone.current = false;
  }, [freeId, arcId, campaignIdParam]);
  useEffect(loadBoard, [loadBoard]);

  // Ноды выводятся из доски, а не собираются заново в каждой ветке загрузки.
  // Календарь приезжает отдельным запросом и позже холста — раньше ради него
  // доску перезагружали целиком, то есть каждое открытие холста стоило двух
  // запросов. Пересобрать ноды достаточно: даты событий берутся из
  // calendarRef, сети это не касается.
  useEffect(() => {
    if (!board) {
      setNodes([]);
      return;
    }
    // Число сцен главы считает сервер: на этот холст они не приезжают
    // (блок G6.2). Подсказки — тоже, отдельным запросом `chapters_of`.
    //
    // А вот содержимое свободной рамки считается здесь, одним проходом: оно
    // и так лежит на доске, и второй запрос ради одного числа не нужен
    // (блок G6.3).
    const insideByFrame = new Map<string, number>();
    for (const n of board.nodes) {
      const p = n.parent_key;
      if (p) insideByFrame.set(p, (insideByFrame.get(p) ?? 0) + 1);
    }
    const nextNodes = applyParenting(
      [
        // Свободные рамки — раньше содержимого, по двойной
        // причине: React Flow требует родителя раньше детей, а порядком в
        // массиве задаётся и слой. Раньше рамки приезжали вперемешку с
        // нодами и ложились поверх своего же содержимого.
        ...[...board.nodes]
          .sort((a, b) => (a.node_type === "frame" ? 0 : 1) - (b.node_type === "frame" ? 0 : 1))
          .map((n) =>
            n.node_type === "chapter"
              ? toChapterNode(n, chapterHints.get(n.chapter.id) ?? 0, enterChapterRef.current, renameChapterRef.current)
              : toFlowNode(n, hintsByScene, openOutsideRef.current, openHintsRef.current, pullCastRef.current, addCheckRef.current, calendarRef.current.months, calendarRef.current.era, renameFrameRef.current, toggleFrameRef.current, insideByFrame.get(n.key) ?? 0, board.setting != null || board.campaign_map != null)
          ),
      ],
      board
    );
    // Выделение переносится со старых нод на новые.
    //
    // Оно живёт в самих нодах (так его держит React Flow), а пересобираются
    // они не только при смене доски: ноды перестраивает и календарь, и приезд
    // подсказок. Без переноса любая такая пересборка снимала выделение — и
    // прыжок «к следующей недоделке» подсвечивал ноду ровно до того мига,
    // пока не придёт пересчёт.
    const selectedIds = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
    let out = selectedIds.size ? nextNodes.map((n) => (selectedIds.has(n.id) ? { ...n, selected: true } : n)) : nextNodes;
    // Только что созданное — выделено и помечено здесь же (блок G2): флаг
    // живёт ровно столько, сколько стоит `freshKey`, и пересборка нод его не
    // теряет.
    // Выделение при этом исключительное: два выделенных узла React Flow не
    // удерживает, и выделение доставалось прежнему, а не новому.
    if (fresh) out = out.map((n) => (n.id === fresh.key ? { ...n, selected: true, data: { ...n.data, isFresh: true, autoEdit: fresh.edit } } : n.selected ? { ...n, selected: false } : n));
    // Текущая сцена прогона (блок G3). Помечается здесь же, а не отдельным
    // проходом: ноды пересобирает и разворот главы, которым прогон и ходит, —
    // без этого подсветка гасла бы ровно на том шаге, где нужна.
    const rehearsingId = rehearsalRef.current.step?.preview.scene.id ?? null;
    if (rehearsingId != null) {
      const key = `scene:${rehearsingId}`;
      out = out.map((n) => (n.id === key ? { ...n, data: { ...n.data, isRehearsing: true } } : n));
    }
    setNodes(out);
    if (!initialFitDone.current && nextNodes.length) {
      initialFitDone.current = true;
      fitWhenMeasured(flowRef);
    }
  }, [board, calendar, hintsByScene, chapterHints, fresh, rehearsal]);

  // focus из адреса — что выделить. Клик по ноде выделяет сам и попутно
  // пишет focus в адрес; этот эффект нужен для второго случая — когда адрес
  // меняется снаружи: переход по ссылке со страницы сцены или приключения,
  // «назад» в истории браузера.
  useEffect(() => {
    if (!board || !focusParam) return;
    const [ft, fid] = splitKey(focusParam);
    const id = Number(fid) || null;
    setSelectedSceneId(ft === "scene" ? id : null);
    setSelectedCheckId(ft === "check" ? id : null);
    setSelectedStickerId(ft === "sticker" ? id : null);
    setSelectedFrameId(ft === "frame" ? id : null);
    setSelectedChapterId(ft === "chapter" ? id : null);
    setSelectedPinId(ft === "pin" ? id : null);
    setSelectedRouteId(ft === "route" ? id : null);
    // Подсветить саму ноду, а не только открыть панель: придя по ссылке на
    // схему из семидесяти узлов, мастер должен увидеть, о котором речь.
    // Выделение React Flow держит в самих нодах, поэтому ставим его там.
    // Ноды, у которых состояние уже верное, возвращаются как есть — иначе
    // каждый переход фокуса пересоздавал бы весь массив.
    //
    // Навязываем выделение только когда `focus` действительно изменился
    // (переход по ссылке, «назад»). Тот же эффект гоняется на правке `board`,
    // и там переопределять `selected` нельзя — Ctrl-мультивыбор `focus` в
    // адрес не пишет, и сводить его обратно к одной ноде фокуса значит
    // схлопывать выделение на любом обновлении доски (Ш1).
    if (appliedFocusRef.current !== focusParam) {
      appliedFocusRef.current = focusParam;
      setNodes((cur) =>
        cur.every((n) => !!n.selected === (n.id === focusParam))
          ? cur
          : cur.map((n) => (!!n.selected === (n.id === focusParam) ? n : { ...n, selected: n.id === focusParam }))
      );
    }
  }, [board, focusParam]);

  // Рёбра держим состоянием, а не выводим из board на лету: React Flow — это
  // управляемый компонент, и без onEdgesChange он не считает набор рёбер
  // живым (выделение и удаление до него не доходят, а вместе с ними и сама
  // отрисовка).
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [threads, setThreads] = useState<CanvasThread[]>([]);

  /**
   * Доска пуста — на ней нет ни узла, ни нити (блок G5).
   *
   * Считается по ответу сервера, а не по `nodes`: в `nodes` лежат узлы React
   * Flow, и они же собираются заново при каждой правке. Ответ доски — то же
   * состояние, что видит сервер, и оно не зависит от того, что сейчас
   * скрыто свёрткой.
   */
  const boardEmpty = (board?.nodes.length ?? 0) === 0 && threads.length === 0;

  // Список наборов нужен только пустой свободной доске — там его и просим.
  useEffect(() => {
    if (!freeId || !boardEmpty || presets.length) return;
    api.get<{ key: string; label: string }[]>("/canvas/presets").then(setPresets);
  }, [freeId, boardEmpty, presets.length]);

  useEffect(() => {
    // Конец ребра, спрятанный в свёрнутой главе, переезжает на её карточку.
    const host = board ? collapsedHost(board) : (id: string) => id;
    setEdges([
      ...(board?.edges ?? []).flatMap((e): Edge[] => {
      const source = host(e.source);
      const target = host(e.target);
      // Оба конца в одной и той же свёрнутой главе — её внутреннее дело.
      if (source === target) return [];
      return [{
        id: e.id,
        source,
        target,
        // У карточки главы хендл один и без имени: имя входа принадлежит
        // спрятанной сцене, а не главе. Для рераут-сегментов разъёмы маршрута
        // именованные (route-in/route-out-<to_key>), так что цепляемся точно;
        // у хаба с N выходами — по совпавшему выходу, иначе в первый. Конец на
        // реальной ноде держим по её входу.
        sourceHandle: source.startsWith("route:")
          ? (routeOutHandle(e.source, target, board?.routes) ?? "route-out")
          : undefined,
        targetHandle: target.startsWith("route:")
          ? "route-in"
          : (target === e.target && e.target_handle ? e.target_handle : null),
        // «Стаканчик» с условием на сегментах разорванного маршрутом ребра не
        // рисуем: текст условия уезжает в тело самого рераута (пока он
        // существует). Разрыв опознаём по суффиксу `::r<N>` в id сегмента —
        // его подставляет routedEdges на сервере.
        label: e.id.includes("::r") ? undefined : (e.label || undefined),
        style: e.width ? { stroke: e.color, strokeWidth: e.width } : undefined,
        markerEnd: e.kind === "thread" ? undefined : EDGE_MARKER,
        // Вид ребра — классом, а не цветом: в палитре ровно три цвета.
        // Исход проверки пунктиром (ведёт туда же, но по броску, а не по
        // решению), состав — тонкой линией: это не ход истории, а из чего
        // сцена собрана. На чёрно-белой печати различие остаётся.
        className: EDGE_CLASS[e.kind],
        selectable: true,
        deletable: true,
      }];
      }),

      ...(threads ?? []).map((th): Edge => ({
        id: `thread:${th.id}`,
        source: `pin:${th.from_pin_id}`,
        target: `pin:${th.to_pin_id}`,
        sourceHandle: "pin",
        targetHandle: "pin",
        type: "straight",
        style: { stroke: th.color, strokeWidth: th.width, vectorEffect: "non-scaling-stroke" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: th.color },
        className: "canvas-edge--thread",
        selectable: true,
        deletable: true,
      })),

    ]);
  }, [board, threads, setEdges]);

  /**
   * Подпись под тулбаром: сколько тут материала.
   *
   * Раньше считались `board.nodes.length` и `board.edges.length` целиком, а в
   * них попадает то, чего Мастер за узел и переход не считает: рамки и пины —
   * разметка доски, а рёбра «сцена → проверка», «состав сцены», «участие в
   * наборе» и нити между пинами — не ход истории. На живом приключении это
   * давало «71 узел · 44 перехода» при 31 сцене и 8 переходах.
   *
   * Показываем не устройство доски, а то, чем меряют подготовку: главы, сцены
   * и переходы. Переход — это «куда история идёт дальше», поэтому исход
   * проверки считается наравне с переходом между сценами: первый ведёт по
   * броску, второй по решению, но оба ведут. На свободной доске ни глав, ни
   * сцен нет — там мерой служит число объектов.
   *
   * Пустые части не показываются вовсе (инвариант 11), поэтому это массив, а
   * не строка с прочерками.
   */
  const boardCounts = useMemo(() => {
    if (!board) return [];
    const chapters = board.nodes.filter((n) => n.node_type === "chapter").length;
    const scenes = board.nodes.filter((n) => n.node_type === "scene").length;
    const moves = board.edges.filter((e) => e.kind === "transition" || e.kind === "outcome").length;
    const parts: string[] = [];
    if (chapters) parts.push(`${chapters} ${plural(chapters, "глава", "главы", "глав")}`);
    if (scenes) parts.push(`${scenes} ${plural(scenes, "сцена", "сцены", "сцен")}`);
    if (moves) parts.push(`${moves} ${plural(moves, "переход", "перехода", "переходов")}`);
    if (!chapters && !scenes) {
      // Рамка — контейнер, пин — метка на доске; ни то, ни другое не объект,
      // ради которого доску завели.
      const objects = board.nodes.filter((n) => n.node_type !== "frame" && n.node_type !== "pin").length;
      if (objects) parts.unshift(`${objects} ${plural(objects, "объект", "объекта", "объектов")}`);
    }
    return parts;
  }, [board]);

  // Раскладка сохраняется пачкой и с задержкой: перетаскивание рождает
  // событие на каждый кадр, и запрос на кадр превратил бы один жест в сотню
  // записей в базу. Для фриформ/кампании arcId=0, используем board_id (Q1 а).
  const saveTimer = useRef<number | null>(null);
  /**
   * Поколение раскладки (блок G6.2).
   *
   * Сцена, брошенная на узел другой главы, уезжает на холст своей новой главы
   * — место ей переносит сервер. Но раскладка сохраняется ПАЧКОЙ и с
   * задержкой, и отложенная запись, взведённая ДО переноса, дописывала сцену
   * обратно на доску приключения: строка оказывалась в двух местах разом, а на
   * холсте главы место сцены пропадало.
   *
   * Снимать таймер оказалось мало: `onNodesChange` взводит его на том же
   * жесте, и порядок между ним и `onNodeDragStop` не гарантирован. Вычёркивать
   * уехавших из полезной нагрузки — тоже: список чистила перезагрузка доски,
   * которая успевала пройти раньше срабатывания таймера.
   *
   * Поколение от порядка не зависит: перенос увеличивает счётчик, и любая
   * запись, задуманная в прежнем поколении, молча отменяется.
   */
  const saveGen = useRef(0);
  /**
   * Пока идёт перенос сцены на другой холст, раскладка этой доски не пишется.
   *
   * Одного поколения не хватило: `onNodesChange` взводит отложенную запись на
   * том же жесте и ПОСЛЕ `onNodeDragStop` — то есть уже в новом поколении, с
   * массивом нод, где уехавшая сцена ещё есть. Флаг снимается перезагрузкой
   * доски, после которой сцены здесь уже нет и записывать нечего.
   */
  const savePaused = useRef(false);
  /** Прогон в ref — чтобы слушатель клавиатуры не переподписывался на каждый шаг. */
  const rehearsalRef = useRef<{ on: boolean; step: RehearsalStep | null }>({ on: false, step: null });
  const stopRehearsalRef = useRef<() => void>(() => {});
  const backRehearsalRef = useRef<() => void>(() => {});
  const stepRehearsalRef = useRef<(sceneId: number) => void>(() => {});
  const boardRef = useRef<CanvasBoard | null>(null);
  boardRef.current = board;

  /**
   * Вернуть передвинутые позиции в доску.
   *
   * Ноды выводятся из `board`, а перетаскивание меняло только базу и
   * состояние React Flow. Пока ноды никто не пересобирал, это сходило с
   * рук: доску перечитывали с сервера, и там лежали уже новые координаты. Со
   * свёрткой появился первый пересбор БЕЗ запроса — и весь холст откатывался к
   * тому, как лежал при открытии: главы, разложенные руками, вставали в тот самый
   * столбик, которым их выдаёт сервер при первом показе.
   *
   * Правим на месте, без `setBoard`: новый объект доски пересобрал бы ноды
   * на каждое перетаскивание и сбросил выделение только что передвинутой ноды.
   * `board` здесь — кэш серверного состояния, и правка идёт рука об руку с PUT.
   */
  const commitPositions = useCallback((next: Node<CanvasNodeData>[]) => {
    const b = boardRef.current;
    if (!b) return;
    const byId = new Map(next.map((n) => [n.id, n]));
    // Отдельного цикла по рамкам глав больше нет: узел главы лежит в
    // `board.nodes` наравне с прочими и попадает в общий проход (блок G6.2).
    for (const n of b.nodes) {
      const node = byId.get(n.key);
      if (!node) continue;
      const abs = toAbsolute(node, byId);
      n.x = Math.round(abs.x);
      n.y = Math.round(abs.y);
    }
  }, []);

  /**
   * Свёртка главы.
   *
   * Состояние лежит в базе, а не в памяти вкладки: разложенный холст — работа
   * Мастера, и перезагрузка страницы не должна её разворачивать обратно (Q8).
   * Доску после ответа не перечитываем: переключатель меняет ровно одно поле,
   * и новый ответ в 34 КБ ради него — тот самый лишний круг, что убрал шаг 1.
   */
  /**
   * Войти в главу — открыть её холст (блок G6.2).
   *
   * Своего вида доски у главы нет: она такая же строка `story_arcs`, и адрес
   * у неё тот же, что у приключения. Кампания входа едет с ней — иначе шаг
   * внутрь молча возвращал бы к заготовке сеттинга.
   */
  const enterChapter = useCallback(
    (chapterArcId: number) => {
      const next: Record<string, string> = { setting: String(settingId), arc: String(chapterArcId) };
      if (campaignIdParam) next.campaign = String(campaignIdParam);
      setSearchParams(next);
    },
    [settingId, campaignIdParam, setSearchParams]
  );
  enterChapterRef.current = enterChapter;

  /**
   * Уехать по висящему разъёму на холст чужой сцены (решение Q17).
   *
   * Адрес — тот же, что у входа в главу, плюс `focus` на самой сцене: иначе
   * Мастер приезжает на чужой холст и ищет глазами, ради чего приехал.
   * Кампания входа едет с ним по той же причине, по какой едет во вход.
   */
  const openOutside = useCallback(
    (link: OutsideLink) => {
      const next: Record<string, string> = {
        setting: String(link.setting_id || settingId),
        arc: String(link.board_arc_id),
        focus: `scene:${link.scene_id}`,
      };
      if (campaignIdParam) next.campaign = String(campaignIdParam);
      setSearchParams(next);
    },
    [settingId, campaignIdParam, setSearchParams]
  );
  openOutsideRef.current = openOutside;

  /**
   * Переименование на месте. Обе ветки ходят на сервер и перечитывают доску,
   * а не правят имя только в своей ноде: имя приезжает из `board`, и первая
   * же пересборка нод (календарь, подсказки) вернула бы старое.
   *
   * У главы правится `story_arcs.name` — это запись, а не подпись на холсте
   * (`PUT /canvas/groups/:arcId` делает это первым же запросом). У свободной
   * рамки записи за именем нет, правится сама рамка.
   */
  const renameFrame = useCallback(async (frameId: number, name: string) => {
    await api.put(`/canvas/frames/${frameId}`, { name });
    loadBoard();
  }, [loadBoard]);

  /**
   * Свернуть или развернуть рамку (блок G6.3).
   *
   * Правим доску в памяти рука об руку с запросом и НЕ перечитываем её: меняется
   * ровно одно поле, а ответ на всю доску ради него — тот самый лишний круг,
   * который убрал шаг 1. Функциональное обновление, а не новый объект из
   * замыкания: два щелчка по разным рамкам в одном кадре читали бы одну доску,
   * и второй затёр бы первый — тот же урок, что был у свёртки главы.
   *
   * `w/h` не шлём вовсе: они относятся к развёрнутому виду и свёртку обязаны
   * пережить нетронутыми.
   */
  const toggleFrame = useCallback((frameId: number, collapsed: boolean) => {
    setBoard((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.node_type === "frame" && n.node_id === frameId
                ? { ...n, frame: { ...n.frame, collapsed } }
                : n
            ),
          }
        : prev
    );
    api.put(`/canvas/frames/${frameId}`, { collapsed });
  }, []);
  toggleFrameRef.current = toggleFrame;
  const renameChapter = useCallback(async (arcId: number, name: string) => {
    if (!board?.board_id) return;
    await api.put(`/canvas/groups/${arcId}`, { board_id: board.board_id, name });
    loadBoard();
  }, [board, loadBoard]);
  renameFrameRef.current = renameFrame;
  renameChapterRef.current = renameChapter;
  /**
   * Чем назвать доску в запросе. У холста приключения и свободной доски это
   * `board_id`, а у схемы сеттинга и карты кампании строки доски может ещё не
   * быть вовсе: `GET /canvas/board` там не пишет (блоки D3, D4), и доска
   * рождается от первого сохранения. Тогда называем владельца, и сервер
   * заводит её сам — тем же путём, каким это делает `scheduleSave`.
   */
  const boardTarget = useMemo(
    () =>
      board?.board_id
        ? { board_id: board.board_id }
        : board?.setting
          ? { setting_id: board.setting.id }
          : board?.campaign_map
            ? { campaign_id: board.campaign_map.id }
            : { arc_id: arcId },
    [board, arcId]
  );

  const scheduleSave = useCallback(
    (next: Node<CanvasNodeData>[]) => {
      const b = boardRef.current;
      // У схемы сеттинга строки доски может ещё не быть: `GET /canvas/board`
      // её не заводит (блок D3). Тогда шлём `setting_id`, и доска родится от
      // первого же сохранения — а полученный `board_id` кладём в доску, чтобы
      // следующие сохранения шли обычным путём.
      if (!b?.board_id && !b?.setting && !b?.campaign_map) return;
      if (savePaused.current) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const gen = saveGen.current;
      saveTimer.current = window.setTimeout(() => {
        // Раскладка, задуманная до переноса сцены на другой холст, устарела.
        if (gen !== saveGen.current) return;
        // В базу уходят АБСОЛЮТНЫЕ координаты (Q15). У ноды внутри главы
        // position отсчитывается от рамки — здесь это разворачивается назад.
        const byId = new Map(next.map((n) => [n.id, n]));
        commitPositions(next);
        void api.put<{ board_id: number }>("/canvas/board/nodes", {
          ...(b.board_id
            ? { board_id: b.board_id }
            : b.setting
              ? { setting_id: b.setting.id }
              : { campaign_id: b.campaign_map?.id }),
          nodes: next.filter((n) => !isFrame(n.id)).map((n) => {
            const [nodeType, nodeId] = splitKey(n.id);
            const abs = toAbsolute(n, byId);
            return {
              node_type: nodeType,
              node_id: nodeId,
              x: Math.round(abs.x),
              y: Math.round(abs.y),
              z_index: n.zIndex ?? 0,
            };
          }),
        }).then((res) => {
          if (!boardRef.current?.board_id && res?.board_id) {
            setBoard((prev) => (prev && !prev.board_id ? { ...prev, board_id: res.board_id } : prev));
          }
        });
      }, 500);
    },
    [commitPositions]
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

  // Новая рамка выбирается и открывает поле имени сразу (см. createGroup),
  // пин — тем же жестом (П2.8): свежий пин попадает в панель свойств с
  // автофокусом на «Имя». `fresh`+`edit` гаснут через 2.2 с, и повторный
  // щелчок по пину редактирование сам по себе не открывает.
  function openPinNameEditor(id: number) {
    setSelectedPinId(id);
    setSelectedChapterId(null);
    setSelectedSceneId(null);
    setSelectedCheckId(null);
    setSelectedStickerId(null);
    setSelectedFrameId(null);
    loadBoard();
    setTimeout(() => setFresh({ key: `pin:${id}`, edit: true }), 400);
  }

  // Кого рамка тащит за собой. Состав считается ОДИН раз, в момент захвата:
  // пересчитывать его на каждом кадре значит терять по дороге сцену, которая
  // на полпути вышла за край рамки, — и половина главы осталась бы позади.
  const nodesRef = useRef<Node<CanvasNodeData>[]>([]);
  nodesRef.current = nodes;

  // undo/redo — раскладка и принадлежность сцен главам, больше ничего
  const snapshot = useCallback(
    (): LayoutSnapshot => ({
      nodes: nodesRef.current.map((n) => ({ ...n, position: { ...n.position } })),
      arcs: new Map(
        (boardRef.current?.nodes ?? [])
          .filter((n) => n.node_type === "scene")
          .map((n) => [n.node_id, n.scene.arc_id] as [number, number | null])
      ),
      parentKeys: new Map(
        (boardRef.current?.nodes ?? [])
          .filter((n) => n.node_type !== "frame")
          .map((n) => [n.key, n.parent_key ?? null] as [string, string | null])
      ),
    }),
    []
  );
  const restoreSnapshot = useCallback(
    (snap: LayoutSnapshot) => {
      const b = boardRef.current;
      // Свободную рамку и пин `scheduleSave` не отправляет: их место — истина
      // СВОЕЙ таблицы (`canvas_frames`, `canvas_pins`), а `PUT /canvas/board/nodes`
      // пишет только `canvas_nodes`. Без этого цикла отмена возвращала их на
      // экране и не возвращала в базе: пока рамка непустая, обман незаметен —
      // сервер всё равно обнимает ею содержимое; у пустой рамки своя строка
      // единственный источник места, и перезагрузка возвращала её туда, откуда
      // её только что отменили.
      const byId = new Map(snap.nodes.map((n) => [n.id, n]));
      const nowById = new Map(nodesRef.current.map((n) => [n.id, n]));
      for (const n of snap.nodes) {
        const [t, id] = splitKey(n.id);
        // Глава отсюда ушла вместе с рамкой (блок G6.2): её место лежит в
        // `canvas_nodes`, и возвращает его общая запись в конце функции.
        if (t !== "frame" && t !== "pin") continue;
        const cur = nowById.get(n.id);
        if (!cur) continue;
        const was = toAbsolute(n, byId);
        const is = toAbsolute(cur, nowById);
        const x = Math.round(was.x);
        const y = Math.round(was.y);
        // Отмена, ничего не менявшая для этой ноды, и запросов не делает.
        if (Math.round(is.x) === x && Math.round(is.y) === y) continue;
        if (t === "frame") api.put(`/canvas/frames/${id}`, { x, y });
        else api.put(`/canvas/pins/${id}`, { x, y });
      }
      commitPositions(snap.nodes);
      /**
       * Возврат сцены в прежнюю главу.
       *
       * Перебираем СНИМОК, а не ноды текущей доски (блок G6.2). Раньше хватало
       * нод: главы были рамками на одном холсте, и сцена никуда с него не
       * девалась. Теперь перенос уводит её на холст своей главы — по нодам
       * доски её уже не найти, и отмена молча не делала ничего.
       *
       * Уехавшую возвращаем и перечитываем доску: её нода должна вернуться на
       * холст, а место ей перенесёт сервер тем же путём, что и при переносе.
       */
      let moved = false;
      let returned = false;
      if (b) {
        const onBoard = new Map(
          b.nodes.filter((n) => n.node_type === "scene").map((n) => [n.node_id, n] as const)
        );
        for (const [sceneId, want] of snap.arcs) {
          if (want === undefined) continue;
          const here = onBoard.get(sceneId);
          if (here) {
            if (want === here.scene.arc_id) continue;
            here.scene.arc_id = want;
            api.put(`/story/scenes/${sceneId}`, { arc_id: want });
            moved = true;
          } else if (want != null) {
            api.put(`/story/scenes/${sceneId}`, { arc_id: want });
            returned = true;
          }
        }
      }
      // Отмена должна вернуть и принадлежность свободных узлов группам-рамкам
      // (В4). `scheduleSave` ниже `parent_key` не шлёт — сервер сохраняет
      // текущее значение, поэтому вернувшийся из группы узел после undo и
      // перезагрузки снова туда «вваливается». Догоняем членство отдельным
      // пакетом для его владельцев: сравниваем снимок (чего хотим) с текущей
      // доской (что лежит в базе) и отправляем только разошедшихся.
      if (b) {
        const nowKeys = new Map(b.nodes.filter((n) => n.node_type !== "frame").map((n) => [n.key, n.parent_key ?? null] as [string, string | null]));
        const writes: { node_type: string; node_id: number; x: number; y: number; parent_key: string | null }[] = [];
        for (const [key, want] of snap.parentKeys) {
          const now = nowKeys.get(key);
          if (now === want) continue;
          const snapNode = byId.get(key);
          if (!snapNode) continue;
          const abs = toAbsolute(snapNode, byId);
          const [t, idRaw] = splitKey(key);
          writes.push({ node_type: t, node_id: Number(idRaw), x: Math.round(abs.x), y: Math.round(abs.y), parent_key: want ?? null });
        }
        if (writes.length && b.board_id) api.put("/canvas/board/nodes", { board_id: b.board_id, nodes: writes });
      }
      if (returned) {
        loadBoard();
        return;
      }
      // Родство сцен изменилось — ноды надо собрать заново из доски; если
      // двигали только позиции, пересбор лишний и стоил бы выделения.
      if (moved && b) setBoard({ ...b });
      else setNodes(snap.nodes);
      scheduleSave(snap.nodes);
    },
    [commitPositions, scheduleSave, setNodes, loadBoard]
  );
  const pushHistory = useCallback(() => {
    historyRef.current.push(snapshot());
    if (historyRef.current.length > 40) historyRef.current.shift();
    setCanUndo(true);
    redoRef.current = [];
    setCanRedo(false);
  }, [snapshot]);
  const undoLayout = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(snapshot());
    setCanRedo(true);
    restoreSnapshot(prev);
    setCanUndo(historyRef.current.length > 0);
  }, [snapshot, restoreSnapshot]);
  const redoLayout = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(snapshot());
    setCanUndo(true);
    restoreSnapshot(next);
    setCanRedo(redoRef.current.length > 0);
  }, [snapshot, restoreSnapshot]);

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

  /**
   * Кого рамка может забрать себе в дети.
   *
   * У сцены и проверки родитель выводится из данных (`arc_id` сцены), и
   * запись `parent_key` для них ничего не значит — `computeParents` её всё
   * равно не смотрит. У рамки и главы вложенности нет вовсе (Q3). Всё
   * остальное — сущность, стикер, картинку, пин — рамка забирает.
   *
   * Пин отсюда был исключён: его место сохранялось прямо из `position`, а у
   * ноды с родителем оно относительное, и первое же перетаскивание уводило
   * пин в угол рамки. Чинится это переводом в абсолютные (`toAbsolute`) там,
   * где место пина сохраняется, а не запретом на родство.
   */
  const canJoinFrame = (key: string) => {
    const [t] = splitKey(key);
    return t !== "scene" && t !== "check" && t !== "frame" && t !== "chapter";
  };

  /**
   * Группа из выделения: рамка по охвату выделенного, и выделенное
   * становится её содержимым.
   *
   * Без второго шага рамка была нарисована вокруг нод, но не владела ими —
   * ехала пустой. Родство пишется тем же `parent_key`, что проставляется при
   * броске ноды в рамку мышью (Q11), поэтому переживает перезагрузку.
   *
   * `at` — куда ставить рамку, когда выделения нет (точка правого щелчка).
   */
  const createGroup = useCallback(async (at?: { x: number; y: number }) => {
    if (!board?.board_id) return;
    const all = nodesRef.current;
    const selected = all.filter((n) => n.selected);
    const byId = new Map(all.map((n) => [n.id, n]));
    let newId: number | null = null;
    let members: Node<CanvasNodeData>[] = [];
    if (!selected.length) {
      const res = await api.post<{ id: number }>("/canvas/frames", {
        board_id: board.board_id,
        name: "Группа",
        x: Math.round(at?.x ?? 0),
        y: Math.round(at?.y ?? 0),
        w: 360,
        h: 240,
      });
      newId = res.id;
    } else {
      // Охват считается по АБСОЛЮТНЫМ координатам: выделенная нода может уже
      // лежать в другой рамке, и её `position` тогда отсчитывается от той.
      const box = selected.map((n) => ({ p: toAbsolute(n, byId), s: getNodeSize(n) }));
      const minX = Math.min(...box.map((b) => b.p.x)) - 16;
      const minY = Math.min(...box.map((b) => b.p.y)) - 34;
      const maxX = Math.max(...box.map((b) => b.p.x + b.s.w));
      const maxY = Math.max(...box.map((b) => b.p.y + b.s.h));
      // На сетку рамка садится НАРУЖУ (блок G6.1): начало прижимается вниз по
      // сетке, дальний край — вверх. Округление к ближайшему подрезало бы
      // рамку по содержимому, ради которого её и рисуют.
      const fx = Math.floor(minX / GRID) * GRID;
      const fy = Math.floor(minY / GRID) * GRID;
      const res = await api.post<{ id: number }>("/canvas/frames", {
        board_id: board.board_id,
        name: "Группа",
        x: fx,
        y: fy,
        w: Math.ceil((maxX + 16 - fx) / GRID) * GRID,
        h: Math.ceil((maxY + 16 - fy) / GRID) * GRID,
      });
      newId = res.id;
      members = selected.filter((n) => canJoinFrame(n.id));
    }
    if (newId && members.length) {
      await api.put("/canvas/board/nodes", {
        board_id: board.board_id,
        nodes: members.map((n) => {
          const [nodeType, nodeId] = splitKey(n.id);
          const abs = toAbsolute(n, byId);
          return {
            node_type: nodeType,
            node_id: nodeId,
            x: Math.round(abs.x),
            y: Math.round(abs.y),
            parent_key: `frame:${newId}`,
          };
        }),
      });
    }
    if (newId) {
      setSelectedFrameId(newId);
      setSelectedChapterId(null);
      setSelectedSceneId(null);
      setSelectedCheckId(null);
      setSelectedStickerId(null);
      loadBoard();
      setTimeout(() => setFresh({ key: `frame:${newId}`, edit: true }), 400);
    } else {
      loadBoard();
    }
  }, [board, loadBoard]);

  // Ширина холста — через ResizeObserver, а не медиазапрос по окну: слева
  // навигация, справа рельс и панель свойств, и при окне в 1440 холсту
  // достаётся 564. Панель свойств вдобавок сворачивается — окно при этом не
  // меняется, а холст меняется, и медиазапрос этого не увидел бы.
  useEffect(() => {
    const el = flowElRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setOverlaysTight(entry.contentRect.width < CANVAS_OVERLAYS_MIN_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [board]);

  // Палитра и поиск — по 260 px каждая. Пока холст широк, они стоят по разным
  // краям и не мешают друг другу; когда места меньше порога, открытые вместе
  // они лежат друг на друге (находка Н7). Тогда открыта одна: последняя
  // открытая вытесняет предыдущую — Мастеру не нужно закрывать лишнее руками.
  const overlaysRef = useRef({ palette: false, search: false });
  useEffect(() => {
    const prev = overlaysRef.current;
    if (overlaysTight && paletteOpen && searchOpen) {
      if (prev.palette) setPaletteOpen(false);
      else setSearchOpen(false);
      // Состояние сейчас изменится — ref обновит следующий проход.
      return;
    }
    overlaysRef.current = { palette: paletteOpen, search: searchOpen };
  }, [overlaysTight, paletteOpen, searchOpen]);

  // cmd+k — поиск по нодам (имя + foreignLinks)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;
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

  const filteredSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as Node<CanvasNodeData>[];
    return nodes.filter((n) => {
      const d = n.data as Record<string, unknown>;
      const name = String((d.name as string) ?? (d.title as string) ?? (d.what as string) ?? "");
      return name.toLowerCase().includes(q);
    });
  }, [searchQuery, nodes]);

  const autoLayoutUnplaced = useCallback(() => {
    // Только !placed — ручное не трогать (решение Q7)
    const unplacedIds = new Set((board?.nodes ?? []).filter((n) => !n.placed).map((n) => n.key));
    if (unplacedIds.size === 0) return;
    pushHistory();
    setNodes((cur) => {
      // Раскладка сеткой под уже разложенным. Посадки внутрь рамки главы
      // здесь больше нет: рамки нет, а на холсте главы все сцены и так её.
      let seq = 0;
      const next = cur.map((n) => {
        if (!unplacedIds.has(n.id)) return n;
        // Шаг кратен сетке (блок G6.1): 12 и 8 клеток вместо прежних 300×200.
        // Иначе «Упорядочить узлы» раскладывало бы мимо линий фона — то есть
        // холст оказывался бы наполовину по сетке, наполовину нет.
        const COL = GRID * 12;
        const ROW = GRID * 8;
        const pos = { x: (seq % 4) * COL, y: toGrid(Math.max(...cur.map((c) => c.position.y), 0)) + ROW + Math.floor(seq / 4) * ROW };
        seq++;
        return { ...n, position: pos };
      });
      scheduleSave(next);
      return next;
    });
  }, [board, pushHistory, scheduleSave]);

  // Состав рамки для перетаскивания больше не снимается: React Flow сам
  // двигает детей вместе с родителем. Прежний снимок был нужен как раз
  // потому, что состав вычислялся перекрытием прямоугольников и по дороге
  // терял сцену, вышедшую за край. Теперь состав — это данные (arc_id), и
  // терять нечего.
  const onNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  /**
   * Пока сцену тащат — показываем, кто её примет.
   *
   * Без этого перенос — слепой жест: сцена меняет главу от того, где её
   * отпустили, а узнаёт об этом Мастер постфактум. Обводка говорит о переносе
   * до того, как он случился, и отменить его можно тем же движением — увести мышь.
   */
  const onNodeDrag = useCallback((_: unknown, node: Node<CanvasNodeData>) => {
    const b = boardRef.current;
    if (!b || node.type !== "scene") return;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const abs = toAbsolute(node, byId);
    const { w, h } = getNodeSize(node);
    // Цель — УЗЕЛ главы под центром сцены, а не рамка (блок G6.2, Q21). Жест
    // тот же, цель стала меньше; всё остальное — обводка, правка `arc_id`,
    // снимок для отмены — работает как работало.
    const arc = chapterNodeAt(nodesRef.current, abs.x + w / 2, abs.y + h / 2);
    const sceneId = Number(splitKey(node.id)[1]);
    let cur: number | null = null;
    for (const n of b.nodes) {
      if (n.node_type === "scene" && n.node_id === sceneId) cur = n.scene.arc_id;
    }
    setDropChapter(arc != null && arc !== cur ? arc : null);
  }, []);

  // Обводка ставится точечно, а не пересбором нод из доски: пересобирать
  // сто тридцать нод на каждое пересечение границы главы — точно не тот ценник,
  // который надо платить во время перетаскивания.
  useEffect(() => {
    setNodes((cur) =>
      cur.map((n) => {
        if (!n.id.startsWith("chapter:")) return n;
        const want = n.id === `chapter:${dropChapter}`;
        if (!!(n.data as ChapterNodeData).isDropTarget === want) return n;
        return { ...n, data: { ...n.data, isDropTarget: want } };
      })
    );
  }, [dropChapter, setNodes]);

  // Группа живёт размером охвата своих членов (гибридная модель): члена нельзя
  // вытащить рукой — рамка растягивается вместе с ним, а вывести можно только
  // явным «Убрать из группы», после чего рамка сужается до нового охвата.
  // Источник правды о размере — клиент, знающий настоящие отрисованные размеры
  // узлов: сервер хранит `w/h` как есть и ничего не пересчитывает, так рост и
  // сужение рамки следуют за составом с верными размерами содержимого.
  // `include` — ноды, которые только что попали в семью (их parentId ещё не
  // выставлен до перечитывания доски); `exclude` — того, кого только что вывели.
  const recomputeFrame = useCallback(
    (frameId: number, opts?: { include?: string[]; exclude?: string[]; moved?: { id: string; position: { x: number; y: number } } }) => {
      const incl = opts?.include ?? [];
      const excl = opts?.exclude ?? [];
      const moved = opts?.moved;
      const frameNode = nodesRef.current.find((n) => n.id === `frame:${frameId}`);
      if (!frameNode) return;
      if ((frameNode.data as FrameNodeData).collapsed) return;
      // `nodesRef.current` синхронизируется на рендере, а на drag-stop он ещё
      // держит ДО-ДРАГОВОЕ место перетаскиваемой ноды. Подменяем для неё
      // свежую позицию из события, иначе охват считается по старой точке:
      // рамка не догонит уехавшего наружу члена до перезагрузки.
      const nodes = nodesRef.current.map((n) =>
        moved && n.id === moved.id ? { ...n, position: { ...moved.position } } : n
      );
      const members = nodes.filter(
        (n) => n.id !== frameNode.id && (n.parentId === `frame:${frameId}` || incl.includes(n.id)) && !excl.includes(n.id)
      );
      if (!members.length) return;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const fx = frameNode.position.x;
      const fy = frameNode.position.y;
      let maxX = fx;
      let maxY = fy;
      for (const m of members) {
        const abs = toAbsolute(m, byId);
        const s = getNodeSize(m);
        maxX = Math.max(maxX, abs.x + s.w + 16);
        maxY = Math.max(maxY, abs.y + s.h + 16);
      }
      const w = Math.max(Math.ceil((maxX - fx) / GRID) * GRID, 160);
      const h = Math.max(Math.ceil((maxY - fy) / GRID) * GRID, 100);
      api.put(`/canvas/frames/${frameId}`, { w: Math.round(w), h: Math.round(h) });
      // Доска — источник собираемых заново нод (`setNodes` в эффекте по board):
      // без правки её `frame.w/h` пересборка вернёт рамке прежний размер, и
      // рост до перезагрузки не доживёт. Пишем в тот же объект, чтобы и
      // соседний `setBoard({...b})` из drag-stop увидел новый размер.
      const b = boardRef.current;
      if (b) {
        for (const n of b.nodes) {
          if (n.node_type === "frame" && n.node_id === frameId) {
            n.frame.w = w;
            n.frame.h = h;
            break;
          }
        }
        setBoard({ ...b });
      }
      setNodes((cur) =>
        cur.map((n) =>
          n.id !== `frame:${frameId}`
            ? n
            : { ...n, width: w, height: h, data: { ...n.data, w, h } }
        )
      );
    },
    [setNodes, setBoard]
  );

  // «Убрать из группы» (гибридная модель): единственный способ вывести члена —
  // явный жест, рукой не вытащить. Пишется `parent_key = null` той же пачкой,
  // что и раскладку (пин зеркалит `canvas_pins` сам), затем рамка сужается
  // пересчётом по оставшимся членам, и доска перечитывается.
  const removeFromGroup = useCallback(
    async (node: Node<CanvasNodeData>) => {
      const parent = node.parentId;
      if (!parent?.startsWith("frame:")) return;
      const boardState = boardRef.current;
      if (!boardState) return;
      const frameId = Number(parent.split(":")[1]);
      const [nodeType, nodeId] = splitKey(node.id);
      const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
      const abs = toAbsolute(node, byId);
      await api.put("/canvas/board/nodes", {
        board_id: boardState.board_id,
        nodes: [
          {
            node_type: nodeType,
            node_id: nodeId,
            x: Math.round(abs.x),
            y: Math.round(abs.y),
            parent_key: null,
          },
        ],
      });
      for (const n of boardState.nodes) {
        if (n.key === node.id) {
          n.parent_key = null;
          break;
        }
      }
      setBoard({ ...boardState });
      // Сужение: пересчёт по оставшимся членам, выведенного исключаем.
      recomputeFrame(frameId, { exclude: [node.id] });
      loadBoard();
    },
    [loadBoard, recomputeFrame]
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node<CanvasNodeData>) => {
      // Рамки и пины мимо `scheduleSave`, поэтому доску догоняем здесь.
      commitPositions(nodesRef.current);
      const target = dropChapterRef.current;
      setDropChapter(null);
      if (isFrame(node.id) && board) {
        // Рамка ходит своей дверью: её место и размер живут в `canvas_frames`,
        // а не в раскладке. Узел главы сюда больше не попадает — его место
        // лежит в `canvas_nodes` наравне с прочими (блок G6.2), и уходит оно
        // общей записью `scheduleSave`.
        const [, id] = splitKey(node.id);
        const newX = Math.round(node.position.x);
        const newY = Math.round(node.position.y);
        api.put(`/canvas/frames/${id}`, {
          x: newX,
          y: newY,
          w: Math.round(node.width ?? dataSize(node.data).w ?? 320),
          h: Math.round(node.height ?? dataSize(node.data).h ?? 240),
        });
        // Дрейф детей (В3): `PUT /canvas/frames` двигает только рамку, а
        // абсолюты членов лежат в `canvas_nodes` и сами собой не меняются.
        // `scheduleSave` из `onNodesChange` опирается на локальную позицию
        // React Flow относительно родителя — сдвиг рамки здесь считается
        // детерминированно по дельте, от этих внутренностей не завися.
        const b = boardRef.current;
        if (b) {
          const frameOld = b.nodes.find((n) => n.node_type === "frame" && n.node_id === id);
          if (frameOld) {
            const dx = newX - Math.round(frameOld.x);
            const dy = newY - Math.round(frameOld.y);
            if (dx || dy) {
              const members = b.nodes.filter((n) => n.parent_key === `frame:${id}`);
              if (members.length) {
                const moved = members.map((n) => ({
                  node_type: n.node_type,
                  node_id: n.node_id,
                  x: Math.round(n.x) + dx,
                  y: Math.round(n.y) + dy,
                  parent_key: `frame:${id}`,
                }));
                api.put("/canvas/board/nodes", { board_id: board.board_id, nodes: moved });
              }
            }
          }
        }
      } else if (isPin(node.id) && board) {
        // Пин ходит своей дверью (`/canvas/pins/:id`), но по общим правилам:
        // в базу — абсолютные координаты (Q15), и рамка, на которую его
        // бросили, — тем же `parent_key`, что у стикера и картинки (Q11).
        const [, id] = splitKey(node.id);
        const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
        const abs = toAbsolute(node, byId);
        const { w, h } = getNodeSize(node);
        // Члена нельзя вытащить рукой: если пин уже в семье — остаётся в ней,
        // рамка растягивается следом. В семье его больше нет только после
        // явного «Убрать из группы», и тогда авто-добавление снова в силе.
        const existing = nodesRef.current.find((n) => n.id === node.id);
        const stickyParent = existing?.parentId ?? null;
        const parentKey = stickyParent
          ? stickyParent
          : (() => {
              const pk = frameAtPoint(board, abs.x + w / 2, abs.y + h / 2);
              return pk === node.id ? null : pk;
            })();
        api.put(`/canvas/pins/${id}`, {
          x: Math.round(abs.x),
          y: Math.round(abs.y),
          parent_key: parentKey,
        });
        const b = boardRef.current;
        if (b) {
          for (const n of b.nodes) {
            if (n.key === node.id) n.parent_key = parentKey;
          }
          setBoard({ ...b });
        }
        if (parentKey) recomputeFrame(Number(parentKey.split(":")[1]), { include: [node.id], moved: { id: node.id, position: node.position } });
      } else if (node.type === "scene" && target != null) {
        /**
         * Перенос между главами — правка самой сцены, а не холста: глава
         * сцены живёт в `story_scenes`, и страница приключения увидит его тоже.
         *
         * После блока G6.2 сцена при этом УХОДИТ С ЭТОГО ХОЛСТА: её место
         * переносит на доску главы сам сервер. Поэтому здесь снимается
         * отложенная запись раскладки и доска перечитывается целиком.
         *
         * Без снятия таймера дефект выглядел так: сервер переносил строку
         * `canvas_nodes` на доску главы, а через полсекунды `scheduleSave`
         * записывал ту же сцену обратно на доску приключения — сцена
         * оказывалась в двух местах сразу, и на холсте главы её место
         * терялось. Найдено проверкой на копии базы.
         */
        const sceneId = Number(splitKey(node.id)[1]);
        saveGen.current += 1;
        savePaused.current = true;
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        void api
          .put(`/story/scenes/${sceneId}`, { arc_id: target })
          .then(() => loadBoard())
          .finally(() => {
            savePaused.current = false;
          });
      } else if (board && node.type !== "check") {
        // Свободная нода запоминает рамку, в которую её бросили (Q11).
        // У сцены и проверки родитель выводится из данных, у остальных выводить
        // не из чего — только из жеста.
        const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
        const abs = toAbsolute(node, byId);
        const { w, h } = getNodeSize(node);
        // Члена нельзя вытащить рукой: уже состоящая в семье нода остаётся в
        // ней, рамка растягивается следом. Авто-добавление бросанием (Q11)
        // включается только для свободной ноды, а не для члена.
        const existing = nodesRef.current.find((n) => n.id === node.id);
        const stickyParent = existing?.parentId ?? null;
        const parentKey = stickyParent
          ? stickyParent
          : (() => {
              const pk = frameAtPoint(board, abs.x + w / 2, abs.y + h / 2);
              return pk === node.id ? null : pk;
            })();
        const [nodeType, nodeId] = splitKey(node.id);
        api.put("/canvas/board/nodes", {
          board_id: board.board_id,
          nodes: [
            {
              node_type: nodeType,
              node_id: nodeId,
              x: Math.round(abs.x),
              y: Math.round(abs.y),
              parent_key: parentKey,
            },
          ],
        });
        const b = boardRef.current;
        if (b) {
          for (const n of b.nodes) {
            if (n.key === node.id) n.parent_key = parentKey;
          }
          setBoard({ ...b });
        }
        if (parentKey) recomputeFrame(Number(parentKey.split(":")[1]), { include: [node.id], moved: { id: node.id, position: node.position } });
      }
    },
    [board, commitPositions, recomputeFrame, loadBoard]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasNodeData>>[]) => {
      const isDragEnd = changes.some((c) => c.type === "position" && c.dragging === false);
      setNodes((current) => {
        // Рамка тащит содержимое сама — это делает React Flow по parentId.
        // Ручной перенос детей отсюда убран: с ним они уезжали бы дважды.
        // Порядок слоёв тоже его: ребёнок всегда рисуется поверх родителя,
        // и applyGroupDepth со своей геометрией больше не нужен.
        const next = applyNodeChanges(changes, current);
        // Пишем только когда перетаскивание закончилось: промежуточные
        // положения никому не нужны, а выделение и подсветка вообще не
        // касаются раскладки.
        if (isDragEnd) scheduleSave(next);
        // Растягивание рамки ручкой — w/h в canvas_frames.
        //
        // Единственное место, где размер рамки доезжает до базы:
        // `onNodeDragStop` на растягивание не срабатывает. Условие здесь
        // спрашивало у изменения размера поле `dragging`, которого у него нет
        // (у него `resizing`), — приведение это скрывало, условие не
        // выполнялось никогда, и растянутая рамка возвращалась к прежнему
        // размеру после перезагрузки. Проверено на своей доске: до правки
        // запись не уходила совсем.
        const dim = changes.find((c): c is NodeDimensionChange => c.type === "dimensions" && c.resizing === false);
        if (dim && isFrame(dim.id) && board) {
          // Только свободная рамка: у узла главы ручек растягивания нет —
          // размер ему задаёт содержимое карточки (блок G6.2).
          const [, fid] = splitKey(dim.id);
          api.put(`/canvas/frames/${fid}`, {
            w: Math.round(dim.dimensions?.width ?? 0),
            h: Math.round(dim.dimensions?.height ?? 0),
          });
        }
        return next;
      });
    },
    [scheduleSave, board]
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
      const sourceHandle = connection.sourceHandle ?? "";

      // Рераут («Маршрут») как носитель-хаб: один вход (носитель слева —
      // существо/локация/сцена) и N выходов (сцены справа, куда носитель
      // передаётся и реально пишется в их каст). Проводка во вход пишет
      // `from_key` (`PUT /routes/:id`), проводка из выхода добавляет выход
      // (`POST /routes/:id/outputs`).
      if (sourceType === "route" || targetType === "route") {
        // Диагностика коннектов рераута (временная).
        console.log("[reroute] onConnect", {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        });
        // Вход или выход? Во вход рераута входят слева (target — рераут), из
        // выхода выходят справа (source — рераут).
        // P0-1: from/to �� handle route-in/route-out, � �� �� ���� � ��������� ���������� from ��� drag � ��������
        const isIn = targetType === "route" ? (connection.targetHandle ? connection.targetHandle === "route-in" : true) : false;
        const routeId = isIn ? targetId : sourceId;
        const peerKey = isIn ? connection.source : connection.target;
        const peerType = isIn ? sourceType : targetType;
        const peerHandle = isIn ? (connection.sourceHandle ?? "") : (connection.targetHandle ?? "");

        // Сосед — тоже рераут: цепочка носителей. Устраиваем её входами: у
        // второго рераута вход (from_key) — первый рераут, вид/роль наследуем
        // от уже настроенного рераута, иначе BFS разойдётся.
        if (peerType === "route") {
          const inheritedId = isIn ? sourceId : targetId;
          const srcData = nodes.find((n) => n.id === `route:${inheritedId}`)?.data as
            | RouteNodeData
            | undefined;
          const kin = srcData?.kind ?? "transition";
          const rol = srcData?.role ?? "";
          const childRouteId = isIn ? routeId : inheritedId;
          try {
            await api.put(`/canvas/routes/${childRouteId}`, {
              from_key: `route:${isIn ? inheritedId : routeId}`,
              kind: kin,
              role: rol,
            });
          } catch (e) {
            alert(`Не удалось связать маршруты: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
          loadBoard();
          return;
        }

        // Нити пинов рераутом не рвём: они живут в поле `threads` отдельно от
        // `edges`, и серверный разрыв рёбер (`routedEdges`) их не видит — такой
        // рераут висел бы без эффекта. Проводку отклоняем явно (#7).
        if (peerType === "pin") return;

        // Вид/роль определяет РЕАЛЬНАЯ сторона (вход — существо/локация/сцена,
        // выход — сцена, куда ложится носитель). Роль у выхода наследуем от
        // носителя (тот же каст-тип), у входа — от разъёма реальной ноды.
        const routeData = nodes.find((n) => n.id === `route:${routeId}`)?.data as RouteNodeData | undefined;
        const prevKind = (routeData?.kind as RouteKind) ?? "transition";
        const prevRole = routeData?.role ?? "";
        let kind: RouteKind = prevKind;
        let role: string = prevRole;
        if (isIn) {
          // Вход — вид/роль носителя по реальной ноде: исход проверки, набор
          // (member), событие (consequences) или каст-сущность по разъёму.
          if (peerHandle.startsWith("outcome:")) {
            kind = "outcome";
            role = peerHandle;
          } else if (peerType === "bundle" || peerHandle === "members") {
            kind = "member";
            role = "members";
          } else if (peerType === "setting_event" || peerType === "campaign_event") {
            kind = "cast";
            role = "consequences";
          } else if (["being","location","artifact","community","character","compendium_entry"].includes(peerType)) {
            kind = "cast";
            role = peerType;
          } else if (peerType === "scene" && peerHandle !== "story" && peerHandle !== "prev") {
            kind = "cast";
            role = peerHandle;
          }
        } else {
          // Выход — тот же носитель уходит в сцену, роль сохраняем каст-типа.
          role = prevRole;
        }
        try {
          if (isIn) {
            await api.put(`/canvas/routes/${routeId}`, { from_key: peerKey, kind, role });
          } else {
            await api.post(`/canvas/routes/${routeId}/outputs`, { to_key: peerKey, role });
          }
          console.log("[reroute] " + (isIn ? "PUT ok" : "POST output ok"), { routeId, peerKey, kind, role });
        } catch (e) {
          console.error("[reroute] " + (isIn ? "PUT failed" : "POST output failed"), { routeId, peerKey, kind, role, error: e });
          alert(`Не удалось подвести маршрут: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        loadBoard();
        return;
      }

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
      } else if (sourceType === "adventure" && targetType === "adventure") {
        // «Что за чем идёт» на схеме сеттинга (блок D3). Связь приключения с
        // самим собой смысла не имеет и молча отбрасывается.
        if (sourceId === targetId) return;
        // На карте кампании связь уходит в кампанию: первая же правка снимает
        // с сеттинга копию всего набора (блок D4), и заготовка остаётся целой.
        await api.post(`/story/arcs/${sourceId}/transitions`, {
          to_arc_id: targetId,
          ...(campaignMapId ? { campaign_id: campaignMapId } : {}),
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
    [loadBoard, nodes, board, campaignMapId]
  );

  // Удаление ребра значит разное для двух видов. Переход исчезает совсем.
  // А у исхода проверки снимается только связь: сам разъём остаётся на месте
  // вместе со своей подписью и текстом последствия — «провал больше не ведёт
  // в яму» не то же самое, что «провала больше нет».
  const onEdgesDelete = useCallback(
    async (removed: Edge[]) => {
      await Promise.all(
        removed.map((e) => {
          // Сегмент выхода рераута-хаба: ребро `route:<id> → сцена`. Удаление
          // снимает именно этот выход (`DELETE /routes/:id/outputs`) и сам
          // реальный каст, который он клал в сцену. К целевым рераутам-цепочкам
          // (source route → route) не трогаем: они разбираются удалением нод.
          if (e.source.startsWith("route:") && !e.target.startsWith("route:")) {
            const [, rid] = e.source.split(":");
            return api.del(`/canvas/routes/${rid}/outputs?to_key=${encodeURIComponent(e.target)}`);
          }
          const [kind, rawId] = e.id.split(":");
          if (kind === "outcome") {
            return api.put(`/story/outcomes/${rawId}`, { target_type: null, target_id: null });
          }
          // Состав и членство в наборе — обычные связи; снимается связь, а
          // нода остаётся на холсте. Обратное («убрал квадратик — выпал из
          // сцены») молча потрошило бы сцены при расчистке схемы.
          if (kind === "cast") return api.del(`/story/cast/${rawId}`);
          if (kind === "member") return api.del(`/links/${rawId}`);
          if (kind === "scene_check") return api.del(`/story/checks/${rawId}`);
          if (kind === "thread") return api.del(`/canvas/threads/${rawId}`);
          // Связь между приключениями на схеме сеттинга (блок D3). На карте
          // кампании стирается КАМПАНИЙНАЯ строка, а связь сеттинга остаётся:
          // сервер снимает копию набора, если её ещё не было (блок D4).
          if (kind === "arc-transition")
            return api.del(
              `/story/arc-transitions/${rawId}${campaignMapId ? `?campaign_id=${campaignMapId}` : ""}`
            );
          return api.del(`/story/transitions/${rawId}`);
        })
      );
      loadBoard();
    },
    [loadBoard, campaignMapId]
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

  /**
   * Гасит подсказку на месте, без запроса к серверу.
   *
   * Правка, сделанная на этом же холсте, обязана гасить свой чип сразу: если
   * он продолжает гореть после того, как локация воткнута, доверие к нему
   * кончится за вечер, а с ним и к счётчику. Тот же приём, которым уже живёт
   * `board` в памяти — он правится рука об руку с PUT, а не перезапрашивается.
   */
  const extinguishHint = useCallback((sceneId: number, match: (h: SceneHint) => boolean) => {
    setHintsByScene((prev) => {
      const cur = prev.get(sceneId);
      if (!cur) return prev;
      const left = cur.filter((h) => !match(h));
      if (left.length === cur.length) return prev;
      const next = new Map(prev);
      if (left.length) next.set(sceneId, left);
      else next.delete(sceneId);
      return next;
    });
  }, []);

  const sceneNameById = useCallback(
    (id: number) => boardNodesOfType(boardRef.current, "scene").find((n) => n.scene.id === id)?.scene.name ?? `Сцена ${id}`,
    []
  );

  /** Гасит подсказку про одну сущность СРАЗУ НА ВСЕЙ доске — для заглушки на
   *  сеттинг: она снимает имя со всех сцен, и перечитывать ради этого 91 сцену
   *  незачем, ответ известен заранее. */
  const extinguishEverywhere = useCallback((entityType: string, entityId: number) => {
    setHintsByScene((prev) => {
      const next = new Map<number, SceneHint[]>();
      let changed = false;
      prev.forEach((hints, sceneId) => {
        const left = hints.filter((h) => !(h.entity_type === entityType && h.entity_id === entityId));
        if (left.length !== hints.length) changed = true;
        if (left.length) next.set(sceneId, left);
      });
      return changed ? next : prev;
    });
  }, []);

  /**
   * Меню чипа подсказок. Открывается тем же `ContextMenu`, что и меню ноды:
   * заводить ради одного пункта свой всплывающий список незачем.
   *
   * «Это не оно» есть только у упоминаний: остальные три подсказки гасятся
   * починкой, а не отговоркой.
   */
  const openHints = useCallback(
    (sceneId: number, x: number, y: number) => {
      const list = hintsByScene.get(sceneId) ?? [];
      const items: ContextMenuItem[] = list.map((h) =>
        h.kind === "mentioned_not_cast" && h.entity_type && h.entity_id
          ? {
              label: h.text,
              children: [
                {
                  label: "Это не оно",
                  onClick: () => {
                    api.post("/canvas/hints/dismiss", {
                      scene_id: sceneId,
                      scope: "scene",
                      entity_type: h.entity_type,
                      entity_id: h.entity_id,
                    });
                    extinguishHint(sceneId, (x2) => x2.entity_type === h.entity_type && x2.entity_id === h.entity_id);
                    setDismissed((d) => ({
                      ...d,
                      scenes: [
                        ...d.scenes,
                        {
                          scene_id: sceneId,
                          scene_name: sceneNameById(sceneId),
                          entity_type: h.entity_type as string,
                          entity_id: h.entity_id as number,
                          name: h.text.split(" — ")[0],
                        },
                      ],
                    }));
                  },
                },
                // Второй пункт — ответ на находку Н13: на одной доске 47 из 143
                // упоминаний это имя города, в котором идёт всё приключение, и
                // точечно его пришлось бы гасить 47 раз. Охват — сеттинг: город
                // принадлежит ему, а не приключению.
                ...(settingId
                  ? [
                      {
                        label: `Не подсказывать про «${h.text.split(" — ")[0]}» в сеттинге`,
                        onClick: () => {
                          api.post("/canvas/hints/dismiss", {
                            setting_id: settingId,
                            scope: "setting",
                            entity_type: h.entity_type,
                            entity_id: h.entity_id,
                          });
                          extinguishEverywhere(h.entity_type as string, h.entity_id as number);
                          setDismissed((d) => ({
                            ...d,
                            setting: [
                              ...d.setting,
                              {
                                entity_type: h.entity_type as string,
                                entity_id: h.entity_id as number,
                                name: h.text.split(" — ")[0],
                              },
                            ],
                          }));
                        },
                      },
                    ]
                  : []),
              ],
            }
          : { label: h.text }
      );
      if (items.length) setContextMenu({ x, y, items });
    },
    [hintsByScene, extinguishHint, extinguishEverywhere, settingId, sceneNameById]
  );
  useEffect(() => {
    openHintsRef.current = openHints;
  }, [openHints]);

  /**
   * Обход недоделок: порядок и прыжок.
   *
   * Порядок — сперва РЕДКИЕ виды (развилка без выхода, недопроставленные цели
   * исходов), потом массовые. Иначе две настоящие дыры утонут в двух десятках
   * сцен без локации, и Мастер их никогда не увидит. Внутри вида — в порядке,
   * в котором сцены пришли с сервера (position, id), чтобы возвраты шли по
   * одному и тому же кругу, а не случайно.
   */
  const hintRoute = useMemo(() => {
    const order = (board?.nodes ?? []).filter((n) => n.node_type === "scene").map((n) => n.node_id);
    const rare: number[] = [];
    const rest: number[] = [];
    order.forEach((id) => {
      const h = hintsByScene.get(id);
      if (!h?.length) return;
      (h.some((x) => x.kind === "branch_dead_end" || x.kind === "outcome_no_target") ? rare : rest).push(id);
    });
    return [...rare, ...rest];
  }, [board, hintsByScene]);

  const hintTotal = useMemo(
    () => [...hintsByScene.values()].reduce((sum, h) => sum + h.length, 0),
    [hintsByScene]
  );

  /** Проходить нечего — кнопки прогона нет вовсе (блок G3). */
  const hasScenesOnBoard = useMemo(
    () => (board?.nodes ?? []).some((n) => n.node_type === "scene"),
    [board]
  );

  const hintCursor = useRef(0);
  /** Один орган управления на всю ветку доводки: число и прыжок в одной кнопке. */
  const gotoNextHint = useCallback(() => {
    if (hintRoute.length === 0) return;
    const sceneId = hintRoute[hintCursor.current % hintRoute.length];
    hintCursor.current = (hintCursor.current + 1) % hintRoute.length;
    const key = `scene:${sceneId}`;
    // Разворачивать больше нечего: свёртки глав нет, а все сцены холста лежат
    // на нём открыто (блок G6.2). Маршрут доводки идёт по сценам ЭТОГО
    // холста — счётчик и прыжок отвечают за то, что здесь, а недоделки
    // внутри глав видны счётчиком на их узлах.
    // Фокус ставится тем же путём, что и клик по ноде: адресом. Своё выделение
    // здесь не годится — эффект фокуса перечитывает `focus` из адреса при
    // каждой смене доски, а разворот главы её как раз меняет, и своё выделение
    // он тут же затирал прежним фокусом. Заодно панель свойств и крошки
    // показывают ту сцену, к которой прыгнули, а не предыдущую.
    if (arcId) {
      const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
      if (campaignIdParam) next.campaign = String(campaignIdParam);
      next.focus = key;
      setSearchParams(next);
    }
    // Центрируем после разворота: ноду до него ещё не обмеряли.
    setTimeout(() => {
      const target = nodesRef.current.find((n) => n.id === key);
      if (!target) return;
      // Место ноды внутри главы отсчитывается ОТ РАМКИ, а `setCenter` ждёт
      // координаты доски: без перевода прыжок уводил холст в пустоту.
      const at = toAbsolute(target, new Map(nodesRef.current.map((n) => [n.id, n])));
      const size = getNodeSize(target);
      flowRef.current?.setCenter(at.x + size.w / 2, at.y + size.h / 2, { zoom: 1, duration: 420 });
    }, 0);
  }, [hintRoute, arcId, settingId, campaignIdParam, setSearchParams]);

  // ------------------------------------------------- режим репетиции (G3)

  /**
   * Показать сцену прогона на холсте.
   *
   * Выделение НЕ трогает: оно адресует панель свойств, и прогон, двигающий
   * его, оставлял бы Мастера на выходе в свойствах случайной сцены. Своя
   * подсветка живёт рядом с выделением и его не касается.
   *
   * Разворачивать главу больше не нужно и нечего (блок G6.2): её сцены лежат
   * на её собственном холсте. Если сцена шага не на этом холсте, прогон
   * перевозит Мастера туда — см. `revealStep`.
   *
   * Камера едет, только когда сцена не видна. На разложенной вручную главе
   * соседние сцены обычно рядом, и рывок на каждый шаг сбивал бы то самое
   * «вижу окружение», ради чего прогон не затемняет остальной холст.
   */
  const revealScene = useCallback(
    (sceneId: number) => {
      const key = `scene:${sceneId}`;
      setTimeout(
        () => {
          const target = nodesRef.current.find((n) => n.id === key);
          const inst = flowRef.current;
          const el = flowElRef.current;
          if (!target || !inst || !el) return;
          // Место ноды внутри главы отсчитывается ОТ РАМКИ, а setCenter ждёт
          // координаты доски: без перевода холст уезжает в пустоту.
          const at = toAbsolute(target, new Map(nodesRef.current.map((n) => [n.id, n])));
          const size = getNodeSize(target);
          const vp = inst.getViewport();
          const rect = el.getBoundingClientRect();
          const left = at.x * vp.zoom + vp.x;
          const top = at.y * vp.zoom + vp.y;
          const margin = 24;
          const visible =
            left >= margin &&
            top >= margin &&
            left + size.w * vp.zoom <= rect.width - margin &&
            top + size.h * vp.zoom <= rect.height - margin;
          if (!visible) {
            // Масштаб оставляем какой есть: прогон показывает сцену в её
            // окружении, а не приближает её вместо него.
            inst.setCenter(at.x + size.w / 2, at.y + size.h / 2, { zoom: vp.zoom, duration: 420 });
          }
        },
        0
      );
    },
    []
  );

  /** Шаг прогона: сервер отдаёт карточку, выходы и запасной ход по порядку. */
  const loadRehearsal = useCallback(
    async (sceneId: number | null) => {
      setRehearsalBusy(true);
      try {
        const q = new URLSearchParams();
        if (sceneId != null) q.set("scene_id", String(sceneId));
        else q.set("arc_id", String(arcId));
        if (campaignIdParam) q.set("campaign_id", String(campaignIdParam));
        const step = await api.get<RehearsalStep | null>(`/canvas/rehearsal?${q.toString()}`);
        setRehearsal(step);
        if (!step) return;
        /**
         * Шаг может увести на другой холст (решение Q23, блок G6.2).
         *
         * История пересекает главы 13 раз из 81 перехода, а сцены главы
         * лежат теперь на её собственном холсте. Прогон, который на границе
         * главы переставал подсвечивать, превратился бы в карточку без
         * холста — а холст в нём половина смысла. Поэтому переезжает он сам:
         * это то же «Войти», только жмёт не Мастер.
         *
         * Состояние прогона живёт в памяти вкладки и переезд переживает:
         * меняется адрес, а не страница.
         */
        const stepArc = step.preview.scene.arc_id;
        if (stepArc != null && stepArc !== arcId) {
          const next: Record<string, string> = { setting: String(settingId), arc: String(stepArc) };
          if (campaignIdParam) next.campaign = String(campaignIdParam);
          setSearchParams(next);
          // Подсветку ставим после того, как приедет новая доска: сейчас
          // этой ноды на холсте ещё нет и обмерять нечего.
          setTimeout(() => revealScene(step.preview.scene.id), 420);
          return;
        }
        revealScene(step.preview.scene.id);
      } finally {
        setRehearsalBusy(false);
      }
    },
    [arcId, settingId, campaignIdParam, revealScene, setSearchParams]
  );

  rehearsalRef.current = { on: rehearsalOn, step: rehearsal };

  // Уход со страницы кончает прогон вместе со звуком: карточка уводит в сцену
  // ссылкой (Q16), и без этого музыка сцены осталась бы играть в разделе, где
  // её нечем выключить.
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const rehearsalSetRef = useRef<number | null>(null);
  rehearsalSetRef.current = rehearsalSetId;
  useEffect(
    () => () => {
      if (rehearsalSetRef.current != null) soundRef.current?.revertSceneSet();
    },
    []
  );

  const startRehearsal = useCallback(() => {
    setRehearsalOn(true);
    setRehearsalBack([]);
    // Свёрнутая панель означала бы прогон без карточки — то есть без прогона.
    setPanelCollapsed(false);
    // С выделенной сцены, если она есть: прогон чаще всего начинают с того
    // места, куда уже смотрят.
    void loadRehearsal(selectedSceneId);
  }, [loadRehearsal, selectedSceneId]);

  const stopRehearsal = useCallback(() => {
    setRehearsalOn(false);
    setRehearsal(null);
    setRehearsalBack([]);
    if (rehearsalSetId != null) {
      sound?.revertSceneSet();
      setRehearsalSetId(null);
    }
  }, [rehearsalSetId, sound]);

  const stepRehearsal = useCallback(
    (sceneId: number) => {
      const from = rehearsalRef.current.step?.preview.scene.id;
      if (from != null) setRehearsalBack((h) => [...h, from]);
      void loadRehearsal(sceneId);
    },
    [loadRehearsal]
  );

  /** Назад — по истории прохода: обратной стрелки в модели нет и быть не должно. */
  const backRehearsal = useCallback(() => {
    setRehearsalBack((h) => {
      if (h.length === 0) return h;
      void loadRehearsal(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, [loadRehearsal]);

  stopRehearsalRef.current = stopRehearsal;
  backRehearsalRef.current = backRehearsal;
  stepRehearsalRef.current = stepRehearsal;

  /** Кнопка «Послушать»: тем же `sceneSet`, что у пульта, и с тем же возвратом. */
  const playRehearsalSound = useCallback(
    (set: { id: number; name: string } | null, sceneName: string) => {
      if (!sound) return;
      if (set == null) {
        sound.revertSceneSet();
        setRehearsalSetId(null);
        return;
      }
      sound.sceneSet(set.id, sceneName, set.name);
      setRehearsalSetId(set.id);
    },
    [sound]
  );

  /**
   * «Заглушённые подсказки» — единственное место, где заглушку видно и можно
   * снять (находка Н14). Ошибочное «Это не оно» иначе необратимо: подсказка
   * пропадает и из чипа, и из счётчика, а чипа у сцены может уже и не быть.
   *
   * Тем же `ContextMenu`, что и остальные меню раздела, — новой панели здесь
   * не заводится. Пункта нет вовсе, когда гасить нечего.
   */
  const openDismissed = useCallback(
    (x: number, y: number) => {
      const items: ContextMenuItem[] = [
        ...dismissed.setting.map((d) => ({
          label: `${d.name} — во всём сеттинге`,
          children: [
            {
              label: "Вернуть подсказку",
              onClick: () => {
                api.del(
                  `/canvas/hints/dismiss?scope=setting&setting_id=${settingId}&entity_type=${d.entity_type}&entity_id=${d.entity_id}`
                );
                setDismissed((prev) => ({
                  ...prev,
                  setting: prev.setting.filter((z) => !(z.entity_type === d.entity_type && z.entity_id === d.entity_id)),
                }));
                // Пересчёт, а не сборка вручную: вернуть подсказку — значит
                // заново пройти тексты всех сцен, и угадать этот ответ нельзя.
                reloadHints(boardRef.current);
              },
            },
          ],
        })),
        ...dismissed.scenes.map((d) => ({
          label: `${d.name} — в сцене «${d.scene_name}»`,
          children: [
            {
              label: "Вернуть подсказку",
              onClick: () => {
                api.del(
                  `/canvas/hints/dismiss?scope=scene&scene_id=${d.scene_id}&entity_type=${d.entity_type}&entity_id=${d.entity_id}`
                );
                setDismissed((prev) => ({
                  ...prev,
                  scenes: prev.scenes.filter(
                    (z) => !(z.scene_id === d.scene_id && z.entity_type === d.entity_type && z.entity_id === d.entity_id)
                  ),
                }));
                reloadHints(boardRef.current);
              },
            },
          ],
        })),
      ];
      if (items.length) setContextMenu({ x, y, items });
    },
    [dismissed, settingId, reloadHints]
  );

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
    (event: React.MouseEvent, node: Node<CanvasNodeData>) => {
      const [type, id] = splitKey(node.id);
      // Пин — векторная точка, верхний слой
      if (type === "pin") {
        const selectedPins = nodes.filter((n) => n.id.startsWith("pin:") && n.selected);
        const targetPins = selectedPins.length ? selectedPins : [node];
        const items: ContextMenuItem[] = [];
        items.push({
          label: "Создать связь",
          onClick: async () => {
            if (targetPins.length === 1) {
              const src = targetPins[0];
              const pos = { x: src.position.x + 40, y: src.position.y + 40 };
              const created = await api.post<{ id: number }>("/canvas/pins", { board_id: board?.board_id, name: "Пин", x: pos.x, y: pos.y, size: "M", color: DEFAULT_FRAME_COLOR, shape: "circle" });
              const fromId = Number(src.id.split(":")[1]);
              const toId = created.id;
              const a = Math.min(fromId, toId);
              const b = Math.max(fromId, toId);
              await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR });
              loadBoard();
            } else if (targetPins.length === 2) {
              const a = Math.min(Number(targetPins[0].id.split(":")[1]), Number(targetPins[1].id.split(":")[1]));
              const b = Math.max(Number(targetPins[0].id.split(":")[1]), Number(targetPins[1].id.split(":")[1]));
              await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR });
              loadBoard();
            } else if (targetPins.length === 3) {
              const ids = targetPins.map((n) => Number(n.id.split(":")[1])).sort((a,b)=>a-b);
              const pairs = [[ids[0],ids[1]],[ids[1],ids[2]],[ids[0],ids[2]]];
              for (const [a,b] of pairs) {
                try { await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR }); } catch {}
              }
              loadBoard();
            } else {
              alert("Слишком много пинов (" + targetPins.length + ") — напишите Тофу, что такой функционал и правда нужен.");
            }
          },
        });
        items.push({
          label: "Изменить цвет",
          children: FRAME_SWATCHES.map((sw) => ({
            label: sw.label,
            onClick: async () => { await api.put(`/canvas/pins/${id}`, { color: sw.value }); loadBoard(); },
          })),
        });
        if (node.parentId?.startsWith("frame:")) {
          items.push({
            label: "Убрать из группы",
            onClick: () => void removeFromGroup(node),
          });
        }
        items.push({
          label: "Удалить",
          danger: true,
          onClick: async () => { await api.del(`/canvas/pins/${id}`); loadBoard(); },
        });
        setContextMenu({ x: event.clientX, y: event.clientY, items });
        return;
      }
      if (type === "adventure") {
        // Ярлык открывается двойным щелчком с любой доски: сеттинг берём у
        // самого приключения, а не из адреса — на свободной доске его нет.
        const sid = (node.data as { settingId?: number }).settingId;
        // С карты кампании входим В КАМПАНИИ: тогда внутри приключения сразу
        // видны её версии сцен и отметки прохождения (решение D0 §13). Ради
        // этого `?campaign_id=` и делали, но попасть туда было нечем.
        if (sid) setSearchParams({ setting: String(sid), arc: String(id), ...(campaignMapId ? { campaign: String(campaignMapId) } : {}) });
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
      const selected = nodes.filter((n) => n.selected);
      // мульти-выделение стикер+картинка → меню группы (Q4)
      if (selected.length > 1 && selected.some((n) => n.id === node.id)) {
        const items: ContextMenuItem[] = [
          {
            // Одна операция — одно имя во всех трёх меню.
            label: "Создать группу",
            onClick: () => { void createGroup(); },
          },
          { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected) },
        ];
        setContextMenu({ x: event.clientX, y: event.clientY, items });
        return;
      }
      const [type, id] = splitKey(node.id);
      // Пин — векторная точка, верхний слой
      if (type === "pin") {
        const selectedPins = nodes.filter((n) => n.id.startsWith("pin:") && n.selected);
        const targetPins = selectedPins.length ? selectedPins : [node];
        const items: ContextMenuItem[] = [];
        items.push({
          label: "Создать связь",
          onClick: async () => {
            if (targetPins.length === 1) {
              const src = targetPins[0];
              const pos = { x: src.position.x + 40, y: src.position.y + 40 };
              const created = await api.post<{ id: number }>("/canvas/pins", { board_id: board?.board_id, name: "Пин", x: pos.x, y: pos.y, size: "M", color: DEFAULT_FRAME_COLOR, shape: "circle" });
              const fromId = Number(src.id.split(":")[1]);
              const toId = created.id;
              const a = Math.min(fromId, toId);
              const b = Math.max(fromId, toId);
              await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR });
              loadBoard();
            } else if (targetPins.length === 2) {
              const a = Math.min(Number(targetPins[0].id.split(":")[1]), Number(targetPins[1].id.split(":")[1]));
              const b = Math.max(Number(targetPins[0].id.split(":")[1]), Number(targetPins[1].id.split(":")[1]));
              await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR });
              loadBoard();
            } else if (targetPins.length === 3) {
              const ids = targetPins.map((n) => Number(n.id.split(":")[1])).sort((a,b)=>a-b);
              const pairs = [[ids[0],ids[1]],[ids[1],ids[2]],[ids[0],ids[2]]];
              for (const [a,b] of pairs) {
                try { await api.post("/canvas/threads", { board_id: board?.board_id, from_pin_id: a, to_pin_id: b, width: 2, color: DEFAULT_FRAME_COLOR }); } catch {}
              }
              loadBoard();
            } else {
              alert("Слишком много пинов (" + targetPins.length + ") — напишите Тофу, что такой функционал и правда нужен.");
            }
          },
        });
        items.push({
          label: "Изменить цвет",
          children: FRAME_SWATCHES.map((sw) => ({
            label: sw.label,
            onClick: async () => { await api.put(`/canvas/pins/${id}`, { color: sw.value }); loadBoard(); },
          })),
        });
        if (node.parentId?.startsWith("frame:")) {
          items.push({
            label: "Убрать из группы",
            onClick: () => void removeFromGroup(node),
          });
        }
        items.push({
          label: "Удалить",
          danger: true,
          onClick: async () => { await api.del(`/canvas/pins/${id}`); loadBoard(); },
        });
        setContextMenu({ x: event.clientX, y: event.clientY, items });
        return;
      }
      const items: ContextMenuItem[] = [];
      // Войти — дрилл-даун в другой холст. Осталось только у ярлыка приключения:
      // у сцены и главы «Войти» повторяло одиночный щелчок и не делало ничего.
      if (type === "adventure") {
        const sid = (node.data as { settingId?: number }).settingId;
        if (sid) {
          items.push({
            label: "Войти",
            onClick: () =>
              setSearchParams({ setting: String(sid), arc: String(id), ...(campaignMapId ? { campaign: String(campaignMapId) } : {}) }),
          });
        }
      } else if (type === "scene") {
        items.push({
          label: "Открыть страницу сцены",
          onClick: () => navigate(`/scenes/${id}`),
        });
      }
      if (type === "being" || type === "compendium_entry") {
        items.push({
          label: "Карточка существа",
          onClick: () => {
            const el = document.querySelector(`[data-id="${node.id}"]`);
            openCreatureCard(type, id, el?.getBoundingClientRect() ?? null);
          },
        });
      }
      if (ENTITY_PAGE_PATH[type]) {
        // Одно правило на все виды: у узла, за которым стоит страница, есть
        // дверь на неё. До блока G7 её имела одна сцена, а существо, локация
        // и предмет — нет, хотя страницы у них есть; «здесь открывается, а
        // здесь нет» Мастеру пришлось бы помнить за столом.
        items.push({
          label: "Открыть страницу",
          onClick: () => navigate(`/${ENTITY_PAGE_PATH[type]}/${id}`),
        });
      }
      if (type === "sticker" || type === "image" || type === "check" || type === "adventure" || type === "bundle") {
        items.push({
          label: "Переименовать",
          onClick: async () => {
            const cur = nodeTitle(node.data) ?? "";
            const name = prompt("Новое имя", String(cur));
            if (!name?.trim()) return;
            if (type === "sticker") await api.put(`/canvas/stickers/${id}`, { text: name.trim(), name: name.trim() });
            else if (type === "adventure") await api.put(`/story/arcs/${id}`, { name: name.trim() });
            else if (type === "check") await api.put(`/story/checks/${id}`, { what: name.trim() });
            else if (type === "bundle") await api.put(`/canvas/bundles/${id}`, { name: name.trim() });
            loadBoard();
          },
        });
        if (type === "sticker") {
          items.push({
            label: "Сменить цвет",
            children: STICKER_SWATCHES.map((sw) => ({
              label: sw.label,
              onClick: async () => { await api.put(`/canvas/stickers/${id}`, { color: sw.key }); loadBoard(); },
            })),
          });
        }
        items.push({
          label: "Дублировать",
          onClick: async () => {
            const pos = { x: node.position.x + 20, y: node.position.y + 20 };
            if (type === "sticker") {
              const d = node.data as StickerNodeData;
              await api.post("/canvas/stickers", { board_id: board?.board_id, text: d.text, color: d.color, x: pos.x, y: pos.y });
            }
            loadBoard();
          },
        });
        items.push({
          label: "Поднять",
          onClick: () => {
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: (n.zIndex ?? 0) + 1 } : n)));
            setNodes(next);
            scheduleSave(next);
          },
        });
        items.push({
          label: "Опустить",
          onClick: () => {
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: (n.zIndex ?? 0) - 1 } : n)));
            setNodes(next);
            scheduleSave(next);
          },
        });
        items.push({
          label: "На передний план",
          onClick: () => {
            const maxZ = Math.max(...nodes.map((n) => n.zIndex ?? 0), 0);
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: maxZ + 1 } : n)));
            setNodes(next);
            scheduleSave(next);
          },
        });
        items.push({
          label: "На задний план",
          onClick: () => {
            const minZ = Math.min(...nodes.map((n) => n.zIndex ?? 0), 0);
            const next = applyGroupDepth(nodes.map((n) => (n.id === node.id ? { ...n, zIndex: minZ - 1 } : n)));
            setNodes(next);
            scheduleSave(next);
          },
        });
      }
        if (node.parentId?.startsWith("frame:")) {
          items.push({
            label: "Убрать из группы",
            onClick: () => void removeFromGroup(node),
          });
        }
      if (type === "route") {
        // Второй пункт удаления рераута: «Удалить с ребром» убирает не только
        // разрыв, но и само реальное ребро (переход между сценами). Пункт
        // «Удалить» ниже по-прежнему лишь снимает разрыв (блок #6).
        const row = boardNodesOfType(board, "route").find((n) => n.route.id === Number(id))?.route;
        if (row?.kind === "transition" && row.transition_id != null) {
          items.push({
            label: "Удалить с ребром",
            danger: true,
            onClick: async () => {
              await api.del(`/story/transitions/${row.transition_id}`);
              await api.del(`/canvas/routes/${id}`);
              loadBoard();
            },
          });
        }
      }
        items.push({
          label: "Удалить",
          danger: true,
          onClick: async () => {
            if (type === "check") await api.del(`/story/checks/${id}`);
          else if (type === "sticker" || type === "image") {
            await api.del(`/canvas/board/node?board_id=${board?.board_id}&node_type=${type}&node_id=${id}`);
          } else if (type === "route") {
            // «Маршрут»: удаляем только разрыв — реальное ребро остаётся.
            await api.del(`/canvas/routes/${id}`);
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
    [board, loadBoard, settingId, arcId, freeId, campaignIdParam, setSearchParams, navigate, nodes, createGroup, removeFromGroup]
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
          if (nodeType === "pin") return api.del(`/canvas/pins/${nodeId}`);
          // Рераут — только разрыв: реальное ребро остаётся, снимаем память
          // прохода, а не саму связь. Удаление «нода+связь» — отдельный жест.
          if (nodeType === "route") return api.del(`/canvas/routes/${nodeId}`);
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
      const selected = selectedNodes.length ? selectedNodes : nodes.filter((n) => n.selected);
      if (selected.length <= 1) return;
      const items: ContextMenuItem[] = [
        {
          // Одна операция — одно имя во всех меню.
          label: "Создать группу",
          onClick: () => { void createGroup(); },
        },
        { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected) },
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [board, loadBoard, nodes, onNodesDelete, createGroup]
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      (event as React.MouseEvent).preventDefault();
      const selected = nodes.filter((n) => n.selected);
      if (selected.length > 1) {
        const items: ContextMenuItem[] = [
          {
            // Одна операция — одно имя во всех меню.
            label: "Создать группу",
            onClick: () => { void createGroup(); },
          },
          { label: "Удалить выбранные", danger: true, onClick: () => onNodesDelete(selected) },
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
          // Та же операция, что в меню «Узлы» — и то же имя: два разных
          // названия у одного действия читались как два разных действия.
          label: "Создать группу",
          onClick: () => { void createGroup(flowPos); },
        },
        { label: PALETTE_NAME, onClick: () => setPaletteOpen(true) },
      ];
      setContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [board, loadBoard, nodes, onNodesDelete, createGroup]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      // палитра → холст: перетащил и там где бросил — там и нода
      const paletteRaw = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (paletteRaw && board) {
        const flowPos = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 0, y: 0 };
        const x = Math.round(flowPos.x);
        const y = Math.round(flowPos.y);
        try {
          const data = JSON.parse(paletteRaw) as PaletteDragPayload;
          if (data.kind === "entity" && data.item) {
            const item = data.item;
            // Бросок поверх рамки сразу делает ноду членом группы (В5):
            // сервер принимает `parent_key` в `POST /board/node`.
            const parent = frameAtPoint(board, x, y);
            await api.post("/canvas/board/node", {
              ...boardTarget,
              node_type: item.type,
              node_id: item.id,
              x,
              y,
              ...(parent ? { parent_key: parent } : {}),
            });
            loadBoard();
            return;
          }
          // Ниже — те, кому нужна настоящая строка доски: у пина, набора и
          // картинки `board_id` лежит в своей таблице и вывести его не из
          // чего. На нетронутой карте их бросок молчит, как молчал и раньше.
          if (!board.board_id) return;
          if (data.kind === "pin" && data.pin) {
            const pinData = data.pin;
            const created = await api.post<{ id: number }>("/canvas/pins", { board_id: board.board_id, name: pinData.name, x, y, size: pinData.size, color: pinData.color, shape: pinData.shape });
            openPinNameEditor(created.id);
            return;
          }
          if (data.kind === "route") {
            // P1: автоподхват ближайшего ребра при дропе — один жест вместо двух подводок
            let from_key = "";
            let to_key = "";
            let kind: string | undefined = undefined;
            let bestDist = Infinity;
            let bestEdge: any = null;
            for (const e of edges) {
              const s: any = (nodes as any[]).find((n: any) => n.id === e.source);
              const t2: any = (nodes as any[]).find((n: any) => n.id === e.target);
              if (!s || !t2) continue;
              const mx = (s.position.x + t2.position.x) / 2;
              const my = (s.position.y + t2.position.y) / 2;
              const d = Math.hypot(x - mx, y - my);
              if (d < bestDist) { bestDist = d; bestEdge = e; }
            }
            if (bestEdge && bestDist < 120) {
              from_key = bestEdge.source;
              to_key = bestEdge.target;
              kind = "transition";
            }
            if (from_key && to_key) {
              await api.post("/canvas/routes", { board_id: board.board_id, x, y, from_key, to_key, kind });
            } else {
              await api.post("/canvas/routes", { board_id: board.board_id, x, y });
            }
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
    [board, loadBoard, arcId, boardTarget, nodes, edges]
  );

  // Delete клавишей — для фриформ стикеров/картинок (после onNodesDelete, иначе TDZ)
  // Alt+W/S — поднять/опустить выбранную ноду только на полотне
  //
  // Ноды берутся из `nodesRef`, а не из зависимостей: перетаскивание меняет
  // `nodes` на каждом кадре, и со списком зависимостей `[nodes]` этот эффект
  // на каждом же кадре снимал и вешал слушатель заново. Обработчику нужны
  // ноды в момент нажатия клавиши, а не в момент подписки, — ref для этого и
  // заведён.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      const current = nodesRef.current;
      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        const selected = current.filter((n) => n.selected);
        if (!selected.length) return;
        e.preventDefault();
        onNodesDelete(selected);
        return;
      }
      if (e.altKey && (e.code === "KeyW" || e.code === "KeyS" || e.key.toLowerCase() === "w" || e.key.toLowerCase() === "s") && !isInput) {
        const selected = current.filter((n) => n.selected);
        if (!selected.length) return;
        // только на полотне: фокус внутри .canvas-flow
        const active = document.activeElement?.closest(".canvas-flow");
        if (!active && !selected.length) return;
        e.preventDefault();
        const isUp = e.code === "KeyW" || (!e.code && e.key.toLowerCase() === "w");
        const delta = isUp ? 1 : -1;
        const next = applyGroupDepth(current.map((n) => (n.selected ? { ...n, zIndex: (n.zIndex ?? 0) + delta } : n)));
        setNodes(next);
        scheduleSave(next);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onNodesDelete, scheduleSave, setNodes]);

  /**
   * Клавиши прогона (блок G3) — ОТДЕЛЬНЫМ слушателем и в фазе ПЕРЕХВАТА.
   *
   * Не прихотью: щелчок по ноде ставит фокус на её div, а React Flow гасит на
   * нём всплытие клавиш — и до слушателя на `window` ни пробел, ни стрелки не
   * доезжали. Проверено руками: синтетическое событие в `window` шаг делало, а
   * настоящее нажатие — нет. Перехват ловит нажатие раньше React Flow.
   *
   * Прогон забирает себе ровно три клавиши. Delete, Alt+W/S и Ctrl+Z работают
   * в прогоне как работали: холст остаётся правимым, потому что прогон и
   * открывают, чтобы чинить найденное на месте.
   *
   * Слушатель подписывается один раз: и состояние прогона, и его действия
   * читаются из ref. Со списком зависимостей он переподписывался бы на каждый
   * шаг — тот же счёт, что уже оплачен переподпиской в этом файле.
   */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const r = rehearsalRef.current;
      if (!r.on) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (e.key === "Escape") {
        e.preventDefault();
        stopRehearsalRef.current();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        backRehearsalRef.current();
        return;
      }
      if (e.key === "ArrowRight" || e.code === "Space" || e.key === " ") {
        const step = r.step;
        if (!step) return;
        const steppable = step.exits.filter((x) => !x.outside);
        // На развилке «вперёд» перестаёт быть однозначным, и угадывать за
        // Мастера нельзя: выбор мышью. Нажатие всё равно гасится — иначе
        // пробел прокрутит страницу под холстом.
        const next =
          steppable.length === 1
            ? steppable[0].scene.id
            : steppable.length === 0
              ? step.next_in_order?.id ?? null
              : null;
        e.preventDefault();
        if (next != null) stepRehearsalRef.current(next);
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  /**
   * Выделено ровно одно — и панель свойств показывает именно его.
   *
   * Шесть состояний выделения жили шестью строками из шести вызовов на каждый
   * тип ноды, и продублированы были дважды. Каждый недосмотр в такой строке —
   * панель, показывающая прошлый выбор: у приключения так и осталась открытой
   * панель пина после щелчка в пустоту.
   */
  const selectOnly = useCallback((type: string, id: number) => {
    setSelectedSceneId(type === "scene" ? id : null);
    setSelectedCheckId(type === "check" ? id : null);
    setSelectedStickerId(type === "sticker" ? id : null);
    setSelectedFrameId(type === "frame" ? id : null);
    setSelectedChapterId(type === "chapter" ? id : null);
    setSelectedPinId(type === "pin" ? id : null);
    setSelectedAdventureId(type === "adventure" ? id : null);
    setSelectedRouteId(type === "route" ? id : null);
  }, []);

  /** Найденное поиском — в центр экрана и в панель свойств. */
  const focusFound = useCallback(
    (n: Node<CanvasNodeData>) => {
      flowRef.current?.fitView({ nodes: [n], padding: 0.35, duration: 300 });
      const [t, id] = splitKey(n.id);
      selectOnly(t, id);
    },
    [selectOnly]
  );

  /**
   * Поставить стартовый набор на пустую свободную доску (блок G5).
   *
   * Всю работу делает сервер одной транзакцией: нить ссылается на пины, и
   * набор из трёх последовательных запросов мог бы доехать до половины.
   * Отсюда — перезагрузка доски и подгон камеры: Мастер должен увидеть
   * поставленное, а не пустое место, где оно лежит.
   */
  async function startPreset(preset: string) {
    if (!freeId || startingPreset) return;
    setStartingPreset(preset);
    try {
      await api.post(`/canvas/free-boards/${freeId}/preset`, { preset });
      loadBoard();
      // С задержкой: ноды приезжают загрузкой доски, и fitView, вызванный
      // сейчас, мерил бы ещё пустой холст.
      setTimeout(() => flowRef.current?.fitView({ padding: 0.3, duration: 300 }), 260);
    } finally {
      setStartingPreset(null);
    }
  }

  /** Создать свободную доску с именем из инлайновой формы. */
  async function createFreeBoard() {
    const name = (newBoardName ?? "").trim();
    if (!name || creatingBoard) return;
    setCreatingBoard(true);
    try {
      const created = await api.post<{ id: number; scope_id: number; name: string }>("/canvas/free-boards", { name });
      setNewBoardName(null);
      setSearchParams({ free_id: String(created.scope_id) });
    } finally {
      setCreatingBoard(false);
    }
  }

  /**
   * Полотно — одно на все виды доски.
   *
   * Раньше здесь стояли два почти одинаковых блока: один для фриформ-доски,
   * другой для приключения. Почти — это триста строк, разошедшихся по трём
   * местам: у приключения не открывалась панель пина и не закрывалась по
   * щелчку в пустоту, а поиск по узлам жил только там, хотя кнопка «Поиск»
   * показывается и на фриформе. Разница между видами доски — только в том,
   * чем наполнять палитру; ради неё копия не нужна.
   */
  const boardSurface = board && (
    <div className="canvas-body">
      <div className="canvas-flow" ref={flowElRef}>
        {/* Снэп включён всегда, без органа управления и без модификатора
            (решение Q6, блок G6.1): 26 пикселей меньше разброса руки при
            броске ноды, а богатство органов управления считается минусом, пока
            не доказано обратное. Растягивание рамок сюда входит даром — ручки
            ресайза читают тот же `snapGrid` из стора React Flow. */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onInit={(inst) => {
            flowRef.current = inst;
          }}
          snapToGrid
          snapGrid={[GRID, GRID]}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodesDelete={onNodesDelete}
          onNodeClick={(event, node) => {
            const [type, id] = splitKey(node.id);
            // Щелчок по портрету ноды раскрывает карточку существа: это
            // единственный элемент ноды без своей роли (шаг 4 ревизии).
            // Второй вход — пункт меню по двойному щелчку: цель 26×26 мелкая,
            // дублирующий вход обязателен.
            if (
              (type === "being" || type === "compendium_entry") &&
              (event.target as HTMLElement).closest(".canvas-node__portrait")
            ) {
              const rect = (event.target as HTMLElement).getBoundingClientRect();
              openCreatureCard(type, id, rect);
              return;
            }
            // П1.2: Ctrl/Cmd-щелчок — добавить узел к выделению, а не заменить
            // его. React Flow сам переключает выделение (onNodesChange ->
            // applyNodeChanges пропускает select-изменения, и в базу оно не
            // пишется), так что при зажатом модификаторе не схлопываем выборку
            // в selectOnly и не пишем focus в адрес: эффект по focusParam ниже
            // иначе снова свёл бы набор выделенных к одному узлу.
            if (event.ctrlKey || event.metaKey) return;
            selectOnly(type, id);
            // focus в адресе — чтобы ссылку на узел можно было сохранить.
            const next: Record<string, string> = {};
            if (freeId) next.free_id = String(freeId);
            else {
              next.setting = String(settingId);
              if (arcId) next.arc = String(arcId);
              // Без этого щелчок по узлу на схеме сеттинга терял `view=map` и
              // выбрасывал обратно в список — то есть выделить узел было
              // нельзя вовсе.
              if (settingMapId) next.view = "map";
              if (campaignIdParam) next.campaign = String(campaignIdParam);
              if (campaignMapId) {
                next.campaign = String(campaignMapId);
                next.view = "map";
                delete next.setting;
              }
            }
            next.focus = node.id;
            setSearchParams(next);
          }}
          onPaneClick={() => selectOnly("", 0)}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          onNodeDoubleClick={handleNodeDoubleClick}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          proOptions={{ hideAttribution: true }}
          panOnDrag={[1]}
          // В прогоне пробел — «вперёд», и вторая роль ему не нужна: по
          // умолчанию @xyflow отдаёт зажатый пробел под панораму.
          panActivationKeyCode={rehearsalOn ? null : undefined}
          selectionOnDrag
          // Выделенная нода не всплывает над рамкой: рамка главы больше её
          // содержимого, и всплывшая рамка закрыла бы собой свои же сцены.
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
        >
          <Background gap={GRID} size={1.4} color="var(--line)" />
          <ControlsButtons />
          {/* Вид и цвета — в canvas.css (.react-flow__minimap), там же её
              прячет @container ниже порога узкого экрана. */}
          <MiniMap pannable zoomable />
          <CanvasLegend />
          {/*
            Пустая свободная доска обязана объяснить, что здесь будет (блок G5).
            Инвариант п. 11 велит блоку без содержимого не показываться, но у
            главного блока экрана оговорка ровно обратная — а холст здесь и есть
            главный блок.

            Только у свободной доски: у приключения без сцен пусто по другой
            причине (сцены заводятся в приключении, а не на холсте), и «Таверна»
            там была бы предложением не того.

            Набор предлагается на пустой доске, а не при её создании: выбор в
            момент создания — лишний шаг тому, кто просто заводит доску, а страх
            пустого листа случается не когда доску называют, а когда на неё
            посмотрели.
          */}
          {board?.free && boardEmpty && presets.length > 0 && (
            <div className="canvas-blank">
              <div className="canvas-blank__label">Пустая доска</div>
              <p className="canvas-blank__lead">
                Свободная доска — для того, что не ложится в приключение: пины и
                нити, стикеры, картинки, вытащенные рукой сущности. Ставьте своё
                из палитры — или возьмите набор, чтобы было с чего начать.
              </p>
              <div className="canvas-blank__row">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="canvas-blank__btn"
                    disabled={!!startingPreset}
                    onClick={() => startPreset(p.key)}
                  >
                    {startingPreset === p.key ? "Ставлю…" : p.label}
                  </button>
                ))}
              </div>
              <p className="canvas-blank__note">
                Три пина и две нити. Не подошло — рамка выделения и Delete.
              </p>
            </div>
          )}
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
                  if (e.key === "Enter" && filteredSearch[0]) focusFound(filteredSearch[0]);
                  if (e.key === "Escape") setSearchOpen(false);
                }}
              />
              <div className="canvas-search__list">
                {filteredSearch.slice(0, 8).map((n) => (
                  <button key={n.id} className="canvas-search__item" onClick={() => focusFound(n)}>
                    {nodeTitle(n.data) ?? n.id}
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
          {/* Кнопка палитры уезжает вправо, пока палитра открыта: иначе панель
              накрывает собственный переключатель, и закрыть её нечем. */}
          <button
            type="button"
            className={`canvas-overlay-toggle canvas-overlay-toggle--palette${paletteOpen ? " is-shifted" : ""}`}
            aria-expanded={paletteOpen}
            // aria-label, а не только title: внутри кнопки одна картинка, а
            // title — последняя подпорка в расчёте имени и на касании не
            // показывается вовсе.
            aria-label={`${paletteOpen ? "Скрыть" : "Показать"} ${PALETTE_NAME_ACC}`}
            onClick={() => setPaletteOpen((v) => !v)}
            title={`${paletteOpen ? "Скрыть" : "Показать"} ${PALETTE_NAME_ACC}`}
          >
            <NavIcon name="palette" className="canvas-overlay-toggle__icon" />
          </button>
          <button
            type="button"
            className="canvas-overlay-toggle canvas-overlay-toggle--panel"
            aria-expanded={!panelCollapsed}
            aria-label={panelCollapsed ? "Развернуть панель свойств" : "Свернуть панель свойств"}
            onClick={() => setPanelCollapsed((v) => !v)}
            title={panelCollapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {panelCollapsed ? "»" : "«"}
          </button>
        </ReactFlow>

        {/* Портал в <body>, как у модалки: у полотна свой контекст наложения
            (трансформация вьюпорта React Flow), и поповер, оставленный внутри
            него, ложился поверх модалки полного статблока, которую сам же и
            открывает. */}
        {creatureCard &&
          createPortal(
            <>
              {/* Подложка-ловушка щелчка: карточка закрывается щелчком мимо, а
                  не крестиком — руки Мастера уже на полотне. */}
              <div className="creature-card-popover-backdrop" onClick={() => setCreatureCard(null)} />
              <div className="creature-card-popover" style={{ left: creatureCard.x, top: creatureCard.y }}>
                <CreatureCardLoader
                  type={creatureCard.type}
                  id={creatureCard.id}
                  onClose={() => setCreatureCard(null)}
                />
              </div>
            </>,
            document.body
          )}

        {paletteOpen && (
          <CanvasPalette
            arcId={freeId ? 0 : arcId}
            settingId={freeId ? 0 : settingId}
            boardId={board.board_id ?? null}
            boardTarget={boardTarget}
            campaignId={freeId ? null : board.campaign_id ?? null}
            shelfVersion={shelfVersion}
            onAdded={(sceneId) => {
              // Новая сцена сразу выделяется: её положили под разложенным, и
              // без выделения Мастер ищет глазами, что именно приехало. Полка
              // тоже перечитывается — у заготовки меняется счётчик вставок.
              refreshAll();
              if (sceneId != null) setSelectedSceneId(sceneId);
            }}
            onPinCreated={(pinId) => openPinNameEditor(pinId)}
          />
        )}
      </div>
      {!panelCollapsed &&
        (rehearsalOn ? (
          <RehearsalPanel
            step={rehearsal}
            busy={rehearsalBusy}
            history={rehearsalBack}
            playingSetId={rehearsalSetId}
            onStep={stepRehearsal}
            onBack={backRehearsal}
            onExit={stopRehearsal}
            onPlay={playRehearsalSound}
          />
        ) : nodes.filter((n) => n.selected).length > 1 ? (
          /* Мультивыделение (П1.2): несколько узлов — вместо одиночных панелей
             свойств сводка по выделению (число, разбивка по типам, сборка в
             группу). Ровно один выбранный узел по-прежнему открывает свою
             панель ниже. */
          <MultiselectPanel
            nodes={nodes.filter((n) => n.selected)}
            onCreateGroup={() => void createGroup()}
          />
        ) : selectedAdventureId != null ? (
          <AdventureProperties
            arcId={selectedAdventureId}
            board={board}
            nodes={nodes}
            onChanged={refreshAll}
          />
        ) : selectedFrameId != null ? (
          <FrameProperties
            frameId={selectedFrameId}
            board={board}
            onSaved={refreshAll}
            onRemoveMember={(key) => {
              const n = nodesRef.current.find((x) => x.id === key);
              if (n) void removeFromGroup(n);
            }}
          />
        ) : selectedChapterId != null ? (
          <ChapterProperties chapterId={selectedChapterId} board={board} onSaved={refreshAll} onEnter={enterChapter} />
        ) : selectedPinId != null ? (
          <PinProperties pinId={selectedPinId} board={board} onSaved={refreshAll} autoEdit={fresh?.edit === true && fresh.key === `pin:${selectedPinId}`} />
        ) : selectedRouteId != null ? (
          <RouteProperties routeId={selectedRouteId} board={board} onSaved={refreshAll} />
        ) : selectedStickerId != null ? (
          <StickerProperties stickerId={selectedStickerId} onSaved={refreshAll} board={board} />
        ) : selectedCheckId != null ? (
          <CheckProperties checkId={selectedCheckId} onSaved={refreshAll} board={board} />
        ) : selectedSceneId != null ? (
          <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />
        ) : null)}
    </div>
  );

  // Список полотен и открытая доска — две разные страницы под одним адресом:
  // доска забирает всё окно, список скроллится вместе с ним. Высоту и лишние
  // строки шапки различаем этим признаком, а не повтором условий по месту.
  const boardMode = freeId > 0 || campaignMapId > 0 || settingMapId > 0 || arcId > 0;

  return (
    <div className={`stack canvas-page ${boardMode ? "canvas-page--board" : "canvas-page--index"}`} style={{ position: "relative" }}>
      <SectionBackground />
      {/* Шапка. В списке к ней же прижата «Открыть доску…»: отдельной строкой
          она стоила ещё одного пустого ряда под потолком. */}
      <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
        {freeId ? (
          <>
            <Link to="/canvas" style={{ color: "var(--muted)" }}>Все полотна</Link>
            <span style={{ color: "var(--muted)" }}>›</span>
            <span style={{ color: "var(--ink)" }}>{board?.free?.name || `Доска ${freeId}`}</span>
          </>
        ) : campaignMapId ? (
          <>
            <Link to="/canvas" style={{ color: "var(--muted)" }}>Все полотна</Link>
            <span style={{ color: "var(--muted)" }}>›</span>
            <span style={{ color: "var(--muted)" }}>{board?.campaign_map?.name || `Кампания ${campaignMapId}`}</span>
            <span style={{ color: "var(--muted)" }}>›</span>
            <span style={{ color: "var(--ink)" }}>Карта</span>
          </>
        ) : settingId ? (
          <>
            {/* Сеттинг — метка, а не ссылка: своего экрана у него в Полотне
                нет, есть список и схема. Наверх ведёт «Все полотна». */}
            <Link to="/canvas" style={{ color: "var(--muted)" }}>Все полотна</Link>
            <span style={{ color: "var(--muted)" }}>›</span>
            {/* Кампания входа занимает ступень сеттинга, а не встаёт рядом с
                ним (Q26): холст один и тот же, а отвечает он на вопрос «чьими
                глазами смотрим». Ступень ведёт на карту кампании — туда, где
                это приключение и открыли. */}
            {arcId && campaignIdParam ? (
              <Link
                to={`/canvas?campaign=${campaignIdParam}&view=map`}
                style={{ color: "var(--muted)" }}
                title="Карта кампании"
              >
                {`в кампании «${board?.campaign?.name || campaignIdParam}»`}
              </Link>
            ) : (
              <span style={{ color: settingMapId ? "var(--muted)" : "var(--ink)" }}>{board?.setting?.name || settings.find((s) => s.id === settingId)?.name || `Сеттинг ${settingId}`}</span>
            )}
            {/* Схема — последняя ступень хлебных крошек, а не безымянный холст:
                иначе на схеме и в списке заголовок одинаковый (блок D3). */}
            {settingMapId ? (
              <>
                <span style={{ color: "var(--muted)" }}>›</span>
                <span style={{ color: "var(--ink)" }}>Схема</span>
              </>
            ) : null}
            {arcId ? (
              <>
                <span style={{ color: "var(--muted)" }}>›</span>
                {/* Ступень приключения. На холсте главы это её родитель и
                    дорога наверх, на холсте приключения — оно само (G6.2). */}
                <Link
                  to={`/canvas?setting=${settingId}&arc=${board?.arc?.parent?.id ?? arcId}${campaignIdParam ? `&campaign=${campaignIdParam}` : ""}`}
                  style={{ color: board?.arc?.parent || focusParam.startsWith("scene:") ? "var(--muted)" : "var(--ink)" }}
                >
                  {board?.arc?.parent?.name || board?.arc?.name || arcs.find((a) => a.id === arcId)?.name || `Приключение ${arcId}`}
                </Link>
                {/* Ступень главы — когда открыт ЕЁ холст. Прежде она
                    показывалась по выделению рамки; выделение — не место, где
                    находишься, и ступенью крошек быть не должно. */}
                {board?.arc?.parent && (
                  <>
                    <span style={{ color: "var(--muted)" }}>›</span>
                    <Link
                      to={`/canvas?setting=${settingId}&arc=${arcId}${campaignIdParam ? `&campaign=${campaignIdParam}` : ""}`}
                      style={{ color: focusParam.startsWith("scene:") ? "var(--muted)" : "var(--ink)" }}
                    >
                      {board.arc.name}
                    </Link>
                  </>
                )}
                {focusParam.startsWith("scene:") && (
                  <>
                    <span style={{ color: "var(--muted)" }}>›</span>
                    <span style={{ color: "var(--ink)" }}>{boardNodesOfType(board, "scene").find((n) => n.key === focusParam)?.scene.name || `Сцена ${focusParam.split(":")[1]}`}</span>
                  </>
                )}
                {/* Выход в базу (Q26): та же доска без правок кампании. Не
                    переключатель — уходит вместе с кампанией и на базовом
                    холсте не показывается вовсе. */}
                {campaignIdParam ? (
                  <button
                    className="canvas-index__map"
                    style={{ marginLeft: 6 }}
                    title="Открыть это приключение без правок кампании"
                    onClick={() => {
                      const next: Record<string, string> = { setting: String(settingId), arc: String(arcId) };
                      if (focusParam) next.focus = focusParam;
                      setSearchParams(next);
                    }}
                  >
                    В базе
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <SectionHeading section="canvas" compact>Полотно</SectionHeading>
        )}
        {/* «Открыть доску…», а не «Открыть холст…» (блок D5): слово «холст»
            из подписей кнопок ушло вовсе — мастер открывает именно свободные
            доски, приключения и карты открываются со списка ниже.
            Общее «+ Доска» стоит не здесь, а у заголовка «Мои доски»: с блока
            D5 доску заводят ещё и у сеттинга, и у кампании, и кнопка наверху
            стала бы третьей одноимённой без указания, чья доска получится. */}
        {!boardMode && <button onClick={() => setShowOpenWizard(true)}>Открыть доску…</button>}
      </div>

      {/* Панель холста. В списке ей нечего показать, и пустая строка съедала
          два зазора под шапкой — поэтому её там нет вовсе. */}
      {boardMode && (
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>

        {/* Схема сеттинга получает ту же панель, что и остальные доски: без
            неё на ней нет ни рамок, ни стикеров, а группировка рамками — это
            условие пригодности схемы, а не украшение (решение D0 §5). */}
        {(arcId > 0 || freeId > 0 || settingMapId > 0 || campaignMapId > 0) && board && (
          <>
            <div style={{ position: "relative" }}>
              <button onClick={() => setCanvasMenuOpen((v) => !v)}>Полотно ▾</button>
              {canvasMenuOpen && (
                <div className="context-menu" style={{ position: "absolute", top: "100%", left: 0, zIndex: 10 }}>
                  <button onClick={() => { setCanvasMenuOpen(false); setShowCanvasWizard(true); }}>Мастер создания полотна</button>
                  <button onClick={() => { setCanvasMenuOpen(false); handleQuickCanvas(); }}>Быстрое полотно</button>
                  <button onClick={() => { setCanvasMenuOpen(false); setShowOpenWizard(true); }}>Открыть</button>
                  {/* Пункта нет, когда гасить нечего: блок, которому нечего
                      показать, не показывается. */}
                  {(dismissed.setting.length > 0 || dismissed.scenes.length > 0) && (
                    <button
                      onClick={(e) => {
                        setCanvasMenuOpen(false);
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        openDismissed(r.left, r.bottom);
                      }}
                    >
                      Заглушённые подсказки ({dismissed.setting.length + dismissed.scenes.length})
                    </button>
                  )}
                  {/* Экспорта и импорта здесь нет намеренно. Выключенные пункты
                      «(скоро)» стояли тут с цикла 5 (решение Q6) и спорили с
                      инвариантом дизайна: пункт, которому нечего показать, не
                      показывается. Вернутся вместе с самим экспортом. */}
                </div>
              )}
            </div>
            {/* Счётчик недоделок (блок G1). Один орган управления, а не
                панель: число и прыжок в одной кнопке, списка нет намеренно —
                список это панель, а она здесь не нужна.

                Нажатие делает ДВА дела: прыгает к следующей недоделке и
                перечитывает подсказки. Полный пересчёт только здесь и при
                открытии доски — 142 мс на каждую правку вернули бы то, от чего
                уходили в шаге 2.

                Кнопки нет, когда недоделок нет: пункт, которому нечего
                показать, не показывается. Когда доводка кончится, счётчик
                уйдёт сам. */}
            {hintTotal > 0 && (
              <button
                title="Перейти к следующей недоделке: сперва развилки без выхода и незаполненные исходы, потом сцены без места и упоминания"
                onClick={() => {
                  gotoNextHint();
                  reloadHints(boardRef.current);
                }}
              >
                {`Недоделок: ${hintTotal} →`}
              </button>
            )}
            {/* Режим репетиции (блок G3) — второй режим холста, а не пункт
                меню: в меню «Полотно ▾» лежит создание и открытие полотен, а
                «Пройти» про то, что уже открыто, и там его не найдут.

                Одна кнопка в двух состояниях, а не две рядом: множественность
                показывается сменой состояния элемента. Кнопки нет, когда
                проходить нечего, — тем же правилом, что и у счётчика выше. */}
            {arcId > 0 && hasScenesOnBoard && (
              <button
                className={rehearsalOn ? "primary" : undefined}
                title={
                  rehearsalOn
                    ? "Закончить прогон (Escape)"
                    : "Тихий прогон истории: состав, проверки, звук и куда дальше"
                }
                onClick={() => (rehearsalOn ? stopRehearsal() : startRehearsal())}
              >
                {rehearsalOn ? "Выйти из прогона" : "Пройти"}
              </button>
            )}
            {/* «+ Приключение», а не «+ Холст» (решение D0 §15): холста
                приключения отдельно от приключения не существует, и слово
                «холст» в подписи через месяц никто не свяжет с тем, что
                удаление сотрёт приключение со сценами. Заводит в сеттинге и
                ОСТАВЛЯЕТ на схеме: новое приключение нужно куда-то положить,
                а уход в его пустой холст этому мешает. */}
            {/* Состав кампании правится прямо с карты (решение владельца от
                2026-08-27): иначе карта показывает, что играется, а поменять
                это негде. «Добавить приключение сеттинга» втягивает готовое,
                «+ Приключение» заводит новое — оно живёт ТОЛЬКО в этой
                кампании и в заготовку сеттинга не попадает (решение D0 §16). */}
            {campaignMapId > 0 && <AddSettingArcButton campaignId={campaignMapId} onAdded={loadBoard} />}
            {(settingMapId > 0 || campaignMapId > 0) && (
              newArcName === null ? (
                <button className="primary" onClick={() => setNewArcName("")}>
                  {campaignMapId ? "+ Приключение кампании" : "+ Приключение"}
                </button>
              ) : (
                <form
                  className="row"
                  style={{ gap: 6 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = newArcName.trim();
                    if (!name) return;
                    if (campaignMapId) {
                      await api.post("/story/arcs", {
                        setting_id: board?.campaign_map?.setting_id ?? settingId,
                        campaign_id: campaignMapId,
                        name,
                        kind: "adventure",
                      });
                    } else {
                      await api.post("/story/arcs", { setting_id: settingMapId, name, kind: "adventure" });
                    }
                    setNewArcName(null);
                    loadBoard();
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Название нового приключения"
                    placeholder="Название приключения"
                    value={newArcName}
                    onChange={(e) => setNewArcName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setNewArcName(null); }}
                  />
                  <button type="submit" className="primary" disabled={!newArcName.trim()}>Создать</button>
                  <button type="button" onClick={() => setNewArcName(null)}>Отмена</button>
                </form>
              )
            )}
            <div style={{ position: "relative" }}>
              <button onClick={() => setNodeMenuOpen((v) => !v)}>Узлы ▾</button>
              {nodeMenuOpen && (
                <div className="context-menu" style={{ position: "absolute", top: "100%", left: 0, zIndex: 10 }}>
                  <button onClick={() => { setNodeMenuOpen(false); setPaletteOpen(true); }}>{PALETTE_NAME}</button>
                  <button onClick={() => { setNodeMenuOpen(false); void createGroup(); }}>Создать группу</button>
                  <button onClick={() => { setNodeMenuOpen(false); autoLayoutUnplaced(); }}>Упорядочить узлы</button>
                </div>
              )}
            </div>
            <button disabled={!canUndo} onClick={undoLayout} aria-label="Отменить последнюю правку раскладки" title="Отменить (Ctrl+Z)" style={{ padding: "6px 8px" }}>←</button>
            <button disabled={!canRedo} onClick={redoLayout} aria-label="Повторить отменённую правку раскладки" title="Повторить (Ctrl+Y)" style={{ padding: "6px 8px" }}>→</button>
            <button onClick={() => setSearchOpen((v) => !v)} title="Поиск по узлам (Ctrl+K)">
              Поиск
            </button>
          </>
        )}

        {boardCounts.length > 0 && (
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
            {boardCounts.join(" · ")}
          </span>
        )}
      </div>
      )}

      {freeId ? (
        !board ? <EmptyState title="Загрузка…" hint="Фриформ-доска" /> : boardSurface
      ) : campaignMapId ? (
        // Карта кампании (блок D4) — тот же холст, но отвечает на вопрос «где
        // мы сейчас»: узлы покрашены прохождением, а состав — приключения
        // кампании, а не всего сеттинга.
        !board ? <EmptyState title="Загрузка…" hint="Карта кампании" /> : boardSurface
      ) : settingMapId ? (
        // Схема сеттинга (блок D3) — второй взгляд на тот же сеттинг, а не
        // обязательный шаг на пути к сценам, каким он был до Q17. Список
        // остаётся дорогой по умолчанию, сюда приходят переключателем.
        !board ? <EmptyState title="Загрузка…" hint="Схема сеттинга" /> : boardSurface
      ) : !arcId ? (
        // Один экран вместо двух (Q21): свои доски и приключения, сгруппированные
        // по сеттингу. Схема сеттинга рядом, переключателем «Список / Схема».
        // Своей набивки у списка нет: её даёт .app-content (24/32 сверху и с
        // боков, 72 снизу под панель звука). Собственные 16px и сдвигали
        // плитки относительно шапки, и добавляли пустоты сверху.
        <div className="stack">
          <div className="canvas-index-tabs">
            <button className={`canvas-index-tab${canvasTab === "campaigns" ? " is-active" : ""}`} onClick={() => setCanvasTab("campaigns")}>Кампании</button>
            <button className={`canvas-index-tab${canvasTab === "settings" ? " is-active" : ""}`} onClick={() => setCanvasTab("settings")}>Сеттинги</button>
            <button className={`canvas-index-tab${canvasTab === "boards" ? " is-active" : ""}`} onClick={() => setCanvasTab("boards")}>Мои доски</button>
          </div>

          {canvasTab === "campaigns" && (
            <>
              {(index?.campaigns ?? []).map((c) => (
                <div key={c.id} className="stack" style={{ gap: 8 }}>
                  <div className="canvas-group-head">
                    <div className="canvas-props__label">{c.name}</div>
                    <div className="canvas-group-head__actions">
                      <button
                        className="canvas-index__map"
                        onClick={() => setSearchParams({ campaign: String(c.id), view: "map" })}
                      >
                        Карта
                      </button>
                      <GroupAdd
                        ownerType="campaign"
                        ownerId={c.id}
                        settingId={c.setting_id ?? null}
                        onCreatedBoard={(scopeId) => setSearchParams({ free_id: String(scopeId) })}
                        onCreatedArc={() => setSearchParams({ campaign: String(c.id), view: "map" })}
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                    {(campaignGroups.find((g) => g.id === c.id)?.boards ?? []).map((b) => (
                      <BoardTile
                        key={b.id}
                        board={b}
                        settings={index?.all_settings ?? []}
                        campaigns={index?.campaigns ?? []}
                        onOpen={() => setSearchParams({ free_id: String(b.scope_id) })}
                        onChanged={reloadIndex}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {index && (index?.campaigns ?? []).length === 0 && <p className="muted">Нет кампаний с досками.</p>}
            </>
          )}

          {canvasTab === "settings" && (
            <>
              {(index?.settings ?? []).map((st) => (
                <div key={st.id} className="stack" style={{ gap: 8 }}>
                  <div className="canvas-group-head">
                    <div className="canvas-props__label">{st.name}</div>
                    <div className="canvas-group-head__actions">
                      <button
                        className="canvas-index__map"
                        onClick={() => setSearchParams({ setting: String(st.id), view: "map" })}
                      >
                        Схема
                      </button>
                      <GroupAdd
                        ownerType="setting"
                        ownerId={st.id}
                        settingId={st.id}
                        onCreatedBoard={(scopeId) => setSearchParams({ free_id: String(scopeId) })}
                        onCreatedArc={reloadIndex}
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                    {boardsOfSetting(st.id).map((b) => (
                      <BoardTile
                        key={b.id}
                        board={b}
                        settings={index?.all_settings ?? []}
                        campaigns={index?.campaigns ?? []}
                        onOpen={() => setSearchParams({ free_id: String(b.scope_id) })}
                        onChanged={reloadIndex}
                      />
                    ))}
                    {st.adventures.map((a) => (
                      <div key={a.id} className="card" style={{ textAlign: "left", padding: 12 }}>
                        <button
                          className="canvas-index__open"
                          onClick={() => setSearchParams({ setting: String(st.id), arc: String(a.id) })}
                        >
                          {a.name}
                        </button>
                        <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                          {a.chapter_count > 0 ? `${a.chapter_count} ${plural(a.chapter_count, "глава", "главы", "глав")} · ` : ""}
                          {a.scene_count} {plural(a.scene_count, "сцена", "сцены", "сцен")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {index && index.settings.length === 0 && <p className="muted">Нет приключений — создайте в разделе Сеттинги.</p>}
            </>
          )}

          {canvasTab === "boards" && (
            <>
              <div className="canvas-group-head">
                <div className="canvas-group-head__actions">
                  {newBoardName === null ? (
                    <button className="canvas-index__map" onClick={() => setNewBoardName("")}>+ Доска</button>
                  ) : (
                    <form
                      className="row"
                      style={{ gap: 8 }}
                      onSubmit={(e) => { e.preventDefault(); void createFreeBoard(); }}
                    >
                      <input
                        autoFocus
                        id="canvas-new-board"
                        name="canvas-new-board"
                        autoComplete="off"
                        placeholder="Название доски"
                        aria-label="Название новой доски"
                        value={newBoardName}
                        onChange={(e) => setNewBoardName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setNewBoardName(null); }}
                      />
                      <button type="submit" className="primary" disabled={!newBoardName.trim() || creatingBoard}>
                        {creatingBoard ? "Создаю…" : "Создать"}
                      </button>
                      <button type="button" onClick={() => setNewBoardName(null)}>Отмена</button>
                    </form>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                {ownerlessBoards.map((b) => (
                  <BoardTile
                    key={b.id}
                    board={b}
                    settings={index?.all_settings ?? []}
                    campaigns={index?.campaigns ?? []}
                    onOpen={() => setSearchParams({ free_id: String(b.scope_id) })}
                    onChanged={reloadIndex}
                  />
                ))}
                {index && ownerlessBoards.length === 0 && <p className="muted">Ничьих досок нет — «+ Доска» заведёт пустое полотно без сеттинга (сохраняется само).</p>}
              </div>
            </>
          )}
        </div>
      ) : !board ? (
        <EmptyState
          title="Историю видно только целиком"
          hint="Сцены приключения лягут схемой: что за чем идёт и где развилки."
        />
      ) : (
        boardSurface
      )}
      {showCanvasWizard && (
        <CanvasWizard
          settings={settings}
          arcs={arcs}
          onClose={() => setShowCanvasWizard(false)}
          onCreated={(params) => {
            setShowCanvasWizard(false);
            if (params.free_id) setSearchParams({ free_id: String(params.free_id) });
            else if (params.chapter_id) setSearchParams({ setting: String(params.setting_id), arc: String(params.arc_id), focus: `chapter:${params.chapter_id}` });
            else if (params.arc_id) setSearchParams({ setting: String(params.setting_id), arc: String(params.arc_id) });
            else if (params.setting_id) setSearchParams({ setting: String(params.setting_id) });
            // Новая глава встаёт ПОД всем разложенным (`frontier` на сервере),
            // то есть чаще всего за краем экрана. Везём к ней глаз и открываем
            // имя — блок G2. Панель свойств открывает `focus` выше: это тот же
            // путь, которым холст показывает ноду при приходе по ссылке.
            // Если приключение то же, адрес не меняется и сам доску не
            // перечитает.
            if (params.chapter_id) {
              if (params.arc_id === arcId) loadBoard();
              setFresh({ key: `chapter:${params.chapter_id}`, edit: false });
            }
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
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

function CanvasWizard({ settings, arcs, onClose, onCreated }: { settings: Setting[]; arcs: StoryArc[]; onClose: () => void; onCreated: (p: { setting_id?: number; arc_id?: number; free_id?: number; chapter_id?: number }) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entityKind, setEntityKind] = useState<"free" | "adventure" | "chapter" | "scene">("scene");
  const [settingId, setSettingId] = useState<number | "free">("free");
  const [parentArc, setParentArc] = useState<number | "">("");
  const [parentChapter, setParentChapter] = useState<number | "">("");
  const [name, setName] = useState("");
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
                  const created = await api.post<{ id: number }>("/story/arcs", { setting_id: Number(settingId), parent_id: pid, name: name.trim(), kind: "chapter" });
                  onCreated({ setting_id: Number(settingId), arc_id: pid, chapter_id: created.id });
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

// Панель свойств проверки — Q6 б (тот же canvas-props, что у сцены)
/* ------------------------------------------------ общее у панелей свойств
 *
 * Шесть панелей (сцена, проверка, стикер, группа, глава, пин) повторяли одну
 * и ту же разметку `canvas-props` / `__head` / `__fields`, а выбор цвета был
 * свёрстан тремя одинаковыми наборами инлайновых кнопок 24×24. Расхождение
 * «шесть цветов в меню против семи в панели» родилось именно там. Здесь
 * оболочка и свотчи заведены по разу (блок C1 ревизии).
 */

/** Оболочка панели: шапка с названием и (по желанию) кнопкой, ниже — тело. */
function PropsPanel({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="canvas-props">
      <div className="canvas-props__head">
        <span className="canvas-props__label">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Русские имена типов узлов для сводки мультивыделения. Сущности уже есть в
 *  `ENTITY_TYPE_LABEL`, но они не покрывают структурные виды узлов холста
 *  (сцена, рамка, стикер…), поэтому здесь свой сведённый словник. */
const MULTI_TYPE_LABEL: Record<string, string> = {
  scene: "Сцена",
  check: "Проверка",
  sticker: "Стикер",
  frame: "Рамка",
  chapter: "Глава",
  pin: "Пин",
  adventure: "Приключение",
  image: "Картинка",
  bundle: "Набор",
  event: "Событие",
  sound_set: "Саундсет",
  playlist: "Плейлист",
  being: "Существо",
  location: "Локация",
  artifact: "Предмет",
  community: "Сообщество",
  compendium_entry: "Из книги",
  character: "Персонаж",
};

/**
 * Панель мультивыделения (П1.2).
 *
 * Когда выбрано несколько узлов сразу, одиночные панели свойств не показывают
 * ничего осмысленного, поэтому вместо них — сводка: сколько выбрано, по типам,
 * и кнопка сборки в группу. Число — голос Data (моноширинный, §1.5),
 * множественность — сменой состояния панели, а не размножением меток (§1.10).
 *
 * Группировка по типу — по префиксу ключа ноды (`splitKey`): он и есть
 * `node_type` с сервера. Порядок — по убыванию числа в типе: вид, которого
 * больше, читается первым.
 *
 * Рамки в выбранном считаются и подсвечиваются, но в группу не входят: их
 * отсеивает сам createGroup через `canJoinFrame`, здесь это не дублируем.
 */
function MultiselectPanel({
  nodes,
  onCreateGroup,
}: {
  nodes: Node<CanvasNodeData>[];
  onCreateGroup: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const [type] = splitKey(n.id);
      m.set(type, (m.get(type) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([type, n]) => ({ type, label: MULTI_TYPE_LABEL[type] ?? type, n }))
      .sort((a, b) => b.n - a.n);
  }, [nodes]);

  return (
    <PropsPanel
      label="Выделено"
      aside={<span className="canvas-props__count">{nodes.length}</span>}
    >
      <div className="canvas-props__fields">
        <div className="canvas-node__chips">
          {groups.map((g) => (
            <span className="canvas-node__chip" key={g.type}>
              {g.label} <b className="canvas-props__count">{g.n}</b>
            </span>
          ))}
        </div>
        <button className="primary" onClick={onCreateGroup}>
          Создать группу
        </button>
      </div>
    </PropsPanel>
  );
}

/**
 * Свойства приключения — только там, где у него есть чем отличаться от самого
 * себя: на карте кампании (блок D4).
 *
 * Показывает расхождение с заготовкой и даёт из него выйти. Copy-on-write
 * молчалив по устройству: правка в кампании снимает копию, и оригинал в
 * сеттинге может уехать вперёд, а Мастер об этом не узнает. Здесь узнаёт.
 */
function AdventureProperties({
  arcId,
  board,
  nodes,
  onChanged,
}: {
  arcId: number;
  board: CanvasBoard | null;
  nodes: Node<CanvasNodeData>[];
  onChanged: () => void;
}) {
  const node = nodes.find((n) => n.id === `adventure:${arcId}`);
  const data = node?.data as AdventureNodeData | undefined;
  const map = board?.campaign_map;
  if (!data) return <PropsPlaceholder label="Приключение">Приключение не найдено.</PropsPlaceholder>;

  return (
    <PropsPanel label="Приключение">
      <div className="canvas-props__fields">
        <div className="canvas-props__field">
          <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)" }}>{data.name}</span>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
            {data.chapterCount > 0
              ? `${data.chapterCount} ${plural(data.chapterCount, "глава", "главы", "глав")} · `
              : ""}
            {data.sceneCount} {plural(data.sceneCount, "сцена", "сцены", "сцен")}
            {data.progress ? ` · ${PROGRESS_LABEL[data.progress]}` : ""}
          </span>
        </div>

        {map && data.isOverride && (
          <div className="canvas-props__field">
            <span className="canvas-props__label">Изменено в кампании</span>
            {data.settingChangedAt && (
              <span style={{ fontSize: "var(--fs-meta)" }}>
                Версия сеттинга изменилась {new Date(data.settingChangedAt).toLocaleDateString()}
              </span>
            )}
            <button
              onClick={async () => {
                if (!confirm(`Вернуть версию сеттинга для «${data.name}»? Правки, сделанные в кампании, пропадут.`)) return;
                await api.del(`/story/arcs/${arcId}/campaign-override?campaign_id=${map.id}`);
                onChanged();
              }}
            >
              Вернуть версию сеттинга
            </button>
          </div>
        )}

        {map && (
          <div className="canvas-props__field">
            <span className="canvas-props__label">Связи</span>
            <span style={{ fontSize: "var(--fs-meta)" }}>
              {map.own_transitions ? "Ведутся в кампании" : "Как в заготовке сеттинга"}
            </span>
            {map.own_transitions && (
              <button
                onClick={async () => {
                  if (!confirm("Вернуть связи сеттинга? Связи, заведённые в кампании, пропадут.")) return;
                  await api.del(`/story/campaigns/${map.id}/arc-transitions`);
                  onChanged();
                }}
              >
                Вернуть связи сеттинга
              </button>
            )}
          </div>
        )}

        {map && (
          <div className="canvas-props__field">
            {/* Убирается ТОЛЬКО связь с кампанией: копии приключения, глав и
                сцен и прогресс остаются в базе и вернутся, если приключение
                привязать заново — так этот маршрут и устроен. */}
            <button
              className="danger"
              onClick={async () => {
                if (!confirm(`Убрать «${data.name}» из кампании? Приключение и весь прогресс по нему останутся — уйдёт только его участие в этой кампании.`)) return;
                await api.del(`/story/campaign-adventures?campaign_id=${map.id}&arc_id=${arcId}`);
                onChanged();
              }}
            >
              Убрать из кампании
            </button>
          </div>
        )}
      </div>
    </PropsPanel>
  );
}

/**
 * Карточка режима репетиции (блок G3) — второй режим правой панели.
 *
 * Показывается ВМЕСТО полей правки, а не рядом: панель одна, и прогон — это
 * чтение, а не работа с полями. Порядок блоков сверху вниз повторяет порядок,
 * в котором Мастер сцену вспоминает: куда я попал → что тут происходит → что
 * читаю вслух → кто здесь → что бросаем → подо что это звучит → куда дальше.
 *
 * Пустые блоки не показываются вовсе (инвариант дизайна): сцены доводятся
 * руками после импорта, и пустых полей у них будет много. Исключений два —
 * «Дальше» стоит последним ВСЕГДА, потому что это единственный орган
 * управления в карточке и прыгать по высоте он не должен, и «Концовка»,
 * потому что отсутствие блока «Дальше» иначе читается как «не заполнено», а
 * не как «конец истории».
 */
function RehearsalPanel({
  step,
  busy,
  history,
  playingSetId,
  onStep,
  onBack,
  onExit,
  onPlay,
}: {
  step: RehearsalStep | null;
  busy: boolean;
  history: number[];
  /** Какой набор поставлен прогоном, чтобы кнопка знала своё состояние. */
  playingSetId: number | null;
  onStep: (sceneId: number) => void;
  onBack: () => void;
  onExit: () => void;
  onPlay: (set: { id: number; name: string } | null, sceneName: string) => void;
}) {
  if (!step) {
    return (
      <PropsPlaceholder label="Прогон">
        {busy ? "Читаем сцену…" : "Сцена не открылась."}
      </PropsPlaceholder>
    );
  }
  const p = step.preview;
  const ending = p.scene.kind === "ending";
  const steppable = step.exits.filter((e) => !e.outside);
  const outside = step.exits.filter((e) => e.outside);
  // Порядок ролей — тот же, что в панели правки состава: место, персонажи,
  // препятствия, лут. Порядок должен совпадать, иначе одна и та же сцена
  // читается в двух режимах по-разному.
  const castGroups = Object.keys(CAST_ROLE_LABEL)
    .map((role) => ({ role, rows: p.cast.filter((c) => c.role === role) }))
    .filter((g) => g.rows.length > 0);
  const playing = playingSetId != null && p.sound != null && playingSetId === p.sound.id;

  return (
    <PropsPanel
      label="Прогон"
      aside={
        <button onClick={onExit} title="Escape">
          Выйти
        </button>
      }
    >
      <div className="canvas-rehearse">
        <div className="canvas-rehearse__head">
          {/* Имя — ссылка: прогон открывают, чтобы находить пропуски, и путь к
              починке должен быть в один щелчок. Уход со страницы сам кончает
              прогон — терять нечего, он ничего не пишет. */}
          <Link className="canvas-rehearse__name" to={`/scenes/${p.scene.id}`}>
            {p.scene.name}
          </Link>
          <span className="canvas-props__label">
            {SCENE_KIND_LABELS[p.scene.kind ?? ""] ?? p.scene.kind}
            {p.scene.arc_name ? ` · ${p.scene.arc_name}` : ""}
          </span>
        </div>

        {p.entryCondition && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Как сюда попадают</div>
            <p className="canvas-rehearse__text">{p.entryCondition}</p>
          </section>
        )}
        {p.summary && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Что происходит</div>
            <p className="canvas-rehearse__text">{p.summary}</p>
          </section>
        )}
        {p.readAloud && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Зачитать</div>
            <p className="canvas-rehearse__text canvas-rehearse__text--aloud">{p.readAloud}</p>
          </section>
        )}
        {/* Состав сгруппирован по ролям: роль называется один раз, а не по
            разу на каждого из четырёх гоблинов. Множественность показывается
            длиной списка, а не размножением одной и той же метки. */}
        {castGroups.length > 0 && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Состав</div>
            {castGroups.map((g) => (
              <div key={g.role} className="canvas-rehearse__cast">
                <span className="canvas-rehearse__role">{CAST_ROLE_LABEL[g.role] ?? g.role}</span>
                <ul className="canvas-rehearse__list">
                  {g.rows.map((c, i) => (
                    <li key={i}>
                      {c.name}
                      {c.qty ? <span className="canvas-rehearse__qty"> ×{c.qty}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
        {p.checks.length > 0 && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Проверки</div>
            <ul className="canvas-rehearse__list">
              {p.checks.map((c, i) => (
                <li key={i}>
                  {c.what}
                  {c.dc ? <span className="canvas-rehearse__qty"> {c.dc}</span> : null}
                  {c.outcomes.length > 0 && (
                    <div className="canvas-rehearse__outcomes">{c.outcomes.join(" · ")}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Звук ручной и один: тем же движком, что у пульта, и повторное
            нажатие возвращает прежнее. Автоматической смены на каждом шаге
            нет намеренно — пролистав пять сцен, Мастер получил бы пять
            обрывков вступлений вместо настроения. */}
        {p.sound && (
          <section className="canvas-rehearse__block">
            <div className="canvas-props__label">Звук</div>
            <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <span>{p.sound.name}</span>
              <button onClick={() => onPlay(playing ? null : p.sound, p.scene.name)}>
                {playing ? "Вернуть" : "Послушать"}
              </button>
            </div>
          </section>
        )}

        <section className="canvas-rehearse__block canvas-rehearse__next">
          <div className="canvas-props__label">Дальше</div>
          {ending && steppable.length === 0 && step.next_in_order == null ? (
            <p className="canvas-rehearse__text">Концовка.</p>
          ) : null}
          {steppable.map((e) => (
            <button
              key={e.scene.id}
              className="canvas-rehearse__exit"
              disabled={busy}
              onClick={() => onStep(e.scene.id)}
            >
              <span className="canvas-rehearse__exit-name">{e.scene.name}</span>
              {e.label && <span className="canvas-rehearse__exit-label">{e.label}</span>}
            </button>
          ))}
          {/* Стрелок нет — идём по порядку: он держится на `position`, и
              линейная глава законно живёт без единого перехода. */}
          {steppable.length === 0 && step.next_in_order && (
            <button
              className="canvas-rehearse__exit"
              disabled={busy}
              onClick={() => onStep(step.next_in_order!.id)}
            >
              <span className="canvas-rehearse__exit-name">{step.next_in_order.name}</span>
              <span className="canvas-rehearse__exit-label">следующая по порядку</span>
            </button>
          )}
          {/* Цель в другом приключении: видна, потому что связь настоящая, и
              холст не должен врать; но шагом не является — прогон уехал бы в
              другое приключение незаметно. Ссылка уводит осознанно. */}
          {outside.map((e) => (
            <Link key={e.scene.id} className="canvas-rehearse__exit is-outside" to={`/scenes/${e.scene.id}`}>
              <span className="canvas-rehearse__exit-name">{e.scene.name}</span>
              <span className="canvas-rehearse__exit-label">
                {e.label ? `${e.label} · ` : ""}
                {e.adventure_name || "другое приключение"}
              </span>
            </Link>
          ))}
          {!ending && steppable.length === 0 && step.next_in_order == null && outside.length === 0 && (
            <p className="canvas-rehearse__text muted">Отсюда никуда не ведёт.</p>
          )}
          {history.length > 0 && (
            <button className="canvas-rehearse__back" disabled={busy} onClick={onBack}>
              ← Назад
            </button>
          )}
        </section>
      </div>
    </PropsPanel>
  );
}

/** Панели пока нечего показать: запись грузится или ничего не выбрано. */
function PropsPlaceholder({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PropsPanel label={label}>
      <div className="canvas-props__empty">{children}</div>
    </PropsPanel>
  );
}

/** Кнопка удаления в шапке панели — одна на все панели, где она есть. */
function PropsDelete({ onDelete }: { onDelete: () => void | Promise<void> }) {
  return (
    <button className="danger" onClick={() => void onDelete()}>
      Удалить
    </button>
  );
}

/**
 * Выбор цвета. Палитра приезжает из `canvasPalette.ts` (блок B1) — своих
 * значений здесь нет.
 *
 * `by` — чем панель считает выбранным: стикер хранит в базе ключ (`paper`),
 * рамка, глава и пин — само значение (`#2C3E50`). Разница настоящая, поэтому
 * она названа явно, а не угадывается сравнением с обоими полями.
 */
function ColorSwatches({
  label = "Цвет",
  swatches,
  selected,
  by,
  onPick,
}: {
  label?: string;
  swatches: SwatchOption[];
  selected: string;
  by: "key" | "value";
  onPick: (sw: SwatchOption) => void;
}) {
  return (
    <div className="canvas-props__field">
      <span className="canvas-props__label">{label}</span>
      <div className="canvas-swatches">
        {swatches.map((sw) => {
          const active = selected === (by === "key" ? sw.key : sw.value);
          return (
            <button
              key={sw.key}
              className={active ? "canvas-swatch is-active" : "canvas-swatch"}
              style={{ background: sw.value }}
              aria-label={`Цвет: ${sw.label}`}
              aria-pressed={active}
              title={sw.label}
              onClick={() => onPick(sw)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Состав контейнера чипами: «в группе» у рамки, «сцен в главе» у главы.
 * Пустой список объясняет, чем его наполнить, — это главный блок панели, и
 * правило «нечего показать — не показывайся» на него не распространяется.
 */
function PropsChips({
  label,
  items,
  empty,
  onRemove,
}: {
  label: string;
  items: { key: string; title: string }[];
  empty: string;
  onRemove?: (key: string) => void;
}) {
  return (
    <div className="canvas-props__field">
      <span className="canvas-props__label">
        {label} ({items.length})
      </span>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
          {empty}
        </p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {items.map((it) => (
            <span key={it.key} className="canvas-node__chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {it.title}
              {onRemove && (
                <button
                  type="button"
                  className="comp-mini"
                  title="Убрать из группы"
                  onClick={(e) => { e.stopPropagation(); onRemove(it.key); }}
                >
                  −
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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
    return <PropsPlaceholder label="Проверка">Загрузка…</PropsPlaceholder>;
  }
  return (
    <PropsPanel
      label="Проверка"
      aside={<PropsDelete onDelete={async () => { await api.del(`/story/checks/${checkId}`); onSaved(); }} />}
    >
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
    </PropsPanel>
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
  if (!sticker) return <PropsPlaceholder label="Стикер">Загрузка…</PropsPlaceholder>;
  return (
    <PropsPanel
      label="Стикер"
      aside={<PropsDelete onDelete={async () => { const bid = board?.board_id ?? 0; await api.del(`/canvas/board/node?board_id=${bid}&node_type=sticker&node_id=${stickerId}`); onSaved(); }} />}
    >
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input id={`sticker-name-${sticker.id}`} name={`sticker-name-${sticker.id}`} autoComplete="off" defaultValue={sticker.name || sticker.text} key={`name-${sticker.id}-${sticker.name}`} onBlur={(e) => e.target.value !== (sticker.name || sticker.text) && save({ name: e.target.value })} /></label>
        <div className="canvas-props__field"><span className="canvas-props__label">Заметка</span><MentionTextarea value={noteDraft} onChange={setNoteDraft} rows={4} placeholder="Заметка с @упоминаниями" defaultSettingId={board?.arc?.setting_id ?? undefined} /><button onClick={async () => { if (noteDraft !== sticker.note) { await save({ note: noteDraft }); await syncMentionLinks("sticker", sticker.id, sticker.note, noteDraft); } }}>Сохранить заметку</button></div>
        {/* Стикер хранит ключ цвета, а не значение. */}
        <ColorSwatches swatches={STICKER_SWATCHES} selected={sticker.color} by="key" onPick={(sw) => save({ color: sw.key })} />
      </div>
    </PropsPanel>
  );
}

function FrameProperties({ frameId, board, onSaved, onRemoveMember }: { frameId: number; board: CanvasBoard | null; onSaved: () => void; onRemoveMember: (key: string) => void }) {
  const frame = boardNodesOfType(board, "frame").find((n) => n.node_id === frameId)?.frame;
  const [name, setName] = useState(frame?.name ?? "");
  useEffect(() => { setName(frame?.name ?? ""); }, [frame?.name]);
  const color = frame?.color ?? DEFAULT_FRAME_COLOR;
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
  /**
   * Состав группы — те, кто ей принадлежит (`parent_key`), а не те, кто
   * оказался под ней на экране.
   *
   * Считалось это перекрытием прямоугольников — и врало дважды. Место
   * ребёнка в React Flow отсчитывается ОТ РАМКИ, а рамка сравнивалась в
   * координатах доски: собственные дети из проверки выпадали, а посторонние,
   * лежащие в абсолютных, в неё попадали. Поверх этого размер ноды брался из
   * запасных чисел `getNodeSize` — у стикера 320 против настоящих 220.
   *
   * На доске владельца это выглядело так: в рамке лежат четыре картинки и три
   * стикера, а панель показывала «В группе (3)» и перечисляла три пина,
   * которые рамке не принадлежат. `parent_key` — то же самое, по чему рамка
   * везёт содержимое; списку и рамке теперь незачем расходиться.
   */
  const members = (board?.nodes ?? []).filter((n) => n.parent_key === `frame:${frameId}`);
  if (!frame) return <PropsPlaceholder label="Группа">Загрузка…</PropsPlaceholder>;
  return (
    <PropsPanel
      label="Группа"
      aside={<PropsDelete onDelete={async () => { await api.del(`/canvas/board/node?board_id=${board?.board_id}&node_type=frame&node_id=${frameId}`); onSaved(); }} />}
    >
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder="Группа" /></label>
        <ColorSwatches swatches={FRAME_SWATCHES} selected={color} by="value" onPick={(sw) => saveColor(sw.value)} />
        <PropsChips
          label="В группе"
          items={members.map((m) => ({ key: m.key, title: boardNodeTitle(m) }))}
          empty="Перетащи узлы внутрь рамки — они поедут вместе с ней."
          onRemove={onRemoveMember}
        />
      </div>
    </PropsPanel>
  );
}

/**
 * Свойства главы (блок G6.2).
 *
 * Состава главы здесь больше нет: её сцены лежат на её собственном холсте, а
 * список из тридцати имён, ведущий в никуда, — это отчёт, а не свойство. Их
 * место занял вход — та же дверь, что двойной щелчок по узлу.
 */
function ChapterProperties({ chapterId, board, onSaved, onEnter }: { chapterId: number; board: CanvasBoard | null; onSaved: () => void; onEnter: (arcId: number) => void }) {
  const node = boardNodesOfType(board, "chapter").find((n) => n.chapter.id === chapterId)?.chapter;
  const [name, setName] = useState(node?.name ?? "");
  useEffect(() => { setName(node?.name ?? ""); }, [node?.name]);
  async function saveName() {
    if (!node) return;
    if (name.trim() === node.name) return;
    // Правится `story_arcs.name` — сама запись главы, а не подпись на холсте.
    await api.put(`/canvas/groups/${chapterId}`, { board_id: board?.board_id, name: name.trim() || "Глава" });
    onSaved();
  }
  if (!node) return <PropsPlaceholder label="Глава">Загрузка…</PropsPlaceholder>;
  return (
    <PropsPanel label="Глава">
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder="Глава" /></label>
        <div className="canvas-props__field">
          <span className="canvas-props__label">Сцен</span>
          <span>{node.scene_count}</span>
        </div>
        <div className="canvas-props__field">
          <button onClick={() => onEnter(chapterId)}>Войти в главу</button>
        </div>
      </div>
    </PropsPanel>
  );
}

function PinProperties({ pinId, board, onSaved, autoEdit = false }: { pinId: number; board: CanvasBoard | null; onSaved: () => void; autoEdit?: boolean }) {
  const pin = boardNodesOfType(board, "pin").find((n) => n.pin.id === pinId)?.pin;
  const [name, setName] = useState(pin?.name ?? "");
  const [size, setSize] = useState(pin?.size ?? "M");
  const [color, setColor] = useState(pin?.color ?? DEFAULT_FRAME_COLOR);
  const [shape, setShape] = useState(pin?.shape ?? "circle");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(pin?.name ?? ""); setSize(pin?.size ?? "M"); setColor(pin?.color ?? DEFAULT_FRAME_COLOR); setShape(pin?.shape ?? "circle"); }, [pin?.name, pin?.size, pin?.color, pin?.shape]);
  // П2.8: свежесозданный пин открывает панель сразу в поле имени. Эффект
  // пережидает и поставку `pin` (панель рендерится раньше данных доски), и
  // 400 мс отложенного `fresh` — фокус приходит к готовому инпуту.
  useEffect(() => {
    if (autoEdit && pin && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [autoEdit, pin]);
  const threads = board?.threads ?? [];
  const myThreads = threads.filter((th) => th.from_pin_id === pinId || th.to_pin_id === pinId);
  async function save(part: Record<string, unknown>) {
    await api.put(`/canvas/pins/${pinId}`, part);
    onSaved();
  }
  if (!pin) return <PropsPlaceholder label="Пин">Загрузка…</PropsPlaceholder>;
  return (
    <PropsPanel
      label="Пин"
      aside={<PropsDelete onDelete={async () => { await api.del(`/canvas/pins/${pinId}`); onSaved(); }} />}
    >
      <div className="canvas-props__fields">
        <label className="canvas-props__field"><span className="canvas-props__label">Имя</span><input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== pin.name && save({ name: name.trim() || "Пин" })} placeholder="Пин" /></label>
        <div className="canvas-props__field"><span className="canvas-props__label">Размер</span><div className="row" style={{ gap: 6 }}>{(["S","M","L"] as const).map((s) => (<button key={s} className={size===s ? "primary" : ""} onClick={() => { setSize(s); save({ size: s }); }}>{s} {s==="S"?"16":s==="M"?"24":"32"}</button>))}</div></div>
        <ColorSwatches swatches={FRAME_SWATCHES} selected={color} by="value" onPick={(sw) => { setColor(sw.value); save({ color: sw.value }); }} />
        <div className="canvas-props__field"><span className="canvas-props__label">Форма</span><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{(PIN_SHAPES as readonly string[]).map((sh) => (<button key={sh} className={shape===sh ? "primary" : ""} onClick={() => { setShape(sh); save({ shape: sh }); }}>{PIN_SHAPE_LABEL[sh] ?? sh}</button>))}</div></div>
        <div className="canvas-props__field"><span className="canvas-props__label">Нити ({myThreads.length})</span>{myThreads.length===0 ? <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>Нет нитей — ПКМ → Создать связь</p> : <div className="stack" style={{ gap: 6 }}>{myThreads.map((th) => {
          const otherId = th.from_pin_id === pinId ? th.to_pin_id : th.from_pin_id;
          const other = boardNodesOfType(board, "pin").find((n) => n.pin.id === otherId)?.pin.name || `Пин ${otherId}`;
          return (
            <div key={th.id} className="row" style={{ gap: 6, alignItems: "center", border: "1.5px solid var(--line)", padding: "4px 6px" }}>
              <span style={{ flex: 1, fontSize: "var(--fs-meta)" }}>— {other}</span>
              <input type="number" min={1} max={8} value={th.width} onChange={(e) => { const w = Number(e.target.value) || 2; api.put(`/canvas/threads/${th.id}`, { width: w }).then(onSaved); }} style={{ width: 48 }} aria-label="Ширина нити" title="Ширина" />
              <input type="color" value={th.color} onChange={(e) => api.put(`/canvas/threads/${th.id}`, { color: e.target.value }).then(onSaved)} style={{ width: 32, height: 24, padding: 0, border: "1.5px solid var(--line)" }} aria-label="Цвет нити" title="Цвет нити" />
              <button className="danger" onClick={async () => { await api.del(`/canvas/threads/${th.id}`); onSaved(); }} aria-label={`Удалить нить к «${other}»`} title="Удалить нить">×</button>
            </div>
          );
        })}</div>}</div>
      </div>
    </PropsPanel>
  );
}

/**
 * Рераут («Маршрут») в панели свойств.
 *
 * Сам данных не заводит — реальное ребро остаётся одно, а здесь у рераута
 * править почти нечего: роль (вид ребра, которое рвёт) read-only, потому что
 * конфликт ролей невозможен по построению. Особый случай — переход между
 * сценами: рераут становится местом для редактора строки «Условие перехода»
 * (`story_scene_transitions.label`), которая раньше жила подписью на середине
 * ребра.
 */
function RouteProperties({ routeId, board, onSaved }: { routeId: number; board: CanvasBoard | null; onSaved: () => void }) {
  const route = boardNodesOfType(board, "route").find((n) => n.route.id === routeId)?.route;
  const [condition, setCondition] = useState(route?.transition_label ?? "");
  useEffect(() => { setCondition(route?.transition_label ?? ""); }, [route?.transition_label]);
  if (!route) return <PropsPlaceholder label="Маршрут">Загрузка…</PropsPlaceholder>;
  const kindLabel = ROUTE_KIND_LABEL[route.kind] ?? route.kind;
  const roleLabel = route.role ? ROUTE_ROLE_LABEL[route.role] ?? route.role : "";
  const isTransition = route.kind === "transition";
  return (
    <PropsPanel
      label="Маршрут"
      aside={<PropsDelete onDelete={async () => { await api.del(`/canvas/routes/${routeId}`); onSaved(); }} />}
    >
      <div className="canvas-props__fields">
        <div className="canvas-props__field">
          <span className="canvas-props__label">Ребро</span>
          <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
            {kindLabel}{roleLabel ? ` · ${roleLabel}` : ""}
          </p>
          {route.from_name && (
            <p className="muted" style={{ fontSize: "var(--fs-meta)", marginTop: 4 }}>
              {route.from_name} → {(route.outputs ?? []).length
                ? route.outputs!.map((o) => o.to_name ?? o.to_key).join(", ")
                : "…"}
            </p>
          )}
        </div>
        {(route.outputs ?? []).length > 0 && (
          <div className="canvas-props__field">
            <span className="canvas-props__label">Выходы ({route.outputs!.length})</span>
            <div className="stack" style={{ gap: 6 }}>
              {route.outputs!.map((o) => (
                <div key={o.to_key} className="row" style={{ gap: 6, alignItems: "center", border: "1.5px solid var(--line)", padding: "4px 6px" }}>
                  <span style={{ flex: 1, fontSize: "var(--fs-meta)" }}>{o.to_name ?? o.to_key}</span>
                  <button className="danger" onClick={async () => { await api.del(`/canvas/routes/${routeId}/outputs?to_key=${encodeURIComponent(o.to_key)}`); onSaved(); }} title="Снять выход">×</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {isTransition && route.transition_id != null && (
          <label className="canvas-props__field">
            <span className="canvas-props__label">Условие перехода</span>
            <input
              value={condition}
              placeholder="Условие"
              onChange={(e) => setCondition(e.target.value)}
              onBlur={() => { const v = condition.trim(); if (v !== (route.transition_label ?? "")) { void api.put(`/story/transitions/${route.transition_id}`, { label: v }); onSaved(); } }}
            />
          </label>
        )}
        {isTransition && route.transition_id != null && (
          <div className="canvas-props__field">
            <button
              className="button button--danger"
              onClick={async () => {
                // Снять не только разрыв, но и сам переход (блок #6).
                await api.del(`/story/transitions/${route.transition_id}`);
                await api.del(`/canvas/routes/${routeId}`);
                onSaved();
              }}
            >
              Удалить с ребром
            </button>
          </div>
        )}
        {!isTransition && (
          <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
            Маршрут — носитель: левый вход принимает существо/локацию/сцену, правые
            выходы кладут его в каст сцен. Удаление «Маршрут» снимает разрыв и касты
            выходов.
          </p>
        )}
      </div>
    </PropsPanel>
  );
}

// Подписи вида ребра и роли для панели свойств рераута.
const ROUTE_KIND_LABEL: Record<string, string> = {
  transition: "Переход",
  outcome: "Исход проверки",
  cast: "Состав сцены",
  member: "Участник набора",
  thread: "Нить",
};
const ROUTE_ROLE_LABEL: Record<string, string> = {
  location: "Локация",
  beings: "Существа",
  plot_characters: "Персонажи",
  loot: "Артефакты",
  consequences: "Последствия",
  members: "Участники",
  story: "Переход",
};

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
  // Персонажи игроков (блок G7). Вкладка условная — её нет там, где кампании
  // нет: на свободной доске и на схеме сеттинга выбирать не из кого
  // (`characters.campaign_id`), а ряд вкладок и без того в две строки на 375.
  // Отдельной вкладкой, а не внутри «Существ»: персонажи игроков и существа
  // сеттинга лежат в разных таблицах, и общий список дал бы строки, которые
  // значат разное.
  { key: "characters", label: "Персонажи" },
  { key: "adventures", label: "Приключения" },
  { key: "bundles", label: "Наборы" },
  { key: "tools", label: "Инструменты" },
  { key: "audio", label: "Аудио" },
] as const;

const PALETTE_DRAG_MIME = "application/x-canvas-palette-item";

/**
 * Что палитра кладёт в `dataTransfer`. Пять видов записи, у каждого свои
 * поля, поэтому все поля необязательные, а разбирает их `handleDrop` по
 * `kind`.
 */
interface PaletteDragPayload {
  kind: string;
  item?: PaletteItem;
  blankId?: number;
  bundleId?: number;
  pin?: { name: string; size: string; color: string; shape: string };
}

/** Имя панели, одно на весь путь: тулбар, контекстное меню, подсказка кнопки.
    Раньше в неё вели четыре двери с разными именами — «Меню узлов»,
    «Показать палитру», эмодзи и отдельный визард. */
const PALETTE_NAME = "Палитра";
const PALETTE_NAME_ACC = "палитру";

/** Строка легенды: значок нужной формы в цвете разъёма плюс подпись. */
function LegendRow({ item }: { item: LegendItem }) {
  return (
    <div className="canvas-legend__row">
      <span
        className={`canvas-legend__mark canvas-legend__mark--${item.shape}`}
        style={{ "--mark": HANDLE_COLORS[item.key] } as React.CSSProperties}
      />
      {item.label}
    </div>
  );
}

const LEGEND_OPEN_KEY = "canvasLegendOpen";

/**
 * Легенда разъёмов. Свёрнута до чипа по умолчанию: девять строк в левом нижнем
 * углу — самый крупный постоянный объект на схеме, а нужны они раз при
 * знакомстве. На ширине 375 развёрнутая легенда вместе с MiniMap не оставляла
 * от холста ничего.
 */
function CanvasLegend() {
  const [open, setOpen] = useState(() => localStorage.getItem(LEGEND_OPEN_KEY) === "1");
  useEffect(() => {
    localStorage.setItem(LEGEND_OPEN_KEY, open ? "1" : "0");
  }, [open]);
  return (
    <div className="canvas-legend">
      <button
        type="button"
        className="canvas-legend__chip"
        aria-expanded={open}
        title={open ? "Свернуть легенду" : "Показать легенду разъёмов"}
        onClick={() => setOpen((v) => !v)}
      >
        Легенда
      </button>
      {open && (
        <div className="canvas-legend__body">
          <div className="canvas-legend__cols">
            <div className="canvas-legend__col">
              <div className="canvas-legend__col-title">Сцена ←</div>
              {CANVAS_LEGEND_IN.map((it) => <LegendRow key={it.label} item={it} />)}
            </div>
            <div className="canvas-legend__col">
              <div className="canvas-legend__col-title">→ Сцена</div>
              {CANVAS_LEGEND_OUT.map((it) => <LegendRow key={it.label} item={it} />)}
            </div>
          </div>
        </div>
      )}
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
  boardTarget,
  campaignId,
  shelfVersion,
  onAdded,
  onPinCreated,
  flowRef,
}: {
  arcId: number;
  settingId: number;
  boardId?: number | null;
  /** Чем назвать доску в запросе: своя строка или владелец, если строки ещё
   *  нет (схема сеттинга, карта кампании). Считает страница — палитре
   *  различать виды досок ни к чему. */
  boardTarget: Record<string, number | undefined>;
  /** Кампания, в которой открыт холст: у неё свои события. */
  campaignId: number | null;
  /** Меняется, когда сцену положили на полку или сняли с неё. */
  shelfVersion: number;
  onAdded: (sceneId: number | null) => void;
  /** Свежесозданный пин (П2.8): страница выделяет его и открывает имя. */
  onPinCreated: (pinId: number) => void;
  flowRef?: React.RefObject<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>;
}) {
  const [tab, setTab] = useState<PaletteTab>("scenes");
  const [shelf, setShelf] = useState<LibraryScene[]>([]);
  const [bundles, setBundles] = useState<LibraryBundle[]>([]);
  const [entities, setEntities] = useState<PaletteItem[]>([]);
  const [events, setEvents] = useState<PaletteItem[]>([]);
  const [adventures, setAdventures] = useState<PaletteItem[]>([]);
  const [characters, setCharacters] = useState<PaletteItem[]>([]);
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

  // Приключения для вкладки-ярлыков (Q20, Q22) — из того же ответа, что кормит
  // экран выбора: список короткий и один на всю базу.
  useEffect(() => {
    if (tab !== "adventures") return;
    api.get<CanvasIndex>("/canvas/index").then((ix) =>
      setAdventures(
        ix.settings.flatMap((st) =>
          st.adventures.map((a) => ({
            type: "adventure",
            id: a.id,
            name: a.name,
            note: `${st.name} · ${a.chapter_count > 0 ? `${a.chapter_count} ${plural(a.chapter_count, "глава", "главы", "глав")} · ` : ""}${a.scene_count} ${plural(a.scene_count, "сцена", "сцены", "сцен")}`,
          }))
        )
      )
    );
  }, [tab]);

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

  // Партия кампании (блок G7). Список уже отдаёт `GET /characters`, своего
  // эндпоинта заводить не пришлось; архивные он отсеивает сам — положенный
  // раньше на холст архивный персонаж с доски не исчезает, ровно как
  // архивное существо, и убирается рукой.
  useEffect(() => {
    if (tab !== "characters" || !campaignId) {
      setCharacters([]);
      return;
    }
    api
      .get<{ id: number; character_name: string; player_name: string }[]>(
        `/characters?campaign_id=${campaignId}`
      )
      .then((rows) =>
        setCharacters(
          rows.map((r) => ({ type: "character", id: r.id, name: r.character_name, note: r.player_name }))
        )
      );
  }, [tab, campaignId]);

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
      await api.post("/canvas/board/node", {
        ...boardTarget,
        node_type: item.type,
        node_id: item.id,
        ...pos,
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
          {PALETTE_TABS.filter(
            (t) => (t.key !== "adventures" || !arcId) && (t.key !== "characters" || !!campaignId)
          ).map((t) => (
            <button
              key={t.key}
              className={`canvas-palette__tab${t.key === tab ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
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

        {tab === "characters" && (
          <>
            {filtered(characters).map((item) => (
              <button
                key={`character:${item.id}`}
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
            {characters.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                В кампании нет персонажей — их заводят в её составе.
              </p>
            )}
          </>
        )}

        {tab === "adventures" && (
          <>
            {filtered(adventures).map((item) => (
              <button
                key={`adventure:${item.id}`}
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
            {adventures.length === 0 && (
              <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
                Приключений нет — создайте в разделе Сеттинги.
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
        {tab === "tools" && (
          <>
            <div className="canvas-palette__label">Инструменты</div>
            <button
              className="canvas-palette__item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "pin", pin: { name: "Пин", size: "M", color: DEFAULT_FRAME_COLOR, shape: "circle" } }));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={async () => {
                const pos = freshSpotAtCenter(flowRef?.current ?? null);
                const created = await api.post<{ id: number }>("/canvas/pins", { board_id: boardId, name: "Пин", x: pos.x, y: pos.y, size: "M", color: DEFAULT_FRAME_COLOR, shape: "circle" });
                onPinCreated(created.id);
                onAdded(null);
              }}
            >
              <span className="canvas-palette__item-name">📌 Пин</span>
              <span className="canvas-palette__item-meta">Точка • M • круг</span>
            </button>
            <button
              className="canvas-palette__item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: "route" }));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={async () => {
                const pos = freshSpotAtCenter(flowRef?.current ?? null);
                await api.post("/canvas/routes", { board_id: boardId, x: Math.round(pos.x), y: Math.round(pos.y) });
                onAdded(null);
              }}
            >
              <span className="canvas-palette__item-name">⇆ Маршрут</span>
              <span className="canvas-palette__item-meta">Разводка длинного ребра</span>
            </button>
            <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>
              Перетащи на холст или нажми. ПКМ на пине — создать связь, цвет, удалить. Нити — в свойствах пина.
            </p>
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
/**
 * Шаг сетки — и рисуемой, и той, к которой прилипают ноды (блок G6.1).
 *
 * Одно число на две вещи намеренно: снэп по линиям, которых на экране нет,
 * хуже, чем никакого. Правит кто-то одно — правит и второе, поэтому второго
 * места, где этот шаг записан, нет.
 *
 * 26 — то, что уже рисовал фон. Круглость числа никому не видна, а расхождение
 * с видимой сеткой видно сразу.
 */
const GRID = 26;
/** Округление до сетки — для тех мест, где позицию ставит не перетаскивание. */
function toGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function freshSpot(): { x: number; y: number } {
  return { x: toGrid(-320 + Math.random() * 40), y: toGrid(Math.random() * 400) };
}
function freshSpotAtCenter(flow: ReactFlowInstance<Node<CanvasNodeData>, Edge> | null): { x: number; y: number } {
  if (!flow) return freshSpot();
  const vp = flow.getViewport();
  // центр экрана в flow-координатах
  const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  // небольшая случайность, чтобы две подряд не легли точно друг на друга
  // Случайность остаётся, но садится на сетку: две подряд не лягут точно друг
  // на друга и при этом обе окажутся на линиях фона (блок G6.1).
  return { x: toGrid(center.x + (Math.random() * 40 - 20) / vp.zoom), y: toGrid(center.y + (Math.random() * 40 - 20) / vp.zoom) };
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
  // Главы берём из доски, а не отдельным запросом: они уже приехали с ней —
  // теперь узлами, а не рамками (блок G6.2). На холсте самой главы соседних
  // глав нет, и список тогда пуст: перенос между главами делается с холста
  // приключения, где они все рядом.
  const chapters = boardNodesOfType(board, "chapter").map((n) => ({ arc_id: n.chapter.id, name: n.chapter.name }));

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

  /**
   * Перенос в другую главу из панели (Q24).
   *
   * Пересчёта места здесь больше нет (блок G6.2). Раньше сцену приходилось
   * двигать на разницу между началами двух рамок, иначе рамки глав легли бы
   * друг на друга; теперь у каждой главы свой холст, и место сцены переносит
   * туда сервер вместе со сменой `arc_id` — вместе с проверками сцены,
   * которые иначе остались бы на прежнем холсте без своей сцены.
   */
  async function moveToChapter(next: number | null) {
    if (!scene || next === (scene.arc_id ?? null)) return;
    const from = board?.groups?.find((g) => g.arc_id === scene.arc_id);
    const to = next == null ? undefined : board?.groups?.find((g) => g.arc_id === next);
    if (board?.board_id && from && to) {
      const dx = Math.round(to.x - from.x);
      const dy = Math.round(to.y - from.y);
      if (dx || dy) {
        const moving = board.nodes.filter(
          (n) =>
            (n.node_type === "scene" && n.node_id === scene.id) ||
            (n.node_type === "check" && n.check.scene_id === scene.id)
        );
        await api.put("/canvas/board/nodes", {
          board_id: board.board_id,
          nodes: moving.map((n) => ({
            node_type: n.node_type,
            node_id: n.node_id,
            x: Math.round(n.x) + dx,
            y: Math.round(n.y) + dy,
          })),
        });
      }
    }
    await save({ arc_id: next });
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
      <PropsPlaceholder label="Свойства">
        Выберите ноду, чтобы увидеть и поправить её.
      </PropsPlaceholder>
    );
  }

  return (
    <PropsPanel
      label="Свойства"
      aside={<span className="canvas-props__label">{SCENE_KIND_LABELS[scene.kind] ?? scene.kind}</span>}
    >

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

      {/* Второй путь переноса между главами (Q24). Перетаскивание быстрее,
          но требует, чтобы обе главы были развёрнуты и влезали на экран разом.
          Список работает всегда — в том числе «убрать в свёрнутую главу на другом
          конце холста». */}
      {chapters.length > 0 && (
        <div className="canvas-props__fields">
          <label className="canvas-props__field">
            <span className="canvas-props__label">Глава</span>
            <select
              value={scene.arc_id ?? ""}
              onChange={(e) => moveToChapter(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Без главы</option>
              {chapters.map((c) => (
                <option key={c.arc_id} value={c.arc_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

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
    </PropsPanel>
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

function ControlsButtons() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="react-flow__panel bottom left react-flow__controls">
      <ControlButton title="Масштаб +" onClick={(e) => { e.preventDefault(); zoomIn(); }} aria-label="Масштаб +">+</ControlButton>
      <ControlButton title="Масштаб −" onClick={(e) => { e.preventDefault(); zoomOut(); }} aria-label="Масштаб −">−</ControlButton>
      <ControlButton title="По размеру" onClick={(e) => { e.preventDefault(); fitView(); }} aria-label="По размеру">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 4V2H10V4H6V6H4V10H2V12H4V14H6V18H10V20H12V18H16V20H20V16H22V14H20V12H22V10H20V6H18V4H14V2H12ZM12 16V14H8V12H6V16H12ZM18 8H16V6H12V4H8V6H6V10H8V12H6V16H10V14H12V18H16V16H18V12H20V10H18V8Z" /></svg>
      </ControlButton>
    </div>
  );
}