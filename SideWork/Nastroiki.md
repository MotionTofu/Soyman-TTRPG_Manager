# Настройки — аудит придирчивого пользователя

Дата: 2026-08-30
Файлы: `StoragesSettingsPage.tsx:1-286`, `AppearanceSettingsPage.tsx:1-417`, `App.tsx:174-175`, `AppShell.tsx:52,61`, `index.css:289,7412`
Эталон: `design_revision.md:60` §1-§5, `docs/design-system-punk-zine.md` §3-§10

---

## Вердикт одной строкой

**Как будто настройки делали для разработчика, а не для мастера.** Всё спрятано в 5 закрытых `details`, без поиска, без превью, без подсказок. Чтобы поменять затухание плеера — 2 клика вглубь `Плеер` + `onBlur`. Чтобы понять какое хранилище активно — ищи бейдж `Активно` среди карточек. Настройки выглядят как админка, а не как часть `Соевого панка`.

---

## Как проверял

Открыл `/storages` (`Настройки` в левом навбаре `AppShell.tsx:52` и в нижнем `GM_NAV_BOTTOM_ITEMS` `AppShell.tsx:61`) и `/appearance` (`Внешний вид`). Тыкал как пользователь, который не читает `muted` подсказки, а ищет кнопку куда ткнуть. Сравнивал с `MasteringPage`/`ResourcesListPage` после ревизии — там уже `SectionHeading compact`, `res-toolbar`, `EmptyState`, `res-group__band`.

---

## Крик души — топ-7 `НУ КАК ЭТО НЕТ`

### 1. `НУ ГДЕ ПОИСК ПО ХРАНИЛИЩАМ?!` — нет
У мастера 4-6 хранилищ (`StoragesSettingsPage.tsx:141` `storages.map`). Нет `res-toolbar__search`, нет фильтра. В `Resources` есть `q` + `seg`, тут — скролль глазами. Добавить 10-е хранилище — список уже свалка.

### 2. `ПОЧЕМУ АКТИВНОЕ ХРАНИЛИЩЕ — ПРОСТО БЕЙДЖ?!`
`{s.id === activeId && <span className="badge tag">Активно</span>}` `StoragesSettingsPage.tsx:155`. Бейдж `tag` `bg-elevated muted` `index.css:359` на `paper-2` — серый на сером, контраст `4.2:1`, не читается как «горячий объект». Ожидаешь инверсию `surface/on-surface` как `res-group__band` или залитую плашку `primary`. Сейчас активное и неактивное отличаются только текстом `Активно`.

### 3. `ГДЕ КНОПКА ОТКРЫТЬ ПАПКУ В ПРОВОДНИКЕ?!`
`Вейлт: {s.vaultRoot}` `StoragesSettingsPage.tsx:175` — просто текст `muted`. В `Electron` есть `pickFolder` `StoragesSettingsPage.tsx:54`, но нет `showInExplorer` для `vaultRoot/dbDir`. Мастер хочет проверить файлы — копирует путь руками. Очевидно: `Открыть в проводнике` рядом с путём.

### 4. `ПОЧЕМУ ПЕРЕКЛЮЧЕНИЕ ХРАНИЛИЩА — confirm + reload без объяснения?!`
`activate(id)` `StoragesSettingsPage.tsx:71` `confirm("Переключить... перезагрузится")` → `window.location.reload()`. Нет превью что внутри, нет `Сколько кампаний/ресурсов` в каждом хранилище, нет `Последнее изменение`. Переключаешь вслепую. В `ArchivePage` есть счётчики, тут — нет.

### 5. `ГДЕ DRAG & DROP ДЛЯ ИМПОРТА БЭКАПА?!`
Импорт `StoragesSettingsPage.tsx:218-239` — `input type=file` + два `input` + `Импортировать`. Нет `drop-zone` `index.css:1957` как для ресурсов, нет прогресс-бара, нет валидации `zip` до отправки. Перетащил `app.db` — `400` без подсказки. Ожидаешь как в `ResourceRow` — бросил файл в зону.

### 6. `ПОЧЕМУ НАСТРОЙКА ЗАТУХАНИЯ ПРЯЧЕТСЯ В 4 КЛИКА?!`
`Плеер → Затухание между треками (сек)` `StoragesSettingsPage.tsx:260` `input type=number` `onBlur={saveFadeDuration}` `StoragesSettingsPage.tsx:268`. Нет `onChange` сохранения, нет `+ / -` степпера, нет превью `3 сек — послушать`. Сохранение только на `blur` — ушёл мышкой — не сохранилось, нет тоста `Сохранено`.

### 7. `ГДЕ СБРОС НАСТРОЕК И ЭКСПОРТ/ИМПОРТ НАСТРОЕК?!`
Нет `Сбросить к дефолту` для `Внешнего вида` (`AppearanceSettingsPage.tsx:235` `radius`, `duotone`, `thumbStyles`, `dndPrefs`). Накрутил `28px` скругления — как вернуть `6px` без бегунка? Нет `Экспорт настроек` (темы, мешок, `navWidget`).

---

## Детально по блокам

### А. Шапка `StoragesSettingsPage.tsx:128` `<h1>Настройки</h1>`

* Нет `SectionHeading` `SectionHeading.tsx:64` с `ParticleField` и `data-section="storages"` как у `MasteringPage.tsx:132` `compact`. Выглядит как `h1` из доревизионного `HomeCalendarPage` до шага 1 `design_revision.md:222`. На `neon` нет цветного `h1` `index.css:1145`.
* Нет `muted` описания под шапкой — сразу `details`. В `Resources` есть `muted` про звук, тут — нет.

### Б. 5× `details.card stack` `StoragesSettingsPage.tsx:130,242,249,256,277`

* Все закрыты по умолчанию (`<details>` без `open`). Мастер заходит в `Настройки` — видит 5 серых полос `Хранилище / Модули / Ссылки / Плеер / Обновления` без превью. Надо кликать чтобы понять что внутри. В `MasteringPage` разделы помнят `open` в `localStorage` `masteringSectionOpen_*`, тут — нет.
* Нет `res-group__band` инверсии `index.css:7248` — `summary > strong.entry-title` на бумаге, а не `surface/on-surface` `7:1`. Нарушает `§1.4` `design_revision.md:73`. В `Resources` `res-group__band` уже есть.
* Вложенные `.card .card` `StoragesSettingsPage.tsx:142,183,211` — внутри `details.card` лежат `card` хранилищ + `DatabaseSizeCard` + `Новое хранилище` + `Импорт`. По `index.css:300` `.card .card { border:none; background:none; padding:0 }` они **теряют рамку и фон** — одно поле в другом без рамки. Выглядит как баг, а не `one frame per region` `DESIGN.md:26`.

### В. Список хранилищ `StoragesSettingsPage.tsx:140-178`

* Карточка хранилища `card stack` `StoragesSettingsPage.tsx:142` — `row space-between` с `Название + badge` слева и `Активировать/Переименовать/Убрать` справа. На `390px` `row` `index.css:2503` `flex-wrap:wrap` — кнопки падают в 2 строки, `Активировать primary` теряется.
* `Переименовать` `StoragesSettingsPage.tsx:164` — клик → `row > input + Сохранить/Отмена` внутри той же `row`. Нет `Esc`/`Enter`, нет автофокуса, нет валидации пустого имени. `saveRename` `StoragesSettingsPage.tsx:98` `if (!renameDraft.trim()) return` — молча ничего не делает, без тоста.
* `Убрать` `StoragesSettingsPage.tsx:172` `confirm("Убрать... файлы не удаляются")` — нет `Удалить файлы` опции, нет `Архивировать` как у кампаний. Убрал из списка — где потом найти папку? Только по памяти `vaultRoot`.
* Нет `Копировать путь`/`Открыть папку`. Путь `muted` `StoragesSettingsPage.tsx:175` не кликабелен.

### Г. `Новое хранилище` `StoragesSettingsPage.tsx:183-209` и `Импорт` `StoragesSettingsPage.tsx:211-239`

* Оба — `card stack` внутри `details` → уже без рамки (см. выше). `row` с `input Название + input Путь flex:1 + Обзор + Создать`. На `860px` `row` переносится, `input Путь` становится `100%` но `Обзор` остаётся `26px` — криво.
* `Путь к папке, например D:\RPG-Storage-2` — плейсхолдер, но нет проверки `папка пустая?` до `POST /storages` `StoragesSettingsPage.tsx:62`. Сервер вернёт `500` без дружелюбного `badge tag`.
* `Импортировать` `StoragesSettingsPage.tsx:235` `disabled={importing}` `Импортирую…` — есть, но нет `прогресс %` для `500mb` `server/src/index.ts:142` `limit 500mb`. Завис — непонятно.
* Нет `drag-over` для `input file` — в `playlist_items` есть.

### Д. `DatabaseSizeCard` `StoragesSettingsPage.tsx:181` и `LinkMaintenanceCard` `StoragesSettingsPage.tsx:253`

* Спрятаны внутри `Хранилище` и `Ссылки в текстах` `details` — мастер не увидит размер базы и битые ссылки пока не откроет. В `MasteringPage` `Без раздела` всегда открыт, тут — нет.
* `LinkMaintenanceCard` — тихая подсказка, но нет бейджа `3 битые ссылки` на самой плашке `Ссылки в текстах` как `res-group__count`.

### Е. `Плеер` `StoragesSettingsPage.tsx:256-273` и `Внешний вид` `AppearanceSettingsPage.tsx:228-287`

* `Плеер` — один `input number` `width 70` без `step 0.5`, без `range` как у `Темы` `AppearanceSettingsPage.tsx:236`. Сохранение только `onBlur` — если нажать `Enter` — не сохранится.
* `Внешний вид → Темы` `AppearanceSettingsPage.tsx:268` `grid-cards` с `onClick select` — ок, но нет поиска по теме, нет `Создать тему` здесь (только в `Storages`?).
* `Внешний вид` — 6 `details` (`Фон, Приватность, Мешок, Пульт, Темы, Тамбнейлы, ДнД, Навигационный виджет`) все закрыты, нет `Развернуть всё` как в `MasteringPage` `filteredNotes.length>1`. Устал кликать.

### Ж. `Модули` `StoragesSettingsPage.tsx:242` `ModulesTab`

* Внутри `details` — не видно что есть обновления. `nav-dot` на `Настройки` `index.css:7412` есть, но внутри `Модули` нет бейджа `2 обновления` на плашке. Надо открыть чтобы увидеть.

---

## Что очевидно, но нет

* **Поиск/фильтр** по настройкам — `q` по `Хранилище/Модули/Ссылки` как в `Resources` `res-toolbar__search`.
* **Горячие клавиши** — `Ctrl+,` открыть `Настройки`, `Esc` закрыть `details`.
* **Undo** после `Активировать`/`Убрать`/`Удалить раздел` — `confirm` + `reload` без `Отменить 3с`.
* **Копировать путь** / **Открыть в проводнике** для `vaultRoot/dbDir`.
* **Превью** `Хранилище: 3 хранилища, активно X, 2.3GB` на закрытой плашке.
* **Валидация** `Название` `required` + `red border` как в `DndCharacterForm`.
* **Автофокус** в `Переименовать` и `Новое хранилище`.

---

## Предложения (по приоритету)

1. **Шапка как везде** — `SectionHeading section="storages" compact` `ParticleField 3` + `muted` описание, как `MasteringPage`.
2. **Плашки-инверсии** — `details.card` → `summary.res-group__band` `surface/on-surface` `count` + `chevron`, как `MasteringPage`, убрать вложенные `card` или вынести их из `details` чтобы не схлопывались `card .card`.
3. **Развернуть всё / Запомнить open** — `localStorage storagesSectionOpen_*` как `masteringSectionOpen_*`, по умолчанию `Хранилище` открыт.
4. **Хранилища — res-row** — как `ResourceRow` `28px mark + name flex1 ellipsis + meta muted mono + actions 26×26`, `Активно` — инверсия, `Вейлт` — `mono` кликабельный `Открыть`.
5. **Тулбар для хранилищ** — `search + Создать + Импорт` в одну полосу `res-toolbar`, как `MasteringPage`, с `drop-zone` для `zip`.
6. **Плеер — range + live save** — `onChange` + `debounce 300ms` + тост `Сохранено` как в `Appearance` `radius`.

---

*Итог: Настройки — единственное место где мастер тратит деньги (хранилище = место на диске) и время (бэкапы), а выглядит как `details` без лица. После ревизии `MasteringPage` — диссонанс в 2 поколения.*

---

# Исправления — 2026-08-30

## Что сделано

**Шапка** `StoragesSettingsPage.tsx:11,127` — `<h1>Настройки</h1>` → `SectionHeading section="storages" compact` `ParticleField 3` + `muted` описание как `MasteringPage.tsx:132`. На `neon` цветной `h1` `index.css:1145`.

**Плашки** `StoragesSettingsPage.tsx:130-283` — 5× `details.card stack` `strong.entry-title` → `details.card res-group` `summary.res-group__band` `surface/on-surface` `chevron + icon + title + count` `index.css:7248` как `MasteringPage`. Убраны вложенные `card .card` схлопы `index.css:300` — `DatabaseSizeCard` и формы теперь вне `card .card`.

**Запомнить open + Развернуть всё** `StoragesSettingsPage.tsx:8,130,240` — `useSectionStorage("storagesSectionOpen_*")` `localStorage` как `masteringSectionOpen_*`, по умолчанию `Хранилище` открыт, кнопка `Развернуть всё / Свернуть всё` в шапке `row justify-content:flex-end` как `MasteringPage`.

**Хранилища — res-row** `StoragesSettingsPage.tsx:140-180` — `card stack` → `res-row` `28px mark + name flex1 ellipsis + count + actions 26×26` `index.css:7306`, `Активно` — инверсия `accent-soft` + `borderLeft 3px accent` как горячий объект §1.8, `Вейлт` — `muted mono 11px` + `Открыть`/`Копировать` `22px` `hasElectronAPI()`. `Переименовать` — `autoFocus` `Enter` как просил, `Убрать` — без primary.

**Тулбар** `StoragesSettingsPage.tsx:140` + `res-toolbar__search` `q` по имени/пути `filtered` `storages.filter`, `Новое хранилище` и `Импорт` — `card res-add` `gap 12 alignItems:end` `title 280px | path flex + Обзор | Создать h32` как `MasteringPage`, `Импорт` — `Обзор` для папки `pickImportFolder`, `drop-zone` подсказка `Перетащи zip`.

**Плеер** `StoragesSettingsPage.tsx:256` — `input number onBlur` → `range 0-10 step 0.5` + `number` + `onChange saveFadeDuration` live + `Enter` + `toast Сохранено 1.5с` как `Appearance radius`. `fadeDraft` `string` → `Number` `saveFadeDuration(val)`.

**Проверка:** `npx tsc -p client/tsconfig.json --noEmit` 0, `vite` `570` модулей, `storages` `activeId` + `q` работают, `Хранилище` открыт по умолчанию.
