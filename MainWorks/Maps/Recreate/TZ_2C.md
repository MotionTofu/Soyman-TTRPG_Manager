# Техническое задание

## Фаза 2C — Shadow Integration + Semantic Equivalence Audit

## 1. Исходное состояние

Фазы 1, 2A и 2B завершены и закоммичены.

Существующий редактор продолжает работать на:

```text
MapCells
cells v1–v4
soyman-map/1
```

Отдельно существует протестированный новый Core:

```text
MapDocumentV5

validateMapDocument
parseMapDocument
serializeMapDocument
migrateLegacyMap
projectMapDocumentForPlayer
soyman-map/2
```

На Фазе 2C `MapDocumentV5` **НЕ становится editor state**.

---

# 2. Главная цель

Подключить новый Map Core к реальному процессу загрузки существующих карт в режиме **shadow audit**.

При открытии валидной legacy-карты должно происходить:

```text
legacy blob
    ↓
parseCellsBlob
    ↓
MapCells ──────────────────→ существующий редактор
    │                           работает как раньше
    │
    └→ migrateLegacyMap
            ↓
       MapDocumentV5
            ↓
         validate
            ↓
 semantic equivalence audit
            ↓
      diagnostics only
```

Shadow-ветка:

* не является источником истины;
* не изменяет карту;
* не сохраняется;
* не участвует в render;
* не участвует в autosave;
* не участвует в History;
* не влияет на UX.

---

# 3. Главный принцип

На протяжении всей Фазы 2C:

```text
MapCells = единственный mutable editor state
```

А:

```text
MapDocumentV5 = одноразовый derived snapshot для аудита
```

Нельзя создавать параллельные изменяемые состояния:

```text
setCells(...)
setDocument(...)
```

и пытаться синхронизировать их.

---

# 4. Запрещено

На Фазе 2C НЕ:

* переводить Tools на V5;
* переводить Selection на V5;
* переводить renderer на V5;
* менять Autosave;
* сохранять V5 в database;
* менять API;
* менять SQLite;
* менять `MapCells`;
* менять legacy serialization;
* менять `soyman-map/1`;
* добавлять V5 → MapCells adapter;
* делать двустороннюю синхронизацию;
* добавлять пользователю переключатель V5;
* показывать новые панели/баннеры;
* менять import UI;
* мигрировать существующие записи.

---

# 5. Разрешённое production-изменение

Впервые разрешено минимально изменить существующий load-flow редактора.

Точка интеграции должна быть одна:

```text
успешная загрузка legacy карты
→ успешно получен MapCells
→ shadow audit
```

Shadow audit не должен размазываться по Tools/Input/Autosave.

---

# 6. Не аудировать corrupt fallback

Существующий редактор умеет при повреждённом blob показать fallback/пустую карту и блокировать autosave.

Shadow V5 migration нельзя запускать на таком fallback как будто это настоящая карта.

Правило:

```text
legacy blob status = valid
→ audit

legacy blob status = corrupt
→ audit skipped
```

Иначе пустой fallback может дать ложный `PASS`.

---

# 7. Новый модуль

Рекомендуется создать:

```text
client/src/maps/core/shadowAudit.ts
```

или:

```text
client/src/maps/core/auditLegacy.ts
```

Он должен оставаться чистым и не зависеть от React.

Основной API концептуально:

```ts
runLegacyShadowAudit(input): LegacyShadowAuditResult
```

---

# 8. Input аудита

Передавать только необходимые данные.

Например:

```ts
interface LegacyShadowAuditInput {
  grid: "square" | "hex";
  width: number;
  height: number;
  cells: MapCells;
}
```

Если migration API требует ещё metadata — добавить только действительно необходимые поля.

Не передавать весь `MapEditorPage`.

Не передавать React state setters.

---

# 9. Result model

Результат должен быть структурированным.

Рекомендуется:

```ts
type ShadowAuditStatus =
  | "pass"
  | "warning"
  | "fail";

interface LegacyShadowAuditResult {
  status: ShadowAuditStatus;

  migrationWarnings: LegacyMigrationWarning[];
  validationIssues: ValidationIssue[];
  equivalenceIssues: SemanticEquivalenceIssue[];

  stats: ShadowAuditStats;
}
```

Допустимо добавить:

```ts
durationMs
```

для диагностики производительности.

---

# 10. Семантика статусов

## PASS

```text
migration completed
+
V5 valid
+
semantic equivalence = exact
+
migration warnings = 0
```

## WARNING

```text
migration completed
+
V5 valid
+
semantic equivalence = exact
+
есть migration warnings
```

Например legacy pair-group нестандартного размера.

## FAIL

Любое:

```text
migration threw
V5 validation failed
semantic mismatch detected
```

---

# 11. Shadow audit никогда не блокирует карту

Даже:

```text
status = FAIL
```

не должен мешать legacy editor открыть карту.

То есть:

```text
V5 audit failed
    ↓
diagnostics
    ↓
legacy editor всё равно работает
```

Это фундаментальный смысл shadow integration.

---

# 12. Semantic equivalence checker

Создать отдельную чистую функцию уровня:

```ts
compareLegacySemantics(
  legacy,
  document
): SemanticEquivalenceIssue[]
```

Она должна сравнивать содержимое legacy MapCells и V5 напрямую.

---

# 13. Критически важно: не сделать tautological test

Comparator НЕ должен вычислять expected result вызовом:

```text
migrateLegacyMap(...)
```

и потом сравнивать migration с самой собой.

Он должен независимо читать:

```text
legacy MapCells
```

и:

```text
MapDocumentV5
```

и проверять семантику.

Допустимо переиспользовать общую математическую базу:

```text
grid.ts
cellCenter
cellCorners
```

Но не migration-specific mapping helpers, если это превращает проверку в самопроверку того же алгоритма.

---

# 14. Что сравнивать — Grid

Проверить:

```text
legacy grid type
↔ V5 grid.type

legacy width
↔ V5 columns

legacy height
↔ V5 rows

cellSize = 1
origin = 0,0
```

Square world bounds:

```text
[0,width] × [0,height]
```

Hex:

сверить bounds с существующей grid geometry.

---

# 15. Что сравнивать — Layer skeleton

Для legacy migration проверить точный набор и порядок:

```text
terrain
river
road
objects
scatter
gameplay
labels
```

Проверить:

* фиксированные IDs;
* kind;
* name;
* visible;
* locked;
* opacity.

Object/Scatter layers могут быть пустыми — это нормально.

---

# 16. Terrain equivalence

Legacy:

```text
terrain Map<string,code>
absence = plain
```

V5:

```text
TerrainCellLayer
defaultMaterial = plain
cells[]
```

Проверить:

1. `defaultMaterial` = builtin plain;
2. каждая legacy non-plain клетка существует в V5;
3. material соответствует тому же terrain code;
4. никакой дополнительной non-plain клетки нет;
5. `plain` не обязан быть материализован entry;
6. координаты совпадают.

Сравнение делать по смыслу, а не по array index.

---

# 17. Roads equivalence

Legacy:

```text
roads Set<"x,y">
```

V5:

```text
road PathLayer
cell-network
```

Проверить:

* если roads пуст — V5 не содержит лишних road cells;
* если не пуст — существует ожидаемый road path;
* cell set совпадает 1:1;
* kind = road;
* geometry = cell-network;
* builtin style корректный;
* width = legacy migration default.

Порядок cells при semantic compare несущественен.

---

# 18. Rivers equivalence

То же самое для:

```text
rivers
```

с обязательной проверкой:

```text
kind = river
```

и правильного builtin style.

---

# 19. Labels equivalence

Для каждой legacy label:

```text
x
y
text
```

проверить V5:

```text
id = deterministic legacy-label-N
text equal
position = cellCenter(...)
```

Особенно не предполагать:

```text
x + 0.5
y + 0.5
```

для hex.

---

# 20. Rooms equivalence

Legacy:

```text
x
y
w
h
type
name
```

V5 GameplayRoom:

```text
geometry rect
roomType
name
deterministic ID
```

Проверить всё поле-в-поле.

Порядок rooms внутри gameplay должен соответствовать legacy order.

---

# 21. Doors equivalence

Для каждой legacy door проверить:

```text
ID
position
orientation
doorKind
secret
```

Позиция должна соответствовать midpoint legacy edge согласно grid semantics migration.

---

# 22. Door pair equivalence

Comparator должен НЕ использовать migration pair-result как expected.

Независимо построить:

```text
legacy pair token
→ legacy door indexes[]
```

и применить принятую ADR semantics:

```text
1
→ unpaired

2
→ pair

>2
→ sequential pairs
→ possible unpaired remainder
```

Затем сравнить `pairedDoorId`.

Migration warning сам по себе НЕ semantic mismatch, если V5 соответствует принятому правилу.

---

# 23. Traps equivalence

Проверить:

```text
legacy kind
↔ trapKind

legacy cell center
↔ world position

legacy array index
↔ deterministic ID
```

---

# 24. Markers equivalence

Проверить:

```text
markerKind
position
deterministic ID
```

для всех существующих marker kinds.

---

# 25. Start / Finish

Если legacy:

```text
null
```

V5 entity должна отсутствовать.

Если существует:

* ID фиксирован;
* position = `cellCenter`;
* kind корректен.

---

# 26. Gameplay ordering

Проверить canonical migrated order:

```text
rooms
doors
traps
markers
start
finish
```

Это не просто semantic count — порядок влияет на render semantics.

---

# 27. Extra entities

Audit обязан ловить не только пропажу legacy данных, но и лишние данные V5.

Например:

```text
legacy markers = 3
V5 markers = 4
```

→ FAIL.

То же:

```text
лишняя terrain cell
лишний path
лишняя gameplay entity
лишняя label
```

---

# 28. Semantic issue model

Issue должен быть диагностируемым.

Например:

```ts
interface SemanticEquivalenceIssue {
  code: string;
  path: string;
  message: string;

  expected?: JsonValue;
  actual?: JsonValue;
}
```

Примеры code:

```text
terrain-missing
terrain-extra
terrain-material-mismatch

road-cell-missing
river-cell-extra

label-position-mismatch

door-position-mismatch
door-pair-mismatch

gameplay-order-mismatch
unexpected-entity
```

---

# 29. Audit pipeline

`runLegacyShadowAudit` должен выполнять:

```text
1. migrateLegacyMap
2. validateMapDocument
3. compareLegacySemantics
4. collect warnings
5. return status
```

Если migration неожиданно throws:

```text
catch
→ FAIL result
```

Никакое исключение shadow branch не должно дойти до editor load-flow.

---

# 30. Validation после migration

Даже если `migrateLegacyMap` типизирован как возвращающий V5, audit обязан прогнать:

```text
validateMapDocument
```

Это проверяет runtime invariants реального результата.

Не считать TypeScript доказательством валидности runtime-document.

---

# 31. Не хранить shadow document в React state

После аудита V5 snapshot должен быть доступен только внутри вызова.

Не делать:

```ts
const [shadowDocument, setShadowDocument] = ...
```

Не делать:

```text
documentRef
```

для будущего использования.

Цель — проверка, не создание второго состояния.

После завершения функции документ может быть освобождён GC.

---

# 32. Reporting

В development environment:

### PASS

Допустимо:

```text
console.debug
```

с компактной строкой:

```text
[Map V5 shadow] map 123 PASS
```

Не логировать огромный документ.

### WARNING

```text
console.warn
```

с migration warnings.

### FAIL

```text
console.error
```

со структурированными:

```text
validationIssues
equivalenceIssues
```

---

# 33. Production UX

Пользователю:

```text
никаких баннеров
никаких toast
никаких новых статусов
никаких блокировок
```

Shadow audit — инженерная диагностика.

Не добавлять новый UI.

---

# 34. Production logging

Не вводить telemetry, analytics или серверный logging в рамках 2C.

Если `console` reporting уже принято для development:

```text
import.meta.env.DEV
```

достаточно.

Audit itself может выполняться всегда либо только в development — решение принять минимальным diff.

### Предпочтительный вариант

Запускать audit при каждой валидной загрузке и сохранять результат только локально в вызове; подробный reporting делать только в DEV.

Если измерения покажут заметную задержку открытия карты — остановиться и сообщить.

Не оптимизировать заранее.

---

# 35. Stats

Добавить компактную статистику для диагностики:

```ts
interface ShadowAuditStats {
  terrainCells: number;
  roadCells: number;
  riverCells: number;

  labels: number;
  rooms: number;
  doors: number;
  traps: number;
  markers: number;

  hasStart: boolean;
  hasFinish: boolean;
}
```

Можно иметь:

```text
legacy
v5
```

counts отдельно, если это полезнее.

---

# 36. Performance timing

Допустимо замерять:

```text
migrationMs
validationMs
equivalenceMs
totalMs
```

через простой timer.

Это diagnostic data.

Не устанавливать искусственный pass/fail threshold без реальных измерений.

---

# 37. Integration point

Найти существующее место:

```text
API map loaded
→ parseCellsBlob
→ valid MapCells obtained
```

Сразу после успешного parse или после формирования всех migration inputs вызвать audit.

Важно:

audit не должен:

```text
setCells
setMap
history.clear
autosave.markLoaded
```

Audit должен быть независим от порядка этих side effects.

---

# 38. Не менять load semantics

Существующий порядок:

```text
load
parse
set state
history reset
autosave etalon
corrupt protection
camera
```

не менять ради Shadow Audit.

Вставить аудит в безопасную точку как side branch.

Если для этого надо переставлять существующие эффекты — STOP.

---

# 39. Map switch

При переходе:

```text
map A → map B
```

каждая валидная загрузка должна дать независимый audit.

Не хранить результат A как state B.

---

# 40. React StrictMode / повторный effect

Если load-effect может выполняться дважды в development, Shadow audit может повториться.

Это не должно менять приложение.

Если console сильно шумит, разрешено дедуплицировать reporting по:

```text
map id + serialized legacy snapshot/hash
```

Но не вводить сложный cache без необходимости.

Повторный audit безопасен, потому что он pure.

---

# 41. Импорт пока не подключать

Не менять flow:

```text
JSON import
```

даже если импортируемая legacy карта тоже хороший кандидат для audit.

На Фазе 2C scope:

```text
persisted map load
```

Import integration оставить позже.

---

# 42. Autosave не трогать

Shadow branch никогда не должна делать V5 serialization частью dirty key.

Сейчас dirty остаётся:

```text
legacy serializeCells
+
legacy params
```

без изменений.

---

# 43. History не трогать

Audit:

```text
history.push = 0
```

во всех случаях.

---

# 44. Renderer не трогать

Canvas получает:

```text
MapCells
```

как раньше.

Не использовать shadow document для даже экспериментального render.

---

# 45. Core strictness

Если:

```text
migration succeeded
but validate failed
```

это `FAIL`.

Не «починять» документ внутри Shadow Audit.

Не canonicalize invalid document так, чтобы проблема исчезла.

---

# 46. Semantic checker не заменяет validator

Разделить ответственности:

### Validator

Проверяет:

```text
валиден ли V5 сам по себе
```

### Equivalence checker

Проверяет:

```text
представляет ли этот V5 конкретную legacy карту
```

Не смешивать эти два класса ошибок.

---

# 47. Tests — pure audit

Создать:

```text
shadowAudit.test.ts
```

Минимально проверить:

1. full square legacy → PASS;
2. full hex legacy → PASS;
3. empty map → PASS;
4. valid migration с dangling pair warning → WARNING;
5. > 2 pair group → WARNING;
6. migration result invalid → FAIL;
7. semantic mismatch → FAIL;
8. migration exception → FAIL без throw наружу.

---

# 48. Comparator mutation tests

Очень полезно взять валидный V5 после migration и искусственно испортить по одному полю.

Comparator должен поймать минимум:

```text
удалили terrain cell
добавили terrain cell
сменили terrain material

удалили road cell
добавили river cell

сдвинули label

сменили room type

сдвинули door
сломали door pair

сменили trap kind

добавили marker

удалили start
добавили лишний finish
```

Это докажет, что checker реально независим от migration.

---

# 49. Layer/order tests

Проверить, что audit ловит:

```text
river/road layers переставлены
label/gameplay layers переставлены
gameplay items переставлены между semantic groups
```

если порядок является частью migration contract.

---

# 50. Hex audit tests

Отдельно проверить:

```text
hex label center
hex trap center
hex marker center
hex start/finish center
hex world bounds
```

Comparator не должен использовать square assumption.

---

# 51. No-side-effects test

Для audit function:

```text
legacy input before
legacy input after
```

должны быть deep-equal.

То же:

```text
MapCells Maps/Sets/arrays
```

не должны мутировать.

---

# 52. Integration test

Добавить тест или максимально близкий к существующей инфраструктуре тест, подтверждающий:

```text
successful legacy map load
→ shadow audit called
→ MapCells passed into editor unchanged
```

И:

```text
corrupt load
→ audit NOT called
```

Не нужно поднимать настоящий браузер, если load orchestration можно проверить unit-level.

---

# 53. Не завязывать tests на console

Core correctness tests должны проверять:

```text
LegacyShadowAuditResult
```

а не то, был ли `console.warn`.

Console reporting тестировать максимум отдельным лёгким тестом либо не тестировать.

---

# 54. Диагностический helper

Допустимо создать:

```ts
formatShadowAuditSummary(result)
```

для console.

Он не должен включать всю карту.

Пример:

```text
Map V5 shadow PASS
terrain=172
roads=24
rivers=9
entities=18
3.7ms
```

---

# 55. Ручной smoke

После интеграции открыть реальные:

```text
square world map
hex region map
dungeon map
map with roads+rivers
map with paired doors
```

В DEV console ожидается:

```text
PASS
```

или понятный `WARNING` для действительно нестандартных pair groups.

Ни одного FAIL нельзя просто проигнорировать перед завершением Фазы 2C.

---

# 56. Если настоящий map даёт FAIL

Не исправлять автоматически migration или legacy data.

Сначала зафиксировать:

```text
legacy summary
audit issue
expected
actual
```

и определить:

```text
bug migration
bug comparator
реальная legacy anomaly
ошибка ADR
```

Если это фундаментальная ошибка ADR — STOP.

---

# 57. Нельзя «подгонять checker»

Если Shadow Audit нашёл несоответствие, запрещено просто ослабить comparator, чтобы получить зелёный результат.

Любое исключение из equivalence rules должно иметь объяснение:

```text
какая legacy semantics не переносится
почему
какое решение принято
```

---

# 58. Stop conditions

Остановиться и сообщить до продолжения, если:

1. реальная валидная карта не мигрируется;
2. migration даёт invalid V5;
3. semantic equivalence требует V5 → MapCells;
4. comparator невозможно сделать независимо от migration;
5. load-flow приходится перестраивать;
6. Shadow Audit меняет autosave/history/state;
7. audit заметно тормозит открытие обычной карты;
8. hex production data расходится с grid semantics;
9. обнаружено новое значение legacy kind, которого нет в ADR/Core;
10. выявлено фундаментальное несоответствие модели V5 реальным данным.

---

# 59. Production files

Ожидается небольшой diff.

Разрешено:

```text
maps/core/shadowAudit.ts
maps/core/semanticEquivalence.ts
tests
```

и минимальная интеграция в существующий load path.

Если для Фазы 2C приходится менять много editor-модулей — это сигнал неправильной границы.

---

# 60. Что НЕ считается целью

Не требуется:

```text
сохранить migrated V5
отрендерить migrated V5
редактировать migrated V5
экспортировать его через UI
показать V5 пользователю
```

---

# 61. Критерии завершения

Фаза считается завершённой, если:

```text
PASS — persisted valid legacy load запускает Shadow Audit

PASS — corrupt fallback audit не запускает

PASS — MapCells остаётся editor source of truth

PASS — V5 нигде не становится mutable editor state

PASS — audit не влияет на autosave

PASS — audit не влияет на history

PASS — audit не влияет на render

PASS — migration result проходит validator

PASS — semantic comparator независим от migration

PASS — square maps проходят equivalence

PASS — hex maps проходят equivalence

PASS — terrain equivalence проверяется

PASS — roads/rivers equivalence проверяется

PASS — labels equivalence проверяется

PASS — gameplay equivalence проверяется

PASS — door pairs проверяются

PASS — extra/missing entities обнаруживаются

PASS — warnings отделены от failures

PASS — реальный editor UX не изменён
```

---

# 62. Итоговая архитектура после 2C

```text
                     LOAD
                      │
                      ▼
               legacy cells blob
                      │
                      ▼
               parseCellsBlob
                      │
            ┌─────────┴─────────┐
            │                   │
            ▼                   ▼
        MapCells          migrateLegacyMap
            │                   │
            │                   ▼
            │            MapDocumentV5
            │                   │
            │           ┌───────┴───────┐
            │           ▼               ▼
            │        validate       equivalence
            │           │               │
            │           └───────┬───────┘
            │                   ▼
            │             diagnostics
            │
            ▼
      EXISTING EDITOR
       unchanged
```

Не существует стрелки:

```text
MapDocumentV5 → editor
```

пока.

---

# 63. Отчёт после выполнения

После 2C не переходить к V5 editor integration.

Отчитаться:

## 1. Файлы

Что создано и какой старый production-файл изменён.

## 2. Integration point

Где именно audit вызывается при load.

## 3. Audit API

Сигнатура и result model.

## 4. Status semantics

PASS / WARNING / FAIL.

## 5. Equivalence rules

Что именно сравнивается.

## 6. Independence

Как гарантировано, что checker не повторяет migration algorithm.

## 7. Square

Результаты тестов.

## 8. Hex

Результаты тестов.

## 9. Door pairs

Результаты.

## 10. Corrupt map

Как audit пропускается.

## 11. Side effects

Подтвердить:

```text
0 setCells
0 history
0 autosave
0 V5 persistence
```

из shadow branch.

## 12. Performance

Замеры хотя бы нескольких тестовых/реальных карт.

## 13. Tests

Количество и группы новых тестов.

## 14. Existing regression

```text
build
client tests
server map tests
lint
```

## 15. Реальные карты

Какие реальные карты вручную открывались и какой статус дали.

## 16. FAIL/WARNING

Если встретились — список причин.

## 17. Production behavior

Подтверждение отсутствия пользовательских изменений.

## 18. Следующий шаг

Только оценка готовности к переходу editor state на V5.

Не реализовывать его.
