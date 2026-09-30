# Фаза 2E — V5 Mutation Core + Stable-ID Selection Primitives

## Цель

Реализовать **write-side нового Map Core** как набор чистых операций над `MapDocumentV5`.

После фазы новый Core должен уметь не только:

```text
read
validate
serialize
render
```

но и:

```text
mutate V5
select/hit-test V5 entities by stable ID
```

При этом production editor всё ещё работает на `MapCells`.

Никакой интеграции V5 в `MapEditorPage` на этой фазе.

---

# Архитектура после 2E

```text
                       LEGACY EDITOR

                        MapCells
                       /   |    \
                    Tools  |   Selection
                           |
                     RenderModel
                           |
                        Renderer


                         V5 CORE

                    MapDocumentV5
                      /         \
                     /           \
          Mutation Operations   Selection Primitives
                  |                    |
                  |                    |
                  +------ stable ------+
                         EntityId
                           |
                           v
                     V5 RenderModel
```

После 2E V5 должен иметь независимые:

```text
READ
WRITE
IDENTITY
```

До production switch.

---

# Production scope

Предпочтительно создавать только новые файлы внутри:

```text
client/src/maps/core/
```

Например:

```text
mutations/
  terrain.ts
  paths.ts
  gameplay.ts
  labels.ts
  geometry.ts
  types.ts

selection/
  hitTest.ts
  move.ts
  types.ts
```

Структуру можно упростить, если модули получаются слишком маленькими.

Разрешено обновить:

```text
maps/core/index.ts
```

для публичных экспортов.

Старый editor менять не требуется.

---

# Главный принцип

Операции работают непосредственно с:

```ts
MapDocumentV5
```

и `EntityId`.

Не вводить:

```text
MapCells
legacy array index
V5 → MapCells
```

как промежуточную модель.

---

# MapCells не использовать

Ни один V5 mutation helper не должен принимать:

```ts
MapCells
```

Ни один V5 selection helper не должен возвращать:

```text
{type:"door", index:17}
```

Новая identity:

```text
EntityId
```

---

# Mutation result

Все операции должны явно сообщать, произошло ли изменение.

Рекомендуемый общий контракт:

```ts
interface MapMutationResult {
  document: MapDocumentV5;
  changed: boolean;
}
```

Для операций создания допустимо:

```ts
interface EntityMutationResult extends MapMutationResult {
  entityId?: EntityId;
}
```

Конкретные названия могут отличаться.

---

# No-op semantics

Если операция ничего не меняет:

```text
changed = false
```

и желательно:

```text
result.document === inputDocument
```

Это важно для будущего History boundary.

Например:

```text
set forest на уже forest
delete отсутствующий ID
move на ту же позицию
remove road cell, которой нет
```

не должны создавать ложное изменение.

---

# Immutable contract

На Фазе 2E mutation functions не должны мутировать входной документ.

То есть:

```text
const before = doc
const result = operation(doc)

before остаётся неизменным
```

Использовать structural sharing там, где это естественно:

```text
не изменился слой
→ старый reference допустимо сохранить
```

Не требуется Immer.

---

# Не делать command history

Не реализовывать:

```text
Command
Patch
InversePatch
Transaction
```

History пока snapshot-based.

Mutation Core лишь должен быть пригоден для будущего вызова:

```text
before
→ operation
→ after
```

---

# Batch-first для terrain

Не проектировать high-frequency painting как:

```text
setTerrainCell(doc, x, y)
setTerrainCell(doc, x+1, y)
setTerrainCell(...)
```

с полной пересборкой документа на каждую клетку.

Основная операция должна поддерживать batch.

Например:

```ts
applyTerrainCellEdits(
  doc,
  layerId,
  edits
)
```

где edit концептуально:

```ts
{
  x: number;
  y: number;
  material: MaterialRef;
}
```

или удаление override с возвратом к default.

---

# Terrain semantics

Работать только с:

```text
TerrainCellLayer
```

Mask Terrain пока read/validation-only.

Mutation helper должен:

```text
проверять layer kind
проверять representation = cells
проверять grid exists
проверять cell bounds
не создавать duplicate coordinates
сохранять canonical сортировку (y,x)
```

---

# Default material

Если пользователь красит клетку материалом:

```text
material === defaultMaterial
```

canonical result должен удалять explicit cell override.

То есть:

```text
default plain
+
set cell to plain
→ entry отсутствует
```

---

# Terrain operation API

Минимально нужны чистые операции уровня:

```text
read terrain material at cell
apply batch edits
```

Flood fill пока можно реализовать отдельно как pure algorithm поверх V5 cell terrain либо оставить будущему Tool integration.

Предпочтительно реализовать pure flood helper сейчас, если его можно сделать без Input/React.

---

# Flood fill

Если реализуется, сохранить существующую semantics:

```text
starting material
→ contiguous grid region
→ replacement material
```

Использовать существующую grid neighborhood semantics.

Square/hex должны вести себя так же, как текущий editor.

Не копировать hex adjacency формулы при наличии shared grid helper.

---

# Cell-network Path mutations

Нужно уметь изменять существующие:

```text
road
river
```

`cell-network` paths.

Минимальный API:

```text
add cells
remove cells
replace cell set
```

batch operation предпочтительна.

---

# Path identity

Операция должна принимать:

```text
pathId
```

а не только:

```text
kind:"road"
```

потому что V5 допускает несколько paths одного kind.

Это важно.

Не зашивать архитектурный invariant:

```text
в документе всегда ровно одна дорога
```

Legacy migration создаёт одну, но V5 этого не требует.

---

# Empty cell-network

Согласно принятому implementation invariant:

```text
empty cell-network invalid
```

Поэтому если удалена последняя cell:

операция должна либо:

```text
удалить MapPath целиком
```

либо возвращать explicit result согласно выбранному Core API.

Предпочтительно удалить path.

Не оставлять невалидный V5.

---

# Создание Path

Для будущего инструмента требуется pure helper создания `cell-network`.

Caller должен передавать:

```text
id
kind
styleRef
width
cells
```

Core не генерирует random ID внутри mutation.

---

# ID generation

Mutation Core не должен скрыто вызывать:

```text
crypto.randomUUID()
```

Для чистоты и детерминированных тестов новый ID приходит извне.

Например:

```ts
createGameplayEntity(doc, layerId, entity)
```

где `entity.id` уже назначен caller'ом.

Позже editor-level helper сможет делать UUID.

---

# Gameplay CRUD

Реализовать операции:

```text
create gameplay entity
update gameplay entity by EntityId
delete gameplay entity by EntityId
move gameplay entity by EntityId
```

Типы:

```text
Room
Door
Trap
Marker
Start
Finish
```

---

# Identity lookup

Не искать сущность по:

```text
array index
```

Public mutation API работает через:

```text
EntityId
```

Внутренний линейный поиск на этой фазе допустим.

Spatial/entity indexes пока не нужны.

---

# Global ID collision

Create operation не должна позволять создать entity ID, уже существующий **где угодно в документе**.

Не только в GameplayLayer.

То есть collision с:

```text
MapObject
Label
Path
ScatterArea
TerrainMaskChunk
```

тоже должен быть отвергнут.

Использовать существующий invariant global EntityId uniqueness.

---

# Ошибки mutation API

Не делать silent no-op для структурно ошибочного запроса:

```text
layer ID существует, но это не gameplay layer
pathId указывает не туда
cell вне grid
duplicate entity ID
```

Предпочтительный result:

```ts
type MutationResult =
  | { ok: true; changed: boolean; document: MapDocumentV5 }
  | { ok: false; issues: MutationIssue[] };
```

Конкретный тип выбрать единообразно.

Отличать:

```text
валидный no-op
```

от:

```text
невалидная mutation request
```

---

# Gameplay update

Не делать generic:

```ts
Record<string, unknown>
```

update API.

Ключевые typed поля должны оставаться typed.

Допустима функция:

```ts
updateGameplayEntity(
  doc,
  id,
  updater
)
```

если после updater результат проходит локальные invariants.

Но не превращать сущности в god objects.

---

# Move semantics

Для point entities:

```text
Door
Trap
Marker
Start
Finish
```

move меняет:

```text
position
```

на world coordinates.

---

# Room move

Для `Room` move должен транслировать ShapeGeometry.

Поддержать корректно:

```text
rect
polygon
ellipse
```

Это простой общий geometry helper и не требует специального legacy режима.

---

# Geometry helpers

Создать pure:

```text
translateShape(...)
```

для:

```text
rect
polygon
ellipse
```

Допустимо предусмотреть:

```text
shapeBounds(...)
```

только если реально нужен hit-test.

Не создавать общий geometry framework сверх задачи.

---

# Door relations

Удаление двери должно сохранить валидность документа.

Если:

```text
A ↔ B
```

и удаляется A:

```text
B.pairedDoorId
→ null
```

автоматически.

Нельзя оставлять dangling relation.

---

# Door pairing operation

Реализовать чистую operation:

```text
pairDoors(A,B)
```

которая:

* запрещает self-pair;
* проверяет оба ID;
* проверяет оба типа;
* разрывает предыдущие пары обеих дверей;
* симметрично связывает новые.

И:

```text
unpairDoor(id)
```

---

# Singletons Start / Finish

GameplayLayer по смыслу текущего editor имеет максимум:

```text
1 Start
1 Finish
```

Если этот invariant нужен V5 editor — зафиксировать его mutation-level.

Важно:

если ADR validator сейчас допускает несколько Start/Finish, не вводить молча новый document invariant.

На этой фазе можно сделать editor operation:

```text
setStart
setFinish
```

которая заменяет существующую соответствующую entity.

Не менять validator без отдельного решения.

---

# Labels CRUD

Реализовать:

```text
create label
update text
move label
delete label
```

по stable `EntityId`.

Label position — world coordinate.

Не возвращаться к cell x/y.

---

# ObjectLayer

На Фазе 2E **не нужно реализовывать полноценное Object editing**, если текущий editor его ещё не имеет как V5 feature.

Но общий EntityId collision scanner должен учитывать `MapObject`.

Не добавлять feature creep.

---

# Scatter / Mask / Spline

Пока не мутировать:

```text
TerrainMask
SplinePath
ScatterArea
```

если это не требуется для сохранения document validity при других операциях.

Эти feature families будут отдельными фазами.

---

# Selection identity

Создать V5 selection type.

Концептуально:

```ts
interface V5Selection {
  entityId: EntityId;
}
```

Если для быстрого routing полезно:

```ts
{
  entityId: EntityId;
  kind: "door" | "trap" | ...
}
```

допустимо.

Но `entityId` — источник identity.

Не хранить array index.

---

# Selection scope

На Фазе 2E воспроизвести текущий selectable gameplay subset:

```text
door
trap
marker
start
finish
room
```

Labels пока не обязаны быть частью Selection, если старый editor их редактирует отдельным label flow.

Objects будут добавлены вместе с Object tooling.

---

# V5 hit-test

Создать pure helper:

```text
hitTestGameplay(...)
```

который принимает:

```text
MapDocumentV5
grid/world input
point
```

и возвращает:

```text
EntityId / selection
```

---

# Selection priority

Сохранить существующую semantics:

```text
door
→ trap
→ marker
→ start/finish
→ room
```

При overlap результат должен совпадать со старым editor.

---

# World coordinates

Hit-test V5 должен работать с world coordinates.

Не преобразовывать entity обратно в legacy cell coordinates без необходимости.

Grid может использоваться для:

```text
tolerance
cell-sized gameplay symbols
```

но identity и geometry остаются world-based.

---

# Door hit-test

V5 door:

```text
position
orientation
```

Hit-test должен работать непосредственно с этими данными.

Не реконструировать:

```text
x/y/edge
```

если это можно избежать.

---

# Room hit-test

Поддержать ShapeGeometry:

```text
rect
polygon
ellipse
```

Если текущая Selection требует только rect, всё равно разумно реализовать корректный point-in-shape helper сейчас — geometry V5 уже это позволяет.

Не реализовывать сложные polygon-with-holes.

---

# Selection move

Создать V5 pure operation:

```text
moveSelectedEntity(doc, entityId, target)
```

или использовать общий gameplay move helper.

Selection module не должен самостоятельно мутировать document.

Предпочтительно:

```text
Selection определяет ID
Mutation Core выполняет move
```

---

# Delete selection

То же:

```text
Selection → EntityId
Mutation Core → delete
```

Не дублировать delete logic внутри selection.

---

# Stable IDs test

Критический тест:

```text
entities:
A, B, C

selected = C.id

delete B

selected ID остаётся C.id
```

Это и есть преимущество V5 перед legacy index-selection.

---

# Reorder stability

Если items reorder:

```text
selection.entityId
```

по-прежнему указывает на ту же entity.

Обязательно тестом.

---

# Mutation validity property

Для каждой успешной mutation:

```text
valid V5 input
→ successful mutation
→ validateMapDocument(output) = valid
```

Это ключевой invariant 2E.

Добавить helper/assertion в tests.

---

# Failed mutation immutability

Если operation возвращает ошибку:

```text
input document
```

не мутирован.

Если no-op:

также не мутирован.

---

# Tests Terrain

Минимально:

```text
paint one cell
batch paint
replace material
paint default removes override
no-op same material
out-of-bounds rejected
square
hex
canonical ordering
duplicate edit coordinates deterministic
flood square
flood hex
```

Если flood вынесен в следующую фазу — явно указать.

---

# Tests Paths

Проверить:

```text
add road cell
remove road cell
batch add/remove
duplicate add = no-op
remove absent = no-op
remove final cell → path removed
multiple road paths не смешиваются
wrong path ID
wrong geometry spline rejected
cell OOB rejected
hex valid
```

---

# Tests Gameplay

Проверить CRUD всех существующих types.

Особенно:

```text
ID collision
move
delete
door pair cleanup
pair
re-pair
unpair
self-pair rejected
room rect move
room polygon move
room ellipse move
```

---

# Tests Labels

Проверить:

```text
create
move
rename
delete
stable ID
duplicate ID rejection
```

---

# Tests Selection

Проверить:

```text
priority
room containment
door hit
trap
marker
start
finish

overlap priority

stable ID after sibling delete
stable ID after reorder
```

Square и hex.

---

# V5 RenderModel compatibility

После mutation результат должен по-прежнему успешно проходить:

```text
createV5RenderModel(...)
```

для legacy-compatible feature subset.

Добавить несколько integration tests:

```text
V5 fixture
→ mutation
→ render model
→ expected changed render semantics
```

Не нужны pixel tests для каждой mutation.

---

# History пока не подключать

Не импортировать:

```text
useMapHistory
```

в Core.

Но `changed` semantics должны позволить будущей интеграции делать:

```text
if changed:
    push(before)
```

без гаданий.

---

# Tools пока не подключать

Не менять:

```text
useMapTools
paintTools
wallTools
shapeTools
objectTools
```

Пока они остаются legacy.

2E строит то, во что они затем будут переведены.

---

# Selection hook пока не менять

Не менять:

```text
useMapSelection
```

Он пока работает с legacy indices.

Это намеренно.

Не пытаться подложить V5 selection под MapCells.

---

# Почему current Selection не переводим сейчас

Legacy IDs:

```text
legacy-door-0
legacy-door-1
```

детерминированы при миграции snapshot.

Но если legacy editor удалит `door-0`, бывшая:

```text
door-1
```

станет array index 0 при следующей миграции.

Следовательно это не stable runtime identity.

Поэтому stable-ID Selection вводится только внутри V5 Core до switch.

---

# Public API

После фазы `maps/core/index.ts` должен экспортировать минимально нужные V5 operations.

Не экспортировать все internal helpers.

Концептуально:

```text
terrain mutations
path mutations
gameplay mutations
label mutations
V5 hit testing / selection types
```

---

# Naming

Не использовать названия:

```text
LegacySelectionV2
NewMapStuff
TempMutation
```

Это уже постоянный V5 Core.

Названия должны описывать domain.

---

# Performance

Не оптимизировать spatial lookup заранее.

Для текущих размеров допустим линейный поиск gameplay entity по ID.

Но terrain batch edit не должен иметь явно квадратичный алгоритм:

```text
N edits × M cells
```

если легко построить `Map<cellKey,...>` один раз.

---

# Canonical ordering

Mutation result обязан сохранять canonical requirements:

```text
TerrainCellEntry
→ sorted y,x

cell-network cells
→ sorted y,x
```

Render-semantic:

```text
layers[]
items[]
paths[]
```

не сортировать.

---

# Unknown properties

Не терять:

```text
properties
```

на entity/path при move/update, если operation их не меняет.

Mutation должна менять минимально требуемые поля.

---

# Unsupported valid V5

Если mutation helper получил feature, который пока не поддерживает:

```text
TerrainMask
SplinePath
```

возвращать structured unsupported mutation issue.

Не corrupt document.

Не конвертировать feature в legacy-compatible representation.

---

# Stop conditions

Остановиться, если обнаружится, что:

```text
текущий tool behavior невозможно выразить V5 без изменения ADR
stable-ID semantics требуют index
door relations требуют новой модели
cell-network mutation требует правила, которого нет в ADR
room hit-testing невозможно определить из ShapeGeometry
успешная mutation регулярно создаёт invalid V5
нужно подключить MapCells к V5 write-side для тестирования
нужно менять React editor
```

При фундаментальном конфликте не расширять scope.

---

# Критерии завершения 2E

Должно быть выполнено:

```text
PASS — V5 terrain cells можно мутировать
PASS — batch terrain edits существуют
PASS — V5 cell-network paths можно мутировать
PASS — path identity основана на pathId
PASS — gameplay CRUD работает по EntityId
PASS — labels CRUD работает по EntityId
PASS — room geometry перемещается в world space
PASS — door pairing invariants сохраняются
PASS — global EntityId collision запрещён
PASS — V5 hit-test существует
PASS — selection возвращает stable EntityId
PASS — selection priority совпадает с legacy
PASS — sibling deletion не ломает selection identity
PASS — reorder не ломает selection identity
PASS — successful mutations дают valid V5
PASS — no-op отличается от error
PASS — input documents не мутируются
PASS — canonical ordering сохраняется
PASS — V5 RenderModel читает mutated legacy-compatible document
PASS — MapCells/editor production не изменены
PASS — dual state отсутствует
```

---

# Архитектура после 2E

```text
                       V5

              ┌── MapDocumentV5 ──┐
              │                   │
              ▼                   ▼
        Mutation Core         Selection
              │                EntityId
              │                   │
              └─────────┬─────────┘
                        ▼
                MapDocumentV5
                        │
                        ▼
                V5 RenderModel
                        │
                        ▼
                    Renderer
```

Но production всё ещё:

```text
MapCells
→ legacy Tools
→ legacy Selection
→ LegacyRenderModel
→ Renderer
```

---

# Отчёт после выполнения

После 2E остановиться.

Отчитаться:

### Файлы

Что создано/изменено.

### Mutation API

Публичные операции и result/error model.

### Immutability

Как обеспечивается отсутствие мутации input.

### Terrain

Batch/no-op/default/canonical semantics.

### Paths

Как работает pathId и удаление пустого path.

### Gameplay

CRUD/move.

### Door pairs

Pair/re-pair/delete semantics.

### Labels

CRUD.

### Stable-ID Selection

Selection model и hit priority.

### Shapes

Rect/polygon/ellipse hit/move.

### Validation

Как проверяется:

```text
valid → mutation → valid
```

### Canonical ordering

Terrain/path cell ordering.

### Tests

Количество и категории.

### Regression

Core/maps/client/server/build/lint.

### Performance

Terrain batch и entity lookup sanity.

### Production

Подтвердить, что старый editor не изменён.

### Stop conditions

Сработали или нет.

### Следующий этап

Только оценка готовности к переключению canonical editor state.

Не выполнять switch автоматически.
