# Фаза 2G — Canonical Editor State Switch

## 1. Цель

Переключить production Map Editor с:

```text
MapCells
```

на:

```text
MapDocumentV5
```

как **единственный canonical mutable state editing session**.

После успешной загрузки карты должно быть:

```text
persisted legacy
      │
      ▼
 legacy parser
      │
      ▼
 migrateLegacyMap
      │
      ▼
 MapDocumentV5
      │
      ├── History
      ├── Tools
      ├── Selection
      ├── RenderModel
      ├── Autosave
      └── Export
```

или:

```text
persisted V5
   │
   ▼
parseMapDocument
   │
   ▼
MapDocumentV5
   │
   └── editor
```

В editing session больше не существует mutable `MapCells`.

---

# 2. Главный инвариант

После load normalization:

```text
MapDocumentV5 = единственный source of truth
```

Запрещено:

```text
MapCells state
+
MapDocumentV5 state
```

Запрещена синхронизация:

```text
MapCells ↔ V5
```

---

# 3. Разрешённые legacy MapCells после switch

`MapCells` разрешён только на внешних legacy-boundaries как краткоживущий промежуточный результат.

Допустимые случаи:

```text
legacy persisted blob
→ parseCellsBlob
→ MapCells
→ migrateLegacyMap
→ уничтожается

legacy generator
→ temporary MapCells
→ migrateLegacyMap
→ уничтожается

soyman-map/1 import
→ legacy representation
→ V5
```

`MapCells` не хранится в:

```text
React state
ref
History
Autosave
Selection
Tools
Viewport
```

---

# 4. Current Editor V5 Compatibility Profile

До поддержки новых возможностей редактор должен редактировать только V5 subset, который он полностью умеет показывать и изменять.

Создать чистую проверку уровня:

```ts
assessCurrentEditorCompatibility(doc)
```

Она должна отличаться от `validateMapDocument`.

`validateMapDocument` отвечает:

> документ валиден как V5?

Compatibility отвечает:

> текущая версия редактора умеет безопасно редактировать все данные этого V5?

---

# 5. Текущий совместимый профиль

Минимально поддержан:

```text
grid != null
square | hex

legacy-compatible grid dimensions
в пределах текущей server persistence schema

TerrainCellLayer

road:
cell-network

river:
cell-network

Labels

Gameplay:
rect rooms
cardinal doors
traps
markers
start
finish

ObjectLayer empty
ScatterLayer empty
```

Использовать существующие diagnostics `createV5RenderModel` как часть проверки, но не ограничиваться ими.

---

# 6. Path ambiguity

Текущий road/river brush исторически работает с одним глобальным набором клеток.

Поэтому compatibility profile на этой фазе должен требовать максимум:

```text
1 editable road cell-network path
1 editable river cell-network path
```

Документ с несколькими `road` paths может быть валидным V5, но текущий brush не знает, какой редактировать.

Это:

```text
valid V5
but unsupported by current editor
```

а не corruption.

---

# 7. Unsupported valid V5

Если persisted/imported V5:

```text
валиден
но не проходит editor compatibility
```

его нельзя молча открыть как обычную редактируемую карту.

Не допустить ситуации:

```text
renderer не показывает spline/scatter/object
↓
пользователь редактирует
↓
autosave
```

---

# 8. Поведение unsupported V5

Предпочтительно открыть безопасный blocked/read-only state либо показать понятное сообщение, что карта использует функции, которые эта версия редактора ещё не поддерживает.

Критические требования:

```text
autosave blocked
tools disabled
никакого silent data loss
```

Не превращать unsupported document в legacy subset.

---

# 9. Persistence profile limitation

Текущий backend V5 persistence поддерживает только:

```text
grid square/hex
width/height 8..100
```

Это ограничение текущего приложения/DB, не V5 schema.

Не менять ADR, чтобы подогнать его под SQLite.

На 2G gridless/native-beautiful maps остаются будущей возможностью.

---

# 10. Load normalization

Сделать один version-aware load pipeline.

Концептуально:

```ts
loadStoredEditorDocument(map)
```

Результат должен быть примерно:

```ts
{
  document: MapDocumentV5;
  sourceFormat: "legacy" | "v5";
  corrupt: boolean;
  compatibility: ...;
}
```

Точные названия свободны.

---

# 11. Legacy load

Для legacy blob:

```text
parse legacy
→ existing corrupt semantics
→ migrateLegacyMap
→ validate V5
→ compatibility check
→ setDocument
```

Migration warnings можно логировать.

Не хранить промежуточный `MapCells`.

---

# 12. V5 load

Для V5:

```text
parseMapDocument
→ validate
→ compatibility check
→ setDocument
```

Не прогонять V5 через legacy.

---

# 13. Не делать write-on-load

Особенно для legacy map:

```text
legacy DB
→ load
→ migrate in memory
```

не должно автоматически означать:

```text
PUT V5
```

если пользователь ничего не изменил.

Legacy row мигрируется в БД **лениво при первом реальном сохранении изменения**.

---

# 14. Autosave baseline

Это требует важной правки autosave etalon.

После legacy load baseline должен быть:

```text
serializeMapDocument(migratedDocument)
```

а не исходная legacy blob string.

Иначе migrated in-memory V5 сразу будет казаться dirty.

---

# 15. Lazy persistence migration

Желаемая semantics:

```text
legacy map opened
→ DB всё ещё legacy

legacy map edited
→ autosave
→ DB становится V5
```

После этого следующие загрузки идут напрямую V5.

---

# 16. Операционный нюанс rollback

После первого V5 save старая версия клиента V5-карту полноценно редактировать уже не сможет.

Она должна хотя бы безопасно уйти в существующий corrupt/blocked fallback и не затереть данные.

Зафиксировать это как deployment limitation.

Не пытаться решать через двойное сохранение legacy+V5.

---

# 17. Editor state

Заменить:

```ts
cells
cellsRef
```

на:

```ts
document
documentRef
```

`documentRef` нужен существующему imperative Input/Tools flow так же, как раньше `cellsRef`.

---

# 18. Synchronous ref mirror

Все live mutations должны гарантировать:

```text
documentRef.current
```

обновлён синхронно вместе с новым document, если следующий pointer event может прийти до React render.

Не возвращать stale-state проблему, которую Фаза 1 уже устраняла.

---

# 19. Geometry source

После switch не использовать server metadata:

```text
map.grid
map.width
map.height
```

как canonical editor geometry.

Источник:

```text
document.grid
document.world
```

Server columns остаются persistence/backward-compat metadata.

---

# 20. Derived editor geometry

При необходимости создать небольшой derived object:

```ts
EditorMapGeometry
```

из `document.grid/world`.

Его могут читать:

```text
Camera
Input
Tools
Viewport
Minimap
```

Но он не является отдельным mutable state.

---

# 21. Camera

`useMapCamera` должен получать geometry, производную от V5.

Camera state остаётся editor-only/localStorage.

Не помещать camera в V5.

Сохранить:

```text
scale 4..240
fit
zoom
persist
```

без изменений.

---

# 22. History

`useMapHistory` уже generic.

Переключить:

```text
MapCells
→ MapDocumentV5
```

V5 mutation Core immutable, поэтому snapshots могут хранить document references.

Если hook требует:

```ts
clone(value)
```

допустимо использовать identity clone:

```ts
doc => doc
```

только если весь production V5 mutation path действительно immutable.

Зафиксировать тестом.

---

# 23. History boundaries

Сохранить ровно существующие semantics:

```text
one paint stroke = one undo

fill = one

road/river edit action = согласно текущему stroke behavior

wall finish = one

shape = one

object placement = one

drag = one на pointerup

modal save/delete = one

generator = one

import = one

resize = one

clear = one
```

---

# 24. Input

Не переписывать pointer/touch state machine.

`useMapInput` должен продолжать отвечать только за orchestration.

Заменить необходимые:

```text
cellsRef
```

на:

```text
documentRef
```

без изменения:

```text
pointer capture
touch transitions
paint rAF
drag threshold
RMB erase override
stroke boundaries
```

---

# 25. Tools facade

Сохранить текущий внешний contract `useMapTools` настолько, насколько возможно.

Внутреннюю реализацию перевести:

```text
MapCells mutation
→ V5 Mutation Core
```

---

# 26. Terrain brush

Использовать:

```text
readTerrainMaterialAt
applyTerrainCellEdits
```

Не писать вручную `TerrainCellEntry[]` в Tool.

Brush cells по-прежнему вычисляются текущей tool/grid geometry.

Batch edits — одним mutation call на dab.

---

# 27. Eraser

Сохранить RMB temporary erase semantics.

Erase terrain означает:

```text
material → defaultMaterial
```

что Core канонически удаляет override.

Tool state при RMB не меняется.

---

# 28. Flood

Использовать V5:

```text
floodTerrainFill
```

Сохранить square/hex behavior.

History = один шаг.

---

# 29. Picker

Picker читает материал из V5 через:

```text
readTerrainMaterialAt
```

Не обращается к legacy terrain Map.

---

# 30. Road / River brush

Текущий UI должен найти текущий editable path по `kind`.

Если path существует:

```text
addPathCells/removePathCells
```

по `pathId`.

Если path отсутствует и пользователь впервые рисует:

```text
createCellNetworkPath
```

с новым ID от editor-level ID factory.

---

# 31. ID factory

Core по-прежнему не генерирует IDs.

На editor-level создать injectable helper:

```ts
createEntityId()
```

Production может использовать UUID.

Tests должны иметь deterministic ID factory.

---

# 32. Не использовать magic legacy IDs для новых entities

Не создавать новые road/doors/markers как:

```text
legacy-door-17
legacy-path-road
```

если они создаются уже внутри V5 editor.

Legacy IDs остаются только migrated entities.

Новые сущности получают новые stable IDs.

---

# 33. Multiple path safeguard

Compatibility profile гарантирует максимум один editable road/river path.

Tool не должен выбирать «первый попавшийся» среди нескольких.

Если invariant нарушен runtime:

```text
structured action error
```

а не silent mutation.

---

# 34. Wall terrain

Текущий wall brush/polyline остаётся:

```text
terrain material "wall"
```

Не превращать в spline/path на switch phase.

---

# 35. Shapes

Текущий shape tool должен применять V5 mutations.

Terrain-shaped operations → terrain batch.

Road/river-shaped operations → path operations.

Room shape → GameplayRoom creation через modal, как раньше.

Не менять UX.

---

# 36. Gameplay creation

Перевести текущие:

```text
Door
Trap
Marker
Room
Start
Finish
```

на:

```text
createGameplayEntity
setStart
setFinish
```

с external stable IDs.

---

# 37. Modal drafts

Существующие UI drafts оставить.

Но save/delete handlers больше не должны:

```text
clone cells
mutate arrays
mutateObjects
```

Они вызывают typed V5 mutation APIs.

---

# 38. `mutateObjects`

Старый `mutateObjects` после успешного switch должен исчезнуть из production editor.

Если что-то ещё требует его — показать call sites в отчёте.

Не оставлять MapCells-era mutation backdoor.

---

# 39. Label flow

Перевести:

```text
create
rename
move
delete
```

на stable-ID label mutations.

Legacy cell-based label identity больше не используется.

---

# 40. Selection hook

Переписать существующий `useMapSelection` на V5.

Public UX API желательно сохранить:

```text
selected
select
clearSelection
hitAt
moveSelectedTo
deleteSelected
```

Но `selected` теперь:

```text
V5Selection
```

со stable `entityId`.

---

# 41. Hit testing

Использовать:

```text
hitTestGameplay
```

из 2E.

Не дублировать priority/geometry внутри hook.

---

# 42. Selection priority

Сохранить:

```text
door
trap
marker
start
finish
room
```

и reverse room stacking согласно 2E.

---

# 43. Move selection

Hook определяет editor snapping/target semantics.

Actual mutation выполняет V5 Mutation Core.

Не мутировать document внутри Selection вручную.

---

# 44. Current grid-snapped UX

Хотя V5 поддерживает free world positions, текущий editor UI может продолжать grid-snapped move.

Это UI/tool behavior, а не storage limitation.

Не добавлять free-object UX во время switch.

---

# 45. Delete selection

Использовать typed V5 delete operation.

Door relation cleanup должен происходить внутри Mutation Core.

Selection hook не должен чинить pair вручную.

---

# 46. Selected rendering

Renderer/read model entities уже имеют stable IDs.

Перевести overlay/highlight:

```text
selectedKey/index
→ selected EntityId
```

Не вычислять identity из array position.

---

# 47. MapViewport

Предпочтительно перестать передавать `MapCells`.

Страница должна производить:

```text
document
→ createV5RenderModel
→ MapRenderModel
```

и Viewport получать:

```text
model
```

либо V5 document, если минимальный diff объективно проще.

Предпочтительнее `MapRenderModel`, чтобы Viewport не зависел от storage format.

---

# 48. V5 render diagnostics

Для совместимого production document ожидается:

```text
diagnostics.length === 0
```

Если во время editing внезапно появляется unsupported diagnostic:

```text
development error
```

Это означает, что Tool создал feature, которую текущий renderer не поддерживает.

---

# 49. Thumbnail

Перевести thumbnail generation:

```text
V5 document
→ V5 RenderModel
→ render
```

Не использовать LegacyRenderModel.

Autosave throttle 2.5 секунды сохранить.

---

# 50. PNG export

PNG export также должен идти:

```text
V5
→ RenderModel
→ renderMap
```

Без V5 → MapCells.

Все export dimensions и visual semantics сохранить.

---

# 51. Minimap

Если minimap читает `MapCells`, перевести её на:

```text
MapRenderModel
```

или V5 read helpers.

Не создавать legacy snapshot только ради minimap.

---

# 52. Autosave hook

Адаптировать `useMapAutosave` с `MapCells` на generic/value-oriented V5 API.

Предпочтительно переименовать внутреннюю семантику:

```text
cells
→ value/document
serializeCells
→ serialize
```

если это можно сделать без лишнего churn.

---

# 53. Autosave serialization

Dirty key теперь использует:

```text
serializeMapDocument(document)
```

плюс существующие metadata/generator params, если они всё ещё сохраняются отдельно.

Не использовать `JSON.stringify(document)` напрямую.

---

# 54. Autosave save request

При save отправлять:

```text
document
```

через V5 backend branch 2F.

Не отправлять одновременно:

```text
cells
```

---

# 55. Autosave quirks

Сохранить зафиксированные Phase-1 quirks.

Не чинить попутно:

```text
dirty-status revert quirk
debounce etalon quirk
retry blocked quirk
onSaved seq quirk
```

Это отдельный tech debt.

---

# 56. Corrupt legacy load

Текущее безопасное поведение должно сохраниться.

Если legacy blob corrupt:

```text
создать display fallback V5
autosave blocked
данные не перезаписывать
```

Fallback не должен считаться настоящей миграцией.

---

# 57. Unsupported V5 autosave

Если compatibility check failed:

```text
autosave blocked
```

Даже если document сам по себе валиден.

---

# 58. Generator integration

Существующие генераторы пока можно оставить legacy algorithms.

Допустимый переходный flow:

```text
generator
→ temporary MapCells
→ migrateLegacyMap
→ validate
→ setDocument
```

Temporary `MapCells` не становится state/ref.

---

# 59. Generator history

Generation replacement остаётся:

```text
one history step
```

как раньше.

Seed reproducibility сохранить.

---

# 60. Dungeon generator

То же правило.

Не переписывать generation algorithms на V5 в этой фазе.

Это отдельная будущая очистка.

---

# 61. Clear

Старый:

```text
setCells(empty)
```

должен исчезнуть.

Реализовать V5 clear operation или V5 document transformation, сохраняющую:

```text
world
grid
layer skeleton
```

и очищающую текущий editable content согласно старой Clear semantics.

Предпочтительно разместить её в Mutation Core и покрыть validator test.

---

# 62. Resize

Это потенциально опасная часть.

Перед изменением кода провести точный audit существующего resize behavior.

Нужно выяснить:

```text
что происходит с terrain
roads/rivers
labels
rooms
doors
traps
markers
start/finish
```

при уменьшении/увеличении карты.

---

# 63. Resize V5

Если semantics однозначно воспроизводится, реализовать pure V5:

```ts
resizeGridDocument(...)
```

Она должна:

```text
изменить grid columns/rows
пересчитать world bounds
удалить/скорректировать OOB cell data
сохранить document validity
```

Gameplay/world-position behavior должен совпасть со старым editor.

---

# 64. Resize stop condition

Если существующий resize зависит от legacy cell identity, которая была утрачена в world-only entity representation, и точное поведение нельзя воспроизвести без угадывания:

```text
STOP
```

Не внедрять heuristic silently.

Сообщить конкретный legacy behavior.

---

# 65. Grid kind changes

Отдельно проверить, позволяет ли production editor менять существующую карту:

```text
square ↔ hex
```

Если нет — ничего делать не нужно.

Если позволяет — это отдельный migration semantic risk.

Не предполагать.

Сверить код.

---

# 66. Map metadata

Сохранить metadata отдельно:

```text
name
scale
cellLore
parent
visibility
generator params
```

Не смешивать её с MapDocument.

---

# 67. Grid metadata duplication

Во время editing источником истины:

```text
document.grid
```

Не поддерживать вручную второй mutable:

```text
map.width/map.height/map.grid
```

Если server response содержит эти compatibility fields, относиться к ним как к persisted metadata mirror.

---

# 68. JSON import

После switch import UI должен поддерживать:

```text
soyman-map/1
→ V5 import/migration

soyman-map/2
→ V5 parse
```

Для V2 обязательно compatibility check перед заменой текущей карты.

---

# 69. JSON export

Новая карта экспортируется:

```text
soyman-map/2
```

через существующий V2 builder.

Не реализовывать V5 → `soyman-map/1`.

---

# 70. Import history

Успешный import:

```text
one history step
```

как раньше.

Invalid/unsupported import не меняет current document.

---

# 71. Existing new-map creation

Не обязательно переводить внешний create-map flow на V5.

Допустимо:

```text
new map created as legacy empty row
→ first editor load migrates to V5 in memory
→ first edit persists V5
```

Это соответствует lazy migration стратегии.

---

# 72. Duplicate map

Проверить duplicate flow.

Если duplication просто копирует stored blob:

```text
legacy stays legacy
V5 stays V5
```

это нормально.

Не конвертировать ради duplicate.

---

# 73. Shadow Audit

После canonical switch production shadow migration больше не нужен как side branch.

Для legacy load теперь migration — настоящий load path.

Можно:

```text
удалить MapEditorPage shadow call
```

оставив audit/equivalence modules и tests как regression tooling.

Не выполнять миграцию дважды.

---

# 74. Optional DEV equivalence

Если хочется сохранить дополнительную страховку, для legacy load допустимо в DEV выполнить:

```text
compareLegacySemantics(legacy, actualMigratedDocument)
```

без второго `migrateLegacyMap`.

Не обязательно.

---

# 75. Current client API

Добавить/использовать V5 save API, не ломая legacy API, если он нужен другим местам.

Map Editor после switch использует V5 branch.

---

# 76. Load response `cells`

Даже если сервер пока возвращает serialized V5 в поле:

```text
cells
```

не распространять это имя дальше editor load boundary.

Сразу нормализовать его в:

```text
document
```

Внутри editor `cells` больше не означает map content.

---

# 77. Compatibility with old persisted V5

V5 maps, уже записанные backend tests/manual tools, должны загружаться напрямую.

Не мигрировать их повторно.

---

# 78. Core validation boundary

После:

```text
legacy migration
V2 import
V5 server load
generator migration
resize
clear
```

document должен пройти:

```text
validateMapDocument
```

на boundary/debug/tests.

Не обязательно валидировать весь document после каждого brush dab в production, если Mutation Core уже гарантирует invariants.

---

# 79. Error model

Mutation `ok:false` должен попадать в текущую:

```text
actionError
```

или эквивалентный UI error flow.

Не делать `console.error` единственным способом сообщить пользователю о невозможной операции.

---

# 80. No direct document mutation

Провести grep/audit после switch.

Editor production не должен делать:

```text
document.layers.push(...)
entity.position.x = ...
```

Все domain mutations идут через Mutation Core либо через явно проверенные whole-document replacement boundaries:

```text
load
import
generator
undo/redo
```

---

# 81. Allowed whole-document replacements

Допустимы:

```text
load normalized V5
undo
redo
generator result
import result
clear result
resize result
cancel drag rollback
```

Остальные edits через core mutation APIs.

---

# 82. Tests — load

Проверить:

```text
legacy load → V5 editor state
V5 load → same V5 editor state
legacy load does NOT autosave immediately
corrupt legacy → blocked fallback
unsupported V5 → blocked
```

---

# 83. Tests — history

Особенно:

```text
paint stroke = 1 undo
fill = 1
wall finish = 1
drag = 1
modal save = 1
generator = 1
import = 1
```

И redo.

---

# 84. Tests — stable selection

Production hook tests:

```text
select C
delete B
selection still C

reorder sibling
selection still same EntityId

delete selected
selection clears
```

---

# 85. Tests — tools

Все существующие semantic tool tests должны быть переписаны/адаптированы к V5 outputs.

Не снижать coverage из-за switch.

Проверить минимум:

```text
brush
eraser
RMB override
fill
picker
road
river
wall
shape
object placement
label
hex restrictions
```

---

# 86. Tests — autosave

Проверить:

```text
legacy-loaded baseline not dirty
first mutation saves V5
V5-loaded baseline not dirty
retry behavior unchanged
seq race behavior unchanged
thumbnail throttle unchanged
corrupt/unsupported blocked
```

---

# 87. Tests — persistence

Client-level mock/integration:

```text
edit legacy-loaded map
→ PUT contains document
→ no cells field
```

И:

```text
reload saved V5
→ no legacy migration
```

---

# 88. Tests — renderer

После switch production path:

```text
V5 document
→ V5 RenderModel
→ renderer
```

LegacyRenderModel больше не должен использоваться Viewport/PNG/thumbnail production call-sites.

---

# 89. Tests — generator

Generator:

```text
legacy transient result
→ V5
→ valid
→ undo restores previous V5
```

Square и hex, где применимо.

---

# 90. Tests — import/export

Проверить:

```text
V1 import → V5 state
V2 import → V5 state
V2 export → parse → same canonical document
unsupported V2 import rejected safely
```

---

# 91. Manual smoke

После unit tests обязательно руками пройти текущий editor:

```text
square load
hex load
brush/RMB
fill/picker
road/river
wall
room
door/trap/marker
drag/delete
label
undo/redo
generator
resize
PNG
JSON V2 export/import
reload/autosave
player preview
```

---

# 92. Реальные карты

Открыть минимум реальные карты, использованные в 2C:

```text
Эстария
Эстария (копия)
```

Ожидается:

```text
legacy load
→ V5 session
→ без visual regression
```

Сделать копию карты для save/reload smoke, чтобы исходный production fixture не портить.

---

# 93. Persistence smoke

На копии:

```text
открыть legacy
изменить одну клетку
дождаться autosave
проверить DB/store format = V5
reload
проверить карту
```

Это ключевой proof switch.

---

# 94. Старый клиент

Зафиксировать ожидаемое:

после V5 save старая версия приложения такую карту редактировать не сможет.

Но она не должна автоматически затереть V5 blob.

Не решать backward edit compatibility через dual format.

---

# 95. Performance

Замерить:

```text
V5 RenderModel creation
brush dab
large flood
undo
autosave serialization
```

на реальной карте порядка 1800 клеток.

Не вводить optimization infrastructure без проблемы.

---

# 96. Stop conditions

Остановиться, если:

```text
нужен V5 → MapCells для рабочего editor path

приходится держать MapCells и V5 одновременно

legacy load автоматически вызывает save без edit

selection всё ещё требует array index

renderer production требует LegacyRenderModel

autosave невозможно сделать V5 без изменения server contract

resize semantics невозможно воспроизвести

grid change теряет semantic data

generator невозможно безопасно нормализовать в V5

unsupported V5 может быть сохранён текущим editor

successful Mutation Core operation создаёт invalid V5

rollback/cancel drag требует mutable aliasing
```

---

# 97. Grep acceptance audit

После switch провести поиск production editor path.

В:

```text
MapEditorPage
editor/hooks
editor/tools
MapViewport
mapExport
autosave path
```

не должно быть:

```text
MapCells
cloneCells
mutateObjects
createLegacyRenderModel
```

Допустимые legacy imports остаются только в:

```text
migration
legacy import
legacy generators
legacy adapter/tests
shadow regression tooling
```

---

# 98. Критерии завершения

Фаза завершена, если:

```text
PASS — MapDocumentV5 единственный mutable editor state
PASS — MapCells state/ref отсутствуют
PASS — legacy load мигрируется один раз
PASS — V5 load идёт напрямую
PASS — load не вызывает автоматический V5 save
PASS — первый реальный edit legacy map сохраняется V5
PASS — V5 reload работает
PASS — Tools используют V5 mutations
PASS — Selection использует EntityId
PASS — History хранит V5 snapshots
PASS — renderer production использует V5 RenderModel
PASS — thumbnail использует V5
PASS — PNG использует V5
PASS — autosave сериализует V5
PASS — backend получает document, не cells
PASS — labels/gameplay drafts работают через mutations
PASS — mutateObjects удалён из editor path
PASS — generator normalizes to V5
PASS — V1 import работает
PASS — V2 import/export работает
PASS — unsupported V5 нельзя случайно перезаписать
PASS — no dual state
PASS — no V5→MapCells
```

---

# 99. Архитектура после 2G

```text
                         LOAD

             ┌──────── legacy ────────┐
             │                        │
             ▼                        │
        parse legacy                  │
             │                        │
             ▼                        │
       migrateLegacyMap               │
             │                        │
             └──────────┐             │
                        ▼             │
                  MapDocumentV5 ◄──── V5 load
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
        Tools        Selection      History
          │          EntityId         │
          └─────────────┬─────────────┘
                        ▼
                  MapDocumentV5
                        │
                ┌───────┴────────┐
                ▼                ▼
           V5 RenderModel     Autosave
                │                │
                ▼                ▼
             Renderer          Server
                                 │
                                 ▼
                            canonical V5
```

Для editing session `MapCells` исчез.

---

# 100. Отчёт после выполнения

После switch остановиться.

Отчитаться:

1. изменённые/созданные файлы;
2. новый state ownership;
3. load pipeline legacy/V5;
4. compatibility profile;
5. corrupt/unsupported handling;
6. `documentRef`;
7. History;
8. Tools;
9. road/river path strategy;
10. stable-ID Selection;
11. modal mutations;
12. renderer/Viewport;
13. PNG/thumbnail/minimap;
14. Autosave baseline/save;
15. lazy legacy→V5 persistence;
16. generators;
17. resize/grid settings;
18. import/export;
19. removed legacy editor helpers;
20. grep audit;
21. tests;
22. build/client/server/lint;
23. performance;
24. real-map smoke;
25. DB persistence smoke;
26. stop conditions;
27. remaining legacy dependencies;
28. regressions/known quirks;
29. readiness for native V5 features.

Новые V5 features (`mask`, `spline`, `scatter`, assets, free objects) после switch автоматически не начинать.
