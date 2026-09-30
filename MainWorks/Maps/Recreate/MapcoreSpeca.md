# Техническое задание

## Фаза 2A — проектирование Map Core V2 / MapDocument

## 1. Статус задачи

Фаза 1 завершена.

Существующий редактор декомпозирован на независимые подсистемы:

```text
Camera
History
Hotkeys
Autosave
Selection
Input
Tools
Viewport
```

Текущая модель данных карты при этом намеренно не менялась:

```text
MapCells
cells blob v1–v4
soyman-map/1
```

Фаза 2A посвящена **только проектированию новой модели карты**.

### На этой фазе запрещено менять production-код редактора.

Не мигрировать карту.

Не менять `MapCells`.

Не менять backend.

Не менять renderer.

Не создавать новую рабочую реализацию.

Результат Фазы 2A — архитектурная спецификация, по которой затем будет выполняться реализация.

---

# 2. Главная цель

Спроектировать новый Map Core таким образом, чтобы редактор больше не был фундаментально основан на клетке.

Новая архитектура должна поддерживать:

```text
быстрые карты
+
детализированные красивые карты
+
square grid
+
hex grid
+
карты без grid
+
свободные объекты
+
слои
+
asset packs
+
terrain materials
+
auto transitions
+
spline paths
+
scatter
+
procedural presets
+
GM/gameplay data
```

При этом оба будущих режима:

```text
⚡ СрочноТяпЛяп

🎨 Красивости
```

должны работать с **одним и тем же форматом карты**.

Это не две модели данных.

---

# 3. Основной архитектурный принцип

В старой архитектуре фундаментальной единицей является клетка:

```text
MapCells
 → terrain["x,y"]
 → roads Set<"x,y">
 → rivers Set<"x,y">
 → markers[x,y]
 → doors[x,y,edge]
```

В новой архитектуре фундаментом должен быть:

```text
MapDocument
 ├─ World
 ├─ Grid
 ├─ Layers
 └─ содержимое Layers
```

## Grid больше НЕ является фундаментом карты

Grid — это:

* система координат;
* snapping;
* отображение;
* измерение;
* возможная дискретизация некоторых типов Terrain/Path.

Но обычный объект должен иметь право находиться, например, в:

```text
x = 18.427
y = 7.831
```

без привязки к клетке.

---

# 4. Форматы и версии

Зафиксировать следующую терминологию.

Старые внутренние blobs:

```text
cells v1
cells v2
cells v3
cells v4
```

Новый внутренний формат:

```text
MapDocumentV5
```

Новый exchange/export envelope:

```text
soyman-map/2
```

То есть:

```text
soyman-map/1
    ↓ legacy import
cells v1–v4
    ↓ migration adapter
MapDocumentV5
    ↓
soyman-map/2
```

Обратный экспорт новой карты в `soyman-map/1` НЕ является обязательным.

Новая модель может содержать данные, которые принципиально невозможно представить в старом формате.

---

# 5. Разделение Map Metadata и MapDocument

Не смешивать серверные метаданные карты с её содержимым.

Существующие понятия вроде:

```text
id
name
scale = planet/continent/...
player_visible
parent_map_id
created_at
updated_at
```

относятся к `MapRecord / MapMetadata`.

А `MapDocument` описывает непосредственно содержимое мира.

Концептуально:

```ts
interface MapRecord {
  id: number;
  name: string;
  scale: MapScale;

  document: MapDocumentV5;

  // server metadata...
}
```

При этом текущую SQL-схему на Фазе 2A НЕ менять.

Физический способ хранения документа в SQLite будет решаться при реализации.

---

# 6. Целевой MapDocument

Подготовить точную TypeScript-спецификацию примерно следующего уровня:

```ts
interface MapDocumentV5 {
  v: 5;

  world: MapWorld;
  grid: MapGridConfig | null;

  assetPacks: AssetPackRef[];

  layers: MapLayer[];
}
```

Это ориентир.

Исполнитель должен проверить структуру на непротиворечивость и оформить окончательные interfaces/types в спецификации.

---

# 7. World

World описывает непрерывное пространство карты.

Минимально:

```ts
interface MapWorld {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}
```

World coordinates — `number`, не integer.

## Инварианты

```text
maxX > minX
maxY > minY
```

Все свободные объекты, paths, shapes и labels хранятся в world coordinates.

Screen coordinates в документ НЕ входят.

Camera в документ НЕ входит.

---

# 8. Grid

Grid может отсутствовать:

```ts
grid: MapGridConfig | null
```

Поддержать:

```text
square
hex
none
```

Для legacy hex сохранить текущую геометрию:

```text
pointy-top
odd-q
```

Grid должен содержать достаточно информации для:

* snapping;
* cell ↔ world;
* отображения;
* размеров логической сетки;
* измерения расстояний.

Концептуально:

```ts
interface MapGridConfig {
  type: "square" | "hex";

  cellSize: number;

  columns?: number;
  rows?: number;

  origin: Vec2;

  hex?: {
    orientation: "pointy";
    offset: "odd-q";
  };
}
```

Точную схему уточнить.

## Важно

`columns/rows` — свойства grid.

Они не должны определять возможность размещения любого MapObject только внутри клеток.

---

# 9. Стабильные ID

Все редактируемые сущности новой карты должны иметь стабильный ID.

Не использовать индекс массива как идентичность сущности.

Тип:

```ts
type EntityId = string;
type LayerId = string;
```

Для новых сущностей допустимо использовать UUID.

Для legacy migration ID должны генерироваться **детерминированно**, например:

```text
legacy-room-0
legacy-room-1

legacy-door-0

legacy-trap-0
```

Повторная миграция одного legacy документа должна выдавать те же IDs.

---

# 10. Layers

Layers становятся first-class сущностями.

Минимальный base:

```ts
interface MapLayerBase {
  id: LayerId;
  name: string;

  visible: boolean;
  locked: boolean;
  opacity: number;
}
```

Порядок `layers[]` является порядком рендера:

```text
первый = ниже
последний = выше
```

Не вводить дополнительный `zIndex`, если он не нужен.

## Начальный набор layer types

Спроектировать минимум:

```text
terrain
path
object
scatter
label
gameplay
```

Тип должен быть discriminated union.

Например:

```ts
type MapLayer =
  | TerrainLayer
  | PathLayer
  | ObjectLayer
  | ScatterLayer
  | LabelLayer
  | GameplayLayer;
```

## Пока НЕ нужны

* nested layer groups;
* blend modes;
* layer transforms;
* masks между layers;
* adjustment layers.

Архитектура не должна запрещать их в будущем, но реализовывать сейчас не надо.

---

# 11. Порядок объектов внутри layer

Сущности внутри слоя также должны иметь стабильный порядок рендера.

Предпочтительно:

```text
порядок items[] = порядок от заднего к переднему
```

Не вводить числовой `zIndex` без необходимости.

Entity ID при reorder не меняется.

---

# 12. Object Layer

Object Layer хранит свободно размещаемые визуальные объекты:

```text
дерево
камень
сундук
дом
статуя
телега
мебель
декорация
```

Концептуально:

```ts
interface MapObject {
  id: EntityId;

  transform: {
    position: Vec2;
    rotation: number;
    scale: Vec2;
  };

  visual: VisualRef;

  properties?: JsonObject;
}
```

Зафиксировать единицы rotation.

Рекомендуется:

```text
degrees
positive = clockwise
```

из-за Canvas coordinate system.

## Scale

Должны поддерживаться независимые:

```text
scale.x
scale.y
```

что также позволяет mirror:

```text
scale.x < 0
```

Если такое решение создаёт проблемы — описать альтернативу.

---

# 13. VisualRef / Assets

MapDocument НЕ должен хранить URL изображений как основную идентичность ассета.

Использовать логическую ссылку.

Например:

```ts
type VisualRef =
  | {
      type: "builtin";
      key: string;
    }
  | {
      type: "asset";
      assetId: string;
    };
```

Это позволяет одновременно поддерживать:

```text
старые встроенные символы редактора
+
будущие PNG/WebP/atlas assets
```

Пример:

```text
builtin: city

asset:
fantasy-punk:nature/tree-oak-03
```

---

# 14. Asset Packs

MapDocument хранит только ссылки на необходимые паки:

```ts
interface AssetPackRef {
  id: string;
  version?: string;
}
```

Asset Pack отдельно содержит:

```text
assets
materials
path styles
scatter profiles
```

Документ НЕ содержит URL каждого изображения.

## Missing asset

Отсутствующий asset pack или asset:

* не должен делать документ нечитаемым;
* должен отображаться placeholder;
* ссылка должна сохраняться, чтобы ассет восстановился после установки pack.

---

# 15. Terrain

Terrain должен поддерживать **два представления**.

Это намеренное архитектурное решение для двух типов работы.

## A. Cell Terrain

Подходит для:

```text
СрочноТяпЛяп
hex maps
классических dungeon/tactical maps
legacy migration
```

Концептуально:

```ts
{
  representation: "cells";

  defaultMaterial: MaterialRef;

  cells: ...
}
```

Хранение разреженное.

Grid определяет геометрию клеток.

---

## B. Mask Terrain

Подходит для режима:

```text
Красивости
```

Граница материала не обязана совпадать с игровой клеткой.

Например игровая клетка может соответствовать:

```text
8×8
16×16
```

terrain samples.

Концептуально:

```ts
{
  representation: "mask";

  resolution: number;

  defaultMaterial: MaterialRef;

  chunks: TerrainMaskChunk[];
}
```

## Chunking

Mask terrain должен быть chunked.

Не хранить гигантский монолитный bitmap всей карты.

При этом Фаза 2A НЕ обязана определять окончательное binary/base64/RLE encoding chunk payload.

Нужно определить **логическую модель и требования к encoding**, а конкретную компрессию можно оставить реализации Terrain Phase.

---

# 16. Terrain Material

Terrain не должен хранить:

```text
"зелёный цвет"
```

как визуальную реализацию.

Он хранит:

```text
MaterialRef
```

Material определяется Asset Pack.

Материал в будущем может содержать:

```text
base textures
variation
scale rules
transition rules
scatter profile
edge decoration
```

Но эти определения НЕ являются частью конкретной карты.

---

# 17. Auto Transitions

Auto transitions являются **derived render data**.

Не сохранять в документ:

```text
edge_NW
corner_SE
Wang mask
autotile index
```

Документ хранит только материалы / terrain field.

Renderer или terrain cache вычисляет переходы.

Это принципиальный инвариант.

---

# 18. Paths

Path Layer используется для:

```text
дорог
рек
ручьёв
стен
заборов
маршрутов
каналов
```

MapPath должен иметь stable ID.

Будущий основной формат:

```ts
interface MapPath {
  id: EntityId;

  kind: string;

  geometry: PathGeometry;

  width: number;

  styleRef: string;

  properties?: JsonObject;
}
```

---

# 19. Два Path Geometry

Для lossless legacy migration разрешить два представления.

## Cell Network

```text
geometry.type = "cell-network"
```

Содержит старый дискретный набор клеток.

Это позволяет перенести текущие:

```text
roads: Set<"x,y">
rivers: Set<"x,y">
```

без попытки угадывать исходную кривую.

## Spline

```text
geometry.type = "spline"
```

Хранит:

```text
nodes[]
```

с world coordinates.

Предусмотреть возможность optional bezier handles:

```ts
{
  position: Vec2;
  in?: Vec2;
  out?: Vec2;
}
```

Derived intersections/caps/mesh НЕ сохраняются.

---

# 20. Scatter

Scatter — самостоятельная параметрическая сущность.

```ts
interface ScatterArea {
  id: EntityId;

  shape: ShapeGeometry;

  profileRef: string;

  seed: number;

  density: number;

  overrides?: ...
}
```

Scatter хранит:

```text
область
профиль
seed
параметры
```

а НЕ тысячи созданных объектов.

Generated instances являются derived data.

---

# 21. Bake Scatter

Должна существовать будущая операция:

```text
Bake / Detach Scatter
```

которая:

```text
ScatterArea
    ↓
MapObject[]
```

После bake объекты становятся обычными редактируемыми Object entities.

Сам ScatterArea может быть удалён.

Это editor operation.

---

# 22. ShapeGeometry

Создать общий тип геометрической области, пригодный как минимум для:

```text
Scatter
Rooms
future zones
```

Минимум:

```text
rect
polygon
ellipse
```

Пример:

```ts
type ShapeGeometry =
  | RectGeometry
  | PolygonGeometry
  | EllipseGeometry;
```

Не привязывать Shapes к grid.

---

# 23. Labels

Label получает stable ID и world position.

```ts
interface MapLabel {
  id: EntityId;

  position: Vec2;

  text: string;

  styleRef?: string;
}
```

Legacy label мигрируется в world position через центр соответствующей клетки.

---

# 24. Gameplay Layer

Gameplay data не должна смешиваться с декоративными MapObjects.

Gameplay Layer содержит семантические сущности НРИ.

Минимум необходимо представить существующие:

```text
Room
Door
Trap
Marker
Start
Finish
```

как discriminated union.

Например:

```ts
type GameplayEntity =
  | MapRoom
  | MapDoor
  | MapTrap
  | MapMarker
  | MapStart
  | MapFinish;
```

Все получают stable ID.

---

# 25. Rooms

Room больше не обязан навсегда быть:

```text
x,y,w,h в клетках
```

Его геометрия:

```text
ShapeGeometry
```

Legacy room мигрирует в rect.

Сохранить:

```text
roomType
name
```

как semantic properties.

---

# 26. Doors

Новая Door entity должна иметь:

```text
id
world position
orientation
kind
secret
```

и при необходимости:

```text
pairedDoorId
```

Вместо старого:

```text
pair: "p17"
```

После legacy migration две двери должны ссылаться друг на друга stable Entity IDs.

Doors по-прежнему могут иметь snapping к grid edges, но хранение двери не должно быть фундаментально завязано на:

```text
{x,y,edge}
```

---

# 27. Traps / Markers / Start / Finish

Также переводятся в world coordinates + stable ID.

Их текущие `kind` сохраняются как typed semantic data.

Не превращать их сейчас в Asset Objects.

Визуал и gameplay semantics должны оставаться логически разделимыми.

---

# 28. GM / Player projection

Security model должен остаться server-authoritative.

Player client не должен получать секретные данные и просто скрывать их UI.

Новый MapDocument должен поддерживать серверную функцию вида:

```text
MapDocument
    ↓ projectForPlayer()
PlayerMapDocument
```

Существующее поведение необходимо сохранить:

```text
secret door → скрыта
trapped door → игрок видит обычную дверь
trap → отсутствует
room type → empty/скрытый тип
```

При этом generic visibility metadata допустима, но она не заменяет typed player projection rules.

Не проектировать безопасность только как:

```text
visible: false
```

на клиенте.

---

# 29. Editor-only state НЕ входит в MapDocument

Не сериализовать:

```text
selection
hover
active tool
camera
zoom
pan
open modal
ruler preview
wall live preview
shape drag preview
clipboard
undo history
redo history
autosave status
```

Camera по-прежнему может жить в `localStorage`.

---

# 30. Derived data НЕ входит в MapDocument

Не сохранять:

```text
autotile result
transition masks generated from neighbors
scatter generated instances
spatial indexes
render caches
thumbnail
Canvas paths
selection hit caches
```

Всё это должно быть восстанавливаемым из canonical data.

---

# 31. Procedural Presets

`СрочноТяпЛяп` presets являются editor operations.

Например:

```text
Forest Clearing preset
```

создаёт обычные:

```text
Terrain
Scatter
Objects
Paths
```

Preset НЕ должен создавать специальный:

```text
ForestClearingEntity
```

если это не действительно параметрическая сущность вроде Scatter.

Главный принцип:

> результат СрочноТяпЛяп можно открыть в Красивостях и редактировать обычными инструментами.

---

# 32. Один документ для двух режимов

В `MapDocument` НЕ должно быть:

```text
mode: "quick" | "beautiful"
```

Режим — свойство editor UI.

Одна карта может одновременно содержать:

```text
cell terrain
mask terrain
free objects
scatter
splines
gameplay data
```

---

# 33. Legacy migration v1–v4 → V5

Спецификация должна содержать точную таблицу миграции.

Минимально:

| Legacy             | V5                                    |
| ------------------ | ------------------------------------- |
| `terrain["x,y"]`   | TerrainLayer `representation:"cells"` |
| отсутствие terrain | `defaultMaterial = plain`             |
| roads Set          | PathLayer + `cell-network`            |
| rivers Set         | PathLayer + `cell-network`            |
| labels[]           | LabelLayer + stable IDs               |
| rooms[]            | Gameplay Room + rect geometry         |
| doors[]            | Gameplay Door + world position        |
| door pair          | `pairedDoorId`                        |
| traps[]            | Gameplay Trap                         |
| markers[]          | Gameplay Marker                       |
| start              | Gameplay Start                        |
| finish             | Gameplay Finish                       |

Миграция должна быть **lossless относительно текущего визуального/семантического поведения**.

Не пытаться автоматически превращать старые roads/rivers в красивые spline curves.

Это было бы выдумыванием данных.

---

# 34. Terrain legacy materials

Старые 18 terrain codes должны получить канонический builtin MaterialRef.

Например концептуально:

```text
builtin:terrain/plain
builtin:terrain/forest
builtin:terrain/mountains
builtin:terrain/deep-water
...
```

Точную naming convention определить в спецификации.

Таким образом legacy map может работать без установленного внешнего Asset Pack.

---

# 35. Builtin Visual namespace

Аналогично существующие векторные:

```text
city
village
camp
chest
altar
trap
door
...
```

должны иметь builtin visual identity, пока Asset System не подключён.

Новая модель не должна требовать сразу нарисовать Asset Pack для открытия старой карты.

---

# 36. Invariants документа

Спецификация должна явно перечислить invariants.

Минимум:

```text
Layer IDs уникальны.

Entity IDs уникальны в рамках документа.

Entity не идентифицируется индексом массива.

Все entity coordinates конечные numbers.

Layer opacity ∈ [0,1].

Entity относится ровно к одному layer.

Тип entity соответствует layer type.

pairedDoorId либо null, либо ссылается на существующую Door.

World bounds валидны.

Grid geometry валидна.

Asset/Material ref может быть unresolved без corruption документа.
```

Добавить остальные обнаруженные необходимые invariants.

---

# 37. Serialization

Формат должен быть обычным JSON.

Canonical document должен быть детерминированно сериализуем.

Нельзя хранить:

```text
Map
Set
class instances
Canvas objects
functions
```

Runtime может использовать их для оптимизации, но serialized representation:

```text
arrays
objects
numbers
strings
booleans
null
```

---

# 38. Runtime vs Serialized model

Допускается различие:

```text
SerializedMapDocumentV5
        ↓ parse
RuntimeMapDocument
```

если runtime нужны:

```text
Map<EntityId,...>
indexes
spatial lookup
caches
```

Но необходимо чётко описать:

* canonical persisted representation;
* runtime indexes;
* кто источник истины.

Canonical document является источником истины.

---

# 39. Производительность

Не проектировать формат только под текущий лимит:

```text
100×100
```

Новая архитектура должна позволять рост.

Особенно:

* terrain mask должен быть chunked;
* spatial index является runtime-derived;
* scatter instances не должны раздувать save;
* asset URLs не должны дублироваться в тысячах objects.

Но конкретную premature optimization не делать.

---

# 40. Undo/Redo

В Фазе 2A НЕ менять snapshot History.

Однако новая модель должна позволять в будущем перейти на command/patch history.

Для этого:

* stable IDs обязательны;
* операции не должны зависеть от array index identity;
* entity update должен быть выразим как изменение сущности по ID.

Не реализовывать command system сейчас.

---

# 41. Autosave

Новая модель должна сериализоваться целиком существующим autosave-механизмом на первом этапе.

Patch saving не требуется.

Нельзя делать patch protocol prerequisite для Map Core V2.

---

# 42. Renderer

Новый MapDocument не должен зависеть от Canvas.

Renderer зависит от MapDocument, а не наоборот.

Концептуально:

```text
MapDocument
    ↓
Renderer
```

а не:

```text
Canvas-specific objects
    ↓
MapDocument
```

---

# 43. Изоляция Asset System

MapDocument знает:

```text
assetId
materialId
styleRef
profileRef
```

Но не знает:

```text
ImageBitmap
HTMLImageElement
CanvasPattern
texture atlas coordinates
CDN URL
```

Этим занимается Asset Registry / renderer.

---

# 44. Что НЕ проектировать сейчас глубоко

Не уходить в реализацию:

```text
GPU renderer
WebGL
texture atlas
binary save format
terrain RLE
exact chunk byte encoding
collaboration/CRDT
network multiplayer editing
plugin API
nested layer groups
animation
3D
```

Если архитектура позволяет это добавить позже — достаточно.

---

# 45. Deliverables Фазы 2A

Создать один архитектурный документ, например:

```text
docs/map-core-v2.md
```

Production source files НЕ менять.

Документ должен содержать:

## A. Final TypeScript model

Полный draft:

```text
MapDocumentV5
World
Grid
Layers
Terrain
Paths
Objects
Scatter
Labels
Gameplay
VisualRef
AssetPackRef
Geometry
IDs
```

Не псевдокод, а достаточно точные interfaces/types.

## B. Invariants

Полный список правил валидности документа.

## C. Persisted vs Derived

Таблица:

```text
что сохраняется
что вычисляется
что editor-only
```

## D. Legacy migration

Точная таблица:

```text
v1–v4 → V5
```

с tricky cases:

```text
plain omitted
door pairs
hex
roads/rivers
start/finish
secret data
```

## E. Player projection

Как новый документ очищается для игрока.

## F. Rendering order

Как определяется:

```text
layer order
+
item order
```

## G. Asset resolution

Как:

```text
AssetRef
MaterialRef
StyleRef
ScatterProfileRef
```

резолвятся и что происходит при missing refs.

## H. JSON example

Привести небольшой, но полный пример `MapDocumentV5` с:

```text
cell terrain
road
2 objects
scatter area
room
door
label
```

## I. Legacy example

Показать небольшой:

```text
cells v4
```

и результат его миграции в V5.

## J. Open decisions

В конце оставить ТОЛЬКО вопросы, которые действительно нельзя безопасно решить на Фазе 2A.

Не оставлять фундаментальные вопросы вроде:

```text
"делать ли стабильные ID?"
"нужны ли layers?"
```

Они уже решены этим ТЗ.

---

# 46. Отдельно проверить спорные места

Перед финальным выводом исполнитель должен специально проверить архитектуру на сценариях:

### Battlemap

```text
square grid
rooms
doors
furniture
free objects
scatter
```

### Hex region map

```text
hex
cell terrain
roads
rivers
cities
```

### Beautiful regional map

```text
grid optional
mask terrain
spline roads
scatter forest
free objects
```

### Quick generated map

```text
preset
→ terrain
→ scatter
→ objects
→ editable result
```

### Legacy dungeon

```text
cells v4
→ migration
→ V5
→ visually/semantically equivalent
```

Если одна модель не справляется со всеми пятью без специальных hacks — указать проблему.

---

# 47. Не создавать LegacyEntity

Не использовать универсальную сущность:

```text
LegacyThing
```

для мигрированных данных.

Если старое представление остаётся полезным техническим режимом:

```text
Terrain cells
Path cell-network
```

оно должно быть нормальной поддерживаемой разновидностью новой модели.

Не тащить `legacy` как постоянную архитектурную ветку.

---

# 48. Не делать универсальный God Object

Не заменять старый `MapCells` новым:

```ts
Entity {
  type: string;
  data: any;
}
```

с огромным `Record<string, unknown>`.

Ключевые сущности должны быть typed discriminated unions.

`properties` допустим только для расширяемых вторичных данных.

Основные координаты, geometry, IDs, kind и relations должны быть типизированы.

---

# 49. Критерии принятия Фазы 2A

Фаза завершена, если:

1. Production-код не изменён.

2. Есть полная спецификация MapDocumentV5.

3. Grid больше не является обязательным фундаментом всех entities.

4. Free coordinates поддержаны.

5. Stable IDs обязательны.

6. Layers first-class.

7. Cell Terrain поддержан.

8. Mask Terrain предусмотрен.

9. Cell-network Paths позволяют lossless legacy migration.

10. Spline Paths предусмотрены.

11. Objects отделены от Assets.

12. Scatter параметрический.

13. Gameplay entities typed.

14. Player projection остаётся server-authoritative.

15. Editor-only state исключён из документа.

16. Derived render data исключены из документа.

17. Legacy v1–v4 имеют детерминированный migration mapping.

18. Missing assets не corrupt документ.

19. Quick/Beautiful используют один документ.

20. Нет runtime/type dependency на React/Canvas/API внутри MapDocument types.

---

# 50. Итоговый ответ после работы

После создания спецификации не переходить к реализации.

Отчитаться:

1. какие файлы созданы;
2. финальная top-level структура `MapDocumentV5`;
3. список layer types;
4. модель IDs;
5. модель coordinates/grid;
6. решение Terrain cells vs mask;
7. решение Paths cell-network vs spline;
8. модель AssetRefs;
9. модель Scatter;
10. Gameplay entities;
11. persisted vs derived;
12. legacy migration summary;
13. player projection;
14. оставшиеся open decisions;
15. обнаружены ли фундаментальные противоречия.

После этого остановиться.

Фаза 2B — migration layer / implementation plan — начинается только после отдельного ревью спецификации.
