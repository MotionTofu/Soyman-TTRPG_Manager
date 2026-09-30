Checkpoint принимаю. Блокеров для Tool Controller нет.

Следующий этап — вынести tool logic из `MapEditorPage`.

Главное архитектурное решение:

**НЕ делать один огромный класс/хук `ToolController`, который знает вообще всё.**

Сделай фасад `useMapTools`, который собирает несколько тематических групп и наружу отдаёт практически тот же объект `tools`, который сейчас получает `useMapInput`.

Концептуально:

```ts
const tools = useMapTools(...)

useMapInput({
  ...
  tools
})
```

А внутри желательно разделить ответственность примерно на:

```text
Paint
Wall
Shape
Ruler
Label
Objects
```

Это могут быть отдельные hooks/modules или несколько крупных модулей — выбери минимальную структуру, которая реально соответствует текущему коду.

Не надо создавать отдельный файл на каждую кнопку.

## Главная цель

Убрать из `MapEditorPage` реализацию инструментов:

```text
paintAt
singleAction
altPick
placeObject

wall tap/hover/finish
shape tap/drag/apply
ruler tap/hover
label tool routing
object placement routing
```

и связанные с ними чистые операции, если им естественнее жить рядом с инструментами.

После этапа `MapEditorPage` должна в основном:

```text
хранить editor/UI state
подключать hooks
передавать зависимости
рендерить интерфейс
```

а не знать, как именно кисть меняет `MapCells`.

## Поведение 1:1

Это всё ещё Фаза 1.

Не менять:

```text
MapCells
cells v1–v4
History semantics
Selection semantics
Input semantics
Terrain model
Road/River model
UI
горячие клавиши
модалки
```

Не добавлять новые инструменты.

Не исправлять существующие quirks.

## Paint group

Перенеси туда:

```text
paintAt
singleAction
altPick
```

и существующие чистые операции:

```text
paintStroke
floodFill
```

если это улучшает локальность кода.

Сохранить:

```text
brush
eraser
road
river
wall-as-paint
fill
picker
Alt-pick
```

и существующую работу:

```text
cellsRef
setCells
history
terrain
brushSize
tool
```

### Важное исключение: eraseOverrideRef

Не делай зависимость:

```text
useMapTools
   ↓
useMapInput.eraseOverrideRef
```

потому что Input одновременно зависит от Tools.

Получится архитектурный цикл.

Вместо этого инвертируй только эту маленькую зависимость.

Input уже знает, активен ли temporary RMB eraser, поэтому при вызове paint передавай это как параметр.

Концептуально:

```ts
paintAt(position, {
  eraseOverride: eraseOverrideRef.current
})
```

или эквивалентную минимальную сигнатуру.

Это допустимое изменение внутреннего API, потому что semantics не меняется.

Добавь тест, который фиксирует:

```text
selected tool = brush
+
RMB override = true
→ фактически выполняется erase
→ selected tool остаётся brush
```

Не используй эту возможность для очистки остальных сигнатур.

## Wall group

Перенеси всю доменную wall-логику:

```text
quantizeVertex
tapVertex
hoverLive
finishWallLine
```

и всё, что определяет результат стены.

Сохранить:

```text
wallDraft
wallLive
wallLineMode
wall snap
Enter finish
double-click finish
toolbar finish
```

Один законченный wall-line по-прежнему должен давать один history step.

UI-кнопки и hotkey остаются снаружи и вызывают API Wall Tool.

Если `wallDraft/wallLive/wallLineMode` сейчас удобнее пока оставить state'ом страницы — допустимо.

Но сама логика обработки не должна оставаться в `MapEditorPage`.

Не переносить состояние только ради LOC.

## Shape group

Перенеси:

```text
shape tap
shape drag
applyShapeRect
```

и правила:

```text
terrain rect
road rect
river rect
wall rect
eraser rect
room rect
```

### Room modal

Tool Controller не должен становиться владельцем UI-модалки комнаты.

Если `applyShapeRect` сейчас напрямую пишет `roomRectRef`, лучше дать Shape Tool callback уровня:

```ts
onRequestRoomCreate(rect)
```

который страница связывает с существующим draft/modal state.

То есть:

```text
Shape Tool
→ сообщает "нужно создать room для rect"
→ UI открывает существующую модалку
```

Не переносить draft формы комнаты внутрь инструмента.

Это вторая допустимая точечная инверсия зависимости.

## Ruler

Перенеси tool-specific обработку:

```text
tap
hover
measure orchestration
```

`rulerMeasure`, если остаётся чистой функцией, может жить рядом.

Состояние `ruler`, если его всё ещё непосредственно использует renderer/UI, пока можно оставить странице и передать controller'у пару value/setter.

Не надо насильно делать Tool Controller владельцем всего state.

## Label

Tool должен отвечать за:

```text
клик по клетке
определение существующей label
запрос открытия редактора label
```

Но сама modal/draft UI остаётся снаружи.

Предпочтительный контракт:

```text
Label Tool
→ onRequestLabelEdit(...)
```

Save/delete существующей modal формы пока можно оставить UI-контроллеру, если перенос потребует смешать UI draft и tool semantics.

Не пытайся на этом этапе переделать весь lifecycle модалки.

## Objects

Перенеси placement-routing:

```text
door
trap
chest
altar
marker
start
finish
```

и существующий `placeObject`.

Selection уже отвечает за move/delete существующих объектов.

Tool Controller отвечает именно за создание/placement.

Если создание требует UI draft/modal, инструмент должен вызвать callback:

```text
onRequestCreate(...)
```

а не становиться владельцем формы.

Не объединять сейчас `MapDoor/MapTrap/MapMarker/...` в универсальный Entity.

Это Фаза 2.

## Граница с Input

Цель — чтобы после этапа `useMapInput` продолжал получать примерно:

```ts
tools: {
  paint,
  ruler,
  wall,
  shape,
  label,
  objects
}
```

То есть его state machine и маршрутизация почти не меняются.

Если инструмент можно вынести без изменения Input API — предпочтительно именно так.

Кроме описанных точечных зависимостей:

```text
eraseOverride
room/create UI callbacks
```

не используй этот этап для redesign `useMapInput`.

## State и refs

Проведи аудит:

```text
toolRef
terrainRef
brushSizeRef
wallDraftRef
wallLiveRef
wallLineModeRef
shapeAnchorRef
```

После переноса каждый из них должен оказаться в одной из категорий:

```text
нужен Tool Controller
нужен UI
нужен одновременно обоим
больше не нужен
```

Удаляй только реально ставшие ненужными refs.

Не делай второй mirror того же state.

Особенно не трогай:

```text
cellsRef
camRef
selectedRef
```

без необходимости.

## History

Tool Controller не должен становиться владельцем History.

Он получает API существующего `useMapHistory`.

Сохранить границы пользовательских действий:

```text
continuous paint stroke → history закрывает Input
fill → 1 step
Alt-remove overlay → 1 step
object placement → 1 step
wall finish → 1 step
shape apply → 1 step
```

Не создавать дополнительный push внутри tool, если Input уже закрывает stroke.

## UI drafts / modals

Не переносить в Tool Controller:

```text
room draft forms
door edit form
trap edit form
marker edit form
settings modal
PNG modal
generator modal
```

Tool Controller может запросить открытие UI callback'ом.

Domain operation и UI draft пока не обязаны быть полностью развязаны — это отдельная работа.

## Tests

Добавь unit-тесты именно на tool semantics.

Особенно важно покрыть:

```text
brush mutation
eraser mutation
road/river mutation
fill
picker
Alt-pick overlay removal
RMB effective eraser
wall finish = один результат
shape apply каждого существующего content type
room shape → request UI, а не прямое создание
object placement основных типов
hex/square ограничения, где они существуют
```

Не дублируй полностью Input-тесты.

Input тестирует маршрутизацию.

Tools должны тестировать результат операции.

## useMapInput после этапа

Проверь, что:

```text
Input
```

не начал знать больше о MapCells, чем сейчас.

Желательно наоборот: его `tools` dependency должна стать стабильнее.

Не надо пока превращать его в generic event framework.

## Предпочтительная структура

Это ориентир, не жёсткое требование:

```text
client/src/maps/editor/
  editorTypes.ts

  hooks/
    useMapCamera.ts
    useMapHistory.ts
    useMapHotkeys.ts
    useMapAutosave.ts
    useMapSelection.ts
    useMapInput.ts
    useMapTools.ts

  tools/
    paintTools.ts
    wallTools.ts
    shapeTools.ts
    rulerTools.ts
    labelTools.ts
    objectTools.ts
```

Если часть файлов получается искусственной по 20 строк — объединяй.

Например `ruler + label` вполне могут жить вместе, если так естественнее текущему коду.

## Стоп-условие

Если для выноса какого-либо инструмента оказывается необходимо изменить:

```text
history boundary
pointer semantics
selection semantics
MapCells schema
modal UX
```

остановись и опиши конкретную зависимость.

Не расширяй scope.

## После выполнения

Отчёт нужен в следующем формате:

1. build/tests относительно baseline;
2. созданные/изменённые файлы;
3. структура `useMapTools` и подмодулей;
4. публичный API `useMapTools`;
5. новый контракт `tools`, который получает `useMapInput`;
6. как устранён цикл вокруг `eraseOverrideRef`;
7. как Shape/Label/Object tools общаются с UI-модалками;
8. какие tool refs исчезли и какие остались;
9. где теперь находятся `paintAt`, `singleAction`, `altPick`, `placeObject`, `finishWallLine`, `applyShapeRect`;
10. подтверждение всех history boundaries;
11. новые tool-тесты;
12. новый LOC `MapEditorPage.tsx`;
13. какие tool-related реализации всё ещё остались в странице и почему.

После Tool Controller дальше автоматически не переходи.
