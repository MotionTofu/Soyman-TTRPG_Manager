# Фаза 3A — First-Class Layers

## 1. Цель

Превратить `MapDocumentV5.layers[]` из структуры хранения в **реальный композиционный стек редактора**.

После фазы именно `document.layers[]` определяет:

* порядок рендера;
* visibility;
* locked;
* opacity;
* active editing target;
* куда пишет конкретный инструмент;
* какие сущности доступны Selection;
* порядок PNG/thumbnail/minimap.

Существующие фиксированные понятия:

```text
terrain
river
road
objects
scatter
gameplay
labels
```

перестают быть захардкоженными render slots.

Они становятся обычными слоями V5.

---

# 2. Главный результат

До 3A фактически:

```text
MapDocumentV5
      │
      ▼
createV5RenderModel
      │
      ▼
flatten:
terrain
river
road
gameplay
labels
      │
      ▼
renderMap
```

После 3A:

```text
MapDocumentV5.layers[]
        │
        ▼
ordered MapRenderLayer[]
        │
        ▼
renderMap
```

Renderer последовательно обходит слои документа.

---

# 3. Основной инвариант

```text
document.layers[] = canonical composition order
```

Первый элемент:

```text
самый нижний
```

Последний:

```text
самый верхний
```

Никакого второго:

```text
hardcoded render order
```

для document content больше не существует.

---

# 4. Что НЕ входит в 3A

Не начинать:

```text
Asset Registry
Asset Packs
Free MapObjects editing
Terrain Mask editing
Terrain Materials redesign
Spline editing
Scatter generation
Quick presets
nested layer groups
blend modes
layer masks
adjustment layers
```

Object/Scatter слои могут существовать в стеке, но их содержимое пока остаётся unsupported current-editor feature.

---

# 5. Перед началом

Зафиксировать Phase 2G отдельным commit/tag.

Проверить, что manual V5 persistence smoke пройден:

```text
legacy map
→ edit
→ autosave V5
→ reload V5
```

Если он ещё не выполнен — пройти перед 3A.

Не смешивать баг V5-switch с новой layer architecture.

---

# 6. Важная временная legacy-логика, которую теперь убираем

После migration сейчас создаётся skeleton:

```text
terrain
river
road
objects
scatter
gameplay
labels
```

Этот порядок должен продолжить визуально воспроизводить старые карты.

Но renderer больше не должен знать, что:

```text
river "должна" быть ниже road
labels "должны" быть сверху gameplay
```

Это определяется исключительно фактическим порядком migrated layers.

---

# 7. RenderModel redesign

Текущий плоский:

```ts
MapRenderModel {
  terrain
  roads
  rivers
  rooms
  doors
  traps
  markers
  start
  finish
  labels
}
```

перевести на layer-oriented model.

Концептуально:

```ts
interface MapRenderModel {
  layers: readonly MapRenderLayer[];
}
```

---

# 8. Render layer union

Ориентировочно:

```ts
type MapRenderLayer =
  | RenderTerrainLayer
  | RenderPathLayer
  | RenderGameplayLayer
  | RenderLabelLayer
  | RenderObjectLayer
  | RenderScatterLayer;
```

Общее:

```ts
interface RenderLayerBase {
  id: LayerId;
  name: string;

  visible: boolean;
  locked: boolean;
  opacity: number;
}
```

Renderer `locked` не использует для изображения, но read-model может его сохранять для editor consumers.

---

# 9. Terrain Render Layer

Для `TerrainCellLayer` read-model должен содержать:

```text
default material/code
cell lookup/index
```

как сейчас.

Каждый TerrainLayer рендерится независимо в своей позиции stack.

---

# 10. Несколько Terrain Layers

С 3A формат/editor должен позволить несколько `TerrainCellLayer`.

Это уже разрешено архитектурой V5.

Временный validator restriction 2B:

```text
ровно один TerrainLayer
```

должен быть удалён.

Не считать его фундаментальным invariant ADR — это было ограничение ранней реализации.

---

# 11. Zero Terrain Layers

Документ также должен быть валиден без TerrainLayer.

В таком случае остаётся обычный базовый canvas/background renderer.

Это пригодится будущим:

```text
object-only maps
transparent-ish compositions
free maps
```

---

# 12. Terrain compositing

Каждый TerrainCellLayer является полным terrain surface со своим:

```text
defaultMaterial
entries
opacity
```

Если верхний terrain слой непрозрачный:

```text
он естественно перекрывает нижний.
```

Это нормальная layer semantics.

Специальный transparent terrain material сейчас НЕ вводить.

---

# 13. Path Render Layer

Каждый `PathLayer` сохраняет собственный:

```text
paths[]
```

Renderer рисует path layers там, где они стоят в `document.layers[]`.

---

# 14. Path order внутри слоя

Внутри `PathLayer`:

```text
paths[] order = render order
```

Не вводить:

```text
river всегда ниже road
```

внутри renderer.

Для migrated maps эта визуальная семантика уже обеспечивается отдельными:

```text
river layer
road layer
```

в правильном порядке.

---

# 15. Gameplay Render Layer

Gameplay layer должен содержать:

```text
items[]
```

Renderer должен брать сущности именно из конкретного GameplayLayer.

---

# 16. Gameplay item order

Перейти к принятой V5 semantics:

```text
items[] = render order внутри layer
```

Migrated документы уже создаются в:

```text
rooms
doors
traps
markers
start
finish
```

поэтому legacy visual parity должна сохраниться.

Не сортировать Gameplay items по kind во время render.

---

# 17. Label Render Layer

Каждый LabelLayer рендерится в своей реальной позиции stack.

Label больше не является специальным:

```text
"всегда самым верхним"
```

типом renderer.

---

# 18. Grid — не Layer

Grid остаётся editor/render overlay.

Он НЕ является:

```text
MapLayer
```

---

# 19. Grid render position

С появлением настоящего arbitrary layer order нельзя сохранять старое правило:

```text
grid между gameplay и labels
```

потому что label может находиться где угодно.

С 3A:

```text
все document layers
→ grid/coords overlay
→ editor overlays
```

Это сознательное изменение renderer architecture.

Зафиксировать его как intentional delta.

---

# 20. Editor overlays

После document layers и grid рисуются:

```text
hover
selection emphasis
ruler
wall live preview
shape preview
rect preview
```

если соответствующий overlay логически должен быть поверх карты.

Не превращать их в document layers.

---

# 21. Layer visibility

Если:

```ts
layer.visible === false
```

renderer полностью пропускает layer.

Не:

```text
opacity = 0
```

а именно skip.

---

# 22. Layer opacity

Использовать:

```text
ctx.save()
ctx.globalAlpha *= layer.opacity
draw layer
ctx.restore()
```

или эквивалент.

Opacity применяется ко всему layer content.

Не записывать изменённую alpha в отдельные entity.

---

# 23. Opacity и внутренние drawing alpha

Проверить текущие routines, где используется:

```text
ctx.globalAlpha
```

Layer opacity должна корректно умножаться, а не перезаписываться.

Тестировать:

```text
layer opacity 0.5
+
entity internal alpha 0.6
→ effective 0.3
```

если текущий drawing code использует alpha.

---

# 24. Layer locked

`locked` не влияет на rendering.

Он влияет на:

```text
Tool mutations
Selection
drag
delete
modal edits
```

---

# 25. Hidden layer selection

Entity из:

```text
visible:false
```

не должна попадать в hit-test Selection.

---

# 26. Locked layer selection

Entity из:

```text
locked:true
```

не должна быть selectable обычным map hit-test.

Layer row при этом можно выбрать в Layer Panel.

---

# 27. Active Layer

Добавить editor-only state:

```ts
activeLayerId: LayerId | null
```

Это НЕ входит в `MapDocumentV5`.

---

# 28. Active Layer lifecycle

При load:

1. если предыдущий active ID существует в новом document и это та же карта — можно сохранить;
2. иначе выбрать разумный default;
3. предпочтительно слой, подходящий текущему tool;
4. fallback — верхний visible unlocked layer;
5. если layers пусты — `null`.

Не усложнять persistent UI state сверх необходимости.

---

# 29. Layer selection ≠ Entity selection

Разделять:

```text
activeLayerId
```

и:

```text
selected entityId
```

Это разные editor concepts.

---

# 30. Entity selection меняет active layer

Когда пользователь hit-test'ом выбирает entity:

```text
selected.entityId
→ найти owning layer
→ activeLayerId = owning layer.id
```

Это делает поведение естественным.

---

# 31. Active layer может быть locked/hidden

Пользователь может выбрать строку locked/hidden layer в панели для:

```text
rename
unlock
show
reorder
opacity
```

Active layer не обязан быть editable.

---

# 32. Tool target resolver

Создать один central helper:

```ts
resolveToolTargetLayer(...)
```

или эквивалент.

Не размазывать:

```text
find layer
```

по каждому tool module.

---

# 33. Tool → layer mapping

Минимально:

```text
brush / eraser / fill / picker / wall
→ TerrainCellLayer

road / river
→ PathLayer

door / trap / marker / start / finish / room
→ GameplayLayer

label
→ LabelLayer

ruler
→ layer-neutral
```

---

# 34. Target resolution

Когда tool активируется/используется:

### Если active layer:

* совместимого kind;
* visible;
* unlocked;

использовать его.

### Иначе:

найти подходящий:

```text
topmost visible unlocked compatible layer
```

и сделать его active.

### Если подходящего слоя нет:

не создавать его магически.

Показать существующий `actionError`:

```text
Нет доступного слоя подходящего типа
```

---

# 35. Почему topmost

Topmost соответствует ожидаемой compositing semantics:

пользователь, рисуя без ручного выбора слоя, скорее ожидает редактировать верхний доступный слой этого типа.

При этом explicit active layer всегда приоритетнее.

---

# 36. Terrain picker

Picker в 3A читает **active/target TerrainLayer**, а не composited итог нескольких terrain layers.

Composite color/material picking — будущая feature.

---

# 37. Terrain fill

Flood работает только внутри target TerrainCellLayer.

Другие terrain layers не участвуют в connected-region calculation.

---

# 38. Road / River

Road/river tool больше не должен искать:

```text
единственный road во всём документе
```

Он работает внутри target `PathLayer`.

---

# 39. Multiple Path Layers

После 3A разрешено:

```text
Paths: Rivers
Paths: Roads
Paths: Secret Routes
```

и т. п.

Для road/river brush ambiguity проверяется **внутри active PathLayer**.

---

# 40. Path ambiguity rule

В одном target PathLayer:

```text
0 path нужного kind
→ создать

1
→ редактировать

>1
→ structured actionError
```

Но наличие road paths в других PathLayers больше не является ошибкой.

---

# 41. Gameplay tools

Все новые gameplay entities создаются именно в target GameplayLayer.

Не в:

```text
первый gameplay layer
legacy-layer-gameplay
```

---

# 42. Labels

Label create/edit lookup должен быть scoped target LabelLayer.

Если в той же cell/world position есть label в другом LabelLayer:

это другая entity.

Не редактировать её случайно.

---

# 43. Start / Finish semantics

Start и Finish остаются map-level singletons текущего editor UX.

При:

```text
setStart
setFinish
```

существующий Start/Finish ищется **во всех GameplayLayers**.

Новый создаётся в target GameplayLayer.

Если старый находился в другом layer:

он удаляется/заменяется согласно существующей set semantics.

---

# 44. Door pairs across layers

Door pair может связывать двери в разных GameplayLayers.

Это валидно V5.

Layer delete должен корректно очистить surviving pairedDoorId.

---

# 45. Layer Mutation Core

Создать:

```text
client/src/maps/core/mutations/layers.ts
```

---

# 46. Layer mutations

Минимально реализовать:

```text
createLayer
deleteLayer
renameLayer
setLayerVisible
setLayerLocked
setLayerOpacity
moveLayer
```

Допустимо:

```text
moveLayerBefore
moveLayerAfter
```

вместо index API, если удобнее.

---

# 47. Mutation semantics

Все layer operations:

* immutable;
* `changed:false` при no-op;
* structured errors;
* output valid V5;
* preserve untouched references, где разумно.

---

# 48. Layer IDs

Новый layer ID приходит извне.

Core не вызывает UUID самостоятельно.

Editor-level:

```text
createLayerId()
```

может использовать тот же UUID source, что entity IDs.

---

# 49. Global ID uniqueness

Новый LayerId не может конфликтовать:

* с другим LayerId;
* ни с одним EntityId.

Следовать существующему global identity invariant.

---

# 50. Create Terrain Layer

В 3A создаётся только:

```text
representation: "cells"
```

с:

```text
defaultMaterial = builtin terrain/plain
cells = []
```

Mask creation пока отсутствует.

---

# 51. Create Path Layer

```text
paths = []
```

---

# 52. Create Gameplay Layer

```text
items = []
```

---

# 53. Create Label Layer

```text
items = []
```

---

# 54. Object / Scatter layer creation

На 3A через UI НЕ обязательно разрешать создание новых Object/Scatter layers.

Существующие слои:

```text
видны
reorder
rename
visibility
locked
opacity
```

но их содержимое ещё не редактируется.

Это позволяет не начинать 3B/3C преждевременно.

---

# 55. Delete Layer

Core operation удаляет слой полностью.

UI перед удалением непустого слоя должен запросить confirmation.

---

# 56. Delete Gameplay Layer и door pairs

Если удаляемый GameplayLayer содержит двери:

для всех surviving doors в других layers:

```text
pairedDoorId
```

ссылающийся на удалённую дверь →

```text
null
```

Output обязан проходить validator.

---

# 57. Delete active layer

После deletion:

```text
activeLayerId
```

переключается на:

* ближайший surviving layer;
* либо layer, подходящий текущему tool;
* либо `null`.

---

# 58. Delete selected entity layer

Если выбранная entity находилась в удалённом layer:

```text
selection.clear()
```

---

# 59. Hide selected layer

Если layer с selected entity становится invisible:

```text
selection.clear()
```

---

# 60. Lock selected layer

Если layer с selected entity становится locked:

предпочтительно:

```text
selection.clear()
```

чтобы UI не оставался в состоянии выбранной, но немодифицируемой entity.

Зафиксировать тестом.

---

# 61. Reorder

Изменение порядка слоя:

```text
one history step
```

---

# 62. Visibility

Toggle:

```text
one history step
```

и обычный autosave document change.

---

# 63. Lock

Toggle:

```text
one history step
```

так как это persisted document property.

---

# 64. Rename

Rename:

```text
one history step
```

---

# 65. Opacity history boundary

Перетаскивание opacity slider не должно создавать 50 undo steps.

Semantics:

```text
pointer down
→ remember before

live updates

pointer up/change commit
→ one history step
```

Использовать существующий подход snapshot boundary либо маленький UI-local transaction.

Не менять generic History architecture.

---

# 66. Layer Panel

Добавить отдельную UI-панель слоёв.

Не смешивать её с map content modal.

---

# 67. Layer row

Минимально:

```text
visibility toggle
lock toggle
layer name
kind/type indication
active highlight
reorder controls
```

---

# 68. Opacity UI

Для active layer:

```text
Opacity 0–100%
```

slider + при желании numeric value.

---

# 69. Rename UX

Допустимо:

* double click name;
* edit field;
* Enter / blur commit;
* Escape cancel.

Не нужна отдельная modal.

---

# 70. Reorder UX

Не добавлять новую drag-and-drop dependency только ради 3A.

Обязательно поддержать reorder через:

```text
Move Up
Move Down
```

или аналогичные controls.

Если drag reorder легко реализуется существующей инфраструктурой — допустимо, но не обязательно.

---

# 71. Add Layer UX

Добавить действие:

```text
+ Layer
```

Минимальные создаваемые типы:

```text
Terrain
Paths
Gameplay
Labels
```

Object/Scatter пока можно не предлагать.

---

# 72. Default layer names

Например:

```text
Terrain
Paths
Gameplay
Labels
```

Если имя уже существует:

```text
Terrain 2
Terrain 3
```

либо иной deterministic UI helper.

Имя не является identity.

---

# 73. Layer type immutable

После создания:

```text
kind
```

нельзя поменять через UI.

Не делать:

```text
Gameplay → Terrain
```

conversion.

---

# 74. Layer panel не знает Core internals

UI вызывает typed layer mutation API.

Не делает:

```text
document.layers.splice(...)
```

---

# 75. Renderer refactor

`createV5RenderModel` должен сохранять реальную структуру и порядок `document.layers`.

Не flatten по semantic category.

---

# 76. V5 Render diagnostics

Для текущего supported subset:

```text
Terrain cells
Path cell-network road/river
Gameplay
Labels
empty Object/Scatter
```

диагностики отсутствуют.

---

# 77. Hidden unsupported layer

Если valid V5 содержит unsupported feature, например nonempty ObjectLayer:

даже если:

```text
visible:false
```

document всё ещё считается unsupported current editor.

Hidden не должен позволять autosave потенциально потерянного content.

Compatibility gate остаётся строгим.

---

# 78. Compatibility profile после 3A

Разрешить:

```text
arbitrary layer order
multiple TerrainCellLayers
multiple PathLayers
multiple GameplayLayers
multiple LabelLayers
visibility
lock
opacity
```

---

# 79. Path compatibility после 3A

Разрешено несколько road/river paths во всём document при условии:

```text
не более одного одного kind внутри конкретного editable PathLayer
```

Если в одном PathLayer два road cell-networks:

current editor unsupported/ambiguous.

---

# 80. Terrain compatibility

Разрешить 0..N TerrainCellLayers.

Mask Terrain всё ещё unsupported.

---

# 81. Gameplay compatibility

Разрешить 0..N GameplayLayers.

Поддерживаемая geometry остаётся:

```text
Room rect
Door cardinal
```

на этом этапе.

---

# 82. Label compatibility

Разрешить 0..N LabelLayers.

---

# 83. Object/Scatter

По-прежнему:

```text
nonempty ObjectLayer
→ unsupported

nonempty ScatterLayer
→ unsupported
```

---

# 84. Selection layer-awareness

Текущий `hitTestGameplay` сделать layer-aware.

Не flatten все gameplay entities без знания layer stack.

---

# 85. Cross-layer hit priority

Алгоритм:

```text
document.layers
iterate top → bottom

skip hidden
skip locked
skip non-gameplay

within gameplay layer:
apply existing semantic hit priority
```

Первый hit побеждает.

---

# 86. Within-layer priority

Сохранить:

```text
door
trap
marker
start
finish
room
```

и существующую same-kind/reverse semantics.

Это позволяет не менять привычный UX внутри слоя.

---

# 87. Layer order beats semantic priority across layers

Если:

```text
lower gameplay layer contains door
upper gameplay layer contains marker
```

и оба overlap:

выбирается marker верхнего слоя.

То есть layer stack имеет приоритет над kind priority.

---

# 88. Selection ownership lookup

Добавить pure helper:

```text
findEntityLayer(document, entityId)
```

либо эквивалент.

Не хранить stale duplicate ownership map в React state.

---

# 89. Selection rendering

Renderer знает entity ID и owning layer.

Если selected entity layer hidden:

selection уже должна быть cleared.

Если selected:

highlight рисуется как editor overlay либо в соответствующем layer-pass — выбрать вариант с меньшим визуальным churn.

Предпочтительно editor overlay после composition.

---

# 90. Locked mutation guard

Даже если по багу Tool получает locked layer ID:

mutation orchestration должна остановить action до Core content mutation.

Layer lock — editor authorization for local mutations.

Не полагаться только на disabled UI.

---

# 91. Modal guard

Если modal открыта для entity, а layer после этого:

```text
locked
hidden
deleted
```

до Save:

Save должен перепроверить owning layer.

Не позволять stale modal обойти lock.

---

# 92. Active layer + tool switch

При смене tool:

если active layer incompatible:

```text
auto-select topmost compatible visible unlocked
```

Это сохраняет быстрый UX без постоянного ручного тыканья по слоям.

---

# 93. Layer manual selection

Если пользователь явно кликает compatible layer:

он становится target следующей операции.

Не переопределять его topmost resolver'ом, пока он остаётся valid target.

---

# 94. Tool cursor / hints

Если подходящего editable layer нет:

Canvas interaction должен быть blocked для данного tool.

Можно показать existing actionError.

Не нужен новый большой UX.

---

# 95. Clear semantics

Проверить текущую V5 `clearDocument`.

После 3A Clear должен:

* сохранить `layers[]`;
* сохранить порядок;
* сохранить names;
* visibility;
* locked;
* opacity;

и очистить **content** всех поддерживаемых layers согласно старому Clear intent.

Не возвращать legacy skeleton.

---

# 96. Clear locked layers

Решить явно.

Рекомендуется:

```text
global Clear
```

очищает всё содержимое независимо от layer lock только после существующего подтверждения, потому что это document-level command.

Если текущий UX подразумевает другое — сохранить текущий смысл.

Зафиксировать тест.

---

# 97. Resize

`resizeGridDocument` должен пройти по **всем**:

```text
TerrainCellLayers
cell-network PathLayers
GameplayLayers
LabelLayers
```

а не по fixed layer IDs.

---

# 98. Resize layer properties

При resize сохранить:

```text
order
visibility
lock
opacity
names
IDs
```

---

# 99. Generators

Текущие legacy generators:

```text
MapCells
→ migrate
→ V5 skeleton
```

по-прежнему могут заменять **весь документ content/stack**, если именно это соответствовало старой semantics Generate.

Не пытаться в 3A распределять generated content по пользовательским custom layers.

Это отдельный future generator UX.

---

# 100. Generator confirmation

Если Generate заменяет custom layer stack, UI должен вести себя так же, как текущая destructive generation операция.

Если уже есть confirmation — сохранить.

Не добавлять новый semantics молча.

---

# 101. Fix Connectivity

Аудировать `fixConnectivityV5`.

Он не должен использовать:

```text
lyr-terrain
lyr-road
```

hardcoded IDs.

---

# 102. Fix Connectivity target

Если операция запускается как tool/command над текущей картой:

предпочтительно работать с target/active TerrainLayer и PathLayer либо с явно определёнными layers.

Если текущий UX не даёт выбора и становится неоднозначно при нескольких слоях:

не выбирать случайно.

Показать structured error:

```text
Выберите слой рельефа/дорог
```

или использовать активный подходящий layer.

---

# 103. Import V1

Legacy V1 migration по-прежнему создаёт стандартный layer stack.

После import:

```text
activeLayerId
```

резолвится заново.

---

# 104. Import V2

Arbitrary layer order сохраняется без изменений.

Compatibility profile 3A применяется.

---

# 105. Export V2

Никакой специальной логики.

`document.layers[]` сериализуется как canonical V5.

---

# 106. PNG

PNG render должен уважать:

```text
layer order
visible
opacity
```

Locked не влияет.

---

# 107. Thumbnail

То же.

---

# 108. Minimap

То же.

---

# 109. Legend

Legend должна учитывать **видимые TerrainLayers**.

Собрать используемые terrain materials из всех visible terrain layers.

Dedupe одинаковые materials.

Hidden terrain layer не добавляет material в legend.

---

# 110. Player Preview

Local preview сохраняет существующую gameplay sanitization/display semantics.

Дополнительно уважает:

```text
visible
opacity
layer order
```

Lock irrelevant.

---

# 111. Server Player Projection

Никаких изменений security architecture не требуется.

Projection должна сохранять:

```text
layers
order
visible
locked
opacity
```

и лишь чистить gameplay content.

Проверить shared tests.

---

# 112. History layer operations

Добавить тесты:

```text
create layer = 1 undo
delete = 1
rename = 1
visibility = 1
lock = 1
reorder = 1
opacity drag = 1
```

---

# 113. Undo active layer state

History хранит document, не editor-only `activeLayerId`.

После undo/redo:

если current activeLayerId больше не существует:

resolver выбирает новый valid layer.

Не включать active layer в History snapshot.

---

# 114. Autosave

Layer changes являются обычными V5 document changes.

Никакой отдельной save logic.

---

# 115. Canonical serialization

Layer order сохраняется.

Не сортировать layers по:

```text
id
name
kind
```

---

# 116. Layer mutation tests

Минимум:

```text
create
delete empty
delete populated
delete paired-door layer
rename
visibility
lock
opacity
reorder
ID collision
no-op
invalid opacity
missing layer
immutability
valid→mutation→valid
```

---

# 117. Renderer order tests

Создать synthetic document с намеренно необычным stack:

```text
Labels
Terrain
Gameplay
Roads
Terrain 2
```

и доказать mocked ctx/draw events:

```text
рисуются именно в таком порядке
```

где поддерживается content.

---

# 118. Legacy parity

Migrated standard stack должен давать тот же document-content draw order, что до 3A.

Исключение:

```text
grid теперь global overlay above document layers
```

зафиксировать отдельно.

---

# 119. Visibility tests

Для каждого supported layer kind:

```text
visible=false
→ 0 content draw calls этого layer
```

---

# 120. Opacity tests

Проверить минимум:

```text
Terrain
Path
Gameplay
Label
```

на `globalAlpha`.

---

# 121. Selection tests

Проверить:

```text
hidden layer skipped
locked layer skipped
top layer wins
within-layer priority preserved
select entity activates owning layer
hide selected clears
lock selected clears
delete layer clears
```

---

# 122. Tool routing tests

Проверить:

```text
active compatible wins

active incompatible
→ topmost compatible

hidden compatible skipped
locked compatible skipped

no layer
→ error

manual active layer retained
```

---

# 123. Multi-terrain tests

Документ:

```text
Terrain A
Terrain B
```

Brush должен менять только target layer.

Flood — только target.

Picker — target.

Undo — один step.

---

# 124. Multi-path tests

Два PathLayers:

```text
Roads Main
Roads Secret
```

Оба содержат по одному road path.

Road brush при active Main меняет только Main.

Это теперь supported.

---

# 125. Multi-gameplay tests

Два GameplayLayers.

Create marker в active A:

```text
B untouched
```

Selection overlap:

```text
upper layer entity wins
```

---

# 126. Multi-label tests

Одинаковая позиция на двух LabelLayers.

Edit в active label layer не должен изменить второй.

---

# 127. Compatibility tests

Документы с:

```text
multiple Terrain layers
multiple Path layers
multiple Gameplay layers
multiple Label layers
arbitrary order
opacity
hidden
locked
```

должны стать compatible.

---

# 128. Всё ещё unsupported

Тестами закрепить:

```text
TerrainMask
Spline
nonempty ObjectLayer
nonempty ScatterLayer
non-rect Room
non-cardinal Door
```

согласно текущему capability profile.

Не случайно разблокировать будущие features.

---

# 129. Performance

Замерить на реальной карте:

* RenderModel build;
* renderer;
* hit-test нескольких gameplay layers;
* layer reorder;
* opacity interaction.

Не оптимизировать без проблемы.

---

# 130. Не вводить Layer spatial indexes

Пока обычных проходов достаточно.

Не строить новый cache architecture.

---

# 131. Не вводить activeLayer в document

Повторно:

```text
activeLayerId = editor state
```

Не persisted map state.

---

# 132. Grep audit

После 3A найти hardcoded assumptions:

```text
lyr-terrain
lyr-road
lyr-river
lyr-gameplay
lyr-labels
```

В production editor/render flow они не должны использоваться как способ найти content.

Допустимы:

```text
legacy migration deterministic IDs
tests
fixtures
```

---

# 133. Ещё один grep

Искать patterns:

```text
find(layer => layer.kind === ...)[0]
```

в Tools/Renderer.

Каждый такой случай проверить:

```text
почему берётся первый?
```

Если layer target должен быть active — исправить.

---

# 134. UI smoke

Руками проверить:

1. открыть legacy-migrated карту;
2. открыть Layers panel;
3. поменять road и river местами;
4. увидеть визуальную смену порядка;
5. hide terrain;
6. вернуть;
7. opacity gameplay 50%;
8. lock gameplay;
9. убедиться, что entities не выбираются;
10. unlock;
11. создать второй GameplayLayer;
12. поставить marker туда;
13. создать второй PathLayer;
14. нарисовать road туда;
15. reorder слои;
16. undo/redo layer операций;
17. reload;
18. убедиться, что stack сохранился;
19. PNG;
20. V2 export/import.

---

# 135. Реальная карта

На копии Эстарии:

```text
открыть
→ standard migrated stack
→ визуально сравнить
→ reorder
→ autosave
→ reload
```

Проверить persistence layer order.

---

# 136. Stop conditions

Остановиться, если:

```text
renderer невозможно сделать layer-driven без потери migrated parity

несколько TerrainLayers требуют изменения MapDocument schema

Tool routing требует два mutable sources of active layer

layer delete ломает door relation invariants

resize невозможно обобщить на arbitrary layers

player projection теряет layer metadata

opacity требует переписывать каждый renderer primitive

multiple gameplay layers ломают stable-ID selection model

server V5 persistence переставляет layer order

canonical serializer сортирует layers

генератор непреднамеренно уничтожает custom stack без текущей destructive semantics
```

Не обходить это локальными hacks.

---

# 137. Критерии завершения

Фаза 3A завершена, если:

```text
PASS — document.layers[] является render order

PASS — hardcoded document render slots удалены

PASS — visibility работает

PASS — lock блокирует editing/selection

PASS — opacity работает

PASS — activeLayerId существует только в editor state

PASS — Layer Panel существует

PASS — create/delete/rename/reorder layers работают

PASS — layer mutations immutable

PASS — arbitrary supported layer order сохраняется

PASS — multiple TerrainCellLayers supported

PASS — multiple PathLayers supported

PASS — multiple GameplayLayers supported

PASS — multiple LabelLayers supported

PASS — tools пишут в target/active layer

PASS — road/river больше не глобально уникальны

PASS — selection учитывает layer order/visibility/lock

PASS — PNG/thumbnail/minimap используют layer stack

PASS — V2 export/import сохраняет stack

PASS — autosave сохраняет stack

PASS — undo/redo layer operations корректны

PASS — migrated legacy maps сохраняют content parity

PASS — Object/Scatter/Mask/Spline features не начаты
```

---

# 138. Архитектура после 3A

```text
                 MapDocumentV5
                       │
                       ▼
                  layers[]
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Layer Panel     Tools      Selection
          │            │            │
          │       activeLayerId      │
          │            │            │
          └────────────┼────────────┘
                       ▼
                 Layer Mutations
                       │
                       ▼
                 MapDocumentV5
                       │
                       ▼
                MapRenderModel
                       │
                ordered layers
                       │
                       ▼
                   Renderer
```

---

# 139. Отчёт после выполнения

После 3A новые features не начинать.

Отчитаться:

1. созданные/изменённые файлы;
2. новый `MapRenderModel`;
3. как renderer использует layer order;
4. visibility;
5. opacity;
6. lock;
7. Layer Mutation API;
8. Layer Panel;
9. activeLayer state;
10. tool target resolver;
11. terrain routing;
12. path routing;
13. gameplay routing;
14. label routing;
15. layer-aware Selection;
16. cross-layer hit priority;
17. delete-layer relation cleanup;
18. clear/resize;
19. generator/fixConnectivity;
20. PNG/thumbnail/minimap/legend;
21. compatibility profile;
22. history boundaries;
23. autosave/persistence;
24. tests;
25. build/client/server/shared/lint;
26. performance;
27. real-map/manual smoke;
28. grep audit hardcoded legacy layer IDs;
29. stop conditions;
30. remaining layer-related limitations.

После отчёта остановиться.
