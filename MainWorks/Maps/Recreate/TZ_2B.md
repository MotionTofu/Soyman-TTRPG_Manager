# Техническое задание

## Фаза 2B — реализация Map Core V2 и Legacy Migration Layer

## 1. Исходное состояние

Фаза 1 завершена и закоммичена.

Редактор декомпозирован на:

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

Фаза 2A завершена и закоммичена.

Архитектурным источником истины является:

```text
docs/adr/0003-map-core-v2.md
```

ADR определяет:

```text
MapDocumentV5
Layers
Stable IDs
World coordinates
Optional Grid
Terrain cells | mask
Paths cell-network | spline
Objects
Scatter
Labels
Gameplay entities
Asset/resource refs
Legacy migration
Player projection
soyman-map/2
```

На Фазе 2B эти решения считаются замороженными.

Если production-код или старые форматы расходятся с ADR, не менять ADR молча.

Остановиться и зафиксировать конкретное противоречие.

---

# 2. Главная цель

Реализовать новый `Map Core V2` как независимый модуль рядом со старой системой.

К концу фазы должно существовать:

```text
Legacy cells v1-v4
       ↓
    MapCells
       ↓
 migrateLegacyMap(...)
       ↓
  MapDocumentV5
       ↓
 validate / parse
       ↓
 canonical serialize
       ↓
 deterministic JSON
```

При этом существующий Map Editor всё ещё работает на:

```text
MapCells
```

и не переводится на V5 в рамках этой фазы.

---

# 3. Ключевое ограничение

На Фазе 2B запрещено:

* делать `MapDocumentV5` editor state;
* заменять `MapCells`;
* менять `renderMap`;
* менять текущие Tools;
* менять Selection;
* менять History;
* менять Input;
* менять Autosave;
* менять backend CRUD карт;
* менять SQLite schema;
* переводить существующий `/api/maps` на V5;
* автоматически мигрировать существующие карты в базе;
* удалять legacy parser;
* менять `cells v1-v4`;
* менять `soyman-map/1`;
* реализовывать mask renderer;
* реализовывать spline renderer;
* реализовывать Asset Pack system;
* реализовывать Scatter generation.

Фаза 2B создаёт новый Core, но **ещё не подключает его к рабочему редактору**.

---

# 4. Рекомендуемая структура

Создать отдельный каталог:

```text
client/src/maps/core/
```

Ориентировочная структура:

```text
client/src/maps/core/
├── types.ts
├── jsonTypes.ts
├── refs.ts
├── constants.ts
├── ids.ts
├── validate.ts
├── parse.ts
├── serialize.ts
├── canonicalize.ts
├── migrateLegacy.ts
├── playerProjection.ts
├── exchangeV2.ts
└── index.ts
```

Тесты рядом:

```text
*.test.ts
```

Если часть файлов получается искусственно маленькой — объединять допустимо.

Главное — не складывать весь Core в один файл на 1500 строк.

---

# 5. Направление зависимостей

Core не должен зависеть от React.

Core не должен зависеть от Canvas.

Core не должен зависеть от editor hooks.

Core не должен зависеть от API клиента.

Допустимая схема:

```text
grid.ts
render constants / legacy types
        ↓
maps/core
        ↓
будущие consumers
```

Если миграция использует существующую grid-математику:

```text
cellCenter
cellCorners
```

импортировать её из существующего `grid.ts`.

Не копировать hex-формулы.

---

# 6. Реализовать TypeScript model

Перенести модель из ADR в настоящий production TypeScript.

Минимально реализовать:

```text
MapDocumentV5
MapRecord-compatible metadata types
MapWorld
MapGridConfig

MapLayer
TerrainCellLayer
TerrainMaskLayer
PathLayer
ObjectLayer
ScatterLayer
LabelLayer
GameplayLayer

MapPath
PathGeometry
SplineNode

MapObject
ScatterArea
MapLabel

GameplayRoom
GameplayDoor
GameplayTrap
GameplayMarker
GameplayStart
GameplayFinish

ShapeGeometry

EntityId
LayerId
Vec2

AssetPackRef
MaterialRef
VisualRef
StyleRef
ScatterProfileRef

JsonValue
JsonObject
JsonArray
```

Типы должны точно соответствовать принятому ADR.

Не расширять модель «на будущее» без необходимости.

---

# 7. JSON-safe types

Реализовать рекурсивную JSON-модель.

Примерно:

```ts
type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

type JsonValue =
  | JsonPrimitive
  | JsonObject
  | JsonArray;

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonArray = JsonValue[];
```

Canonical persisted model не должен типово допускать:

```text
Date
Map
Set
Function
undefined
class instances
```

---

# 8. Resource refs

Реализовать единый typed pattern:

```text
builtin
asset
```

для:

```text
MaterialRef
VisualRef
StyleRef
ScatterProfileRef
```

Не использовать raw URL.

Не использовать строковый magic-prefix как единственную типовую гарантию, если ADR задаёт object-discriminated representation.

Пример:

```ts
{
  type: "builtin",
  key: "terrain/plain"
}
```

---

# 9. Builtin constants

Создать канонические builtin refs для legacy-совместимости.

Минимум:

```text
terrain/plain
terrain/forest
terrain/hills
terrain/mountains
terrain/desert
terrain/ice
terrain/swamp
terrain/deep_water
terrain/shallow_water
terrain/lava
terrain/acid
terrain/poison
terrain/wall
terrain/stone
terrain/wood
terrain/earth
terrain/darkness
terrain/necro
```

Сверить naming точно с ADR.

Не допустить случайного расхождения:

```text
deep-water
deep_water
deepWater
```

между миграцией, validator и renderer adapters.

Для paths:

```text
builtin road style
builtin river style
```

в точной форме, принятой ADR.

Для старых визуальных gameplay/markers при необходимости подготовить builtin refs, но не подключать renderer.

---

# 10. Stable ID helpers

Новые пользовательские сущности в будущем могут использовать UUID.

Но legacy migration должна быть полностью детерминированной.

Реализовать helpers уровня:

```ts
legacyLayerId(...)
legacyEntityId(...)
legacyPathId(...)
```

Не генерировать random UUID при миграции.

Повторный вызов:

```text
legacy input X
→ V5 A

legacy input X
→ V5 B
```

должен давать canonical-identical документы.

---

# 11. Canonical ordering

Определить и реализовать canonical ordering в соответствии с ADR.

Минимум:

```text
Terrain cells:
sort y, then x

cell-network cells:
sort y, then x
```

Legacy entity order сохраняется детерминированно по исходным массивам.

Layer order legacy migration должен быть фиксирован:

```text
terrain
river
road
objects
scatter
gameplay
labels
```

Gameplay item order:

```text
rooms
doors
traps
markers
start
finish
```

Нельзя полагаться на incidental insertion order разных вызовов.

---

# 12. Canonicalization

Создать функцию уровня:

```ts
canonicalizeMapDocument(doc)
```

Она должна приводить документ к сериализуемому каноническому виду, не меняя semantics.

Минимально:

* canonical ordering там, где ADR его требует;
* отсутствие `undefined`;
* стабильная структура;
* нормализация допустимых optional fields;
* без генерации новых IDs;
* без изменения entity order, если порядок является render semantics.

Очень важно:

Не сортировать обычные:

```text
layers[]
items[]
```

по ID.

Их порядок является частью карты.

Сортировка допустима только там, где ADR прямо говорит, что порядок данных не несёт визуальной семантики:

```text
TerrainCellEntry[]
cell-network cells[]
```

---

# 13. Serializer

Реализовать:

```ts
serializeMapDocument(doc): string
```

Требования:

* canonical representation;
* deterministic output;
* JSON;
* без runtime-only data;
* один и тот же canonical doc → одна и та же строка.

Не обязательно писать собственный JSON encoder.

Можно использовать `JSON.stringify` после canonicalization.

Но порядок object keys должен быть стабильным.

Если обычная конструкция объектов уже гарантирует нужный порядок в проекте — зафиксировать это тестами.

---

# 14. Parser

Реализовать:

```ts
parseMapDocument(raw): ParseResult
```

Parser должен:

1. разобрать JSON/unknown;
2. проверить структуру;
3. проверить `v === 5`;
4. проверить invariants;
5. вернуть typed `MapDocumentV5`;
6. не бросать необработанные исключения наружу для пользовательского файла.

Предпочтительный результат:

```ts
type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] };
```

Не обязательно именно такое имя.

---

# 15. Runtime validation

Реализовать validator V5.

Проверить минимум все invariants ADR:

```text
version
world bounds
finite numbers
grid
layer IDs
entity IDs
opacity
layer kinds
entity kinds
terrain representation
cell/grid constraints
shape geometry
path width
scatter density/seed
scale != 0
pairedDoorId
door symmetry
resource refs
JSON-safe properties
```

Особенно:

```text
TerrainCellLayer
→ требует grid

cell-network
→ требует grid
```

И:

```text
cell x/y
→ integer
→ внутри columns/rows
```

---

# 16. Глобальная уникальность IDs

Validator должен проверять:

```text
LayerId uniqueness

EntityId uniqueness across ALL layers
```

Не только внутри конкретного массива.

То есть это невалидно:

```text
ObjectLayer:
  obj-17

GameplayLayer:
  door id = obj-17
```

---

# 17. Door relation validation

Проверять:

```text
pairedDoorId == null
```

или:

```text
pairedDoorId → существующая GameplayDoor
```

Также:

```text
A.pairedDoorId === B.id
→
B.pairedDoorId === A.id
```

Self-pair запрещён.

Если ADR этого ещё явно не говорит — считать естественным следствием парности и зафиксировать в код-комментарии/тесте, не менять ADR без необходимости.

---

# 18. Terrain validation

Для `TerrainCellLayer`:

* grid обязателен;
* `x/y` integer;
* внутри grid;
* material ref валиден;
* canonical cells не должны содержать duplicate coordinate entries.

Duplicate `(x,y)` — validation error.

Не применять правило «последний победил» молча.

Для `TerrainMaskLayer` пока проверить только логическую оболочку:

* `sampleSize > 0`;
* finite;
* `materials.length > 0`;
* chunk IDs unique;
* chunk coordinates integer;
* payload JSON-safe.

Не валидировать ещё будущий byte encoding.

---

# 19. Path validation

`MapPath`:

```text
id unique
kind non-empty
width > 0
styleRef valid
```

`cell-network`:

* grid required;
* integer cells;
* cells in bounds;
* duplicates prohibited.

`spline`:

* world Vec2 finite;
* nodes должны удовлетворять минимальной длине, принятой ADR/реализацией;
* handles finite;
* никаких derived intersections/caps.

Если ADR не задаёт минимальное число spline nodes — зафиксировать разумный validator-level минимум и явно сообщить в отчёте.

Не менять фундаментальную модель.

---

# 20. Shape validation

Проверить:

```text
rect:
w > 0
h > 0

ellipse:
rx > 0
ry > 0

polygon:
>= 3 points
```

Все числа finite.

На этой фазе не проверять self-intersection polygon.

---

# 21. Object validation

Проверить:

```text
position finite
rotation finite
scale.x finite != 0
scale.y finite != 0
visual ref valid
properties JSON-safe
```

Free object разрешено находиться вне `world.bounds`.

Это НЕ validation error.

---

# 22. Scatter validation

Проверить:

```text
stable ID
shape valid
profileRef valid
seed integer
density >= 0
overrides JSON-safe
```

Generated instances отсутствуют в document.

---

# 23. Legacy migration API

Реализовать функцию примерно:

```ts
migrateLegacyMap({
  map,
  cells
}): LegacyMigrationResult
```

Где вход содержит всё необходимое из существующей карты:

```text
grid type
width
height
cellLore / metadata при необходимости
MapCells
```

Точная сигнатура должна быть минимальной.

Не передавать весь React `MapFull`, если нужны 5 полей.

---

# 24. Legacy migration result

Миграция должна возвращать не только документ, но и diagnostics.

Например:

```ts
interface LegacyMigrationResult {
  document: MapDocumentV5;
  warnings: LegacyMigrationWarning[];
}
```

Warnings нужны как минимум для повреждённых/нестандартных door-pair token groups:

```text
1 door with pair token
>2 doors with pair token
```

Обычная карта должна мигрировать без warnings.

---

# 25. Legacy terrain migration

Старое:

```text
terrain: Map<"x,y", terrainCode>
```

→

```text
TerrainCellLayer
```

Правила:

```text
defaultMaterial = builtin terrain/plain

plain entries
→ не сохраняются

остальные
→ TerrainCellEntry
```

Сортировка:

```text
y
x
```

Старый `wall` terrain мигрирует как terrain material wall.

Не превращать его на этой фазе в spline wall.

---

# 26. Legacy roads/rivers

Старые:

```text
roads: Set<"x,y">
rivers: Set<"x,y">
```

мигрируют lossless в:

```text
PathGeometry {
  type: "cell-network"
}
```

Один `MapPath` на legacy road set.

Один `MapPath` на legacy river set.

Если set пустой — path либо отсутствует согласно ADR, либо пустой layer без path.

Свериться с принятой спецификацией и соблюдать её точно.

Не вычислять connected components.

Не строить spline.

Не строить intersections.

---

# 27. Legacy grid

Square:

```text
origin = 0,0
cellSize = 1
columns = width
rows = height
world bounds = [0,width] × [0,height]
```

Hex:

использовать существующую:

```text
pointy
odd-q
```

геометрию.

World bounds вычислять через существующую `grid.ts`, согласно ADR.

Не писать вторую реализацию hex bounds.

---

# 28. Legacy labels

Legacy:

```text
{x,y,text}
```

→

```text
MapLabel
```

position = существующий `cellCenter`.

Не хардкодить square-only:

```text
x + 0.5
y + 0.5
```

если функция должна поддерживать hex.

Использовать `cellCenter(grid, x, y)`.

---

# 29. Legacy rooms

Legacy room:

```text
x
y
w
h
type
name
```

→ GameplayRoom.

Для square legacy:

```text
ShapeGeometry rect
```

с сохранением исходной геометрии.

Room ID:

```text
legacy-room-N
```

Порядок N = исходный валидированный array order.

---

# 30. Legacy doors

Legacy door мигрирует в world coordinate.

Для square:

```text
n → midpoint north edge
e → midpoint east edge
s → midpoint south edge
w → midpoint west edge
```

Orientation:

```text
n 0
e 90
s 180
w 270
```

Сохранить:

```text
doorKind
secret
```

без смысловой нормализации.

---

# 31. Legacy door pairs

Реализовать принятый алгоритм группировки:

```text
pair token
→ array of door IDs
```

Далее:

```text
0 → ничего
1 → pairedDoorId null + warning
2 → взаимная пара
>2 → последовательные пары по legacy index order
     остаток при нечётном количестве → null
     warning
```

Пример:

```text
token X:
doors [0,4,7,9,13]

→
0 ↔ 4
7 ↔ 9
13 → null
```

Результат должен удовлетворять симметричному invariant.

---

# 32. Legacy traps / markers / start / finish

Позиции через существующий `cellCenter`.

Stable IDs:

```text
legacy-trap-N
legacy-marker-N
legacy-start
legacy-finish
```

Kinds сохраняются без переименований.

Не превращать gameplay markers в ObjectLayer.

---

# 33. Deterministic legacy layers

Создать exact layer skeleton, установленный ADR.

ID каждого слоя должен быть фиксирован.

Например концептуально:

```text
legacy-layer-terrain
legacy-layer-river
legacy-layer-road
legacy-layer-objects
legacy-layer-scatter
legacy-layer-gameplay
legacy-layer-labels
```

Использовать ТОЧНЫЕ значения из ADR.

Не придумывать их во время реализации, если ADR уже определил.

Для каждого слоя фиксированы:

```text
name
visible
locked
opacity
kind
```

---

# 34. Player projection

Реализовать:

```ts
projectMapDocumentForPlayer(doc)
```

Функция должна создавать безопасную копию / новый canonical document.

Исходный GM-document не мутировать.

Правила согласно ADR и текущему server-authoritative поведению:

```text
secret door
→ удалить

trapped door
→ обычная door

trap
→ удалить

room
→ roomType empty
```

Имя комнаты — согласно исправленному ADR/current server behavior.

Не следовать старому локальному `previewAsPlayer`, если он расходится с server projection.

Источник истины — ADR + server semantics.

---

# 35. Player projection и door pairs

Если secret door удаляется из Player document, а обычная paired door ссылалась на неё:

projection не должна оставлять dangling:

```text
pairedDoorId → отсутствующая entity
```

Нужно определить безопасную projection normalization:

```text
pairedDoorId = null
```

для оставшейся двери.

Проверить аналогичные relation invariants после projection.

---

# 36. Projection validation

Добавить property-style test:

```text
valid GM document
→ projectForPlayer
→ valid Player document
```

Минимум для набора gameplay entities.

Это важный invariant.

---

# 37. soyman-map/2

Реализовать новый exchange module отдельно от существующего `mapExchange.ts`.

Например:

```text
maps/core/exchangeV2.ts
```

Реализовать:

```ts
buildSoyMapV2(...)
parseSoyMapV2(...)
```

Не менять существующий `soyman-map/1`.

---

# 38. Envelope V2

Следовать ADR.

Canonical source grid —:

```text
document.grid
```

Не возвращать удалённый `gridKind` как второй источник истины.

Metadata вроде:

```text
name
scale
cellLore
```

хранить точно в принятом envelope.

---

# 39. V1 import

В рамках Фазы 2B разрешается добавить **чистую функцию**:

```text
soyman-map/1
→ existing validated legacy representation
→ MapDocumentV5
```

Но не менять текущий UI import flow редактора.

То есть новый импортный pipeline можно протестировать отдельно, но старая кнопка импорта пока работает как раньше.

---

# 40. MapRecord / metadata

Не менять SQL.

Можно создать TypeScript-типы будущего `MapRecordV5`, но не переключать сервер.

`cellLore` согласно ADR остаётся metadata.

Не дублировать его в `MapDocument`.

---

# 41. Runtime indexes

На этой фазе НЕ реализовывать:

```text
Map<EntityId,...>
spatial index
R-tree
quadtree
entity cache
```

Пока canonical JSON model достаточно.

Если validator строит временный `Map` для проверки IDs — это локальная implementation detail, не runtime model.

---

# 42. Deep cloning

Не добавлять собственный `cloneMapDocument` без необходимости.

Если тестам/проекции нужен clone, предпочтительно строить новый документ структурно.

Не использовать JSON stringify/parse как скрытый production cloning primitive без объяснения.

---

# 43. Error model

Ошибки Core должны быть структурированными.

Например:

```ts
interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}
```

Не обязательно именно так.

Но validator не должен возвращать только:

```text
"invalid map"
```

Нам нужны сообщения уровня:

```text
layers[4].items[2].pairedDoorId:
target does not exist
```

Это пригодится import UI позже.

---

# 44. Parser resilience

Parser V5 должен быть строгим к canonical format.

Не делать поведение:

```text
битая entity
→ тихо выкинуть
```

как legacy parser.

Для V5 corrupt canonical document должен возвращать validation errors.

Legacy forgiving behavior остаётся частью legacy parsing до migration.

Это важное разделение:

```text
Legacy:
best effort parsing

V5:
strict canonical validation
```

---

# 45. Forward compatibility

На Фазе 2B не проектировать generic unknown-field preservation.

`v:5` validator может игнорировать неизвестные поля либо запрещать их — выбрать один режим и зафиксировать.

Предпочтительно:

* canonical known structures валидируются строго;
* harmless unknown object keys допускаются только если это осознанно нужно.

Не превращать всё в `additionalProperties:any`.

Сообщить выбранную политику в отчёте.

---

# 46. Тестовый fixture legacy

Создать набор fixtures.

Минимум:

```text
empty v1 square
terrain v1
labels v2
dungeon v3
full v4 square
full v4 hex
door pairs
broken pair group 1
broken pair group >2
max/cap-like map
```

Не обязательно хранить все fixture как отдельные JSON-файлы, если TS builders удобнее.

Главное — читаемость тестов.

---

# 47. Golden migration tests

Для нескольких legacy fixtures сделать exact snapshot/golden tests:

```text
legacy input
→ migrate
→ serialize
→ EXACT expected JSON
```

Особенно:

```text
v4 square
v4 hex
door pair
roads/rivers
```

Это закрепляет deterministic migration.

---

# 48. Roundtrip V5

Добавить тест:

```text
valid V5
→ serialize
→ parse
→ serialize

строка A === строка B
```

Минимум:

* cell terrain;
* paths;
* object;
* scatter;
* label;
* gameplay.

---

# 49. Canonicalization tests

Проверить:

* terrain cells в разном input order → одинаковый serialized result;
* cell-network cells в разном order → одинаковый serialized result;
* layers НЕ сортируются;
* object items НЕ сортируются;
* gameplay items НЕ сортируются;
* stable IDs сохраняются.

---

# 50. Validation negative tests

Минимум проверить ошибки:

```text
duplicate layer ID
duplicate entity ID
NaN / Infinity
bad world bounds
bad grid
cell terrain without grid
cell outside grid
duplicate terrain coordinate
cell-network without grid
duplicate path cell
path width <= 0
zero object scale
invalid shape
broken pairedDoorId
asymmetric door pair
self pair
bad resource ref
invalid JSON property
mask sampleSize <= 0
duplicate mask chunk ID
```

---

# 51. Legacy equivalence tests

Миграция должна сохранять legacy semantics.

На этой фазе не нужен pixel-perfect новый renderer.

Но тестами сравнить данные:

```text
terrain codes
road cells
river cells
labels
rooms
doors
traps
markers
start
finish
```

до и после migration.

Для positions использовать ожидаемую grid math.

---

# 52. Hex tests

Особенно важно отдельно проверить:

```text
hex cellCenter
hex world bounds
hex label positions
hex marker positions
hex trap positions
```

Не писать expected values через копию формулы.

Где возможно использовать существующий `grid.ts` как production source и отдельные конкретные regression fixtures.

---

# 53. Player projection tests

Минимум:

```text
secret flag
secret kind
trapped door
trap
room type
room name
ordinary door
marker
label
start/finish
paired door after counterpart removal
```

После projection:

```text
validate(projected) === valid
```

---

# 54. Exchange V2 tests

Проверить:

```text
build V2
parse V2
invalid format
invalid document
invalid metadata
roundtrip
```

V1 parser не менять.

---

# 55. Performance sanity

Фаза не про оптимизацию, но migration/validation не должны быть очевидно квадратичными там, где этого легко избежать.

Особенно:

```text
ID uniqueness
door pair lookup
paired validation
```

делать через `Set/Map`, а не вложенные полные обходы.

Не делать benchmark infrastructure без необходимости.

---

# 56. Public Core API

В конце должен быть единый entry point:

```text
client/src/maps/core/index.ts
```

Он экспортирует только публично нужные части.

Например:

```text
types
parseMapDocument
serializeMapDocument
validateMapDocument
migrateLegacyMap
projectMapDocumentForPlayer
buildSoyMapV2
parseSoyMapV2
```

Не экспортировать случайные внутренние helpers без необходимости.

---

# 57. Запрет на premature adapters

Пока не делать:

```text
MapDocument → MapCells
```

только ради того, чтобы старый renderer мог его показать.

Это будет отдельным решением следующей фазы.

Не создавать двустороннюю синхронизацию:

```text
MapCells ↔ MapDocument
```

Она почти гарантированно станет источником ошибок.

В Фазе 2B направление только:

```text
Legacy → V5
```

---

# 58. Не мигрировать database

Никаких:

```text
ALTER TABLE
UPDATE maps
background migration
on-load save V5
```

Существующие записи должны остаться untouched.

Даже если migration уже работает.

---

# 59. Не менять autosave

Новый serializer НЕ подключать к текущему `useMapAutosave`.

Фаза 2B может тестировать:

```text
serializeMapDocument
```

изолированно.

Но рабочий редактор сохраняет legacy blob как раньше.

---

# 60. Не менять import UI

Новая поддержка `soyman-map/2` пока существует как Core API.

Не добавлять кнопки/детекты/диалоги в `MapEditorPage`.

UI integration — позже.

---

# 61. Production code, который разрешено менять

Разрешено:

```text
создать client/src/maps/core/*
```

Допустимо минимально изменить:

```text
существующие shared types/constants
```

ТОЛЬКО если без этого возникает дублирование канонических literal types.

Например если V5 должен использовать те же:

```text
MapDoorKind
MapTrapKind
MapRoomType
```

можно вынести literals в нейтральный shared type module.

Но:

* поведение legacy renderer не менять;
* serialization legacy не менять;
* старые imports должны продолжить работать;
* diff должен быть минимальным.

Если это требует каскадного refactor — не делать, временно импортировать тип из существующего module.

---

# 62. Тестовая граница

Core tests должны запускаться без React component rendering.

Большинство — чистый Vitest.

Это принципиально:

```text
Map Core
```

должен быть библиотекой данных, а не частью UI.

---

# 63. Stop conditions

Остановиться до продолжения, если обнаружится хотя бы одно:

1. ADR нельзя реализовать без изменения `MapCells`.

2. Legacy migration требует угадывать отсутствующие данные.

3. Текущая hex-геометрия противоречит ADR.

4. Текущий door pair format имеет другую semantics, чем зафиксировано.

5. Server player projection невозможно выразить через V5 без изменения модели.

6. Deterministic serialization требует изменить render-semantic array order.

7. `cellLore` или другой metadata field не имеет однозначного владельца.

8. Нужно менять database schema.

9. Нужно подключать V5 к editor для тестирования Core.

10. Нужен фундаментальный пересмотр ADR.

В таком случае не расширять scope самостоятельно.

---

# 64. Рекомендуемый порядок реализации

Работу делать маленькими шагами:

```text
1. Types + JSON/resource refs
2. Validator
3. Canonicalization + serializer/parser
4. Legacy deterministic IDs/layers
5. Terrain/grid migration
6. Paths migration
7. Labels/gameplay migration
8. Door pair migration
9. Full migrateLegacyMap
10. Player projection
11. soyman-map/2
12. Golden/negative/roundtrip tests
13. Public index cleanup
```

После каждого крупного шага тесты должны оставаться зелёными.

Не делать всё одним огромным diff без промежуточной проверки.

---

# 65. Критерии готовности Фазы 2B

Фаза считается завершённой только если:

```text
PASS — реальные TypeScript-типы V5 существуют
PASS — production editor по-прежнему использует MapCells
PASS — database не менялась
PASS — legacy serialization не менялась
PASS — V5 validator реализован
PASS — V5 parser реализован
PASS — deterministic serializer реализован
PASS — canonicalization реализована
PASS — MapCells → V5 migration реализована
PASS — migration deterministic
PASS — square legacy покрыт
PASS — hex legacy покрыт
PASS — roads/rivers lossless
PASS — door pairs корректны
PASS — stable IDs
PASS — player projection реализована
PASS — projected doc проходит validator
PASS — soyman-map/2 build/parse реализован
PASS — V5 roundtrip работает
PASS — negative validation tests существуют
PASS — старые editor tests остаются зелёными
PASS — существующий UX не изменён
```

---

# 66. Что должно остаться неизменным после фазы

Пользователь, открыв приложение после Фазы 2B, не должен заметить вообще ничего нового.

Редактор:

```text
выглядит так же
рисует так же
сохраняет так же
загружает так же
импортирует soyman-map/1 так же
```

Новый Core существует пока как протестированный внутренний фундамент.

Это ожидаемый результат.

---

# 67. Отчёт после выполнения

После реализации не переходить к интеграции.

Дать отчёт:

## 1. Файлы

Какие production/test файлы созданы и какие старые изменены.

## 2. Core API

Что экспортирует:

```text
maps/core/index.ts
```

## 3. Type model

Есть ли отклонения от ADR.

Если есть — почему.

## 4. Validator

Какие invariants реально проверяются.

## 5. Canonical serialization

Как обеспечивается determinism.

## 6. Migration

Краткая схема:

```text
MapCells
→ MapDocumentV5
```

## 7. IDs

Точные legacy layer/entity/path ID conventions.

## 8. Layer order

Точный migrated order.

## 9. Terrain

Как migrated legacy terrain.

## 10. Roads/rivers

Как реализован cell-network.

## 11. Door pairs

Алгоритм и diagnostics.

## 12. Hex

Какая существующая grid math переиспользована.

## 13. Player projection

Какие transformations выполняются.

## 14. soyman-map/2

API build/parse.

## 15. Tests

Количество новых Core tests и основные группы.

## 16. Golden fixtures

Какие exact deterministic migration cases закреплены.

## 17. Existing regression

Результаты:

```text
vite build
client tests
server map tests
lint
```

## 18. Production behavior

Подтверждение, что editor/backend/database не переключены на V5.

## 19. Open issues

Только реальные проблемы, обнаруженные реализацией.

## 20. Следующий шаг

Не реализовывать его.

Только оценить, готов ли Core к следующей фазе интеграции.

---

# 68. Ожидаемая архитектура после Фазы 2B

```text
                   EXISTING APP

                 MapEditorPage
                       │
                    MapCells
                       │
        ┌──────────────┴──────────────┐
        │                             │
   legacy render                 legacy autosave
        │                             │
     unchanged                     unchanged


                    NEW CORE

                    MapCells
                       │
                       ▼
              migrateLegacyMap
                       │
                       ▼
                MapDocumentV5
                │      │       │
                │      │       │
                ▼      ▼       ▼
            validate serialize project
                │      │       │
                └──────┼───────┘
                       │
                       ▼
                  soyman-map/2
```

Эти две ветки пока существуют параллельно.

Связывать их в рабочем редакторе на этой фазе запрещено.

---

# 69. Главный принцип Фазы 2B

Фаза 2B должна доказать три вещи:

### 1. Новый формат самодостаточен

Его можно:

```text
создать
валидировать
сериализовать
распарсить
```

без React, Canvas и старого editor state.

### 2. Старые карты не теряются

Любой валидный legacy `MapCells` можно детерминированно представить как `MapDocumentV5` без выдумывания информации.

### 3. Мы ещё можем отступить

Если после этой фазы выяснится проблема в V5, старый редактор всё ещё полностью рабочий, потому что на новый Core ещё ничего пользовательского не переключено.

Именно после выполнения этих трёх условий можно начинать следующую фазу — интеграцию `MapDocumentV5` в editor state.
