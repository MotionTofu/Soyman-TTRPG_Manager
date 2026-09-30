# Фаза 2D — V5 Read Model + Renderer Decoupling

## 1. Цель

Отвязать существующий Canvas renderer от конкретного storage/editor-типа `MapCells`, не меняя визуальное или пользовательское поведение редактора.

После фазы должно существовать:

```text
MapCells ───────────┐
                    ▼
               MapRenderModel
                    │
                    ▼
                 renderMap
```

и параллельно:

```text
MapDocumentV5
       │
       ▼
  MapRenderModel
       │
       ▼
    renderMap
```

Но production editor по-прежнему использует:

```text
MapCells
```

как canonical mutable state.

V5 пока не становится editor state.

---

# 2. Зачем этот этап нужен

Сейчас V5 migration уже доказана:

```text
legacy
→ V5
→ valid
→ semantically equivalent
```

Но renderer всё ещё структурно привязан к `MapCells`.

Если сразу переключить editor на V5, одновременно придётся менять:

```text
renderer
Tools
Selection
History wiring
Autosave
load/save
import/export
```

Это слишком большой blast radius.

На 2D отделяем только **read path**.

---

# 3. Главный принцип

Новый `MapRenderModel` — это не новая карта и не третий формат хранения.

Это **read-only runtime view**.

Он:

* не сериализуется;
* не сохраняется;
* не имеет собственного lifecycle;
* не мутируется;
* не является source of truth;
* не входит в History;
* не входит в Autosave.

Это адаптер чтения.

---

# 4. Запрещено

Не:

* переключать `cells` state на V5;
* менять Tools;
* менять Input;
* менять Selection;
* менять History;
* менять Autosave;
* менять backend;
* менять database;
* сохранять V5;
* подключать `soyman-map/2` к UI;
* делать V5 → MapCells conversion;
* делать dual mutable state;
* реализовывать mask terrain rendering;
* реализовывать spline rendering;
* реализовывать scatter rendering;
* реализовывать external assets.

---

# 5. Важное отличие от запрещённого V5 → MapCells adapter

Нельзя делать:

```text
MapDocumentV5
→ MapCells
→ renderMap
```

Это снова делает `MapCells` обязательным промежуточным форматом.

Нужно:

```text
MapCells ────────► MapRenderModel
MapDocumentV5 ──► MapRenderModel
                         │
                         ▼
                      renderer
```

То есть renderer становится независим от обоих storage formats.

---

# 6. Новый read contract

Создать нейтральный read-only контракт.

Рекомендуемое место:

```text
client/src/maps/renderModel.ts
```

или:

```text
client/src/maps/render/model.ts
```

Если существующий `render.ts` пока один файл, не делать большой folder-refactor без необходимости.

Концептуально контракт должен давать renderer ровно то, что ему нужно.

Например:

```ts
interface MapRenderModel {
  readonly terrain: RenderTerrainView;
  readonly roads: RenderCellPathView;
  readonly rivers: RenderCellPathView;

  readonly labels: readonly RenderLabel[];
  readonly rooms: readonly RenderRoom[];
  readonly doors: readonly RenderDoor[];
  readonly traps: readonly RenderTrap[];
  readonly markers: readonly RenderMarker[];

  readonly start: RenderPoint | null;
  readonly finish: RenderPoint | null;
}
```

Это только направление.

Сначала проанализировать фактические чтения `renderMap`.

Не переносить в контракт данные, которыми renderer не пользуется.

---

# 7. Read model должен быть renderer-oriented

`MapRenderModel` не обязан повторять:

```text
MapCells
```

и не обязан повторять:

```text
MapDocumentV5
```

Он должен отражать потребности текущего renderer.

Пример:

если renderer спрашивает:

```text
terrain.get(cellKey)
roads.has(cellKey)
```

можно предоставить read interface с методами:

```ts
terrainAt(x, y)
hasRoad(x, y)
hasRiver(x, y)
```

вместо копирования `Map`/`Set`.

Выбрать форму, которая минимизирует coupling.

---

# 8. Не материализовать полную копию без необходимости

Предпочтителен lightweight adapter/view.

Не делать на каждом render:

```text
MapCells
→ огромный новый object
→ новые arrays/maps/sets
→ render
```

если можно дать renderer стабильные read-accessors.

Особенно не копировать terrain Map целиком каждый React render.

---

# 9. Legacy adapter

Реализовать:

```ts
createLegacyRenderModel(cells: MapCells): MapRenderModel
```

Он должен представлять текущий `MapCells` renderer'у без семантических изменений.

На первом production переключении:

```text
MapCells
→ createLegacyRenderModel
→ renderMap
```

Результат визуально должен быть 1:1 текущему renderer.

---

# 10. V5 adapter

Реализовать отдельно:

```ts
createV5RenderModel(document: MapDocumentV5): MapRenderModel
```

На этой фазе он обязан поддерживать только legacy-compatible V5 subset:

```text
TerrainCellLayer
road cell-network
river cell-network
LabelLayer
GameplayLayer
```

Плюс пустые:

```text
ObjectLayer
ScatterLayer
```

Новые представления пока не рендерить.

---

# 11. Unsupported V5 content

Если V5 document содержит:

```text
TerrainMaskLayer
spline path
MapObject
ScatterArea
external visual assets
```

legacy renderer adapter не должен тихо притворяться, что всё поддерживает.

Определить явную capability/diagnostic модель.

Например:

```ts
interface RenderModelDiagnostic {
  code: string;
  message: string;
}
```

или result:

```ts
{
  model,
  diagnostics
}
```

Но production editor в 2D использует только legacy adapter, поэтому пользователь этого пока не видит.

---

# 12. Не считать unsupported content corruption

Например:

```text
spline path
```

может быть абсолютно валидным V5, просто текущий renderer его ещё не умеет отображать.

Это:

```text
unsupported-render-feature
```

а не:

```text
invalid-document
```

---

# 13. Terrain read model

Legacy-compatible renderer должен получать эквивалент:

```text
plain default
+
non-plain terrain cells
```

Из MapCells:

```text
terrain.get(key)
```

Из V5:

```text
TerrainCellLayer.defaultMaterial
TerrainCellLayer.cells[]
```

V5 adapter может построить индекс для быстрого lookup.

---

# 14. Runtime indexes разрешены

В отличие от canonical document, render adapter может построить derived:

```text
Map
Set
```

например:

```text
terrainByCell
roadCells
riverCells
```

Это runtime-only cache/read view.

Он не сериализуется.

---

# 15. Кэширование V5 adapter

Не оптимизировать преждевременно.

Но создание индекса не должно происходить для каждой клетки внутри `renderMap`.

Допустимо построить:

```text
V5 document
→ render model/index
→ renderer
```

один раз на identity документа.

В production 2D V5 path пока не используется, поэтому сложный cache не нужен.

---

# 16. Labels

Read-model label должен содержать всё, что реально необходимо старому renderer.

Если старый renderer работает с:

```text
cell x/y
```

а V5 хранит:

```text
world position
```

не заставлять V5 adapter искусственно восстанавливать cell identity, если renderer можно минимально перевести на world position.

Но это изменение допускается только если visual semantics сохраняется.

При сомнении сохранить существующую renderer geometry через read model.

---

# 17. Gameplay read model

Текущий renderer должен продолжать видеть:

```text
rooms
doors
traps
markers
start
finish
```

в форме, достаточной для старого рендера.

Важно:

V5 stable ID не должен потеряться в read model.

Даже если renderer пока его не использует, entity identity пригодится Selection следующей фазы.

Предпочтительно включить:

```text
id
```

в read representation.

Legacy entities могут получать временную identity из existing ordering только внутри legacy adapter либо использовать deterministic-compatible identifiers.

Не менять legacy selection на этой фазе.

---

# 18. Player preview

Существующий local:

```text
previewAsPlayer
```

должен вести себя ровно как до 2D.

Не заменять его V5 `projectMapDocumentForPlayer`.

Это отдельное поведение.

Renderer decoupling не является security-refactor.

---

# 19. Grid остаётся отдельно

Не затягивать:

```text
MapGridConfig
```

в `MapRenderModel`, если renderer сейчас получает map/grid отдельно.

Существующий `renderMap` уже получает map/grid geometry.

Минимальный diff предпочтительнее.

---

# 20. renderMap signature

Изменить `renderMap` так, чтобы вместо конкретного:

```text
MapCells
```

он принимал:

```text
MapRenderModel
```

или эквивалентный read-only интерфейс.

Остальные аргументы менять только при необходимости.

---

# 21. renderMap implementation

Внутри renderer заменить прямые знания:

```text
cells.terrain
cells.roads
cells.rivers
cells.labels
...
```

на read-model API.

Не менять:

* цвета;
* stroke widths;
* thresholds;
* order;
* culling;
* glyphs;
* font sizes;
* overlay order;
* player preview;
* grid;
* coords;
* DPR.

---

# 22. Render order

Сохранить текущий фактический порядок:

```text
terrain
river
road
rooms
doors
traps
markers
start
finish
labels
grid/overlays согласно текущему renderer
```

Не использовать эту фазу для нового layer renderer.

`layers[]` V5 пока не управляют production rendering order.

---

# 23. MapViewport

`MapViewport` должен по-прежнему получать текущий `cells` prop от страницы, если это минимальный diff.

Допустимый вариант:

```text
Viewport
  cells
    ↓
createLegacyRenderModel(cells)
    ↓
renderMap
```

или adapter создаётся выше.

Выбрать место с наименьшим количеством перестроений.

---

# 24. Adapter identity / React

Не создавать новый unstable model object так, чтобы `renderMap` начинал вызываться чаще только из-за adapter identity.

Если adapter создаётся внутри React component:

```text
useMemo
```

по `cells` допустим.

Но не вводить memoization architecture шире необходимого.

---

# 25. Shadow comparison — read model

Расширить Core/read-model tests, но не обязательно production Shadow Audit.

Нужно доказать:

```text
Legacy MapCells
      ↓
LegacyRenderModel

Legacy MapCells
      ↓
migrate
      ↓
V5RenderModel
```

дают **семантически одинаковый read model** для legacy subset.

---

# 26. Новый comparator

Можно создать:

```ts
compareRenderModels(a, b)
```

только для тестов.

Либо сравнивать конкретные reads.

Не нужно добавлять второй production audit, если это создаёт лишний runtime cost.

---

# 27. Read-model equivalence

Для одной legacy fixture проверить:

```text
legacy model terrainAt
===
V5 model terrainAt
```

для всех клеток.

То же:

```text
roads
rivers
labels
rooms
doors
traps
markers
start
finish
```

---

# 28. Особое внимание world positions

V5 хранит world positions, legacy renderer исторически знает cell coordinates.

Проверить:

* square labels;
* hex labels;
* doors;
* traps;
* markers;
* start;
* finish.

Нельзя допустить двойного применения `cellCenter`.

---

# 29. Room geometry

Legacy room:

```text
cell rect
```

V5 room:

```text
ShapeGeometry
```

Текущий renderer поддерживает только migrated:

```text
rect
```

Если V5 содержит polygon/ellipse room:

```text
unsupported-render-feature
```

на этой фазе.

Не пытаться approximate polygon в legacy cells.

---

# 30. Door geometry

V5 door уже хранит world:

```text
position
orientation
```

Текущий renderer исторически использует:

```text
cell
edge
```

Это важная граница.

Предпочтительно минимально научить renderer/read model рисовать дверь по:

```text
world position
orientation
```

если это можно сделать визуально 1:1.

Это уменьшит legacy coupling.

Но:

если diff становится большим — оставить legacy-shaped render representation внутри read model.

Главный критерий — visual parity.

---

# 31. Не делать обратную геометрическую реконструкцию без причины

Плохой вариант:

```text
V5 world door
→ угадываем x/y/edge
→ старый renderer
```

если renderer можно безопасно научить работать с world geometry.

Это породит ненужную зависимость V5 от grid snapping.

---

# 32. Visual parity tests

Существующие renderer tests должны остаться зелёными.

Добавить adapter-level tests.

Если инфраструктура позволяет без brittle pixel tests:

```text
render legacy model
render migrated V5 model
```

с одинаковым mocked Canvas context и сравнить последовательность значимых draw calls.

Не обязательно делать snapshot каждого пикселя.

---

# 33. Минимальный visual regression set

Проверить:

* plain + forest terrain;
* river + crossing road;
* room;
* ordinary door;
* secret door;
* trap;
* marker;
* start/finish;
* label;
* square;
* hex;
* player preview.

---

# 34. Existing export

Проверить все места использования `renderMap`.

Особенно:

```text
MapViewport
PNG export
thumbnail generation
map list previews
```

Все они должны получить legacy render adapter либо общий helper.

Не оставить один call-site со старой signature.

---

# 35. Thumbnail parity

Autosave thumbnail generation должна визуально и функционально остаться прежней.

Не менять thumbnail timing/throttle.

Только источник read data для renderer.

---

# 36. PNG export parity

PNG export должен продолжить работать без изменений UX.

Не менять resolution/export settings.

---

# 37. Mini-map

Если mini-map использует отдельный render helper или непосредственно MapCells:

* не мигрировать её на V5;
* но если она вызывает `renderMap`, провести через тот же legacy read adapter.

Не расширять scope.

---

# 38. Production V5 adapter не подключать

Очень важно:

После 2D production flow всё ещё:

```text
MapCells
→ LegacyRenderModel
→ renderer
```

а НЕ:

```text
MapCells
→ migrate V5
→ V5RenderModel
→ renderer
```

Shadow migration не должна внезапно стать renderer dependency.

---

# 39. V5 adapter используется только тестами

На 2D `createV5RenderModel` может использоваться:

* unit tests;
* equivalence tests;
* development experiments без UI.

Не подключать к рабочему viewport.

---

# 40. Error handling Legacy adapter

Для валидного `MapCells` adapter не должен fail.

Он может предполагать уже распарсенный legacy state.

Не добавлять ещё один validator legacy.

---

# 41. V5 adapter validation

`createV5RenderModel` может предполагать valid V5, если public contract это ясно документирует.

Либо вернуть structured diagnostics для unsupported features.

Не дублировать весь `validateMapDocument`.

---

# 42. Capability result

Рекомендуемый результат V5 adapter:

```ts
interface V5RenderModelResult {
  model: MapRenderModel;
  diagnostics: RenderModelDiagnostic[];
}
```

Где diagnostics отражают только unsupported rendering.

Не validation errors.

---

# 43. Unknown V5 layers

Так как `MapLayer` сейчас closed union, unknown kinds не должны доходить после parser/validator.

Adapter не обязан поддерживать future unknown kinds.

---

# 44. Mask terrain

При наличии `TerrainMaskLayer`:

на этой фазе НЕ реализовывать.

Вернуть diagnostic:

```text
unsupported-terrain-mask
```

В зависимости от выбранной модели:

* renderer получает default terrain;
* либо terrain layer пропускается.

Поведение должно быть явно определено и протестировано.

---

# 45. Spline paths

Аналогично:

```text
unsupported-spline-path
```

Не rasterize spline в cells.

---

# 46. Objects

V5 ObjectLayer с непустыми items:

```text
unsupported-object-layer
```

Не пытаться рисовать builtin objects сейчас.

---

# 47. Scatter

V5 ScatterLayer с непустыми areas:

```text
unsupported-scatter-layer
```

Не генерировать scatter.

---

# 48. Diagnostics deterministic

Diagnostics должны:

* иметь stable codes;
* не зависеть от случайного порядка;
* не содержать giant payload.

Это пригодится следующим фазам.

---

# 49. Tests Legacy adapter

Минимум:

```text
terrain lookup
plain fallback
road lookup
river lookup
labels
rooms
doors
traps
markers
start
finish
```

---

# 50. Tests V5 adapter

На migrated fixtures:

```text
full square
full hex
roads+rivers
door pairs
labels/gameplay
```

ожидается:

```text
0 unsupported diagnostics
```

потому что migration создаёт только legacy-compatible subset.

---

# 51. Unsupported tests

Создать валидные V5:

* mask terrain;
* spline path;
* object;
* scatter;
* polygon room.

Убедиться, что adapter:

* не падает;
* выдаёт правильный diagnostic;
* не corrupt model.

---

# 52. Adapter equivalence

Ключевой тест:

```text
fixture legacy
    │
    ├→ createLegacyRenderModel
    │
    └→ migrateLegacyMap
          ↓
       createV5RenderModel

compare
→ equivalent
```

Для square и hex.

---

# 53. No mutation

Оба adapters не мутируют:

```text
MapCells
MapDocumentV5
```

Проверить тестами.

---

# 54. Build/tests

После перехода production renderer на LegacyRenderModel:

* все editor tests;
* Core tests;
* renderer tests;
* PNG/export tests;
* server map tests;
* build;
* lint.

Предсуществующие failures не чинить в рамках 2D.

---

# 55. Manual smoke

Пройти минимум:

1. открыть square карту;
2. открыть hex карту;
3. кисть;
4. дорога/река;
5. комнаты/двери;
6. labels;
7. Player Preview;
8. PNG export;
9. reload/autosave;
10. проверить thumbnails/minimap.

Ожидается полное отсутствие визуальной разницы.

---

# 56. Stop conditions

Остановиться, если:

1. `MapRenderModel` начинает повторять весь `MapDocumentV5`;
2. renderer всё равно требует прямой `MapCells`;
3. V5 adapter требует V5 → MapCells conversion;
4. visual parity дверей требует угадывать потерянные данные;
5. migrated V5 не может выразить данные текущего renderer;
6. необходимо менять Tools/Selection;
7. необходимо менять persistence;
8. PNG/thumbnail требуют отдельную несовместимую модель;
9. adapter создаёт заметную performance regression;
10. приходится менять rendering semantics.

---

# 57. Критерии завершения

PASS:

```text
renderMap больше не типизирован на MapCells

существует read-only MapRenderModel

существует Legacy → RenderModel adapter

существует V5 → RenderModel adapter

production renderer использует Legacy adapter

V5 adapter не подключён к editor state

legacy visual semantics сохранены

square parity подтверждена

hex parity подтверждена

PNG export сохранён

thumbnail rendering сохранён

Player Preview сохранён

Tools/Selection/History не изменены

Autosave/persistence не изменены

нет V5 → MapCells

нет dual mutable state
```

---

# 58. Архитектура после 2D

```text
                EDITING

               MapCells
                  │
      ┌───────────┼────────────┐
      │           │            │
     Tools     Selection    History
      │
      └───────────┬────────────┘
                  │
                  ▼
               MapCells
                  │
                  ▼
        LegacyRenderModel
                  │
                  ▼
              renderMap


             SHADOW / CORE

               MapCells
                  │
                  ▼
          MapDocumentV5
                  │
                  ▼
           V5RenderModel
                  │
                  ▼
       equivalence tests only
```

Renderer теперь не знает, откуда пришла карта.

---

# 59. Отчёт

После завершения остановиться и сообщить:

1. созданные/изменённые файлы;
2. точный `MapRenderModel` API;
3. Legacy adapter API;
4. V5 adapter API;
5. unsupported diagnostics;
6. что изменилось в `renderMap`;
7. все call-sites `renderMap`;
8. как сохранён render order;
9. как решены labels/world positions;
10. как решены doors/world geometry;
11. square parity;
12. hex parity;
13. PNG parity;
14. thumbnail parity;
15. tests;
16. build/lint/regression;
17. performance before/after, если измеримо;
18. production state ownership;
19. встретились ли stop conditions;
20. готовность следующей фазы.

К V5 editor state автоматически не переходить.
