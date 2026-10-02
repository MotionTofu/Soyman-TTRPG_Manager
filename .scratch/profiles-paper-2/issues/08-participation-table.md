# 08 — Таблица участия; участники приключения

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Таблица участия: контекст (adventure | campaign, id) · сущность (вид, id) · JSON. Ключи хода событий `goal · plan · without · if_help · if_deprived`; `if_deprived` добавить и в участие кампании (`beingForce.PARTICIPATION_KEYS`). Участники приключения = составы его сцен ∪ добавленные вручную.

## Acceptance criteria

- [ ] API чтения/записи участия; только Мастер
- [ ] Список участников приключения собирается автоматически, ручных можно добавить и убрать
- [ ] Светлая и тёмная (`aberrant`) тема, 390 px — скриншотами; цвета только переменными `paper.css`
