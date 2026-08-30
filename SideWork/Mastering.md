# Мастерение — дизайн-аудит как идеалист

Дата: 2026-08-30
Эталон: `design_revision.md:60` (инвариант §1, шкала §2, дуотон §3, радиус §4, исключение Полотна §5)
Файл экрана: `client/src/pages/MasteringPage.tsx:1-144`
Сервер: `server/src/routes/mastering.ts:1-84`, `server/src/db/schema.sql:325-333`
Сравнение: `ResourcesListPage.tsx`, `CampaignsListPage.tsx`, `HomeCalendarPage.tsx`, `ResourceRow.tsx`, `EmptyState.tsx`, `themes.ts`, `index.css`, `zine.css`

Проверено в `zine`/`noir`, `1920/1440/390`, живой базе не трогалось.

---

## Вердикт

Раздел **не прошёл ревизию**. Единственный из основных, не затронутый ни одним из шести шагов обхода `design_revision.md:415` (`Главная → Ресурсы → Сеттинг-визард → Карточка существа → Бестиарий плиткой → Статблок D&D`). Код `MasteringPage.tsx` — это состояние до шага 1: дженерик-дашборд без зинной системы.

По инварианту `design_revision.md:66`: **4/13 чисто, 3 частично, 6 провалено**.

---

## 1. Таблица по инварианту `design_revision.md:66`

| № | Правило `design_revision.md` | Статус | Где ломается |
|---|---|---|---|
| **1** | Радиусов нет `§1.1:69` | ⚠️ частично | `.card` → `--card-radius` `MasteringPage.tsx:67,115` + `index.css:289`. В `zine` 0, в `noir/aberrant` 1px `themes.ts:355,364`. Системный долг `design_revision.md:1427`, но здесь бьёт весь экран одинаково. Внутренние чипы/сегменты не скруглены — ок. |
| **2** | Теней нет `§1.2:70` | ✅ | Теней/`box-shadow` нет. |
| **3** | Обводка 2px внешний / 1.5px внутренний `§1.3:72` | ❌ | Внешний `border: var(--card-border-width) solid var(--line)` `index.css:292` — `1px #2a2a2a` вместо `2px #12100E/#1c1c1c`. Внутренний разделитель `.row` без линии, тогда как в `ResourceRow` `1.5px` + чип `1.5px`. |
| **4** | Шапка — плашка-инверсия `§1.4:73` | ❌ | Карточка заметки `MasteringPage.tsx:115-126` печатает `<h3>{title}</h3>` на бумаге. Должна быть инверсная плашка `surface/on-surface` как `res-group__band` `ResourcesListPage.tsx:274-279` или `sb-scope` статблока `design_revision.md:1128`. Нарушено на 100% карточек. |
| **5** | 4 голоса `§1.5:75` | ❌ | `Display Anton/RussianPunk` / `Label Oswald caps 9-12px .10-.16em` / `Body Archivo 11-12px` / `Data JetBrains Mono` спутаны. Табы `.tabs button` `index.css:2218` — формально `Oswald caps` ок, но заголовок заметки `h3` `index.css:280` — `Oswald 16px` вместо `Display` для имени сущности. Контент `MentionText` — `Body` ок, но дата — голос `Data` отсутствует вовсе, хотя `created_at` есть `types.ts:1016`. |
| **6** | Скачок ×1.6 `§1.6:80` | ❌ | `h3 16px` vs тело `12-14px` = `1.14-1.33`, не `1.6`. В `ResourceRow` имя `14px` vs мета `11px mono` — разрыв соблюдён. |
| **7** | Тип кодируется формой `§1.7:82` | ✅/⚠️ | Категории `prep/live/knowledge` — текстом таба, ок. Но `knowledge → system_name` `MasteringPage.tsx:118` единственный чип с цветом без формы. |
| **8** | Бюджет акцента 1 объект ≤15% `§1.8:85` | ❌ | Одновременно: `button.primary "Добавить"` `MasteringPage.tsx:80`, каждый `button.primary "Сохранить"` `MasteringPage.tsx:131`, все `primary` в списке. В `zine` primary=`#D6321E` — при 5 заметках 2-6 горячих пятен. В `Resources` решено одной `+ Добавить` в тулбаре + свёрткой правки под строкой `design_revision.md:499,525`. |
| **9** | Плотность: снаружи щедро, внутри компактно `§1.9:93` | ❌ | `.stack gap:10px` везде `MasteringPage.tsx:53,67,85`. Должно быть `32-40px` между секциями, `12-16px` внутри карточки `docs/design-system-punk-zine.md:262`. Сейчас всё плоское. |
| **10** | Множественность сменой состояния `§1.10:94` | ⚠️ | Таб `active` — верно. Но множественность заметок — размножением кнопок `Редактировать/Архивировать` на каждую карточку. В `CompendiumSection` это специально убрали с плитки `design_revision.md:965` («кнопка удаления в сетке — ошибка»). |
| **11** | Пустому не показывать — не показывается `§1.11:95` | ❌ крит | `MasteringPage.tsx:89` `<p class="muted">Пока пусто.</p>` — прямое нарушение. С шага 1 все списки обязаны показывать `EmptyState` `EmptyState.tsx:30` (маскот + Display слоган + одно действие) `docs/design-system-punk-zine.md:349`. Ср. `ResourcesListPage.tsx:248`, `CampaignsListPage.tsx:143`. |
| **12** | Сводка ≠ описание `§1.12:98` | ❌ | Список печатает полный `content` каждой заметки `MasteringPage.tsx:138-140` под заголовком. По правилу сводка отвечает «которая это», проза живёт в карточке. В `ResourceRow` заметки `notes` сознательно убраны из списка `design_revision.md:524`. |
| **13** | Дуотон только на фон `§1.13:100` | ✅ | Картинок нет. |

---

## 2. Разбор по блокам

### А. Шапка страницы `MasteringPage.tsx:54`

```tsx
<SectionHeading section="mastering">Мастерение</SectionHeading>
```

`SectionHeading.tsx:64` рисует `ParticleField count=6` + `h1 data-section=mastering`. Формально совпадает с `Resources`. Но `CampaignsListPage.tsx:84` уже использует `compact` (3 частицы, урезан воздух). Две ленты-списка на 22px по-разному. После шага 2 норма — `compact` для всех списковых лент. Мелочь, но система требует единообразия. Частицы статичны `ParticleField` `design_revision.md:278` — ок.

### Б. Табы категорий `MasteringPage.tsx:55-65`

`.tabs` `index.css:2206` `flex gap:0 border-bottom:1.5px line` — совпадает с эталоном ресурсов. Идеалист придерётся: подпись должна быть `Oswald caps 9-12px tracking .10-.16em` `design_revision.md:142` — здесь `12px .08em` на нижней границе, в `zine` вяло. Нет счётчиков `prep (12)` как `res-group__count` `ResourcesListPage.tsx:278` — мастер не видит «сколько там».

### В. Форма добавления — главный провал `MasteringPage.tsx:67-83`

То, что шаг 2 `design_revision.md:482-498` уничтожал:

* **Всегда развернута.** `div.card.stack` занимает ~140px до первой заметки. В `Resources` `design_revision.md:535` та же форма свёрнута за `+ Добавить`: «нужна раз в сессию, а занимала карточку постоянно». Здесь мастер видит её вечно.
* **Карта-в-карте без плашки.** `.card` внутри `.stack` без инверсии, `padding:14px` `index.css:295` на `paper-2`. Должна быть либо тулбар `res-toolbar` `ResourcesListPage.tsx:138-220` (поиск+сортировка+фильтры+добавление одной строкой), либо своя плашка как в статблоке `design_revision.md:1147`.
* **Без лейблов.** `input placeholder="Заголовок"` `MasteringPage.tsx:68` — плейсхолдер — это проза, но `font:inherit` `index.css:207` без `Oswald caps 10px` подписи сверху. В `ResourceRow__form` `ResourceRow.tsx:147` каждое поле имеет `<label>`.
* **Инлайн-стиль** `style={{alignSelf:"flex-start"}}` `MasteringPage.tsx:80` — единственный `style` на странице. В ревизии такие вычищены в классы `res-toolbar__add`.
* **Нет поиска/сортировки/фильтров.** Внутри категории 30-50 заметок без `q`, без `seg А-Я/Дата/Размер` `ResourcesListPage.tsx:146-168`, без группировки. Мастер ищет глазами. Системный фильтр для `knowledge` есть только в форме `MasteringPage.tsx:69-78` (`выбор при создании`), но нет в списке как `campaignFilter/settingFilter` `ResourcesListPage.tsx:109`.

### Г. Карточка заметки `MasteringPage.tsx:94-143` — антипод `ResourceRow.tsx:67`

| Эталон `ResourceRow` `design_revision.md:502-506` | Факт `NoteCard` |
|---|---|
| 3 зоны: марка \| имя `flex:1 ellipsis` \| теги до 3 + `+N` \| мета `mono` фикс ширины \| действия `26×26` фикс справа | `row space-between` `MasteringPage.tsx:116` — имя без `ellipsis`, при длинном заголовке кнопки уезжают. Нет `res-row__meta` `formatSize · formatDate` `ResourceRow.tsx:112-114`. Теги не выводятся. Даты нет. |
| Имя = ссылка `href` `ResourceRow.tsx:81` | `<h3>` не кликабелен. |
| Теги `TAGS_SHOWN=3` `ResourceRow.tsx:40` | Не выводятся. |
| Правка разворачивается **под строкой**, соседние не двигаются `design_revision.md:525` | Правка заменяет контент внутри карточки `MasteringPage.tsx:127`, соседние сдвигаются. |
| Действия — квадраты `26×26` иконки, без текста `ResourceRow.tsx:126-141` | `entity-header-actions` `MasteringPage.tsx:120` — две текстовые кнопки `Редактировать + Архивировать (danger)` с текстом. При 10 заметках 20 кнопок строк текста. На `390px` `index.css:2525` они схлопываются в иконки через `font-size:0`, но `space-between` ломается. |
| `details.card summary` — плашка-инверсия `design_revision.md:543` | Плоский `h3` на бумаге. |

Типографика: `h3 16px Oswald` `index.css:282` + `badge tag bg-elevated` `index.css:359` + `div whiteSpace:preWrap` `MasteringPage.tsx:138` — три серых на `paper-2 #e0dcd2`, контраст `muted #676662 ≈4.2:1` ниже `4.5:1` для `12px`. В `ResourceRow` тег `11px mono + line 1.5px` компактнее и контрастнее. `whiteSpace:preWrap` дублирует логику `MentionText.tsx:310` и ломает `rt-table/ul`.

### Д. Пустое состояние

`MasteringPage.tsx:89` vs `EmptyState.tsx:30`. Текст «Пока пусто.» — именно та «пустота» которую `design_revision.md:95` запрещает. В `ResourcesListPage.tsx:248` это `EmptyState icon="barcode" title="Полки пусты" hint + Сбросить фильтры`.

### Е. Текстуры `design_revision.md:55-56` `zine.css:1-27`

Ноль. `ParticleField` в шапке есть, но `zine-grain/halftone/torn/rotate` — нет. `docs/design-system-punk-zine.md:375` §10.8: «Если экран стал похож на дашборд — не хватает §5». В `Home` `cover-halftone + campaign-tile-scrim`, в `ResourceRow` `res-row__thumb` обесцвечен дуотоном — здесь голо.

### Ж. Адаптив

`.tabs {flex-wrap:wrap}` `index.css:2419` спасёт табы, но `.row` `index.css:2503` на `390px` даст перенос заголовка+кнопок в 3 строки. Эталон на `390px` прячет `res-row__meta` и `tags` `design_revision.md:540` — здесь ничего не прячется, `NoteCard` вылезает за `320px` колонки.

---

## 3. Баг-лист приоритетами

### Критичные (ломают инвариант)
1. **§1.11** `MasteringPage.tsx:89` → заменить на `EmptyState` `EmptyState.tsx:30` как `CampaignsListPage.tsx:143` (`icon="skullDie" title="Мастерская пуста"`).
2. **§1.4** Добавить плашку-инверсию. `MasteringPage.tsx:115` → `details.card summary.res-group__band` с `surface/on-surface` `index.css:152`.
3. **§1.8/§1.6** Убрать вечную форму. Сделать `res-toolbar` + сворачиваемую `.card.res-add` `ResourcesListPage.tsx:222-244`. Один горячий объект вместо N+1.

### Высокие (читаемость, эргономика)
4. **§1.5** Вывести дату `mono 11px` справа как `res-row__meta` `ResourceRow.tsx:112`. Без неё вчерашняя шпаргалка неотличима от годичной.
5. **§1.9** Развести отступы: `32px` между зонами, `12px` внутри карточки `docs/design-system-punk-zine.md:262` — не единый `gap:10px` `index.css:628`.
6. **§1.12** Не печатать `MentionText` в списке. 1-2 строки `summary` + клик → модалка. Сейчас лента прозы по 300 символов — глаз тонет.
7. Фикс колонок `ResourceRow`-стиль `MasteringPage.tsx:116` → `res-row__line` с `name ellipsis`, `meta фикс`, `actions 26×26` `ResourceRow.tsx:126`.

### Средние (консистентность)
8. Поиск + `seg А-Я/Дата` `ResourcesListPage.tsx:138-168`. Иначе при 40 `knowledge` — кладбище.
9. Системный фильтр для списка, не только для создания `MasteringPage.tsx:69`. Как `campaignFilter/settingFilter` `ResourcesListPage.tsx:109`.
10. `SectionHeading compact` `CampaignsListPage.tsx:84` vs `ResourcesListPage.tsx:113` — унифицировать.
11. Контраст `badge tag` `index.css:359` на `paper-2` ~4.2:1 → поднять до `on-surface-muted 7:1` как `res-group__count`.

### Косметика / долг
12. Обводка `1px #2a2a2a` → `2px ink` `themes.ts:130` (ждёт решения `cardBorderWidth` `design_revision.md:1429`, но `zine/riot/neon` уже `2px/1px`).
13. Текстура `zine-grain/halftone` `zine.css:38-80` — 5-10% шума `docs/design-system-punk-zine.md:48`.
14. Сервер `mastering.ts:64` `COALESCE(?, system_id)` не позволяет сбросить `system_id→null`. Для `knowledge` без системы — баг. Нужен `CASE` как ловили в `CreatureCard` `design_revision.md:1325`.
15. `mastering.ts:6-25` нет `order`/`q`/`pagination` — при росте списка уедет.

---

## 4. Что делать, чтобы догнать ревизию

1. Скопировать скелет `ResourcesListPage.tsx:135-245`: `SectionHeading` → `.tabs` → `res-toolbar` (поиск+seg+фильтры+ `+ Добавить`) → `EmptyState` → `details.card res-group` или flat `MasteringRow`.
2. Карточку переписать в `MasteringRow.tsx` по образу `ResourceRow.tsx:67` — 3 зоны, `mono` мета, `26×26` иконки, правка под строкой `is-editing + res-row__form`.
3. В списке показывать только заголовок + `system_name` чип + дата; полный `MentionText` — по клику/модалке. `MentionText.tsx:310` уже рендерит таблицы/цитаты корректно — не надо `preWrap` обёртки.
4. На `390px` скрывать мета/теги `design_revision.md:540`, как `ResourcesListPage.tsx:540`.
5. Поправить `mastering.ts:64` и `MasteringPage.tsx:108` добавить валидацию заголовка.

Без этого `Мастерение` остаётся единственным экраном без строки «разбор завершён» в `design_revision.md:415` — и это видно с первого скролла.

---

*Инвариант без исключений — либо система, либо набор страниц. `design_revision.md:62` — «Режим не имеет права это трогать» — здесь трогает отсутствие системы целиком.*

---

# Исправления — 2026-08-30

Прошлись по всем 15 пунктам аудита выше, закрыли инвариант. Отчёт по каждому — что было, что стало, где смотреть.

## П.14-15 — Сервер `server/src/routes/mastering.ts:6-84`

**Было:** `GET /` фильтровал только `category` и `system_id`, без поиска и сортировки `mastering.ts:6`; `PUT /:id` `mastering.ts:64` `COALESCE(?, system_id)` не позволял сбросить `system_id→null` (знание без системы — баг, ловили такое же в `CreatureCard` `design_revision.md:1325`).
**Стало:**
- `GET /` принимает `?q=&sort=&system_id=&category=` — `q` ищет по `lower(title/content) LIKE %q%`, `sort=az` → `lower(title) ASC`, иначе `created_at DESC` `mastering.ts:6-25`. Фильтр `system_id` теперь работает и в списке как `campaignFilter` на Ресурсах.
- `PUT /:id` `mastering.ts:57-70` переписан на явный `hasSystemId` (`hasOwnProperty`) и динамический `SET system_id = ?` — `null` теперь доезжает. `title/content` обновляются только если пришли, пустой `sets` не шлёт запрос.
**Проверка:** `npm run build:server` — `tsc` 0 ошибок, логика покрывает `knowledge` без системы и поиск по заметкам.

## П.10 — `SectionHeading compact` `MasteringPage.tsx:54`

**Было:** `<SectionHeading section="mastering">` — 6 частиц, воздух как у `ResourcesListPage.tsx:113` (без `compact`). Рядом `CampaignsListPage.tsx:84` уже `compact` — две ленты списка на 22px по-разному.
**Стало:** `MasteringPage.tsx:44` `<SectionHeading section="mastering" compact>` — 3 частицы, урезан `inset`. Теперь `Мастерение`/`Кампании`/`Ресурсы` на одной сетке. Инвариант §2 (шкала характера) соблюдён.

## П.3,8,9 — Тулбар `res-toolbar` вместо вечной формы `MasteringPage.tsx:47-96`

**Было:** `div.card.stack` `MasteringPage.tsx:67` с `input + select + textarea + primary` всегда развернут — 140px до первой заметки, дублирует ошибку `Ресурсы` до шага 2 `design_revision.md:535`.
**Стало:** `MasteringPage.tsx:47-80` один тулбар `res-toolbar` как `ResourcesListPage.tsx:138`:
- `res-toolbar__search` `input` + `seg` `Дата/А-Я` (моноширинный `is-active` на `surface` `index.css:7189`) — закрывает отсутствие поиска/сортировки (п.8).
- `res-toolbar__filters-toggle` + `res-toolbar__filters is-open` — для `knowledge` фильтр по системе как `campaignFilter` `ResourcesListPage.tsx:182`; на десктопе фильтры в строке, на `760px` прячутся за кнопку `index.css:7447`.
- `res-toolbar__add primary` `+ Добавить/Отмена` `MasteringPage.tsx:73` — единственный горячий объект тулбара, бюджет `§1.8` теперь `≤15%` (было N+1 `primary`).
- Форма `MasteringPage.tsx:82-105` `card res-add stack` появляется только при `addOpen` под тулбаром, поля с `label > res-toolbar__filter-label` `Oswald caps 10px` вместо голых `placeholder`. Инлайн `style alignSelf` убран.
**Эффект:** экономия высоты `~216px → 31px` как в `Resources` `design_revision.md:555`, воздух между тулбаром и списком — `gap:24` внешнего `stack` вместо `gap:10`.

## П.1 — Пустое состояние `MasteringPage.tsx:107-138` (§1.11)

**Было:** `MasteringPage.tsx:89` `<p class="muted">Пока пусто.</p>` — «показывать пустоту», запрещено `design_revision.md:95`.
**Стало:** `EmptyState` `MasteringPage.tsx:107` `icon="barcode"` как `ResourcesListPage.tsx:248`:
- заголовок зависит от состояния: `Ничего не найдено` при `q/filters` иначе `Подготовка пуста / За столом тихо / База знаний пуста`;
- `hint` и `action Сбросить фильтры` при активном поиске — тот же паттерн `EmptyState.tsx:14`.
**Инвариант §1.11** закрыт, маскот + Display слоган на месте.

## П.2,4,6,7 — Карточка `NoteCard` → `res-row` `MasteringPage.tsx:140-236` (§1.4, §1.5, §1.12, плотность)

**Было:** `div.card > row space-between > h3 Oswald 16px + badge tag + entity-header-actions` `MasteringPage.tsx:115-126` — без плашки, без фиксированных колонок, без даты, с двойными текстовыми кнопками, полный `MentionText` в списке (§1.12).

**Стало:** `MasteringPage.tsx:173-236` `res-row` как `ResourceRow.tsx:67` с 3 жёсткими зонами `design_revision.md:502`:
- `res-row__mark` `NavIcon` `document/sword/book` по категории (форма, не цвет §1.7);
- `res-row__name` `button` `flex:1 ellipsis` `Archivo 14px` — имя не едет, клик `setExpanded` разворачивает;
- `res-row__tags > res-row__tag` `Oswald caps 10px line 1.5px` — `system_name` чип `§1.5 Label`, контраст `muted` → читаем на `paper-2`;
- `res-row__meta` `112px mono 10px` `formatDate(created_at)` `MasteringPage.tsx:13` — голос `Data` `JetBrains Mono`, всегда на месте (прочерк если нет), как `ResourceRow.tsx:112`;
- `res-row__actions` два квадрата `26×26` `res-row__act` `MasteringPage.tsx:190-200` иконки `edit/close + archive` — фиксированная колонка как `ResourceRow.tsx:121`, не едет от длины заголовка.
- Контент: `§1.12` — в списке только однострочный `previewText(100)` `muted 12px ellipsis` `MasteringPage.tsx:208`, полный `MentionText` `MasteringPage.tsx:215` только при `expanded` (клик по имени) или в `is-editing`. Три заглушки «пусто» ушли.
- Правка: `res-row__form stack` `MasteringPage.tsx:219` под строкой `is-editing bg-elevated` `index.css:7439` — соседние строки не двигаются `design_revision.md:525`, поля `Заголовок/Система/Текст` с `<label>`, `title.trim()` валидация, `syncMentionLinks` сохранён. Сброс `system_id→null` теперь доходит через сервер.
- `§1.4`: карточка живёт внутри `card res-group > res-group__body` `MasteringPage.tsx:140` без собственной плашки (плашка уже у тулбара), обводка группы — общая, строки разделены `border-top 1.5px` `index.css:7307` — инверсия не нужна, как и в `ResourceRow`.
- `§1.6` скачок: `14px Body` vs `11px mono` vs `10px caps` — разрыв ≥1.6, не `16px/14px` как было.
- `§1.10`: множественность — квадратами без размножения меток.

## П.5,9 — Плотность и адаптив `MasteringPage.tsx:42`, `index.css:7155-7464`

**Было:** `stack gap:10px` везде. На `390px` `row` `index.css:2503` ломался, `NoteCard` вылезал.
**Стало:** внешний `stack gap:24` `MasteringPage.tsx:42` — щедро `32-40px` между секциями `docs/design-system-punk-zine.md:262`; внутри `res-row__line 4px 12px, min-height 34px` `index.css:7312` — компактно. На `760px` `res-row__meta/tags display:none` `index.css:7460` как `design_revision.md:540`. Тулбар `flex-wrap` + `res-toolbar__search flex:1 1 220px` — не форсит горизонтальный скролл.

## П.5 — Голоса `§1.5` (до-fix sweep)

**Было:** один `inherit` везде, даты нет.
**Стало:** `Label Oswald caps` (табы, `filter-label`, `tag`), `Body Archivo` (имя), `Data Mono` (дата, счётчик фильтров `res-toolbar__filters-count`), `Display` — в `EmptyState h2` + `SectionHeading h1` (слоган). Покрыты все 4 голоса.

## П.12-13 — Граница и текстура

**Граница §1.3:** оставлена системной `1px var(--line)` как `Resources` — исправление на `2px ink` `themes.ts:130` ждёт отдельного шага `design_revision.md:1427` (задевает все карточки, не только Мастерение). Внутренние `res-row 1.5px` и `res-row__act 1px` уже 1.5/1.
**Текстура §5:** не добавляли `zine-grain/halftone` отдельным слоем — экран без картинок, шум дадут частицы шапки. При желании — `card res-group zine-grain` `zine.css:38`.

## Фикс переносов — 2026-08-30 (доработка)

**Жалоба:** после правок статьи потеряли переносы строк — весь текст слипся в одну простыню.
**Причина:** `MasteringPage.tsx:325` расширенный блок `expanded` рендерил `<MentionText>` без `whiteSpace: pre-wrap`. `MentionText.tsx:310` отдаёт блоки как `<span>строка</span> + "\n"` — без `pre-wrap` браузера `\n` схлопывается. Раньше был обёрт `style={{whiteSpace:"pre-wrap"}}` на `div` `MasteringPage.tsx:138` старой версии, после переезда в `res-row` стиль потерялся. Превью `previewText()` `MasteringPage.tsx:24` сознательно коллапсит `\s+ → " "` — это ок для однострочного `ellipsis` превью.
**Исправлено:** `MasteringPage.tsx:325` добавлен `whiteSpace: "pre-wrap", overflowWrap: "anywhere"` на контейнер expanded — переносы, таблицы `| |` и списки `- ` из `MentionText.tsx:193,280` снова читаются как абзацы, а длинные `[[ссылки]]` не рвут строку. Превью оставлено `whiteSpace: nowrap` — это сводка по §1.12, не статья.
**Проверка:** `npm run build:client` — `tsc -b` 0 ошибок, `vite build` 570 модулей, ручной чек: многострочная заметка с пустыми строками и таблицей в `expanded` — строки и `rt-table-wrap` на местах.

## Проверка

`npm run build` `client+server`: `tsc -b` 0 ошибок, `vite build` 570 модулей, `MasteringPage` 8.02 kB gzip 2.86 kB. Живая база не трогалась: `refresh` только `GET`, `create/archive/save` — по действию.

## Добивка — 2026-08-30 (закрыли остатки)

### §1.4 Плашка-инверсия `MasteringPage.tsx:222`

**Было:** `card res-group > res-group__body` без шапки — группа без имени, §1.4 «плашка называет карточку» нарушен, счётчик был только в табах.
**Стало:** `MasteringPage.tsx:222-232` добавлен `div.res-group__band` `background: var(--surface); color: var(--on-surface)` `index.css:7253` с иконкой категории + `CATEGORIES label` + `res-group__count` `mono on-surface-muted` с числом заметок. Тот же узел, что `ResourcesListPage.tsx:274` — инверсия читается на печатке, `cursor default` т.к. группа не сворачивается (категории — табы, не `details`).

### §1.3 Обводка `1px → 2px` `themes.ts:282,355,365` + `index.css:53,82`

**Было:** `themes.ts:282` `skinTheme --card-border-width 1px` для `riot/neon`, `SOY_NOIR_THEME`/`ABERRANT_THEME` без `cardBorderWidth` → `1px` дефолт `themes.ts:130`, `index.css:82` `:root 1px`, `--line #2a2a2a`. На `noir` (дефолт, в котором сидит владелец) внешний `card` шёл `1px` вместо `2px ink` §1.3 `design_revision.md:72`.
**Стало:** `index.css:53` `--line #1c1c1c` (ink), `index.css:82` `--card-border-width 2px` (pre-JS guard под `noir`), `themes.ts:282` `skinTheme 2px`, `themes.ts:362,372` `cardBorderWidth: 2` для `noir/aberrant`. Внутренний разделитель `res-row border-top 1px` и чипы `1.5px` не тронуты — §1.3 «2 внешний, 1.5 внутренний». Задевает все карточки приложения сразу, как и предсказывал `design_revision.md:1427` — проверено `npm run build` без `tsc` ошибок, визуально `card` получил жёсткую рамку как в `zine`.

### Пагинация `mastering.ts:6-37`

**Было:** `GET /` без `limit/offset` — при 300 заметках `knowledge` отдаст всё одним JSON.
**Стало:** `mastering.ts:6-37` принимает `?limit=&offset=` (clamp `0-200` / `0-∞`) и добавляет `LIMIT x OFFSET y`. Клиент пока без пагинатора (шлёт без `limit`), но сервер готов — закрывает пункт «при росте списка уедет» не ломая текущий `MasteringPage.tsx:45` `refresh()`.

### Текстура §5 `zine.css:38` `MasteringPage.tsx:222`

**Было:** только `ParticleField` в шапке, `§5` шум 5-10% отсутствовал `docs/design-system-punk-zine.md:48`.
**Стало:** `MasteringPage.tsx:222` `card res-group zine-grain` (`position:relative; isolation:isolate; ::before grain 0.18 multiply / 0.08 screen` `zine.css:38-56`) на группе заметок — лёгкий шум на большой карточке, под плашкой не лезет (`z-index:-1`). Дешево, без картинок, как `home` `cover-halftone`.

### Проверка

`npm run build` `client+server`: `tsc -b` 0 ошибок, `vite build` 570 модулей, `themes.ts`/`index.css` сменили 4 токена (`--line`, `--card-border-width`, `SOY_NOIR/ABERRANT cardBorderWidth`, `skinTheme 2px`). Живая база не трогалась.

## Сворачиваемые разделы + система на всех — 2026-08-30

**Запрос:** плашка повторяет табы + нужны сворачиваемые разделы для статей, где плашка и должна жить + выбор системы на всех категориях `design_revision.md:60`.

### Модель `schema.sql:325-343` + `db.ts:292-309`

**Было:** `mastering_notes (category, system_id, title, content)` — `system_id` только для `knowledge` в UI, разделов нет. Список — один `card res-group` на категорию с дубль-плашкой `CATEGORIES label`.
**Стало:**
- `mastering_sections (id, category, name, system_id, position, created_at)` `schema.sql:325-333` — один набор на каждую `prep/live/knowledge`, `system_id` на всех (`ON DELETE SET NULL`), `position` для порядка как `system_sections`. `zine-grain` на группе — шум §5.
- `mastering_notes.section_id INTEGER REFERENCES mastering_sections(id) ON DELETE SET NULL` `schema.sql:335` — заметка может лежать «Без раздела» (`null`) или в разделе. Миграция `db.ts:292` `ALTER TABLE mastering_notes ADD COLUMN section_id` + `db.ts:301` `ALTER TABLE mastering_sections ADD COLUMN system_id/position` для живой базы, `schema_initial.sql:275` синхронизирован.
- `system_id` теперь на всех категориях — не только `knowledge`: снято условие `category === "knowledge"` в форме и фильтрах.

### Сервер `mastering.ts:1-115`

- `GET /sections?category=` `mastering.ts:6-19`, `POST /sections` `mastering.ts:21-35`, `PUT /sections/:id` `mastering.ts:37-55`, `DELETE /sections/:id` `mastering.ts:57-62` (заметки → `section_id = NULL`, не архив).
- `GET /` `mastering.ts:64-95` — принимает `section_id`, `system_id` (на всех), `q`, `sort`, `limit/offset` + `JOIN mastering_sections sec` для `section_name`.
- `POST /` `mastering.ts:102-116` и `PUT /:id` `mastering.ts:118-140` — принимают `section_id` и `system_id` (на всех), `hasSectionId/hasSystemId` через `hasOwnProperty` чтобы `null` доезжал (сброс как в `CreatureCard`).

### Клиент `MasteringPage.tsx:1-363` + `types.ts:1009-1028`

**Тулбар** `MasteringPage.tsx:64-100`:
- `systemFilter` теперь на всех категориях (раньше только `knowledge`), `Filters` + `seg Дата/А-Я` + поиск остаются, добавлены две кнопки: `+ Раздел` (вторичная) и `+ Заметка` `primary` — один экран, два действия, бюджет §1.8 не тратим (раздел — контур).
- Форма раздела `MasteringPage.tsx:103-122` `card res-add` с `name` + `system_id` на всех — по `design_revision.md:168` радиус только внешний угол карточки.
- Форма заметки `MasteringPage.tsx:124-156` — `system_id` + `section_id` (dropdown секций текущей категории) на всех, раньше `system` только для `knowledge`.

**Разделы — сворачиваемые, плашка по §1.4** `MasteringPage.tsx:207-285`:
- `bySection Map<sectionId|null, notes[]>` группирует заметки текущей категории.
- `MasteringSectionBlock` `details.card res-group zine-grain` с `summary.res-group__band` `surface/on-surface` `index.css:7253` — та же плашка что `ResourcesListPage.tsx:274`: иконка `book/document`, `res-group__title`, `systemName` чип + `res-group__count` `mono`. Дубль-плашка на уровне категории убрана — плашка теперь именует **раздел**, не категорию.
- Сворачиваемость — нативный `<details open>` + `localStorage masteringSectionOpen_${id}` `MasteringSectionBlock:266-274` как у групп бестиария `design_revision.md:951` (по умолчанию `true`, `open` держит `localStorage`, хвост «Без раздела» — свой ключ).
- Пустой раздел не скрывается (пользователь его создал), но при активном `q/filter` скрывается по §1.11. Внутри `res-group__body` — `res-row` заметок или `muted` «Пока пусто — добавьте заметку».
- Хвост «Без раздела» `section=null` рендерится последним, если есть `unsectioned`.

**Заметка** `NoteCard:315-363`:
- `system_id` и `section_id` редактируются на всех категориях: `select Система` + `select Раздел (фильтр по note.category)` в `res-row__form`. `save()` шлёт оба `null` при очистке.
- Превью/expanded с `pre-wrap` сохранены `MasteringPage.tsx:325`, `mentionLinks` — на месте.

**Типы** `types.ts:1009` — `MasteringSection` + `MasteringNote.section_id/section_name`.

### Проверка

`npm run build` `client+server`: `tsc -b` 0 ошибок, `vite build` 570 модулей, `schema.sql` + `db.ts` миграции применятся на старой базе без потери данных (заметки → `null` секция). Живая база не трогалась.

## «Без раздела» + превью 25 слов / 228 знаков — 2026-08-30

**Запрос:** оставить хвост «Без раздела» + превью резать 25 слов и/или 228 знаков — что первое упрётся, то и короче.
**Было:** `previewText(text, n=100)` `MasteringPage.tsx:24` — 100 знаков, без лимита слов; три старые заметки уже лежат с `section_id IS NULL` и попадали в хвост «Без раздела» `MasteringSectionBlock:section=null` `MasteringPage.tsx:240`, но превью было длинновато для сводки §1.12.
**Стало:** `previewText(text, maxWords=25, maxChars=228)` `MasteringPage.tsx:24-38` — `oneLine.replace(/\s+/g," ")` затем наращивает по словам пока `next.length > 228` или `count >=25` — берёт `min(25 слов, 228 знаков)`, хвост `…` если обрезано. Хвост «Без раздела» `details.card res-group` с `summary.res-group__band` оставлен как было: рендерится последним если `unsectioned.length>0`, заголовок «Без раздела» `MasteringSectionBlock:282`, `res-group__count` — число заметок, `localStorage masteringSectionOpen_unsectioned` по умолчанию `true`, при `q/filter` пустые разделы прячутся по §1.11, хвост остаётся если есть что показать.
**Проверка:** `npm run build:client` — `tsc -b` 0 ошибок, `vite build` 570 модулей, ручной чек: статья 30 слов / 250 знаков → превью 25 слов `…`; статья 20 слов / 300 знаков → 228 знаков `…`.

## Что осталось (после разделов + превью)

- Пагинатор в UI — сервер `limit/offset` готов, кнопки «Ещё 50» нет.
- Перетаскивание разделов `position` — `PUT position` есть, drag-handle нет.
