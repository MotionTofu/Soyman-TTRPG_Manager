# Техническое задание

## Фаза 1 — Декомпозиция текущего редактора карт без изменения поведения

### 1. Цель фазы

Разделить текущий монолитный `MapEditorPage.tsx` на более независимые модули, **не изменяя пользовательское поведение редактора и не меняя формат карты**.

Главная задача фазы — подготовить кодовую базу к последующему развитию редактора: слоям, свободным объектам, ассетам, новым terrain-системам, scatter, paths и procedural presets.

После завершения этой фазы редактор должен работать визуально и функционально так же, как до рефакторинга.

---

# 2. Что сейчас считается исходным состоянием

Основной контроллер редактора находится в:

```text
client/src/pages/MapEditorPage.tsx
```

Он содержит:

* UI редактора;
* локальный state карты;
* камеру;
* обработку мыши;
* обработку тач-ввода;
* zoom/pan;
* инструменты;
* selection;
* drag объектов;
* painting;
* history;
* undo/redo;
* autosave;
* hotkeys;
* генераторы;
* import/export;
* player preview;
* minimap;
* модальные окна;
* связь с API.

Существующая модель карты:

```ts
MapCells
```

остаётся неизменной на протяжении всей Фазы 1.

Существующий формат сериализации `cells v1–v4` также не меняется.

---

# 3. Основной принцип

На этой фазе запрещается менять архитектуру данных карты.

То есть НЕ нужно:

* добавлять `MapDocument`;
* менять `MapCells`;
* добавлять Layers;
* добавлять Asset System;
* добавлять свободные координаты объектов;
* переписывать renderer;
* менять систему terrain;
* переписывать roads/rivers;
* менять формат сохранения;
* менять поведение инструментов;
* менять UI.

Фаза посвящена только **разделению ответственности существующего кода**.

---

# 4. Требуемый результат

В конце Фазы 1 `MapEditorPage.tsx` должен превратиться из монолитного контроллера в композиционный компонент.

Целевая схема:

```text
MapEditorPage
│
├── editor state
│
├── camera
│
├── history
│
├── autosave
│
├── input
│
├── tool controller
│
├── selection
│
├── viewport
│
└── panels / modals
```

Сам `MapEditorPage` должен преимущественно:

* собирать зависимости;
* подключать hooks;
* передавать состояние в дочерние компоненты;
* отображать UI.

---

# 5. Предлагаемая структура файлов

Допускаются небольшие изменения в структуре, если они обоснованы, но рекомендуется следующий вариант:

```text
client/src/maps/editor/
│
├── hooks/
│   ├── useMapCamera.ts
│   ├── useMapHistory.ts
│   ├── useMapAutosave.ts
│   ├── useMapInput.ts
│   ├── useMapHotkeys.ts
│   └── useMapSelection.ts
│
├── tools/
│   ├── types.ts
│   ├── brushTool.ts
│   ├── fillTool.ts
│   ├── eraserTool.ts
│   ├── roadTool.ts
│   ├── riverTool.ts
│   ├── wallTool.ts
│   ├── shapeTool.ts
│   ├── selectTool.ts
│   ├── objectTools.ts
│   └── index.ts
│
├── components/
│   ├── MapViewport.tsx
│   ├── MapToolbar.tsx
│   ├── MapPanels.tsx
│   └── MapModals.tsx
│
├── editorTypes.ts
└── editorUtils.ts
```

Не обязательно переносить всё сразу в максимально мелкие файлы.

Лучше предпочесть **крупные понятные модули**, чем 50 файлов по 20 строк.

---

# 6. Этап 1 — вынести управление камерой

Создать:

```text
useMapCamera.ts
```

В него перенести всю логику, связанную с:

```ts
cam = {
  scale,
  ox,
  oy
}
```

В hook должны войти:

* zoom;
* zoom к позиции курсора;
* zoom к центру;
* pan;
* fit map;
* восстановление камеры из `localStorage`;
* сохранение камеры в `localStorage`;
* ограничения scale;
* screen → world;
* world → screen.

Существующая математика должна остаться неизменной.

Нельзя менять:

```text
scale 4..240
```

и существующее поведение wheel zoom / fit / pan.

Ожидаемый интерфейс примерно:

```ts
const camera = useMapCamera({
  mapWidth,
  mapHeight,
  grid,
  viewportSize,
});
```

Результат:

```ts
camera.cam

camera.panBy(...)
camera.zoomAt(...)
camera.zoomIn()
camera.zoomOut()
camera.fit()
camera.toWorld(...)
camera.toScreen(...)
```

Допускается другой API, если он чище.

---

# 7. Этап 2 — вынести history

Создать:

```text
useMapHistory.ts
```

Существующий механизм history должен быть сохранён:

```text
pastRef
futureRef
UNDO_DEPTH = 50
```

На этой фазе НЕ переписывать snapshot-based history на command pattern.

Hook должен отвечать за:

* `pushHistory`;
* `undo`;
* `redo`;
* `canUndo`;
* `canRedo`;
* очистку history;
* clone snapshots;
* обработку stroke history.

Желательно получить API:

```ts
const history = useMapHistory<MapCells>({
  value: cells,
  onChange: setCells,
  clone: cloneCells,
  depth: 50,
});
```

Например:

```ts
history.push(before);
history.undo();
history.redo();
history.clear();
```

Поведение мазка:

```text
pointer down
→ snapshot before
→ несколько изменений
→ pointer up
→ один history step
```

должно полностью сохраниться.

---

# 8. Этап 3 — вынести Autosave

Создать:

```text
useMapAutosave.ts
```

Перенести туда:

* debounce 800 ms;
* сравнение нормализованного serialized state;
* `seq`-защиту от гонок PUT;
* работу с thumbnail throttling;
* dirty state;
* error state;
* retry;
* `beforeunload`;
* блокировку autosave после загрузки corrupt blob.

Существующее поведение считается контрактом и не должно изменяться.

Пример интерфейса:

```ts
const autosave = useMapAutosave({
  mapId,
  cells,
  mapMeta,
  serializeCells,
  buildThumbnail,
});
```

Возвращаемое состояние:

```ts
autosave.status
autosave.error
autosave.retry()
autosave.isDirty
```

Сетевая логика карты не должна оставаться разбросанной по `MapEditorPage`.

---

# 9. Этап 4 — вынести selection

Создать:

```text
useMapSelection.ts
```

Сохраняется текущая модель selection:

```ts
ObjSel
```

и текущие сущности:

* door;
* trap;
* marker;
* room;
* start;
* finish.

Не добавлять multi-select.

Hook должен отвечать за:

* selected object;
* hit testing coordination;
* begin drag;
* drag state;
* move;
* end drag;
* delete selected;
* clear selection.

Сам hit-test можно оставить в существующем модуле либо вынести отдельно.

Важно сохранить существующий порядок hit test:

```text
door
→ trap
→ marker
→ start/finish
→ room
```

и текущее drag-поведение.

---

# 10. Этап 5 — создать единый Tool Controller

Сейчас поведение инструментов распределено внутри `MapEditorPage`.

Необходимо выделить понятие:

```ts
MapToolController
```

На этой фазе не требуется создавать универсальную plugin-систему.

Достаточно отделить логику инструментов от React-компонента.

Существующие инструменты:

```text
brush
fill
eraser
picker
road
river
wall
shape
ruler
label
select
door
trap
chest
altar
marker
start
finish
```

должны сохраниться без изменения.

---

# 11. Tool API

Рекомендуется определить контекст инструмента:

```ts
interface MapToolContext {
  map: MapFull;
  cells: MapCells;

  setCells(next: MapCells): void;

  grid: MapGrid;

  brushSize: 1 | 2 | 3;

  pushHistory(snapshot: MapCells): void;

  requestRender(): void;
}
```

Инструменты могут иметь callbacks:

```ts
interface MapTool {
  onPointerDown?()
  onPointerMove?()
  onPointerUp?()
  onClick?()
  onCancel?()
}
```

Не обязательно реализовывать все инструменты как полноценные классы.

Функциональный подход предпочтителен.

---

# 12. Не переусложнять Tool System

Цель — не сделать mini-Unity.

На Фазе 1 достаточно добиться, чтобы:

```text
MapEditorPage
```

не содержал огромные ветки:

```ts
if (tool === "brush") ...
else if (tool === "road") ...
else if (...)
```

По возможности они должны быть перенесены в:

```text
tools/*
```

или controller.

---

# 13. Этап 6 — вынести pointer/input orchestration

Создать:

```text
useMapInput.ts
```

Hook отвечает за:

* pointer down;
* pointer move;
* pointer up;
* pointer cancel;
* wheel;
* touch;
* middle mouse;
* Space + drag;
* RMB eraser override;
* pointer capture;
* rAF coalescing мазков.

Сам hook не должен знать детали того, как рисуется forest или ставится trap.

Он должен определять:

```text
это pan
это active tool
это erase override
это selection drag
```

и передавать событие соответствующей подсистеме.

Существующий rAF batching для paint move обязательно сохранить.

---

# 14. Этап 7 — вынести hotkeys

Создать:

```text
useMapHotkeys.ts
```

Перенести туда:

* V;
* B;
* E;
* I;
* G;
* R;
* N;
* W;
* U;
* M;
* T;
* D;
* L;
* C;
* A;
* K;
* S;
* F;
* Delete;
* Escape;
* Enter;
* Ctrl+Z;
* Ctrl+Shift+Z;
* Ctrl+Y;
* +/-;
* 0.

Поведение в input/textarea/contentEditable должно остаться прежним.

---

# 15. Этап 8 — выделить MapViewport

Создать:

```text
MapViewport.tsx
```

Его ответственность:

* содержать `<canvas>`;
* управлять размером canvas;
* DPR;
* передавать canvas context renderer'у;
* связывать pointer/input hooks с canvas;
* отображать только viewport-related UI.

`MapViewport` не должен содержать:

* autosave;
* API;
* import/export;
* генератор;
* модалки.

---

# 16. Renderer пока не переписывать

Существующий:

```text
client/src/maps/render.ts
```

и функция:

```ts
renderMap(...)
```

должны остаться основным renderer'ом.

Допускается изменить сигнатуру вызова ради удобства, но визуальный результат должен совпадать.

Не внедрять:

* retained scene graph;
* WebGL;
* multiple canvas layers;
* asset rendering;
* new terrain rendering.

---

# 17. Этап 9 — разделить UI-панели

Самые крупные визуальные блоки желательно вынести из страницы.

Минимум:

```text
MapToolbar
MapPanels
MapModals
```

Не обязательно делать отдельный компонент для каждой кнопки.

Цель:

`MapEditorPage.tsx` должен читаться сверху вниз как композиция редактора, а не как вся программа.

Пример:

```tsx
return (
  <MapEditorLayout>
    <MapToolbar ... />

    <MapViewport ... />

    <MapPanels ... />

    <MapModals ... />
  </MapEditorLayout>
);
```

---

# 18. Этап 10 — генераторы

Существующие генераторы уже находятся в отдельных модулях:

```text
generate.ts
dungeon.ts
```

Их алгоритмы не менять.

Но управление ими из UI желательно вынести в отдельный hook или controller:

```text
useMapGenerators.ts
```

или небольшой helper.

Он отвечает за:

* подтверждение замены карты;
* формирование params;
* вызов генератора;
* один history step;
* применение результата.

---

# 19. Импорт / экспорт

Логику:

```text
mapExchange.ts
mapExport.ts
```

не менять.

Из `MapEditorPage` желательно вынести только orchestration:

```text
useMapImportExport
```

или handlers-файл.

На этой фазе формат:

```text
soyman-map/1
```

остаётся неизменным.

---

# 20. Состояние редактора

После рефакторинга следует чётко разделить минимум три категории state.

## Map state

```text
map
cells
```

## Editor state

```text
tool
brushSize
selected
wallDraft
ruler
hover
shapePreview
```

## View state

```text
camera
showGrid
showCoords
playerPreview
```

Эти категории пока не обязаны находиться в разных stores.

Использование Zustand/Redux в рамках этой фазы НЕ является обязательным.

Если существующий React state нормально работает, новый глобальный store добавлять не нужно.

---

# 21. Использование refs

Существующий `cellsRef` используется для императивных canvas handlers.

Его можно сохранить.

Но после рефакторинга должен быть понятный контракт:

```text
React state = authoritative UI state
refs = latest snapshot for event handlers
```

Не создавать несколько конкурирующих источников истины.

---

# 22. Что должно исчезнуть из MapEditorPage

К завершению фазы непосредственно внутри страницы не должно оставаться больших реализаций:

* zoom math;
* pan math;
* undo/redo;
* autosave sequencing;
* pointer state machine;
* hit testing implementation;
* paint implementation;
* flood fill implementation;
* keyboard router;
* drag implementation.

Страница может вызывать эти вещи.

Но не должна их реализовывать.

---

# 23. Что допускается оставить в MapEditorPage

Допустимо оставить:

* загрузку `MapFull`;
* крупную композицию редактора;
* выбор текущего инструмента;
* открытие/закрытие панелей;
* маршрутизацию;
* top-level ошибки;
* orchestration между несколькими подсистемами.

---

# 24. Требование по поведению

После каждой крупной части рефакторинга необходимо проверить существующее поведение.

### Camera

Проверить:

* wheel zoom;
* zoom к курсору;
* +/-;
* 0;
* pan middle mouse;
* Space + LMB;
* touch pan;
* pinch;
* сохранение camera position.

### Painting

Проверить:

* terrain brush;
* brush sizes 1/2/3;
* square;
* hex;
* RMB erase;
* Alt picker;
* fill;
* road;
* river;
* wall brush;
* wall polyline.

### Shapes

Проверить:

* terrain rectangle;
* road rectangle;
* river rectangle;
* wall rectangle;
* eraser rectangle;
* room rectangle.

### Objects

Проверить:

* doors;
* secret doors;
* door pairs;
* traps;
* markers;
* rooms;
* start;
* finish;
* dragging;
* deleting.

### History

Проверить:

* stroke = один undo;
* object creation;
* object move;
* shape;
* generator;
* import;
* redo.

### Saving

Проверить:

* autosave;
* dirty detection;
* race protection;
* retry;
* reload;
* corrupt map protection.

---

# 25. Regression checklist

Перед завершением фазы вручную проверить минимум следующие сценарии.

### Scenario A — world map

Создать square map.

Нарисовать:

```text
forest
mountain
river
road
labels
markers
```

Сохранить.

Перезагрузить.

Проверить совпадение.

---

### Scenario B — dungeon

Создать square dungeon.

Использовать:

```text
walls
rooms
doors
traps
start
finish
```

Undo/redo.

Перезагрузить.

---

### Scenario C — hex

Создать hex map.

Проверить:

```text
paint
fill
road
river
brush radius
picker
camera
```

---

### Scenario D — player view

Создать:

```text
secret door
trapped door
trap
room type
```

Сравнить GM и Player preview.

Player view должен остаться идентичным старому.

---

### Scenario E — import/export

Экспортировать карту в JSON.

Импортировать обратно.

Сравнить.

---

# 26. Тесты

Если существующие тесты есть — они должны продолжить проходить.

Дополнительно желательно покрыть unit-тестами вынесенные чистые части:

```text
camera transforms
history
tool routing
selection helpers
autosave state decisions
```

Особенно важны тесты для функций без DOM.

Не обязательно в рамках этой фазы писать сложные browser/e2e тесты, если инфраструктуры для них сейчас нет.

---

# 27. Запреты в рамках Фазы 1

Не выполнять параллельно:

```text
Terrain Materials
Auto Transitions
Asset Packs
Scatter
Splines
Layers v2
MapDocument v5
new renderer
WebGL
multi-select
object rotation
object scaling
```

Даже если во время рефакторинга становится очевидно, как это добавить.

Создать TODO или техническую заметку, но не включать функциональность в эту фазу.

---

# 28. Правило маленьких миграций

Работу выполнять небольшими законченными шагами.

Рекомендуемый порядок:

```text
1. Camera
2. History
3. Hotkeys
4. Autosave
5. Selection
6. Input
7. Tool logic
8. Viewport
9. UI panels/modals
10. cleanup
```

После каждого шага редактор должен собираться и быть работоспособным.

Не делать один огромный commit с полным переписыванием страницы.

---

# 29. Критерии готовности

Фаза считается завершённой, если выполняются все условия:

1. Поведение редактора не изменилось.

2. Формат `MapCells` не изменён.

3. Формат `cells v1–v4` не изменён.

4. API карт не изменён.

5. Старые сохранённые карты открываются без миграции.

6. `renderMap` визуально выдаёт тот же результат.

7. Undo/redo работают как раньше.

8. Autosave работает как раньше.

9. Все существующие инструменты работают.

10. `MapEditorPage.tsx` больше не содержит основную реализацию camera/history/input/autosave/tool logic.

11. Каждая вынесенная подсистема имеет понятный публичный API.

12. Код готов к следующей фазе — проектированию нового `MapDocument`.

---

# 30. Ожидаемый итог

После выполнения Фазы 1 архитектура должна выглядеть примерно так:

```text
MapEditorPage
│
├── useMapCamera
├── useMapHistory
├── useMapAutosave
├── useMapSelection
├── useMapInput
├── useMapHotkeys
│
├── ToolController
│   ├── Terrain tools
│   ├── Overlay tools
│   ├── Object tools
│   └── Utility tools
│
├── MapViewport
│       │
│       └── renderMap
│
├── MapToolbar
├── MapPanels
└── MapModals
```

При этом под капотом всё ещё используется существующая модель:

```text
MapFull
+
MapCells
+
cells blob v1–v4
```

То есть Фаза 1 не создаёт новый картодел.

Она делает существующий редактор достаточно модульным, чтобы следующая фаза — переход на новый Map Core — не требовала одновременно переписывать весь UI, ввод, камеру, историю и сетевую логику.
