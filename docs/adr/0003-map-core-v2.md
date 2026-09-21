# ADR-0003: Map Core V2 — спецификация MapDocument (Фаза 2A)

Статус: draft на ревью (Фаза 2B начинается только после ревью).
Дизайн-документ, не реализация. Production-код на этой фазе не меняется.

Контекст Фазы 1: редактор декомпозирован (`Camera/History/Hotkeys/Autosave/
Selection/Input/Tools/Viewport`), модель данных намеренно оставлена старой
(`MapCells`, `cells v1–v4`, `soyman-map/1`). Здесь проектируется её замена.

---

## A. Final TypeScript model

### A.1. Примитивы

```ts
/** Стабильный идентификатор сущности или слоя. Новые — UUID. */
type EntityId = string;
type LayerId = string;

/** Точка/вектор в world coordinates. Всегда конечные numbers. */
interface Vec2 {
  x: number;
  y: number;
}

/** JSON-совместимые значения. Canonical model типово не допускает
 *  function/Map/Set/Date/class instances — только это. */
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
```

### A.2. Top level

```ts
interface MapDocumentV5 {
  v: 5;
  world: MapWorld;
  /** null = карта без grid (режим «Красивости» без привязки). */
  grid: MapGridConfig | null;
  assetPacks: AssetPackRef[];
  layers: MapLayer[];
}

interface MapRecord {
  id: number;
  name: string;
  scale: MapScale; // planet | continent | country | region | settlement | locality
  /** Подпись «1 клетка = …» (колонка cell_lore). Display-metadata записи,
   *  не геометрия: в Grid config её нет. Редактируется в настройках карты,
   *  используется линейкой (parseCellLore) и экспортом. */
  cellLore: string;
  playerVisible: boolean;
  parentMapId: number | null;
  createdAt: string;
  updatedAt: string;
  /** Генераторный provenance (опционально, только metadata — см. D.8). */
  provenance?: MapProvenance;
  document: MapDocumentV5;
}
```

Физическое хранение `document` в SQLite (TEXT-колонка vs отдельная таблица) —
решение Фазы 2B. Схема БД на Фазе 2A не меняется.

### A.3. World

```ts
interface MapWorld {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

### A.3.1. Bounds semantics (выбранное правило)

`world.bounds` — рабочая/экспортная область карты. Инварианты: `maxX > minX`,
`maxY > minY`, все числа конечные. Свободные entities (objects, scatter areas,
labels, gameplay) МОГУТ временно находиться за пределами bounds — формат это
допускает, редактор при коммите предупреждает/клампит (решение редактора,
не формата). Зато клеточные модели строго ограничены: `TerrainCellLayer.cells`
и `cell-network` обязаны лежать в `0..columns-1 / 0..rows-1` (инвариант 18).

В документе только world coordinates. Screen coordinates, camera, zoom, pan —
никогда (см. C).

### A.4. Grid

```ts
interface MapGridConfig {
  type: "square" | "hex";
  /** Размер клетки в world units (для legacy square = 1). */
  cellSize: number;
  columns: number;
  rows: number;
  origin: Vec2;
  hex?: {
    orientation: "pointy";
    offset: "odd-q";
  };
}
```

- `columns/rows` — свойства grid, а не ограничение размещения: свободный объект
  вправе стоять вне клеток и даже вне `columns × rows` (валидация bounds —
  на редакторе, не на формате).
- Legacy hex-геометрия сохраняется дословно: `pointy-top, odd-q` из `grid.ts`.
- `cellSize > 0`, `columns/rows >= 1` целые, все числа конечные.
- World-координаты legacy square-карты W×H: клетка `(x, y)` занимает
  `[x, x+1] × [y, y+1]`, центр — `(x+0.5, y+0.5)`; bounds мигрированной карты —
  ровно `[0, W] × [0, H]`, `origin = { x: 0, y: 0 }`, `cellSize = 1`.
- Hex bounds мигрированной карты — bounding box углов всех клеток
  (через существующую математику `cellCorners`).

### A.5. Layers

```ts
interface MapLayerBase {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 включительно. */
  opacity: number;
}

type MapLayer =
  | TerrainLayer
  | PathLayer
  | ObjectLayer
  | ScatterLayer
  | LabelLayer
  | GameplayLayer;
```

- Порядок `layers[]` = порядок рендера (первый — ниже, последний — выше).
  Числового `zIndex` нет.
- Порядок items внутри слоя = порядок от заднего к переднему; reorder не
  меняет Entity ID.
- Сущность принадлежит ровно одному слою; тип сущности соответствует типу слоя.
- Nested groups, blend modes, transforms, masks, adjustment layers — не
  проектируются, архитектура их не запрещает (опциональные поля — позже).

### A.6. Terrain

```ts
type MaterialRef =
  | { type: "builtin"; key: string }
  | { type: "asset"; assetId: string };

interface TerrainLayerBase extends MapLayerBase {
  kind: "terrain";
  defaultMaterial: MaterialRef;
}

interface TerrainCellEntry {
  x: number;
  y: number;
  material: MaterialRef;
}

/** Клеточный террейн. ТРЕБУЕТ `document.grid !== null`; x/y — целые индексы
 *  в `0..columns-1 / 0..rows-1` (инвариант 18). Невыразимо без grid —
 *  именно поэтому отдельная ветка union, а не опциональные поля. */
interface TerrainCellLayer extends TerrainLayerBase {
  representation: "cells";
  /** Разреженно, сортировка (y, x). */
  cells: TerrainCellEntry[];
}

/** Масочный террейн. НЕ зависит от grid: работает при `grid: null`.
 *  Геометрия — собственная: origin + sampleSize в world units. */
interface TerrainMaskLayer extends TerrainLayerBase {
  representation: "mask";
  mask: TerrainMask;
}

type TerrainLayer = TerrainCellLayer | TerrainMaskLayer;

interface TerrainMask {
  origin: Vec2;
  /** World units на один terrain sample (> 0). При наличии grid редактор
   *  по умолчанию предлагает `cellSize / 8` или `/ 16` (editor default,
   *  не семантика формата — см. J.2). */
  sampleSize: number;
  /** Палитра слоя: sample логически = индекс в этот массив.
   *  Именно так canonical model отвечает, «что означает sample»,
   *  не раскрывая binary encoding. */
  materials: MaterialRef[];
  chunks: TerrainMaskChunk[];
}

interface TerrainMaskChunk {
  id: EntityId;
  /** Чанковые координаты: chunk (cx, cy) покрывает samples
   *  `[cx*S, (cx+1)*S) × [cy*S, (cy+1)*S)`, где S — размер чанка
   *  (решение Terrain Phase). Позиция sample в мире:
   *  `origin + (index + 0.5) * sampleSize`. */
  cx: number;
  cy: number;
  /** Непрозрачная нагрузка (индексы в `materials` + служебное).
   *  Логические требования к encoding: детерминированная сериализация,
   *  потоковое чтение по чанкам, отсутствие гигантского монолитного bitmap.
   *  Конкретная компрессия (RLE/base64/binary) и размер чанка —
   *  решение Terrain Phase, не этой спеки. */
  payload: JsonObject;
}
```

- Материал — только `MaterialRef`, никаких hex-цветов в документе.
- 18 legacy terrain codes → builtin-материалы `builtin:terrain/<code>`
  (snake_case кодов сохраняется после `builtin:terrain/` один в один —
  `MAP_TERRAIN_ORDER` из `render.ts`: `plain, forest, hills, mountains,
  desert, ice, swamp, deep-water, shallow-water, lava, acid, poison, wall,
  stone, wood, earth, darkness, necro`).
- Отсутствие клетки в `cells[]` = `defaultMaterial` (как отсутствие ключа
  в legacy = `plain`).

### A.7. Paths

```ts
interface PathLayer extends MapLayerBase {
  kind: "path";
  paths: MapPath[];
}

/** Логическая ссылка на стиль/профиль: та же семантика builtin/asset,
 *  что у MaterialRef/VisualRef. URL не хранятся никогда. */
type StyleRef =
  | { type: "builtin"; key: string }
  | { type: "asset"; assetId: string };

type ScatterProfileRef =
  | { type: "builtin"; key: string }
  | { type: "asset"; assetId: string };

interface MapPath {
  id: EntityId;
  /** "road" | "river" | "wall" | "fence" | "route" | "canal" | ... (открытый набор). */
  kind: string;
  geometry: PathGeometry;
  /** Для cell-network — в клетках; для spline — в world units. > 0. */
  width: number;
  styleRef: StyleRef;
  properties?: JsonObject;
}

type PathGeometry =
  | { type: "cell-network"; cells: Array<{ x: number; y: number }> }
  | { type: "spline"; nodes: SplineNode[] };

interface SplineNode {
  position: Vec2;
  in?: Vec2;
  out?: Vec2;
}
```

- `cell-network`: lossless-контейнер legacy `roads`/`rivers` (отсортированные
  клетки, без выдумывания кривых). Один path на kind при миграции.
  ТРЕБУЕТ `document.grid !== null`; x/y — целые индексы в
  `0..columns-1 / 0..rows-1` (инвариант 18).
- `spline`: мировые координаты, опциональные bezier-ручки. Grid не нужен.
- Пересечения/caps/mesh, вычисленные из геометрии, — derived, не хранятся.
- `width > 0`, конечное.

### A.8. Objects

```ts
type VisualRef =
  | { type: "builtin"; key: string }
  | { type: "asset"; assetId: string };

interface MapObject {
  id: EntityId;
  transform: {
    position: Vec2;
    /** Градусы, clockwise (Canvas: ось Y вниз). */
    rotation: number;
    scale: Vec2;
  };
  visual: VisualRef;
  properties?: JsonObject;
}

interface ObjectLayer extends MapLayerBase {
  kind: "object";
  items: MapObject[];
}
```

- `scale.x`/`scale.y` независимы; `scale.x < 0` = mirror (допустимо;
  хит-тест зеркального объекта — задача редактора/рендера, не формата).
- Builtin visuals (пока нет Asset Pack): `builtin:city`, `builtin:village`,
  `builtin:camp`, `builtin:chest`, `builtin:altar`, `builtin:trap`,
  `builtin:door`, `builtin:battle`, `builtin:obelisk`, ... — пространство имён
  `builtin:<legacy-kind>` один в один с кодами `MAP_MARKER_KINDS` и глифами
  дверей/ловушек.

### A.9. Scatter

```ts
interface ScatterLayer extends MapLayerBase {
  kind: "scatter";
  areas: ScatterArea[];
}

interface ScatterArea {
  id: EntityId;
  shape: ShapeGeometry;
  profileRef: ScatterProfileRef;
  seed: number;
  density: number;
  overrides?: JsonObject;
}
```

- Хранятся область + профиль + seed + параметры, НЕ сгенерированные инстансы.
- Будущая операция `Bake / Detach Scatter`: `ScatterArea → MapObject[]`
  в ObjectLayer; area после bake может удаляться. Editor operation.

### A.10. Shapes

```ts
type ShapeGeometry =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: Vec2[] }
  | { type: "ellipse"; center: Vec2; rx: number; ry: number };
```

Общая геометрия для Scatter, Rooms, будущих зон. К grid не привязана.
Инварианты: `w > 0, h > 0, rx > 0, ry > 0`; polygon — ≥3 точек, все конечные.

### A.11. Labels

```ts
interface MapLabel {
  id: EntityId;
  position: Vec2;
  text: string;
  styleRef?: string;
}

interface LabelLayer extends MapLayerBase {
  kind: "label";
  items: MapLabel[];
}
```

`text` — непустая строка после trim (лимиты — валидация редактора/сервера,
миграция их соблюдает, т.к. вход уже провалидирован парсером:
`MAP_MAX_LABELS = 200`, текст ≤64).

### A.12. Gameplay

```ts
interface GameplayRoom {
  id: EntityId;
  kind: "room";
  geometry: ShapeGeometry;
  roomType: "empty" | "barracks" | "temple" | "treasury" | "prison" | "lab";
  name: string;
}

interface GameplayDoor {
  id: EntityId;
  kind: "door";
  position: Vec2;
  /** Градусы clockwise от севера (−Y): n=0, e=90, s=180, w=270. */
  orientation: number;
  doorKind: "arch" | "door" | "locked" | "trapped" | "secret" | "portc";
  secret: boolean;
  pairedDoorId: EntityId | null;
}

interface GameplayTrap {
  id: EntityId;
  kind: "trap";
  position: Vec2;
  trapKind: "pit" | "arrow" | "gas" | "glyph";
}

interface GameplayMarker {
  id: EntityId;
  kind: "marker";
  position: Vec2;
  markerKind: "chest" | "altar" | "city" | "village" | "camp" | "metro" | "battle" | "obelisk";
}

interface GameplayStart {
  id: EntityId;
  kind: "start";
  position: Vec2;
}

interface GameplayFinish {
  id: EntityId;
  kind: "finish";
  position: Vec2;
}

type GameplayEntity =
  | GameplayRoom
  | GameplayDoor
  | GameplayTrap
  | GameplayMarker
  | GameplayStart
  | GameplayFinish;

interface GameplayLayer extends MapLayerBase {
  kind: "gameplay";
  items: GameplayEntity[];
}
```

- Kind-наборы — те же литералы, что `MAP_DOOR_KINDS`/`MAP_TRAP_KINDS`/
  `MAP_ROOM_TYPES`/`MAP_MARKER_KINDS` (миграция без переименований).
- `secret` двери сохраняется отдельным флагом И kind (legacy хранит оба:
  `kind: "secret"` и/или `secret: true` — см. D.7).
- Декоративный визуал gameplay-сущностей — через будущие VisualRef, не сейчас;
  kind ≠ visual (разделимость зафиксирована).

### A.13. Assets

```ts
interface AssetPackRef {
  id: string;
  version?: string;
}
```

- Документ хранит только ссылки. Определения (assets/materials/path
  styles/scatter profiles) живут в паках.
- Missing pack/asset: документ читаем, рендер — placeholder, ссылка
  сохраняется (восстановится при установке пака). Unresolved ref ≠ corruption
  (инвариант).

---

## B. Invariants

1. `v === 5`.
2. Layer IDs уникальны в документе.
3. Entity IDs уникальны в рамках документа (все слои и все типы).
4. Entity не идентифицируется индексом массива.
5. Все координаты — конечные numbers (`Number.isFinite`).
6. World bounds валидны (`maxX > minX`, `maxY > minY`).
7. Grid: `cellSize > 0`, `columns/rows >= 1` целые; hex — `pointy/odd-q`.
8. `opacity ∈ [0,1]`.
9. Entity принадлежит ровно одному слою; тип entity соответствует типу слоя.
10. Порядок `layers[]` и `items[]` = порядок рендера (снизу вверх / сзади вперёд); `zIndex` отсутствует.
11. `pairedDoorId` — `null` либо ID существующей `GameplayDoor` того же документа; парность симметрична (A↔B).
12. `width > 0` у paths (для cell-network — в клетках); `density >= 0`,
    `seed` — целое; `w/h/rx/ry > 0` у shapes.
13. `rotation` — конечное число; `scale.x/scale.y` — конечные, ненулевые.
14. Asset/Material/Style/Profile-ref может быть unresolved без corruption.
15. Сериализация: только arrays/objects/numbers/strings/booleans/null; детерминированный порядок ключей; `cells[]`/`cell-network` отсортированы по (y, x).
16. Ровно один TerrainLayer с `representation: "cells"` на документ на Фазе 2B (mask — позже; валидатор 2B это проверяет, формат разрешает оба).
17. `defaultMaterial` обязателен в каждом TerrainLayer.
18. Клеточные модели требуют grid: `TerrainCellLayer` и `cell-network`
    при `document.grid === null` — невалидны; их x/y — целые индексы
    в `0..columns-1 / 0..rows-1`. Мигрированные данные этому удовлетворяют
    всегда (парсер legacy гарантирует целочисленность и bounds).
19. Mask террейн от grid не зависит: `origin` + `sampleSize > 0` задают
    геометрию сами; `materials` непуст; каждый sample — валидный индекс
    в `materials`.

---

## C. Persisted vs Derived vs Editor-only

### Сохраняется (canonical)

World bounds; grid config; asset pack refs; layers (порядок, видимость, lock, opacity); terrain cells/mask; paths (геометрия, kind, width, styleRef); objects (transform, visual, properties); scatter areas; labels; gameplay entities; IDs; `properties`.

### Вычисляется (derived, не хранить)

Autotile/transition masks, Wang-индексы; scatter-инстансы; spatial indexes; render caches; thumbnail; canvas paths; selection hit caches; `hoverCells`; миниатюры списка карт (server-side, вне документа).

### Editor-only (никогда в документ)

Selection, hover, active tool, camera/zoom/pan, открытые модалки, ruler/wall/shape previews и drag-состояния, clipboard, undo/redo history, autosave status. Camera — по-прежнему `localStorage`.

---

## D. Legacy migration v1–v4 → V5

Вход миграции — распарсенный `MapCells` (парсер уже применил per-record
валидацию и caps: labels ≤200/64 символа, rooms ≤100, doors ≤400,
traps/markers ≤300, имена ≤64). Миграция детерминирована: тот же вход —
тот же V5 байт в байт (сортировки + `legacy-<kind>-<index>` IDs).

### D.1. Таблица

| Legacy | V5 |
|---|---|
| `terrain["x,y"]` (кроме `plain`) | TerrainLayer `cells`, material `builtin:terrain/<code>` |
| отсутствие ключа / `plain` | не пишется (покрыто `defaultMaterial = builtin:terrain/plain`) |
| `roads` Set | PathLayer, один path `kind:"road"`, `cell-network` (отсортировано) |
| `rivers` Set | PathLayer, один path `kind:"river"`, `cell-network` |
| `labels[]` | LabelLayer, позиция = центр клетки `(x+0.5, y+0.5)`, IDs `legacy-label-N` |
| `rooms[]` | Gameplay Room, `rect` как есть, IDs `legacy-room-N` |
| `doors[]` | Gameplay Door: позиция = середина ребра (`n:(x+.5,y)`, `s:(x+.5,y+1)`, `w:(x,y+.5)`, `e:(x+1,y+.5)`), orientation `n=0/e=90/s=180/w=270`, IDs `legacy-door-N` |
| `door.pair` | `pairedDoorId` в обе стороны (строка пары резолвится в IDs после обхода всех дверей) |
| `traps[]` | Gameplay Trap, центр клетки, IDs `legacy-trap-N` |
| `markers[]` | Gameplay Marker, IDs `legacy-marker-N` |
| `start/finish` | Gameplay Start/Finish, IDs `legacy-start`, `legacy-finish` |
| grid square W×H | `grid` square, `cellSize: 1`, `columns: W`, `rows: H`, `origin: {0,0}`, bounds `[0,W]×[0,H]` |
| grid hex W×H | `grid` hex `pointy/odd-q`, bounds = bbox углов клеток |
| seed/sea/mountains/forest | НЕ в документ — остаются колонками записи (см. D.8) |

### D.2. Tricky cases

- **Plain omitted.** `serializeCells` не пишет `plain` (сверено с кодом). Миграция читает отсутствие как `plain` и тоже не пишет клетку. Round-trip V5→рендер эквивалентен.
- **Door pairs.** Обход 1: создать все двери с `pairedDoorId: null`, запомнить `pair`-строку → ID. Обход 2: для каждой непустой строки проставить взаимные ссылки. Одиночная дверь — `null`. Пустая строка `pair: ""` парсером уже нормализована в `null`.
- **Hex.** Дверей на гексах не бывает (создание заблокировано, парсер пропустит только square-рёбра `n/s/e/w`), но если запись есть — мигрирует по тем же правилам edge-midpoint в hex-world-координатах; ориентация — по той же таблице. Рёберная модель гексов не вводится.
- **Roads/rivers.** Один path на kind, клетки отсортированы (y, x). Компоненты связности НЕ выделяются (деривация для рендера). Пересечения road×river не вычисляются (мост дорисует рендер, как сейчас).
- **Start/finish.** Всегда максимум одна точка каждого; `null` — отсутствие (слой без entity, а не entity-флаг).
- **Secret data.** `kind` + `secret` переносятся как есть оба поля; projection (§E) их скрывает. Данные не теряются и не утекают — сервер решает, какую проекцию отдать.
- **Версии v1–v3.** Отсутствующие массивы = пустые слои/отсутствие paths: v1 (без labels/rooms/doors/traps) → нет LabelLayer-items, нет gameplay, нет river-path; v2 → +labels; v3 → +rooms/doors/traps/start/finish. Пустые слои (`items: []`) валидны.
- **Caps.** Вход уже обрезан парсером (первые N валидных). Миграция caps не переупорядочивает.

### D.3. Порядок слоёв после миграции (снизу вверх, сверен с `renderMap`)

Legacy renderer рисует строго: terrain → **rivers** → **roads** (река НИЖЕ
дороги — бумажная подложка + вода, поверх дорога-мост) → rooms → doors →
traps → markers → start/finish → grid/coords → **labels поверх всего**.
Отсюда детерминированный порядок V5 (grid-линейка — решение рендера, не слоя):

`terrain(cells) → path(river) → path(road) → object(пусто) → scatter(пусто) →
gameplay → label`.

Фиксированные IDs/имена/флаги слоёв (часть детерминизма, §D.7):

| # | id | name | kind | visible | locked | opacity |
|---|---|---|---|---|---|---|
| 1 | `lyr-terrain` | `Terrain` | terrain | true | false | 1 |
| 2 | `lyr-river` | `Rivers` | path | true | false | 1 |
| 3 | `lyr-road` | `Roads` | path | true | false | 1 |
| 4 | `lyr-objects` | `Objects` | object | true | false | 1 |
| 5 | `lyr-scatter` | `Scatter` | scatter | true | false | 1 |
| 6 | `lyr-gameplay` | `Gameplay` | gameplay | true | false | 1 |
| 7 | `lyr-labels` | `Labels` | label | true | false | 1 |

Слои `river`/`road` присутствуют всегда (пустыми `paths: []`, если данных нет),
чтобы порядок по умолчанию был зафиксирован; object/scatter — пустыми скелетами.

Порядок entities внутри GameplayLayer после миграции (совпадает с порядком
отрисовки legacy): все `rooms` (исходный порядок) → все `doors` → все `traps` →
все `markers` → `start` → `finish`.

### D.4. Детерминизм миграции (точный)

- Layer IDs/имена/флаги/порядок — таблица D.3 дословно.
- Entity IDs: `legacy-room-N`, `legacy-door-N`, `legacy-trap-N`,
  `legacy-marker-N`, `legacy-label-N` (N — индекс в исходном массиве),
  `legacy-start`, `legacy-finish`; paths — `legacy-path-road`, `legacy-path-river`.
- Порядок entities: исходный порядок массивов (rooms/doors/traps/markers/labels
  уже детерминированы парсером); клетки terrain/cell-network отсортированы (y, x).
- Legacy road/river defaults (сверены с `renderMap`): `width: 1` (в клетках
  для cell-network; рендер умножает на scale как сейчас:
  road — `chrome.ink`, `max(1.5, scale*0.22)`, round caps;
  river — подложка `paper` `max(2, scale*0.34)` + вода `#4E7E96`/`MAP_RIVER_FILL`
  `max(1.5, scale*0.22)`), `styleRef: { type: "builtin", key: "road" }` /
  `{ type: "builtin", key: "river" }`.
- Новых случайных/UUID значений миграция не создаёт вообще. Повторная миграция
  одного входа — canonical-identical JSON. UUID — только для сущностей,
  созданных пользователем уже в V5.

### D.5. Door pair migration (точный алгоритм)

Legacy `pair` — непрозрачный строковый токен группы: редактор применяет
move/delete/kind ко ВСЕМ дверям с тем же токеном (проверено: `deleteSelected`,
`moveObjTo`, `saveDoorDraft` фильтруют по равенству токена, размера группы
не проверяют). Миграция:

1. Сгруппировать двери по непустому токену (`pair: ""` парсером уже → `null`).
2. Внутри группы отсортировать по исходному индексу.
3. Группа из 1 → `pairedDoorId: null` (висячий токен от удалённого партнёра).
4. Группа ровно из 2 → взаимные `pairedDoorId`.
5. Группа > 2 (нестандарт, но редактор такое допускает) → связать
   последовательными парами в порядке индексов (0↔1, 2↔3, …); нечётный
   остаток → `null`. НЕ связывать звездой и НЕ молча отбрасывать:
   мигратор возвращает число таких групп в отчёте.

Симметрия A↔B — инвариант 11; миграция с >2-группой его сохраняет
попарно, остаток — `null` с обеих сторон отсутствует как класс
(у остатка просто нет партнёра).

### D.6. soyman-map/2 envelope

```ts
interface SoyMapV2Envelope {
  format: "soyman-map/2";
  /** Копия record metadata для импорта (канонически живёт в MapRecord). */
  name: string;
  scale: MapScale;
  cellLore: string;
  document: MapDocumentV5;
}
```

`gridKind` отсутствует намеренно: единственный источник истины —
`document.grid` (`null` = без сетки). Размеры/геометрия выводятся из документа,
дублирование запрещено. `soyman-map/1` принимается как legacy import
(валидация + bounds-check — существующие, см. `mapExchange.ts`).
Обратный экспорт V5 → v1 не требуется.

### D.7. Secret-деталь (сверено с кодом)

Legacy дверь секрета кодируется двумя независимыми сигналами:
`kind === "secret"` и/или `secret === true` (`doorForView`: скрыть если любой).
Миграция копирует оба поля без нормализации «или» — projection проверяет оба.

### D.8. Provenance (не документ)

```ts
interface MapProvenance {
  preset?: string;
  seed?: number;
  params?: { sea?: number; mountains?: number; forest?: number };
}
```

Живёт в `MapRecord`, не в `MapDocumentV5`. Рендер и миграция его не читают.
Воспроизводимость «тот же сид» — свойство операции генератора, не формата.

---

## E. Player projection

Серверная, server-authoritative функция `projectForPlayer(doc): doc`
(преемник `stripCellsForPlayer` из `server/src/routes/maps.ts`).
Клиент игрока секретного не получает вообще (не «скрывает UI»).

Каноническая GM-миграция v1–v4 → V5 является **lossless**. Проекция вводит
ровно одну осознанную дельту относительно GM-данных — ту же, что production
уже делает сегодня на `/api/maps/:id` для роли player
(сверено: `stripCellsForPlayer` — secretdoors вон, trapped→обычная,
traps вон, room type→`empty`, имена комнат остаются):

| Сущность | GM | Player |
|---|---|---|
| secret door (`kind` или флаг) | видна (пунктир) | entity удалена из проекции |
| trapped door | `trapped` | `doorKind: "door"` (остальные поля как есть) |
| обычная дверь | как есть | как есть |
| trap | есть | entity удалена |
| room | `roomType` + имя | `roomType: "empty"`, имя сохраняется |
| marker/label/start/finish | как есть | как есть |
| terrain/paths/objects/scatter | как есть | как есть |

Уточнение про локальный preview: `previewAsPlayer` в текущем `renderMap`
НЕ правит тип комнат (ветки нет) — т.е. локальный preview щедрее серверной
отдачи. Это наблюдаемый production-quirk превью, не аргумент против проекции:
источник истины для игрока — серверная проекция. Generic `visible: false`
НЕ является механизмом безопасности: проекция типизирована по видам сущностей.

---

## F. Rendering order

1. Порядок `layers[]` (нижний → верхний).
2. Внутри слоя — порядок `items[]` (задний → передний).
3. Terrain ожидается нижним (валидатор 2B предупреждает, формат не запрещает).
4. Gameplay выше objects по умолчанию (порядок миграции, §D.3).
5. Сетка/координаты и подписи — решение рендера, не слоёв: legacy рисует
   grid/coords поверх gameplay, labels — поверх всего. V5-рендер сохраняет
   этот визуальный порядок независимо от layer order.

---

## G. Asset resolution

`builtin:<key>` — встроенный реестр клиента (символы/глифы текущего рендера;
террейны — палитра-наследник `MAP_TERRAIN_FILL`).
`asset:<assetId>` — через Asset Registry установленного пака
(`AssetPackRef.id[/version]` из документа).
Порядок: точное совпадение → semver-совместимый пак → placeholder
(непрозрачный бокс с ключом; документ и ссылка целы).
URL изображений, атласные координаты, `ImageBitmap` в документе запрещены.

---

## H. JSON example (V5, canonical)

```json
{
  "v": 5,
  "world": { "bounds": { "minX": 0, "minY": 0, "maxX": 8, "maxY": 6 } },
  "grid": { "type": "square", "cellSize": 1, "columns": 8, "rows": 6, "origin": { "x": 0, "y": 0 } },
  "assetPacks": [],
  "layers": [
    {
      "id": "lyr-terrain", "name": "Terrain", "kind": "terrain",
      "visible": true, "locked": false, "opacity": 1,
      "representation": "cells",
      "defaultMaterial": { "type": "builtin", "key": "terrain/plain" },
      "cells": [
        { "x": 1, "y": 1, "material": { "type": "builtin", "key": "terrain/forest" } },
        { "x": 2, "y": 1, "material": { "type": "builtin", "key": "terrain/forest" } }
      ]
    },
    {
      "id": "lyr-road", "name": "Roads", "kind": "path",
      "visible": true, "locked": false, "opacity": 1,
      "paths": [
        {
          "id": "path-road-1", "kind": "road",
          "geometry": { "type": "cell-network", "cells": [{ "x": 0, "y": 2 }, { "x": 1, "y": 2 }] },
          "width": 1, "styleRef": { "type": "builtin", "key": "road" }
        }
      ]
    },
    {
      "id": "lyr-objects", "name": "Objects", "kind": "object",
      "visible": true, "locked": false, "opacity": 1,
      "items": [
        {
          "id": "obj-1",
          "transform": { "position": { "x": 6.427, "y": 4.831 }, "rotation": 0, "scale": { "x": 1, "y": 1 } },
          "visual": { "type": "builtin", "key": "tree-oak" }
        },
        {
          "id": "obj-2",
          "transform": { "position": { "x": 5.5, "y": 4.5 }, "rotation": 90, "scale": { "x": -1, "y": 1 } },
          "visual": { "type": "asset", "assetId": "fantasy-punk:nature/tree-oak-03" }
        }
      ]
    },
    {
      "id": "lyr-scatter", "name": "Scatter", "kind": "scatter",
      "visible": true, "locked": false, "opacity": 1,
      "areas": [
        {
          "id": "scatter-1",
          "shape": { "type": "ellipse", "center": { "x": 4, "y": 4 }, "rx": 2, "ry": 1.5 },
          "profileRef": { "type": "builtin", "key": "forest-light" },
          "seed": 7,
          "density": 0.5
        }
      ]
    },
    {
      "id": "lyr-rooms", "name": "Gameplay", "kind": "gameplay",
      "visible": true, "locked": false, "opacity": 1,
      "items": [
        {
          "id": "room-1", "kind": "room",
          "geometry": { "type": "rect", "x": 5, "y": 3, "w": 2, "h": 2 },
          "roomType": "treasury", "name": "Кладовая"
        },
        {
          "id": "door-1", "kind": "door",
          "position": { "x": 5.5, "y": 3 }, "orientation": 0,
          "doorKind": "door", "secret": false, "pairedDoorId": null
        }
      ]
    },
    {
      "id": "lyr-labels", "name": "Labels", "kind": "label",
      "visible": true, "locked": false, "opacity": 1,
      "items": [{ "id": "label-1", "position": { "x": 1.5, "y": 1.5 }, "text": "Тёмный лес" }]
    }
  ]
}
```

## I. Legacy example (v4 → V5, фрагмент)

Вход (`cells` blob v4, поле 4×3 square):

```json
{
  "v": 4,
  "cells": { "1,1": "forest", "2,1": "forest" },
  "roads": ["0,2", "1,2"],
  "rivers": [],
  "labels": [{ "x": 1, "y": 1, "text": "Тёмный лес" }],
  "rooms": [{ "x": 2, "y": 0, "w": 2, "h": 2, "type": "treasury", "name": "Кладовая" }],
  "doors": [{ "x": 2, "y": 0, "edge": "n", "kind": "door", "secret": false, "pair": null }],
  "traps": [],
  "markers": [],
  "start": null,
  "finish": null
}
```

Выход: grid `square 4×3`, bounds `[0,4]×[0,3]`; TerrainLayer `cells` —
`(1,1)/(2,1) forest`, default `plain`; PathLayer — один `road`
`cell-network [(0,2),(1,2)]`; LabelLayer — `legacy-label-0` в `(1.5,1.5)`;
GameplayLayer — `legacy-room-0` rect `(2,0,2,2)` treasury, `legacy-door-0`
в `(2.5,0)` orientation `0`, `pairedDoorId: null`; object/scatter — пустые
скелеты; `assetPacks: []`.

---

## J. Open decisions (только неснимаемое на 2A)

1. **Chunk payload encoding** mask terrain (RLE/base64/binary + размер чанка).
2. **SampleSize default редактора** (`cellSize/8` vs `/16` при наличии grid;
   явный `sampleSize` при `grid: null`) — семантика формата от grid не зависит.
3. **Алгоритм сглаживания spline** (Catmull-Rom vs Bézier default) — на геометрию не влияет.
4. **Реестр и дистрибуция Asset Packs** (где лежат, версионирование, подпись).
5. **Хранение provenance** (колонка записи vs sidecar) — на документ не влияет.
6. **Лимиты длин/количеств V5** (наследовать MAP_MAX_* или снять для free-карт).

Фундаментальное (IDs, layers, free coords, cells+mask, cell-network+spline,
projection, отделение assets) — решено выше, не reopen.

---

## K. Проверка сценариев (§46 ТЗ)

- **Battlemap** (square, rooms, doors, мебель, scatter): rooms/doors — gameplay;
  мебель — objects со snap через редактор (формат не заставляет); scatter — area.
  Без хаков.
- **Hex region** (hex, cell terrain, roads, rivers, cities): terrain cells +
  два cell-network path + markers (`city`) с builtin-визуалом. Без хаков.
- **Beautiful regional** (`grid: null`, mask, spline, scatter, objects):
  grid-операции деградируют в free placement — явно, не хаком.
- **Quick generated** (preset → editable): генератор пишет обычные слои
  (cells terrain + scatter areas + objects) — результат открывается
  в Красивостях как есть. Без хаков.
- **Legacy dungeon** (v4 → V5): таблица D.1 + пример I; эквивалентность —
  тот же набор клеток/рёбер/центроидов и те же kinds/pairs, без выдумывания
  кривых. Без хаков.

Противоречий, требующих спец-хаков, не найдено.

---

## L. Связь с существующим кодом (для Фазы 2B)

- `grid.ts` (`pixelToCell/cellCenter/cellCorners`, odd-q pointy-top) — эталон
  hex-геометрии; миграция и V5-рендер обязаны использовать её, не копию.
- `render.ts` kinds/палитры (`MAP_*_KINDS`, `MAP_TERRAIN_FILL`) — источник
  builtin-пространств имён (§G, §A.6/A.8).
- Editor Фазы 1 (`mutateObjects/commitChange`, selection по индексам) —
  точки будущей адаптации под stable IDs, топология вызовов готова.
- `mapExchange.ts` (`soyman-map/1` + bounds-check) — образец валидации
  для `soyman-map/2`.
