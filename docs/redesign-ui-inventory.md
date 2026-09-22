# SoyMan_1shot — UI inventory для редизайна (R1)

Функциональность заморожена (D1–D2 done). Этот документ — карта того, что
есть в UI, что повторяется, что станет primitive, чем управляют tokens и что
придётся генерировать. Практика, не эссе: каждый пункт с якорем `file:line`.

Слоистая модель (цель R2+):

```text
UX / behavior (main.tsx, repository, engine — НЕ трогать в редизайне)
      ↓
UI primitives (SoyMan_1shot/app/ui/ — Button, ActionRow, Banner)
      ↓
SoyMan components (characterRow, модалки, секции — структура)
      ↓
Fantasy Punk skin (tokens.css переопределение + decoration hooks)
      ↓
generated decorative assets (только оформление, §8)
```

## 1. Экраны и состояния

Всё — один `app/main.tsx` (~1455 строк) + `app/shell.css` (24 строки).
Лист и визарды — `client` (`DndCharacterView`, `DndCharacterWizard`),
1shot их только встраивает. Состояния переключаются флагами, не роутером
(роутера в 1shot нет; глубокая ссылка одна: `?character=id`).

| Экран | Якорь | Триггер / элементы |
|---|---|---|
| Header | `main.tsx:1313` | лого-ссылка, имя, Рубашка (select), Большие карты (checkbox), Скачать копию, `role=status` (Сохраняем…/Сохранено) |
| Главная / библиотека | `main.tsx:1412-1416` | `visibleCharacters` + `archivedList` (`<details>Архив`), `characterRow`: ссылка Открыть/Продолжить, `⋯`-меню |
| Row menu | `main.tsx:1296-1306` | Открыть, Создать копию (`canDuplicate`), Архивировать/Восстановить, Поделиться с мастером (только `syncCred && content && characterUid`), Удалить |
| Новый персонаж | `main.tsx:1415` | input Имя (100), Создать через визард / Открыть пустой лист, managed-нотисы + Повторить |
| Creation wizard (12 шагов) | `DndCharacterWizard.tsx:71-84` | Личность, Портрет, Класс, Вид, Предыстория, Черта, Характеристики, Навыки, Заклинания, Досье, Снаряжение, Обзор; `Шаг N из 12` + таб-стрип + mobile select; footer Отмена/Назад/Далее vs Создать персонажа (гейты полноты); черновик `dnd-wizard-draft:*` (автосейв, resume-баннер, `confirm()` на сброс/отмену, фото не в черновике) |
| Character sheet | `main.tsx:1412` | единый `<DndCharacterView>` без mobile/desktop-ветвления в 1shot; сейв через `update`/`applyLevelUp` (очередь, CAS) |
| Level-up | `DndCharacterForm.tsx:11067` + `12470` | кнопка `Уровень N — повысить` → `DndLevelUpWizard`; черновик `dnd-levelup-draft:*`; чистится при delete/sync-pull-delete |
| Archive | `main.tsx:1239-1257` | через меню; `leaveIfOpen` уводит с открытого |
| Delete confirm | `main.tsx:1337-1341` | `Удалить «name»?`, best-effort share-revoke, чистка черновиков + `collectGarbage()` |
| Portable import | `main.tsx:1168-1201`, модалка `1324-1336` | HTML-файл → single-match (Обновить/Копия/Отмена) vs multi-match (только копия); JSON restore из копии |
| Portable export | `main.tsx:1314-1322` | Скачать HTML / Проверить состав (audit-модалка: счётчики, problems, external-assets) |
| PWA update banner | `main.tsx:1323` | `Доступна новая версия`, Обновить/Позже, сброс очереди сейвов |
| Storage | `main.tsx:1422` | `readStorageStatus`, Защитить данные, совет про бэкап |
| Sync setup | `main.tsx:1424-1428` | URL input, Включить синхронизацию |
| Sync pairing out/in | `main.tsx:1342-1353` | QR + Скопировать + Готово (10 мин, одноразовая); входящая `?api=` → Подключить/Отмена |
| Sync conflict modal | `main.tsx:1359-1378` | 4 вида × per-uid секции, keep-local/use-server, Отмена |
| Auto-sync status | `main.tsx:1432-1439` | checkbox + хинт, `Синхронизация…`, `Синхронизировано`, `Не удалось…`, счётчики pushed/pulled/conflicts/КБ |
| Share modal | `main.tsx:1379-1410` | 3 ветви: ссылка (копировать/открыть/обновить/отключить), sibling-active, нет ссылки; privacy-нота; conflict-нота |
| Offline/error/empty | `main.tsx:1411,1415-1416,1430,1441` | `role=alert` баннер, `Открываем…`, `Здесь появятся…`, `временно недоступна`; `beforeunload` при pending/failed; `<SaveNotices/>` тосты |
| Standalone viewer | `app/standalone.tsx` | read-only шаблон в экспортируемом HTML (не экран приложения) |

## 2. Reusable patterns (что повторяется)

Все в `main.tsx`, стили — `client/src/index.css` + `shell.css`:

- **Buttons**: база + `primary` + `disabled` + busy-swap текста (~15 мест, всегда в `.row.oneshot-actions`). Варианты: `primary` (подтверждение/CTA), plain (отмена/вторичка), `danger` (есть класс `button.danger`, в 1shot не используется — удалить/архив идут через `primary`!). `ghost`-класса нет.
- **ActionRow**: `div.row.oneshot-actions` ×14 — один и тот же флекс-контекст, примитив `app/ui/ActionRow.tsx`.
- **Menu**: один `oneshot-menu` (kebab строк). Нет outside-click close — поведение freeze.
- **Modal**: клиентский `Modal` (портал, `modal-backdrop`), 8 call-сайтов в 1shot, все дефолтные. Обёртка не вводилась сознательно: внутренности модалок — клиентский CSS с `:has()`-селекторами, лишний div может сломать селекторы.
- **Banner**: `oneshot-error[role=alert]` ×3 копии + `oneshot-update[role=status]` (sticky) + `muted`-строки (~25, хинты/диагностика/прогресс). Три уровня громкости — осознанно.
- **Fields**: голые `label > input/select/checkbox` (5 мест) + 2 shell-класса раскладки; скрытые file-inputs (без визуала).
- **Section headers**: `h1` + `h2` секции + `h3` модалок + per-item `h2` конфликтов.
- **CharacterRow**: билдер `characterRow` ×2 списка (активные + архив).
- **Progress**: только busy-тексты + текстовые строки (`Подготавливаем…`, `Синхронизация…`). Прогресс-баров нет.
- **Tabs/badges/tooltips/cards**: в 1shot-хроме НЕТ (табы/бейджи/тултипы живут внутри листа). Не воссоздавать в shell.

## 3. Существующие дубли (случайные)

1. `row oneshot-actions` ×14 строкой — не компонент (→ `ActionRow`, сделано в R1).
2. `oneshot-error` ×3 копипасты (`main.tsx:1411,1406,1441`) — не компонент (→ `Banner`, сделано в R1).
3. `muted` на ~25 контекстов (хинт/статус/empty/diag) — один класс, семантики смешаны, но безвредно: skin красит голос, не смысл. Не дробить.
4. Настоящие числовые дубли — в `client/index.css`/`dnd-sheet.css`, не в shell. В shell.css дублей нет (всё токены; повторы `gap` — осознанная шкала).
5. `button.danger` существует, но 1shot деструктивные действия идут через `primary` — решение skin: либо danger-вариант для Удалить/Отключить, либо оставить. Поведение не менять.

## 4. Proposed primitives (итог R1)

Живут в `SoyMan_1shot/app/ui/`, behavior-neutral, zero-visual-change:

| Primitive | Контракт | Мигрировано (proof) |
|---|---|---|
| `Button` | `primary`/`secondary`/`danger` (ghost отложен — класса нет), `busy`+`disabled`, `data-ui="button"` | delete-модалка, home create-блок |
| `ActionRow` | `row oneshot-actions`, `data-ui="action-row"` | те же 2 места |
| `Banner` | `error` (`oneshot-error[role=alert]`) / `hint` (`muted`), `as p\|div`, `data-ui="banner"` | global error, sync error, share error |

Не создавать (проверено, §4): Menu (1 использование), IconButton (1 kebab), Modal-обёртку (риск `:has()`-селекторов клиента), Tabs/Badge/Card (нет в хроме), Field (голые label достаточны; skin красит классы).

## 5. Token map

`app/tokens.css` — 1shot-владеемая семантика поверх клиентских токенов
(`client/src/index.css:38+`, тема `noir` через `applyTheme`). Прямых
palette-значений в компонентах нет (`--color-*` не вводится вообще).

| Semantic | Маппинг сегодня | Замечание skin |
|---|---|---|
| `--ui-bg` / `--ui-surface` | `var(--paper)` | фон страниц/шапки/меню |
| `--ui-surface-raised` | `var(--paper-2)` | ошибки, апдейт-баннер, hover меню |
| `--ui-text` / `--ui-text-muted` | `var(--ink)` / `var(--muted)` | |
| `--ui-accent` | `var(--accent)` | акцент-бордер ошибок, primary-кнопки (через класс) |
| `--ui-danger` | `var(--danger-bg)` | зарезервирован (1shot пока шлёт danger через `primary`) |
| `--ui-success` | `var(--pay-free)` | зарезервирован, в shell не используется |
| `--ui-border` | `var(--line)` | все 1px-разделители |
| `--space-1..8` | `var(--sp-1..8)` | 2/4/6/8/12/16/24/32px; в shell заменены только точные совпадения (16/12/6/8px), остальные px — layout-константы, см. §6 |
| `--radius-sm/md/lg` | все → `var(--card-radius)` (0px noir) | схлопнуты осознанно; skin разведёт |
| `--font-ui` / `--font-display` | клиентские имена напрямую | уже семантика; алиас был бы самореференсом |
| `--content-max-width` | `850px` | `.oneshot-home`; лист 1500px — отдельный layout-режим, не токен |
| `--fs-*` | оставлены клиентские | закрытая шкала кегля (10/12/16/26), не палитра — не дублировать |

`shell.css` переведён на `--ui-*` (identical computed values — проверено
скриншотами до/после, §10). Остаточные px-литералы (14/18/20/24/40/60,
медиа 700px) — layout-константы конкретных мест, будущий разброс по шкале.

## 6. CSS layer proposal

```text
client/src/index.css + dnd-sheet.css   — база и лист (чужая территория R1)
        ↓
SoyMan_1shot/app/tokens.css            — семантика 1shot (ТОЧКА ЗАМЕНЫ SKIN)
        ↓
SoyMan_1shot/app/shell.css             — layout chrome (только --ui-*)
        ↓
SoyMan_1shot/app/components.css        — decoration slots (хуки без эффекта)
        ↓
skin (будущее)                         — переопределение tokens.css +
                                         derniers штрихи через ::before/::after,
                                         background/mask/border-image,
                                         CSS-переменные. Геометрия от картинок
                                         не зависит — layout-размеры только
                                         в shell/components, никогда из assets.
```

Файла `skin.css` нет сознательно: сегодня skin = `themes.ts noir` +
маппинг `tokens.css`. R2 добавит его как override-слой, не трогая остальное.

Decoration slots (`components.css`): `[data-ui="button"|"action-row"|"banner"]::before/::after`
зарезервированы хуки (без визуального эффекта сегодня) + задокументированы
допустимые техники (background/mask/border-image/variables). Mobile-first
сохранён: единственный брейкпоинт 700px не тронут; mobile = основной.

## 7. Current assets

Полная классификация — по инвентаризации (якоря в отчёте разведки):

- **used**: PWA manifest + сгенерированные icons, `app-icon.png`, 3 punk-шрифта
  (на noir-теме idle, грузятся), dice-пара webp, все `rasterAsset`
  (coins/inventory/tokens/schools/conditions), card backs (~450КБ ×2) +
  превью-пайплайн каталога, CSS-фреймы/скроллбары.
- **unused в 1shot (но шипаются через `publicDir`)**: `mascot/*` (36),
  `cursors/*` (108), `logo.png`, `icons.svg`, клиентский `manifest.json`,
  6 запасных шрифтов, chronicle/tabs-скроллбары.
- **temporary**: `SoyMan_1shot/public/*` (прототип лендинга), процедурные
  иконки `build.mjs`, `zine.css:289` image-treatment trial.
- **candidate for redesign**: maskable-иконки (gap), сжатие backs, 108
  курсоров → подмножество/дефолт, запасные шрифты (drop/дока),
  dice light/dark → вектор, фреймы под generated borders.
- Шрифты: только ttf/otf, woff2 нет. Текста внутри декоративных assets нет
  (проверить при генерации, §17).

## 8. Required generated asset categories (спецификация, не картинки)

Интенсивность по §18: текст ≈ чисто; controls — лёгкий punk; панели/
навигация — умеренно; content cards — сильно; hero/empty — максимум.

| Кат. | Что | Где | Aspect/alpha/растяжение/mask |
|---|---|---|---|
| A. Surface | углы панелей, орнаменты карточек, разделители секций | shell sections, home blocks | тонкие horizontal, transparent, repeat-x, mask-able |
| B. Navigation | маркер активного таба листа, мотивы wizard-progress | лист (таб-стрип), визард (шаги/селект) | малые, transparent, не растягивать текст |
| C. States | empty-библиотека, offline-декор, conflict-иллюстрация | home empty, sync-ошибки, conflict-modal | hero-ish, opaque/transparent, max-эффект |
| D. Content | class/species cards, item cards | визард (CardTile), лист | карточные пропорции, opaque art + HTML-текст поверх |
| E. Micro | царапины, маркер-штрихи, halftone-маски | кнопки/бейджи/фан | tileable/alpha-mask, только через mask-image или ::before, не layout |

## 9. UX freeze (не менять в R2 без причины)

Лист: вкладки, quick controls, mobile/desktop-ветвление внутри
`DndCharacterView`, игровые сценарии. Визард: 12 шагов, свободные прыжки
(не locked — см. селект шагов), полнотные гейты, preview, draft/resume,
`confirm()`-охранники. A11y-база: нативные `<button>`, `disabled`,
`label`-связи, `role=alert/status/menu/dialog`, keyboard там где есть
(меню — Esc/фокус не вводился, не регрессировать). Контраст текста — только
от цветов, не от background-image (инвариант для skin).

## 10. Свобода редизайна (R2)

- Значения `tokens.css` целиком (палитра, радиусы, шрифты, отступы).
- Decoration через `components.css`-хуки (углы, маски, текстуры, скретчи).
- Эталонные экраны первыми: **A. Главная/библиотека** (навигация, карточки,
  actions, empty/archive, sync/status), **B. Character sheet mobile**
  (плотность, контролы, табы, портрет).
- Card backs (~450КБ) и dice-пара — первые кандидаты на замену/векторизацию.
- `button.danger` для деструктивных действий 1shot — решение skin.
- Мёртвый вес `app-dist` (mascot/cursors/logo) — отдельная оптимизация
  `publicDir`, не R1.

---

*Проверено R1: `npm test` 1shot green, `tsc` clean, `vite build` ok;
скриншоты home/sync/sheet-mobile до/после — identical (см. smoke-отчёт).*
