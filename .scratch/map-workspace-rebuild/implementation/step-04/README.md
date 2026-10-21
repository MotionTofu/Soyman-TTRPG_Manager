# Основа связанных токенов — тикет 03

Дата: 2026-09-30. Следующий шаг после рабочей оболочки. Реализация в общей рабочей копии; существующие и параллельные изменения сохранены.

## Результат

- Shared V6: gameplay token со своим ID, world position/diameter/rotation, sourceRef being/location + UID, shape/visual, source/custom label и private/public. Новое размещение private. Несколько экземпляров одного источника независимы; pure mutations не меняют источник.
- V5-to-V6 upgrade сохраняет все поддержанные поля, порядок слоёв/элементов, mask payload, spline handles/width/branching, exploration и asset packs. Legacy мигрируется прежним алгоритмом, затем upgrade только в памяти. Новый reader возвращает null document для corrupt/unsupported — никакого saving fallback.
- Version dispatch отделяет legacy, V5, V6, future/unknown и corrupt. Старый UI не заявляет V6 support; неизвестная версия/функция отключает инструменты и не получает кнопку разрешения перезаписи.
- Серверный capability gate предшествует чтению, проекции, assets, thumbnail и изменениям. Проверяется декодированный ID маршрута, поэтому percent encoding не обходит gate. Некорректное поле версии не передаёт вложенный payload через metadata/errors.
- GM recovery `/maps/:id/raw` возвращает исходную строку без normalization. Есть кнопка скачивания при отказе загрузки и при unsupported load.
- Resolver возвращает UID и предпочтительное короткое имя через доменный реестр и UID-службу. Новые refs проверяются по существованию и архиву источника/сеттинга. Прежний orphan принимается только с тем же persisted token ID и ref; новый экземпляр отсутствующего source отклоняется.
- `maps.revision` начинается с 0; миграция оставляет blobs/bindings нетронутыми. Все map PUT увеличивают revision; compare-and-swap защищает запись. Для V6 expectedRevision обязателен. Старый клиент не может понизить формат через cells/document/clear/grid/resize.
- Автосохранение использует returned revision. Метаданные ждут текущий save и используют ту же revision. Конфликт останавливает debounce/retry, сохраняет правки в окне и даёт скачать локальный `/2` backup. Resize settings больше не посылает document вместе с legacy width/height.
- `/3`: explicit master backup сохраняет refs. Parser/import читает /1, /2, /3. По умолчанию import отсоединяет token refs без числового/name relink; для отсутствующего source display используется нейтральная подпись/силуэт.

## Границы

Текущий холст/инструменты/история продолжают работать с V5. Production UI ещё не создаёт и не рисует токены V6; готов отдельный reader и транспорт для следующей интеграции. Автоматического сохранения V6 при загрузке нет. Сервер на рабочей БД для этой проверки не запускался; API tests используют временные базы.

V6 player routes, assets/thumbnail игрока и мастерский player-view возвращают `map-presentation-unavailable` до тикета 09. Это промежуточная граница совместимости, а не готовый публичный показ. Старые карты сохраняют существующий player flow.

Выбор gallery требует стабильного image ID и пока не принимается. Entity-avatar представлен логической ссылкой в модели; реальное разрешение портрета/отображение — 05/09. `/3` master backup не является переносимым пакетом изображений; материализация display/bytes, публичный export и relink — 09. Native Electron — финальная регрессия 10.

## Проверка

- Client: 478 тестов карт, страницы редактора и затронутого слоя данных прошли (47 файлов).
- Shared: 115 тестов kernel/boundaries/version/model прошли (7 файлов).
- Server: 62 теста legacy/V5/V6/validation, включая миграцию revision на старой временной базе, прошли (4 файла). [server-tests.log](server-tests.log).
- TypeScript client/server и shared build: успешно; [client-types.log](client-types.log), [server-types.log](server-types.log).
- Vite bundle: успешно; существующее предупреждение о размере chunks в [bundle.log](bundle.log). Полный npm build с общими style guards не заявляется: текущие нарушения зафиксированы в отчёте шага 03; новый экранный CSS здесь не добавлялся.
- Scoped lint: без ошибок; три прежних hook dependency warnings MapEditorPage в [lint.log](lint.log).
- Browser Edge/Chromium: unsupported raw load, отказ серверного gate с recovery download, conditional save conflict, экспорт реальных локальных правок и отсутствие blind retry. Оба размера 1366×768 и 820×900; горизонтального overflow нет. Все API intercepted fixtures, рабочих запросов/записей нет. [browser-qa.json](browser-qa.json), [снимки](screenshots/), [проверка](check-safety.mjs).
- Дополнительный общий `noDirectApi` guard обнаружил прежние прямые API imports в `PdfReaderPage.tsx` и `ResourceLinkPage.tsx`. Эти файлы не изменялись в данном шаге. Остальные 50 тестов этого дополнительного прогона прошли; это не ошибка новых map/data файлов. Полный зелёный прогон всех тестов приложения не заявляется.

## Следующий шаг

Тикет 04: подключить V6 к редактированию/истории, камере и корректному завершению сохранения при уходе. Тикет 05: drag/drop, доступная альтернатива размещению и реальные изображения/подписи токенов на холсте. Художественные ассеты подключаются на шаге отрисовки.
