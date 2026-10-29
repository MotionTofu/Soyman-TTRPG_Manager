# SoyMan — TTRPG Manager

Личный менеджер настольных ролевых кампаний. React + TypeScript клиент (`client/`),
Express + better-sqlite3 сервер (`server/`), упаковка в десктоп через `electron/`.
Продуктовый контекст — `PRODUCT.md`, визуальная система — `docs/design-system.md` (v2 «Д»), где что лежит в коде — `DESIGN.md`.

## Ассеты приложения

Основные рабочие файлы графики и шрифтов — в `assets/library/`, учёт —
в `assets/manifest.json`. Пути в `client/public/`, `client/src/assets/`
и `build/icon.png` являются синхронизируемыми копиями. Перед добавлением
или заменой ассетов прочитать `assets/README.md`; после правок выполнить
`npm run assets:sync` и `npm run assets:check`. Исторический архив
Fantasy Punk хранит концепты и варианты; рабочие файлы правятся в
общем хранилище. Не перезаписывать чужие правки рабочих копий.

## Agent skills

### Issue tracker

Локальный markdown: спеки и тикеты лежат файлами в `.scratch/<feature-slug>/`. См. `docs/agents/issue-tracker.md`.

### Triage labels

Канонические лейблы без переименования (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). См. `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` в корне репозитория. См. `docs/agents/domain.md`.
