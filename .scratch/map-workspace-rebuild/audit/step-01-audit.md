# Шаг 1 — аудит карт и границы нового редактора
Дата: 2026-09-30
Execution: completed
Область: чтение рабочей копии, проверки на временных данных, архитектурные решения. Production-исходники и рабочая БД не изменены.

[План](../plan.md) · [ADR-0004](../../../docs/adr/0004-map-workspace-v6-tokens.md)

## Результат
Новый редактор не требует выбрасывать ядро V5. Сохраняем чистую модель, миграцию, операции, историю и алгоритм данжа; новый UI и расширение документа вводим отдельно. Для связанных токенов выбираем MapDocumentV6 и soyman-map/3. До первой записи V6 обязателен барьер совместимости на сервере и в загрузчике. Следующая продуктовая работа — точный статический макет, тикет 11.

## 1. Карта зависимостей
```text
AppShell (обычная навигация / PreviewDock пульта; SearchPanel справа)
  → MapEditorPage (~монолитная композиция, инструменты, генератор, обмен)
    → loadStoredEditorDocument
      → legacy parse → migrateLegacyMap → shared V5 kernel
      → V5 parse → validate → canonicalize
      → assessCurrentEditorCompatibility → renderer diagnostics
    → history / camera / selection / input / tool mutations
    → MapDocumentV5 → createV5RenderModel → ordered layers → renderMap
    → useMapAutosave → PUT /maps/:id {document}
      → shared kernel из dist → validateV5DocumentBody → maps.cells JSON
    → mapExport / thumbnails / PlayerMapStage
      → server player-view → projectMapDocumentForPlayer

SearchPanel / BagWidget → SEARCH_DRAG_MIME {type,id,...}
  → будущий серверный resolver → GameplayToken.sourceRef {kind,uid}
  → токен в gameplay layer → общий путь истории/сохранения/рендера

map_bindings — отдельные отношения карты целиком
LocationMap + location pins — отдельный существующий редактор изображения локации
```

## 2. Что реально реализовано
| Область | Наблюдение и источник |
|---|---|
| Общий документ | [shared types](../../../shared/src/maps/core/types.ts): v=5, world.bounds, nullable grid, exploration, шесть типов слоёв; токенов сущностей нет |
| Shared kernel | [client facade](../../../client/src/maps/core/types.ts) ссылается на shared/src; сервер импортирует @soyman/shared из dist. Перед серверными тестами shared собран |
| Загрузка | [loadDocument](../../../client/src/maps/editor/loadDocument.ts): legacy мигрируется в памяти; V5 валидируется напрямую; загрузка не пишет в БД |
| Редактор | [MapEditorPage](../../../client/src/pages/MapEditorPage.tsx) уже держит V5 и отправляет document, вопреки устаревшему комментарию сервера «production этот путь не вызывает» |
| Сохранение | [autosave](../../../client/src/maps/editor/hooks/useMapAutosave.ts): debounce 800 ms, последовательная отправка в пределах одной страницы, dirty/error/retry, блокировка; thumbnail throttling 2.5 s |
| БД/API | [maps routes](../../../server/src/routes/maps.ts), [validation](../../../server/src/routes/mapsValidation.ts): canonical JSON в maps.cells; request document не смешивается с cells/grid/width/height |
| Геометрия | V5 допускает grid=null и world coordinates. Persistence отвергает grid=null, допускает стороны 8..100. Старый UI дополнительно требует origin=(0,0), cellSize=1 |
| Слои/рендер | [renderModel](../../../client/src/maps/renderModel.ts), [render](../../../client/src/maps/render.ts): ordered layers, visibility/lock/opacity; masks на square, spline road/river и изображения объектов уже имеются |
| Неподдерживаемое | [compatibility](../../../client/src/maps/core/compatibility.ts): scatter, некоторые геометрии/материалы/маски и прочие renderer diagnostics запрещают редактирование даже скрытых слоёв |
| Генератор | [dungeon](../../../client/src/maps/dungeon.ts) возвращает MapCells; MapEditorPage уже мигрирует его в V5, валидирует и кладёт применение одним шагом истории. Адаптер уже есть в странице, его нужно выделить |
| Картинки | [registry](../../../client/src/maps/assets/registry.ts): локальные resource UID, авторизованная загрузка; базовый набор символов только tree/tower/camp. Это ещё не библиотека художественных стен, полов и токенов |
| Показ игрокам | [projection](../../../shared/src/maps/core/playerProjection.ts): режет ловушки/секреты и exploration; [PlayerMapStage](../../../client/src/components/presentation/PlayerMapStage.tsx) берёт серверный player-view даже для мастера |
| Экспорт | [mapExport](../../../client/src/maps/mapExport.ts): master/player PNG через общую read model; [exchangeV2](../../../client/src/maps/core/exchangeV2.ts): soyman-map/2, импорт в текущую карту требует совпадения сетки/размеров |
| Мешок/поиск | [SearchPanel](../../../client/src/layout/SearchPanel.tsx), [BagWidget](../../../client/src/components/BagWidget.tsx), [bag store](../../../client/src/bag.ts): общий drag payload, мешок в localStorage, payload не авторитетные данные сущности |
| Имена/identity | [entityNames](../../../server/src/services/entityNames.ts): preferShort и пакетный resolver; [entityKinds](../../../server/src/db/entityKinds.ts): being/location; [uidOf](../../../server/src/services/mentions.ts): постоянный UUID источника |
| Другие карты | [LocationMap](../../../client/src/components/LocationMap.tsx): image pins и общие previews; полезный пример взаимодействия, не второй источник истины новых карт |

## 3. Проверка защиты от перезаписи
Наблюдения воспроизведены [read-only probe](compatibility-probe.mjs), [результат](compatibility-probe.log). Script загружает исходный client loader через Vite без HTTP-сервера, DB и браузера.
- Валидный поддерживаемый V5: сохраняет исходный слой, corrupt=false, compatible=true.
- Валидный неподдерживаемый V5 без grid: corrupt=false, compatible=false, причина grid-missing. Это нормальный отдельный unsupported-путь; autosave.disabled остаётся true.
- v=6: shared detector сообщает legacy; client считает corrupt=true и показывает совместимый пустой V5 fallback.
- Новый gameplay kind=token внутри v=5: strict validator отвергает его; client также показывает corrupt fallback.
- Неизвестное top-level поле V5 принимается, но canonicalization его удаляет.

В MapEditorPage corrupt fallback имеет «Понял, разрешаю перезапись». В случае будущей версии/нового kind нет separate unsupported причины: после ручного разрешения fallback можно записать. Автосохранение исходно блокируется; фактическая перезапись при аудите не выполнялась.

Отдельное последствие по чтению кода: сервер тоже определяет v=6 как legacy. Старый stripCellsForPlayer фильтрует старые top-level rooms/doors/traps, а не новые layers. Поэтому неизвестную версию нельзя отдавать через старый player-view/assets путь. Это вывод из исходников; HTTP с V6 на рабочей БД не запускался.

Вывод: сейчас нельзя обещать, что любой будущий формат безопасно открывается старым UI. Барьер новой версии — prerequisite тикета 03, а не задача визуального оформления.

## 4. Дополнительные ограничения
- gridless — изменение не только UI: maps.grid сейчас NOT NULL CHECK square/hex. Перед включением gridless нужно изменить метаданные/API и геометрию viewport/export/player stage.
- camera fit и несколько потребителей рендера используют grid/width/height; основой нового контракта становятся world.bounds.
- Внутри одной страницы autosave последовательный; блокировки версии записи между окнами/клиентами нет. Требуется optimistic revision на новых документах.
- beforeunload защищает закрытие окна, но сам по себе не гарантирует сохранение при внутреннем уходе из workspace.
- Promise.all загрузки карты + каталога и отказ prepareMapImageAssets могут заблокировать весь редактор из-за картинки. Missing asset должен стать локальным fallback, а не corruption/потерей остальных данных.
- generic layer.visible не считается разрешением публикации игрокам: для токенов вводится отдельное правило.
- БД map_bindings уже допускает scene, и story-код использует его, а публичный maps bindings CRUD перечисляет только setting/campaign/location. Не сужать существующий набор отношений при замене.
- Локальные токены не становятся спутниками сущности: владелец размещения — карта. Удаление сущности не должно каскадно удалять токены или весь слой.
- Художественный renderer не измерялся на пользовательских сценах. Тесты подтверждают корректность текущего подмножества, не качество картинки концепта.

## 5. Сверка с прежними фазами
| Документ | Фактическое состояние |
|---|---|
| ADR-0003 / TZ_2B | V5 kernel и legacy migration есть; status draft ADR не описывает степень реализации |
| TZ_2C | Shadow/equivalence модули и тесты есть; не брать shadow state как canonical |
| TZ_2D | Read model и decoupled renderer есть |
| TZ_2E | Immutable mutations и stable-ID selection есть |
| TZ_2G | Production state/save реально переключены на V5 |
| TZ_3A | Layer stack и LayerPanel присутствуют; порядок и свойства участвуют в рендере/selection |

Это сверка конкретных частей, а не заявление о прохождении каждой строки старых ТЗ. Новой работой не откатываем существующие изменения масок, spline width/handles/branching, exploration и слоёв.

## 6. Переиспользование
| Решение | Части |
|---|---|
| Сохранить | Shared invariants/refs/serialize, deterministic migration, immutable mutations, stable IDs, history, grid math, generator algorithm, search/bag/data layer/previews, map_bindings и scene показ |
| Сохранить с расширением | Dispatch/parser/kernel V6; player projection/resolver; autosave revision/flush; camera world bounds; selection/token hit-test; read model, export и assets fallback |
| Заново собрать | Workspace shell contract, layout, tool rail, contextual panels, generator dialog, entity placement UI |
| Отложить | Выбор нового renderer по измерениям, полноценный scatter, пакеты художественных ассетов, gridless persistence/инструменты |

## 7. Решения первого шага
Подробности — ADR-0004.
1. Map workspace в одном AppShell, GM-only editing, поиск/мешок сохранены.
2. MapDocumentV6 / soyman-map/3; существующие v1–v5 читаются, конвертируются в памяти без записи при открытии.
3. Typed GameplayToken в gameplay layer; sourceRef использует kind+uid, numeric id остаётся адресом существующего API/drag.
4. Capability gate и version-aware unsupported loader идут до первой записи V6; opaque bytes не заменяются fallback.
5. Server-authoritative player presentation без исходных refs/приватных полей, с фильтрацией exploration.
6. Переносимый экспорт по умолчанию отсоединяет sourceRef; явный relink разрешён только по проверенному UID.
7. Canvas2D и фиксированная сетка остаются начальной базой; world coordinates обязательны, gridless включается после отдельной migration/geometry работы.
8. История ephemeral; сохранение имеет revision conflict и явный flush/ошибку при уходе.

## 8. Проверки
| Проверка | Результат |
|---|---|
| Shared build | PASS |
| Shared map tests | 2 файла, 9 тестов PASS |
| Client maps + MapEditorPage | 44 файла, 459 тестов PASS |
| Server maps validation/API/V5 | 3 файла, 52 теста PASS, временные БД/хранилища |
| Compatibility probe | Воспроизведены пять наблюдений, см. выше |
| Всего | 49 файлов, 520 тестов PASS |

[Client log](client-tests.log), [server log](server-tests.log), [shared log](shared-tests.log), [build log](shared-build.log).
В логах Vitest/Vite есть предупреждение о будущем native config loader; это не провал текущих проверок. Намеренный stderr отрицательного shadow-теста не означает failed test.

Не выполнялись: ручной запуск приложения, аудит содержимого реальной БД, полная сборка клиента/сервера, измерение рендера и проверка пиксельного совпадения. Новые guarantees V6 ещё не реализованы; PASS относится к текущему коду.

## 9. Передача в шаг 2
Тикет 11 разблокирован для точного макета. Макет должен показать: постоянные поиск/мешок, rail, token private/public состояние, orphan/missing image fallback, unsupported-version экран, save/conflict/уход, новый/заменяемый данж и доступное размещение без drag.
До шага 3 (реализации модели) нельзя записывать V6; до макета не начинаем новый production UI.

