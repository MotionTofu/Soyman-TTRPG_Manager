# Типизированные токены сущностей и сохранение
Status: ready-for-agent
Execution: completed
Type: task
Depends on: 01

[План](../plan.md) · [Спецификация](../spec.md)

## Задача
По ADR-0004 сначала реализовать version dispatch, server capability gate и unsupported загрузку без fallback overwrite. Только затем включить запись MapDocumentV6 / soyman-map/3. Добавить токен как first-class gameplay entity со стабильным ID, world-координатами и sourceRef kind+uid (being/location), серверным разрешением numeric ID. Реализовать parser, validator, canonicalization, lossless V5 upgrade, mutations и проверку доступности source. Ввести record revision и conditional save для защиты между окнами. map_bindings остаётся связью карты целиком.

## Критерии готовности
Несколько токенов одного источника имеют разные ID; reload/round-trip сохраняет трансформации и overrides; удаление токена не удаляет источник; неизвестный payload не затирает документ; версия согласована с обменом и старым редактором.

Новый токен private по умолчанию. Неподдерживаемая версия не проходит legacy player-view/assets; старый клиент не читает/пишет V6. Future-version raw bytes остаются нетронутыми. Load старой карты не пишет в БД. Revision conflict не вызывает blind retry. Уже сохранённый orphan ref допускается при редактировании без создания нового отсутствующего source.

## Проверка
Meaningful round-trip/version tests, валидация сломанных refs, удалённые/архивные источники, серверные права и совместимость старых карт.

## Границы
Пользователь разрешил продолжить реализацию 2026-09-30. Этот тикет включает чистую модель, version dispatch, серверное хранение/валидацию и условное сохранение. Подключение V6 к инструментам интерфейса — тикет 04, drag/drop и представление источника — 05, публичная проекция и перенос изображений — 09. Текущий V5 UI не объявляет поддержку V6 и не переключается на новый формат автоматически. Изменения пользователя сохранены.

## Comments

2026-09-30: архитектурные варианты разрешены в [ADR-0004](../../../docs/adr/0004-map-workspace-v6-tokens.md); ограничения воспроизведены в [аудите](../audit/step-01-audit.md). Реализация этого тикета пока не начата.

2026-09-30: реализация завершена. Добавлены V6 kernel, независимые private token IDs, sourceRef kind+uid, трансформации/overrides, lossless V5 upgrade, /3 master backup и безопасный import /1–/3 без relink. Сервер разрешает numeric source ID через реестр/UID-службу, проверяет архив/существование, допускает прежние orphan IDs/refs. Version gate действует до legacy flow и thumbnail/assets; raw recovery сохраняет исходную строку. Новая ревизия не меняет существующие blobs/bindings. Автосохранение и правки метаданных используют одну ревизию; конфликт блокирует повтор и предлагает копию правок. V6 player flow закрыт до 09. [Отчёт](../implementation/step-04/README.md).

