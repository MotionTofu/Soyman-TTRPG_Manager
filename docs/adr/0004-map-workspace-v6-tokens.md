# ADR-0004: рабочее пространство карт, V6 и связанные токены
Дата: 2026-09-30
Статус: принято; оболочка, V6 kernel, version gate, refs validation, record revision, базовый V6 UI и размещение связанных токенов реализованы 2026-09-30. Публичная проекция ещё не подключена.
Область: новые карты и новый редактор внутри общего клиента SoyMan.
Основание: [аудит рабочей копии](../../.scratch/map-workspace-rebuild/audit/step-01-audit.md), запрос пользователя о замене редактора.

## Контекст и изменение ADR-0003
ADR-0003 задал V5, шесть типов слоёв и gameplay union без токенов сущностей. Текущий код уже использует V5 в production, допускает masks, spline handles/widths/branching и exploration.
Это решение дополняет архитектуру ADR-0003 и меняет исходный перечень GameplayEntity и версию документа для нового редактора. Принципы чистого shared kernel, stable IDs, layers, world coordinates и разделения canonical/derived/editor-only сохраняются.
Неизвестное поле V5 может потеряться при canonicalization, неизвестный gameplay kind превращает load в corrupt fallback. v=6 сейчас ошибочно маршрутизируется в legacy. Добавлять новую сущность без отдельной version boundary нельзя.

## 1. Рабочее пространство
AppShell получает явный режим standard / session-live / map-workspace. Map routes библиотеки и редактора используют map-workspace; обычная навигация заменяется инструментальным rail, правая панель — компактным представлением существующих поиска и мешка.
Переиспользуются общие auth/data/sound/bag/previews. Модуль не становится вторым приложением, Electron window или вторым React-клиентом.
Route определяет workspace при прямом открытии и Back/Forward. Свойства, слои и ассеты открываются на холсте; поиску и мешку не подменяют назначение.
Editing только для GM; игрок получает общий просмотр/server presentation, не инструменты автора.
Точный статический макет предшествует сборке UI.
Обычный GM-клик по карте в библиотеке, создание и быстрый черновик открывают `/maps/:id/workspace`. Классический `/maps/:id` временно доступен отдельной обозначенной ссылкой для генератора и показа прежних карт до переноса этих функций. После записи V6 ссылка на классическое редактирование исчезает; игрок сохраняет свой маршрут просмотра. Это изменение входа сделано 2026-09-30 после сообщения пользователя о неработающем переносе; полное удаление прежней UI-обвязки остаётся в тикете 10.

## 2. Документ и физическое хранение
Новый canonical документ: MapDocumentV6, v=6. Top-level сохраняет world, grid, exploration, assetPacks и layers. Все существующие поддержанные поля V5, включая widths/handles/branchFrom и mask payload, переносятся lossless. Шесть существующих видов слоёв сохраняются; token добавляется в gameplay union.
Формат обмена: soyman-map/3 с V6 document и record metadata; import читает /1, /2, /3. Явного автоматического downgrade с потерей токенов/геометрии нет.
Для начала остаётся одна canonical JSON-колонка maps.cells, имя историческое. Не хранить параллельно V5 и V6 как два редактируемых документа.
Локальные ID карты, map_bindings, parent_map_id, player_visible и остальные record metadata сохраняются. Камера, selection, история, состояния панелей и drag не попадают в документ.

Чтение legacy v1–v4 → существующая детерминированная миграция в V5 → lossless V5-to-V6 upgrade. Чтение V5 → upgrade in memory. Открытие не пишет в БД. Первый явный edit и успешный save нового editor записывают V6 с проверкой revision.
Существующий V5 UI может продолжать редактировать старые v1–v5 записи, пока они не преобразованы; новый сервер обязан отклонять его запросы на V6.
Неизвестная версия хранится как opaque raw bytes и ошибка unsupported-version, без canonicalization через другую версию.

## 3. Совместимость до первой записи V6
Это prerequisite реализации tokens, а не пожелание к релизу.
- Общий detector различает legacy v1–v4, V5, V6, unsupported-version и corrupt; любые v>6 не считаются legacy.
- Client loader отдельно возвращает supported, unsupported и corrupt. Для unsupported нет allowOverwrite, редактирования или autosave. Master может скачать оригинал; fallback не становится saving baseline.
- Сервер обрабатывает версии до strip/projection/assets/thumbnail. Неизвестный документ не проходит в legacy player flow.
- Ввести объявление клиента о максимальной поддерживаемой версии на чтение и запись (контракт заголовка: X-Soyman-Map-Max-Version). Отсутствующий заголовок означает старый клиент, максимум V5. Это совместимость, не авторизация.
- При текущем V6 и capability<6 сервер возвращает 409 с code=map-version-unsupported и requiredVersion=6; документ, thumbnail и asset URLs не включаются.
- Для V6 запрещено принимать legacy cells, clearCells, grid resize или body.document старой версии; несовместимый запрос ничего не меняет.
- Барьер распространяется на full map, player-view, assets, raw exchange и изменения через старый UI; список может вернуть безопасные record metadata и флаг несовместимости без содержания.
- Новый player stage объявляет capability=6. Старый stage не может получить непроецированный V6.
- Сервер, shared dist и клиент развёртываются согласованно; сначала reader/gate, затем разрешение V6 save.
- Откат старого бинарного сервера на БД с V6 не поддерживается: нужно заранее сохранённое состояние БД либо backend, умеющий V6. Свежие V6 изменения сохраняются отдельным экспортом перед восстановлением snapshot. Нельзя обещать возврат старого UI на V6 без потерь.

Header name и error code — контракт этого ADR; конкретный транспорт переносится через существующий API client. Поддельный header не даёт прав на карту.

## 4. Токен и источник
Токен принадлежит карте; сущность-источник существует независимо. Повторный drop создаёт новый UUID токена. Удаление токена не удаляет source, удаление source не каскадно удаляет размещение.
Typed GameplayToken:
```ts
interface GameplayToken {
  id: EntityId;
  kind: "token";
  position: Vec2;
  size: number; // diameter in world units, finite and > 0
  rotation: number;
  sourceRef: { kind: "being" | "location" | "compendium_entry"; uid: string } | null;
  appearance: {
    shape: "circle" | "diamond";
    visual: TokenVisualRef;
  };
  label: { mode: "source" } | { mode: "custom"; text: string };
  playerVisibility: "private" | "public";
}
```
TokenVisualRef — типизированная логическая ссылка: builtin silhouette, установленный image asset или разрешённый avatar/gallery visual сущности по kind+uid. Для gallery используется стабильный идентификатор изображения; если текущая галерея его не имеет, вводится mapping до поддержки выбора gallery. URL и file_path в документ не записываются.
sourceRef=null поддерживает переносимую визуальную копию. Исходный вид сущности/форма при detach остаются определены appearance. Для detached label только custom.
Числовой id из SearchResult нужен для существующих API и запроса resolver. В canonical token он не используется как identity: сервер выдаёт kind+uid через существующий реестр и UID-службу. Это уточняет раннюю спецификацию, где sourceRef предлагался как kind+id.
Имена через entityNames(..., preferShort=true), с учётом archive/access. Общий shared kernel не читает DB/React/Canvas; resolution — серверный доменный слой.
Новый sourceRef проверяется сервером при размещении/сохранении. Уже сохранённый orphan ref допускается при последующих правках карты, чтобы удаление source не блокировало карту; сервер сверяет ID токена и неизменный ref с persisted документом, а не доверяет заявлению клиента. Новое размещение отсутствующего/архивного source отклоняется.
source mode динамически разрешает имя/картинку, custom переопределяет только токен. Master fallback для потерянной связи нейтральный и явный; ошибки картинки не делают весь документ corrupt.
Размещение принимает being/location и compendium_entry только с kind=monster. Поддержка бестиария добавлена 2026-09-30 по уточнению пользователя: нужны существа и из населения сеттингов, и из компендиума. Поиск фильтрует subtype, старый мешок может не содержать subtype; сервер в обоих случаях проверяет запись и активность системы, отклоняет заклинания и другие виды. Для монстра используются круг, основной портрет либо силуэт being. Character и остальные поисковые результаты не включены.

## 5. Размещение
Поиск и мешок передают существующий SEARCH_DRAG_MIME. Payload проверяется по типу/ID; title, subtitle и portrait не считаются authoritative.
Map-specific server resolver принимает только разрешённые виды, проверяет существование/архив/доступ и возвращает stable ref + display metadata. Запрос не создаёт source и не изменяет map_bindings.
Pointer позиция переводится CSS screen → world один раз, затем snap к подходящей клетке; DPR относится к canvas buffer. Locked/hidden target layer исключён.
Размещение и связанное состояние документа — одна команда истории. Неуспешный resolution/отмена не оставляет токена. Пока resolution pending, показывается только transient ghost.
Мешок остаётся персональным staging store, drop не расходует его запись. «Разместить» → клик на холсте / клавиатурное подтверждение обеспечивает альтернативу drag.

## 6. Игрок и изображения
По умолчанию новый token private. Переключение в public — явное действие мастера, публикующее только представление токена, не исходную карточку.
Сервер сначала разрешает доступные display fields и применяет token visibility + exploration, затем чистая shared projection строит player document. Нельзя передать refs игроку и надеяться скрыть UI.
У player token sourceRef=null, label/custom уже разрешён, visual ссылается только на разрешённый map-scoped asset; никаких source UID/id, приватных overrides или оригинальных путей.
Видимость токена не открывает весь being/location через detail API. Серверные права preview исходной сущности остаются прежними.
player-view под GM тоже применяет эти правила. PNG игрока, thumbnails игрока и презентация используют то же projected presentation. Master thumbnail не передаётся игроку.
Asset-list строится из опубликованной проекции; разрешённые изображения выдаются с обычной авторизацией и проверкой карты. Missing image → fallback; приватное source image не подставляется неявно.
Для orphan ref публичное представление нейтральное: старые приватные name/avatar из cache не публикуются автоматически.
generic layer.visible — состояние композиции, не право публикации. Для GM hide слоя не заменяет private/public.

## 7. Переносимость
Default portable export отсоединяет token sourceRef, материализует выбранные публичные display label/visual и сохраняет геометрию/ID размещения. Для missing asset есть честный placeholder.
Перенос изображений требует asset manifest/package: metadata-only JSON сам по себе не делает картинки переносимыми. Нельзя обещать одинаковый вид, если bytes/установленные packs не переданы.
Явный режим relink переносит только mapping устойчивых UID и проверяет местный доступ. Числовые IDs другой установки никогда не связываются автоматически. Одинаковые названия не основание для relink.
Импорт не создаёт локаций/существ без отдельного запроса пользователя. Private/master export выделяется явно; player export не содержит их данных.

## 8. Геометрия и рендер
World bounds — контракт viewport/fit/export/player presentation; grid — optional overlay/snap и основа только grid-зависимых моделей.
В первой пригодной версии допустим текущий профиль square/hex, unit cells, 8..100. Скрытая сетка не равна gridless document.
Перед gridless требуется migration maps.grid/width/height, допускающая NULL для отсутствующей сетки; только V6 metadata/consumers это обрабатывают, старые клиенты отсекает capability gate. Bounds не выводятся из фиктивных grid dimensions.
Gridless terrain использует маски, paths — world splines; cell terrain и cell-network без grid остаются невалидны.
Canvas2D используется до целевого измерения; смена renderer отдельно обосновывается размером сцены, количеством объектов, памятью и latency. Canonical model не зависит от renderer.
Новые draw caches, spatial indexes, сгенерированные scatter instances остаются derived. Поддержка renderer не выводится из валидности документа; unsupported-profile не записывается упрощённым.
Согласованные floor/wall/object assets нужны отдельно: рисунок концепта не является уже реализованной библиотекой.

## 9. Генерация и история
Существующий детерминированный dungeon algorithm сохраняется. Уже имеющийся в MapEditorPage путь MapCells → migrateLegacy → validation выделяется в чистую функцию и завершается V6 upgrade.
Preview transient; по умолчанию новая карта. Замена текущего документа отдельна, с одной undo-командой и видимым описанием замены. Ручные токены не исчезают скрытым побочным действием.
History остаётся в памяти; на crash/reload не обещается undo. Seed + версионированные algorithm/params сохраняются как record provenance, не derived геометрия; факт генерации не нужен для чтения уже сохранённой карты.
В provenance необходимо отделить dungeon params от текущих land params sea/mountains/forest; меняется record transport, не только диалог.

## 10. Сохранение и конкурирующие окна
Сохраняется debounce/serial queue, но новый документ имеет optimistic revision, монотонное целое поле записи, отдельное от JSON.
Новый write отправляет expectedRevision; UPDATE с условием revision либо сохраняет и увеличивает revision, либо возвращает 409 map-revision-conflict без изменений.
До преобразования старых карт допустимы legacy writes, но новый сервер увеличивает revision при каждом изменении записи, чтобы новый клиент заметил и правку из старого окна. После преобразования V6 действуют capability gate и обязательный expectedRevision.
Auto-retry не перезаписывает чужую редакцию. Workspace удерживает локальный документ, показывает конфликт и предлагает перечитать после явного решения.
Внутренний уход запускает flush/drain pending save или явно удерживает пользователя на ошибке. beforeunload недостаточен для SPA navigation.
Timestamp секунды не используется как revision. Миграция revision не меняет blob карты. Детали UX конфликтов входят в точный макет.

## 11. Отвергнутые варианты
- Снести все карты/миграцию вместе с UI: теряем проверенные данные и работу ядра без продуктовой пользы.
- Неформальный token в properties/неизвестном поле V5: поля теряются либо воспринимаются как corruption; невозможно надёжно проверить права/projection.
- Тот же v=5 с новым union member без gate: старый parser ломает загрузку; ручной corrupt overwrite остаётся.
- Отдельная map_tokens таблица как единственная модель размещения: две независимые сохранения/истории/экспорты вместо одного документа. Серверный индекс refs допустим как derived.
- Только numeric entity ID: опасный relink между установками и восстановленными базами.
- Связь через map_bindings вместо token: у неё нет экземпляра, координат и трансформации; существующие отношения нельзя перепрофилировать.
- Новый graphics engine до проверки текущего: не решает недостающую библиотеку/UX и увеличивает объём первой версии.

## 12. Критерии реализации этого контракта
1. Future version и unknown feature открываются как unsupported, raw bytes сохранены, перезапись запрещена.
2. Старый клиент не читает/пишет V6 ни master, ни player путём.
3. Старые v1–v5 round-trip сохраняют IDs/слои/geometry/exploration/bindings; load не пишет.
4. Два токена одного UID независимы; source delete не ломает save; token delete не меняет source.
5. Player payload/assets/PNG не содержат private tokens/source refs/приватных полей.
6. Revision conflict не приводит к blind retry и потере правок другого окна.
7. Portable import не присоединяет чужие numeric IDs, missing bytes имеют fallback.
8. Gridless реализуется только после persistence/consumer upgrade, не фиктивным скрытием обязательной сетки.
9. UI собирается по проверенному статическому макету.

## Последствия и последующие задачи
Тикет 03 включает compatibility gate, V6 kernel/record revisions и миграцию before-save; тикет 05 — resolution/placement; тикет 09 — проекцию/asset privacy/portable exchange. Тикет 04 — bounds/camera/flush; gridless persistence и художественная библиотека в тикете 07.
Тикет 11 разблокирован: макет учитывает private/public token, unsupported-format, orphan/image fallback и save conflict.
Данный ADR фиксирует архитектурный выбор; он не означает, что перечисленные гарантии уже реализованы или что пользовательская БД преобразована.

## Реализация 2026-09-30

Тикет 06: быстрый генератор подключён к библиотеке и новому workspace через проверяемый адаптер прежнего алгоритма. Preview — отдельный документ; создание новой private карты по умолчанию, явная замена текущей — один V6 снимок истории. При замене сохраняются целые слои токенов (ID/refs/порядок/lock/visible/opacity/позиции), конфликтующие IDs геометрии переименовываются вместе с парными дверями; раскрытые клетки сбрасываются, режим exploration сохраняется. Замена допускается только на квадратной сетке того же размера; из hex-карты можно создать отдельный данж. Опциональный `appearance: { style: "blueprint" | "paper-ink" }` задаёт представление карты отдельно от топологии и темы приложения; shared validation/canonical save и геометрический адаптер его сохраняют. Это настройки оформления документа, а не генераторная provenance записи. Рецепт целиком в документ не записывается. [Отчёт](../../.scratch/map-workspace-rebuild/implementation/step-07/README.md).

Тикет 04: новый базовый экран `/maps/:id/workspace` явно доступен из библиотеки. State/history/autosave — полный V6, V5 геометрические операции проходят через адаптер с сохранением токенов и порядка. Загрузка не записывает upgrade; первая завершённая правка скрытой карты записывает V6. У опубликованной старой карты редактирование закрыто до готовности публичной проекции; можно создать отдельную private V6 копию, сохранив старый показ. Flush/условная запись защищают ссылки и same-document Back/Forward; ранний POP listener включён до BrowserRouter, guard активен только на новом экране. При ошибке экран остаётся открыт, доступны повтор и master backup; native beforeunload защищает переход между документами. Проверены ручной данж/reload/history, lock, Escape, камера, DPR 2 и три размера экрана. [Отчёт](../../.scratch/map-workspace-rebuild/implementation/step-05/README.md). Публичный V6 и художественные ассеты продолжаются в 09 и 07–08.

Тикеты 02–03 завершены: оболочка меняет панели, shared V6 сохраняет всю поддержанную геометрию V5 и типизированные токены; сервер различает неизвестную версию до projection/assets/thumbnail, требует V6 capability и revision, защищает прежние orphan refs. Старый V5 UI остаётся на V5; новый reader/API подготовлен отдельно. Конфликт автосохранения останавливает записи и позволяет скачать локальные правки. `/3` master backup и import `/1–/3` готовы как чистый API; импорт отсоединяет refs. Portable display/asset materialization, relink и player projection — тикет 09. До его выполнения V6 player routes возвращают `map-presentation-unavailable`, включая мастерский второй экран; исходный V6 не выходит игроку. Native Electron regression и переключение — тикет 10. Проверки используют только временные БД и явно помеченные fixtures; сервер на рабочей БД для этой проверки не запускался.

Тикет 05: активный новый редактор регистрирует действия размещения/превью в общем workspace-контексте; библиотека и старый редактор их не предоставляют. Поиск и мешок передают только проверенные kind/id, источник разрешается сервером в stable UID. GM-only `token-presentations` даёт текущие имена, локальные числовые ID для карточки и безопасные `/files/` URL портретов; эти данные и декодированные изображения остаются transient. Для существ переиспользуется основной портрет либо портрет базовой записи бестиария, для локаций — основной портрет. Галерея не включена без stable image IDs. Изображения загружаются с авторизацией и рисуются с clipping по форме токена; ошибка картинки оставляет силуэт, orphan — явную нейтральную заглушку. Drag и кнопка → клик/стрелки/Enter используют CSS→world→snap, одну команду истории и повторную проверку captured target после resolver. Request epoch отменяет поздние ответы при Escape, смене карты/прав доступа, новом размещении или unmount. Мешок не расходуется. В свойствах доступны подпись, форма, размер, поворот, приватность, выбор портрета/силуэта, карточка, detach и удаление; источник не редактируется. Preview ограничен областью холста и не предлагает уход в профиль. [Отчёт](../../.scratch/map-workspace-rebuild/implementation/step-06/README.md).


Тикет 07: mask terrain, spline roads/rivers, forest/mountains scatter и зеркальные трансформации подключены к V6 workspace без смены формата. Scatter хранит shape/profileRef/seed/density/size; позиции экземпляров и bitmap остаются производными. Неизвестный профиль либо превышенный бюджет блокирует совместимость даже скрытого слоя. Кисти/selection/properties проверяют lock/visible. Canvas2D выбран по замерам; модель не пересчитывается при pan/zoom, mask raster читает chunks напрямую, неизменённые слои сохраняются по ссылке. Нативные символы имеют bitmap-кэш и vector fallback. Настоящий gridless остаётся за границами unit-grid persistence до отдельного upgrade; континентальные размеры и PNG library не объявляются реализованными. [Отчёт и пределы](../../.scratch/map-workspace-rebuild/implementation/step-08/README.md).

Тикет 08: `soyman-cartography:1` — установленный локальный набор с устойчивыми asset IDs, provenance/hashes и 17 WebP до 100 KiB каждый. Объекты требуют matching pack/version; два рисованных scatter profile сохраняют только recipe и включают набор в assetPacks. Прежние vector profiles не переопределены. Декодирование, текстурные tiles/mask bitmaps и экземпляры остаются transient. Known asset с недоступной картинкой остаётся совместимым: Canvas показывает placeholder/обычную геометрию и предупреждение, редактирование и save разрешены. Неизвестный ID/версия по-прежнему закрывают compatibility gate. Paper-ink использует локальные поверхности, узкие stone wall borders, обычную wood door и подписи ближе к краю комнаты; секретность и виды дверей не заменяются artwork. Blueprint не использует декоративные textures. Полка находится над нижней частью холста и закрывается после выбора/Escape; справа остаются поиск и мешок. Клик по прозрачному интерьеру комнаты предпочитает реальный объект ниже, transform footprint учитывает rotation и signed scale. UI skin, Sofia/Rubik fonts и paper только workspace; классический renderer получает старые defaults. Portable export, player presentation и финальный cutover остаются 09–10. [Отчёт](../../.scratch/map-workspace-rebuild/implementation/step-09/README.md).

Минимальная проекция V6 (2026-10-01, шаг 1 [редизайна](../../.scratch/map-workspace-rebuild/redesign-2026-10-01.md)): `projectMapDocumentV6ForPlayer` в shared — правила секретности и тумана V5, только public-токены, отвязанные (sourceRef=null, подпись разрешена сервером, портрет → силуэт). `player-view` и `assets?player_view=1` отдают её мастерскому второму экрану с capability 6; учётные записи игроков для V6 по-прежнему закрыты. Имя public-токена — мастерское, без фильтра по уровням доступа игроков: это упрощение до шага «Стол». Портреты игрокам — тоже там.
