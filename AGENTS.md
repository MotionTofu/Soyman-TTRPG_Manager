# SoyMan — TTRPG Manager

Личный менеджер настольных ролевых кампаний. React + TypeScript клиент (`client/`),
Express + better-sqlite3 сервер (`server/`), упаковка в десктоп через `electron/`.
Продуктовый контекст — `PRODUCT.md`, визуальная система — `DESIGN.md`.

## Agent skills

### Issue tracker

Локальный markdown: спеки и тикеты лежат файлами в `.scratch/<feature-slug>/`. См. `docs/agents/issue-tracker.md`.

### Triage labels

Канонические лейблы без переименования (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). См. `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` в корне репозитория. См. `docs/agents/domain.md`.
