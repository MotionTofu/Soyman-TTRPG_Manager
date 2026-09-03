# Карты — аудит 05 (генератор + редактор)

Дата: 2026-09-18. Область: `client/src/pages/MapsListPage.tsx`, `MapEditorPage.tsx`, `client/src/maps/{mapTypes,grid,generate,render}.ts`, `server/src/routes/maps{,.ts,Validation.ts}`, правила `design_revision.md` §1–§7 + §20 (canvas) + §7 (maps).

Метод: **4-звенный аудит** — чтение кода построчно + сверка с `design_revision.md`, `00_Отчёт_фундамент.md`, `План.md`, `Иерархия_карт.md`, `Находки.md`. Ручной прогон в браузере не делался (за владельцем по `Находки.md`). Ничего не правилось до обсуждения плана.

---

## Свод правил (design_revision.md) — compliance check §7 (maps)

| Правило | Статус | Комментарий |
|---|---|---|
| §7: Палитра террейна — 9 цветов, calm desaturated, NOT accent, NOT neon | ⚠️ **расхождение** | Код: 13 террейнов в `MAP_TERRAIN_FILL` (deep_water..wall). Дизайн утверждает 9. Возможно, некоторые (lava, acid, poison) — специальные пакеты C/D, но они попадают в рендер без фильтра. |
| §7: Дороги — ink текущего режима, NOT accent | ✅ | `render.ts:567` — `ctx.strokeStyle = chrome.ink` |
| §7: Выделенная кисть/клетка — outline (stroke), NOT fill accent | ❌ **нарушение** | `MapEditorPage.tsx:901-908` — `border: 2px solid var(--accent)`. Должно быть `1px solid var(--ink)` + внешний маркер. |
| §7: Тип сущности кодируется формой, не цветом (мотивы) | ✅ | `render.ts:68-92` — `drawTerrainMotif` использует сегменты/точки. `PATTERN_ON_DARK` — контраст тем/свет. |
| §7: Grid — 1px line, invariable | ✅ | `render.ts:775-798` — `ctx.lineWidth = 1; ctx.strokeStyle = chrome.line` |
| §7: Coordinates — Oswald, caps, tracking 0.08em, muted, only scale ≥18 | ⚠️ **частично** | `render.ts:803-816` — Oswald + `letterSpacing 0.08em` + `chrome.muted`, но размер `Math.min(11, Math.round(scale * 0.32))` и проверка `"letterSpacing" in ctx`. В `MapEditorPage` readout — другая гарнитура. |
| §7: Форма/контраст мотивов — темная заливка → светлый мотив, светлая → темный (ink) | ✅ | `render.ts:78-80` — `PATTERN_ON_DARK` вычисляется через `hexLum`; `ctx.strokeStyle = ink` на темном, `ctx.fillStyle = ink` на светлом. |

---

## 1. Аудит с точки зрения Графического дизайнера-перфекциониста

### Критические нарушения design_revision.md

1. **Палитра: 13 террайн vs 9 по design** (`render.ts:27-49`)
   - Design §7 четко: "9 цветов (MAP_TERRAIN_FILL в maps/render.ts): спокойные припылённые, не accent и не неон".
   - Код имеет 13 заполнений: deep_water, shallow_water, plain, forest, hills, mountains, desert, ice, swamp, lava, acid, poison, wall.
   - Лава/кислота/яд — пакет D (числа в отчёте), но они рендерятся без отдельной маркировки. Визуально на карте среди 9 "основных" эти 3 выделяются своим насыщенным цветом, что нарушает "calm desaturated palette".
   - **Риск:** При ЧБ-пети и дейтеранопии varias пар/plain/desert/hills сливаются (dLum разница < 0.02 у некоторых пар).

2. **Выделенная кисть — accent fill вместо outline** (`MapEditorPage.tsx:901-908`)
   - Текущий CSS: `border: 2px solid var(--accent)` на активной кнопке кисти.
   - Design §7: "выделено — обводкой, а не заливкой акцентом: 'выделено' — координатная отметка и в бюджете §1.8 не входит".
   - Более того, §1.3: "Обволкка одной толщины: 1 px по всему контуру". 2px даёт "жирные" разделители.
   - **Исправление:** `.map-tool[aria-pressed="true"]` → `outline: 1px solid var(--ink); box-shadow: 0 0 0 1px var(--accent)` или просто `border: 1px solid var(--ink)` с иконкой выбора.

3. **Координаты: гарнитура и声声** (`render.ts:803-816`)
   - Design §1.5: "Координаты — голос Label (Oswald, caps, tracking .08em), приглушённым".
   - Код использует `var(--font-ui, sans-serif)` как запасной стек —Design ревизия §2 уже пофиксила, что Data (JetBrains Mono) — это `--font-mono`, а Label (Oswald) принадлежит режиму. Проверка: в `render.ts` размер зависит от scale, но фолбэк `--font-ui` может быть не Oswald.
   - **Риск:** На экране в нуаре координаты могут отображаться иначе, чем в панке, что ломает когнитивную карту Мастера.

4. **Контраст палитры: лес/болото** (`render.ts:38-39`)
   - Было: лес `#75946F`, болото `#7E9070` — dLum 0.006, дейтеранопия 0.017 — practically indistinguishable.
   - Стало (предыдущие этапы): `#5F7D72` — разрыв тона 48°, dLum 0.078, дейтеранопия 0.067, sat 0.14 — различимы.
   - **Осталось:** Бежевое трио (пустыня `#D3BC87`, равнина `#C2B489`, холмы `#A89A7C`). dLum пары:plain-hills 0.139, desert-plain 0.155, hills-desert 0.132 — различимы, но близко по светлоте. При acterantopia могут сливаться.
   - **Рекомендация:** Довести разбieжку до dLum ≥0.15 у всех пар (например, холмы сделать `#A08060` или `#907050`).

### Neuzhlyemyye (на первый взгляд obvious) проблемы

5. **Легенда в редакторе** — только цветные квадраты 26×26 с `title`-тултипом. Новый игрок не расшифрует карту без легенды с названиями.
6. **Выбранная кисть выделяется.accent fill** — выглядит как ошибка интерфейса, а не намеренного дизайна.
7. **Координата readout в редакторе** использует `var(--font-mono)` вместо Oswald — inconsistency within the same screen.

---

## 2. Аудит с точки зрения Программиста (код, уязвимости, оптимизация)

### Critical code issues

1. **render.ts — 935 строк, монолитный рендерер**
   - Одна функция `renderMap` делает всё: заливка поля, мотивы, дороги, объекты, сетка, координаты, legenda, ховер.
   - Множественные проходы по `cells.terrain` (lines 528-563, 551-561) — одни и те же итерации для разных целей.
   - `hexLum` вычисляется при каждом рендере — можно мемоизировать, так какPalette статическая.
   - Магия чисел: `0.52*u`, `0.4*u`, `0.28*u` etc. — нет константных имен.

2. **generate.ts — двойной вычисления fbm** (`generate.ts:85-124`)
   - Строки 85-95: вычисляется `e = fbm(x,y,seed) - Math.max(0, d-0.75)*0.9` и сохраняется `isLand` + `mountainNoise`.
   - Строки 100-124: **тот же самый fbm вычисляется снова** для той же территории.
   - **Оптимизация:** Второй проход (100-124) нужен только для определения леса (f > forestT), но `isLand` и `mountainNoise` уже есть. Можно рефакторинг к одному проходу с условиями.

3. **Race condition автосейва** (`MapEditorPage.tsx:296-348`)
   - `saveSeqRef` + `pendingSeqRef`: два быстрых маза = два overlapping `PUT`.
   - `lastSavedRef` обновляется в `.then()`, но порядок ответов не гарантирован.
   - Если поздний ответ придет раньше — `pendingSeqRef !== seq` и он игнорируется, но изменения уже применены на клиенте.
   - **Риск:** Некорректный Zustand state, история может сбиться.

4. **parseCellsBlob — молча괴 данные** (`render.ts:347-427`)
   - `catch` блок возвращает пустую карту без сигнала.
   - Загрузка нормализует эталон (`193`), и первая же правка перезапишет сервер — исходные данные потеряны.
   - **Безопасность:** Нужно возвращать статус `corrupt` и показывать плашку с кнопкой "Разрешить перезапись".

5. **Thumbnail generation blocks UI** (`MapEditorPage.tsx:299-314`)
   - `renderThumbnail` делает `canvas.toDataURL()` каждые 800мс при автосейве.
   - Для карты 60×40 при плотности 32 —canvas 1920×1408 — дорогая операция.
   - **Оптимизация:** Кэш `thumbCacheRef` с TTL 2.5с; на паузе — свежее; при перезагрузке — null (сервер оставит старое).

6. **Сервер: raw English errors** (`server/src/routes/maps.ts`, `mapsValidation.ts`)
   - `translateMapError` переводитKnown RegExp-паттерны, но неизвестные ошибки отдаются "сырыми".
   - `validateCellsBlob` возвращает тексты на английском (хотя есть русские переводы в таблице).
   - **Нужно:** Весьма API должны отдавать русские ошибки или клиент должен гарантированно маппить.

### Проблемы архитектуры

7. **MAP_TERRAIN_ORDER vs MAP_TERRAIN_FILL discrepancy**
   - `mapTypes.ts:1-39` defines `MAP_SCALE_ORDER` and presets.
   - `render.ts:11-25` defines `MAP_TERRAIN_ORDER` (13 items).
   - `render.ts:27-49` defines `MAP_TERRAIN_FILL` (13 items).
   - `mapTypes.ts:31-38` defines `MAP_SCALE_PRESETS` (6 items).
   - **Inconsistency:** No single source of truth for which terrains exist at which scale.

8. **Hex grid rendering without culling** (`render.ts:522-527`)
   - Для гексов: `for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) { traceCell(x,y); ctx.fill(); }`
   - Без отсечения по visible cells — при 100×100 гексов и mousemove ховер — ~20k path operations за кадр.

---

## 3. Аудит с точки зрения Придирчивого пользователя (юзабилити, UX, навигация)

### "КАК ЭТО У ВАС НЕТ ТАКОГО?!" — очевидные промахи

1. **Тулбар перегружен** (`MapEditorPage.tsx:2118-2149`)
   - 8 инструментов + 3 размера кисти + undo/redo + очистить + генератор + PNG + Обмен + readout об автосейве.
   - На 390 px (фонд телефон) Instruments: 5 инструментов + 3 размера + readout занимают ~3-4 ряда. Текущий `clamp(420px,68vh,780px)` canvas, но тулбар вылезает за пределы или сжимается непонятно как.
   - **Критика:** Важно frequently используемые инструменты (кисть, дорога, ластик) должны быть доступны одним нажатием, редкие — подменю.

2. **"Generate" без подтверждения** (`MapEditorPage.tsx:401-423`)
   - `generate()` при непустой карте не показывает диалога подтверждения — только подпись в футере честно говорит «затрет всю роспись», ноmany users won't read it.
   - **Expected:** Модальное подтверждение с сидом/параметрами, как минимум один `useConfirm` перед заменой клеток.

3. **Legend buried** (`MapEditorPage.tsx:2358-2403`)
   - Тоггл "Легенда" есть, но он в подменю "Terrain" иконками без текста подписей. Новый мастер не поймёт, что за терренами цвета.
   - **Expected:** Постоянная панель легенды с цветом + названием, Collapsible, та herself — источник для PNG-легенды.

4. **Right-click silent** (`MapEditorPage.tsx:1717-1940`)
   - `onContextMenu: preventDefault` (1026) + `onPointerDown` right button не обрабатывается как инструмент (537-539 — только 0/1).
   - Пользователь жмет ПКМ — тишина. В подсказках (`1035`) про это "молчально" ни слова.
   - **Expected:** Either make right-click eraser immediately, or show a toast "Right-click = eraser (hold)" or "Coming soon".

5. **PNG export: too many options in toolbar** (`MapEditorPage.tsx:1276-1384`)
   - Чекбоксы сетки, координат, легенды, игрока, плотность — все в ряд инструментов.
   - **Expected:** Export dialog или submenu, а не переполненная тулбар. And defaults should be sensible: grid ON, coords OFF (on screen), legend ON, density 32.

6. **Import/Export JSON warnings** (`MapEditorPage.tsx:1094-1144`)
   - Валидация есть, но пользователю показывается только алерт после FileReader. Better: disable button "Import" if file format wrong, show inline hint.
   - thumbnail size limit 300k not visible until upload fails.

7. **No keyboard shortcuts cheat sheet** (`MapEditorPage.tsx:1638-1702`)
   - Hottkeys есть (B/G/E/I/R/M/T/V, +/-, 0, Esc), но нигде не показаны. Пользователь узнаёт случайно.
   - **Expected:** Подсказка "Hotkeys: B=brush, G=fill, E=eraser, I=picker, R=road, M=ruler, T=label" где-то внизу или при ховере.

8. **Player_visible checkbox placement** (`MapsListPage.tsx:2186-2200`)
   - Checkbox "Видят игроки" в тулбаре карты — но он меняет `player_visible` на сервере. Обычный пользователь может его видеть и менять, не понимая последствий.
   - **Expected:** Скрыто за гейтом `apiRoleGate`, или вынесено в настройки мастера.

### Мелкие но раздражающие

9. **Счётчик filtered/maps не кликабелен** (`MapsListPage.tsx:261-263`)
10. **PNG-name с кириллицей** — sanitized only `\/:*?"<>|`, пробелы и остальное оставлены, могут сломать `a.download`.
11. **Coordinate threshold 18** — нигде не объяснено, почему на экране выкл, а на бумаге нужны. Пользователь гадает.
12. **Границы гексов в миниатюре** — `renderThumbnail` использует свою формулу, отличную от `worldBounds()` из grid.ts — миниатюра может резать край гексов (P2-8 в прошлых аудитах это фиксилось, проверьте текущую реализацию).

---

## 4. Аудит с точки зрения Мастера игры (GM prep + print)

### "Накидай карту, чтобы понять во время игры"

1. **PNG export: нет легенды, нет cell_lore** (`MapEditorPage.tsx:1276-1384`)
   - По умолчанию легенда выкл, `cell_lore` не попадает в экспорт.
   - **GM needs:** "I need to print a map players can use at the table. Must show: what terrain type is what, scale, key (start/finish)."
   - **Missing:** Legend auto-included, `1 клетка = ...` in print, coordinates optional.

2. **Координаты только при scale ≥ 18** (`render.ts:803`)
   - GM может открыть карту на зуме 12 — координаты не видны. На бумаге scale иначе.
   - **Issue:** "I printed map at 32 px/cell, but coordinates are missing. Players can't find positions by letter-number."

3. **Маловероятные генератор параметры** (`generate.ts:12-17`)
   - Sea 20-80, mountains 0-40, forest 0-60 — что такое "много гор"? Для continua 40 = 30% поля, для locality 40 = ??? (locality max 60 but size 5×36 cells).
   - **GM needs:** "How many mountains will this have?" — ambiguous across scales.

4. **No scale reference on printed map** (`PNG export`)
   - Printed map has no visual scale bar. Only "1 клетка = 20 м" in legend — but if printed at different DPI, ratio changes.
   - **GM needs:** "Is this 1:5000 or 1:10000? I can't tell without ruler."

5. **Grid: ON for prep, OFF for print** (`showGrid toggle`)
   - GM wants grid on for planning, off for final print. Current toggle persists between sessions (localStorage).
   - **Issue:** "I forgot to turn off grid before printing, now grid lines on paper."

6. **Start/Finish markers clear but small** (`render.ts:726-771`)
   - Start: arc `#0a4a2a` fill + `#3dd68c` stroke. Finish: white rect + ink fill.
   - On small prints (A5, 100×100 px per cell), markers may disappear or merge with terrain.
   - **Issue:** "Start marker blended with forest terrain, not visible."

7. **Dungeon generation not intuitive** (`dungeon.ts` referenced but not detailed in current audit scope)
   - GM wants to quickly lay out a dungeon, but generator requires many params (rooms, corridors, secrets, traps).
   - **Issue:** "I just want a quick 5-room dungeon, not configure 7 parameters."

### "И можно на принтере распечатать"

8. **PNG density options insufficient** (`PNG_DENSITIES = [16, 24, 32, 48]`)
   - 16 px/cell: too small for table. 48: may exceed A4 width for large maps.
   - **Needed:** 64 (for large prints), or auto-scale to paper size.
   - Also: A4/A3 format selection, margins, `@media print` CSS.

9. **Legend not included in export** — GM cannot tell terrain types from printed map alone.

10. **Mobile preview unusable for prep** — GM uses phone to check details, but mobile toolbar is 3-4 rows (P2-6 in earlier audits), canvas clamped, difficult to edit.

---

## План исправлений (приоритетность)

### Этап 0 (готовительный)
- Зафиксировать этот аудит в `MapsAudition_05.md`
- Ручной прогон владельца по `Находки.md` п.10 обязателен
- Никаких откатов через git/GitHub без спроса (политика проекта)

### Этап 1 (P0 — данные, безопасность, тупики)
- **P0-1:** Переписать `paintAt` — считать `changed` ДО `setCells` (чистая функция от реф-cells), дублировать логику в тач-пути. Добавить `beforeunload` при `dirty/saving`. Кнопка "Повторить сохранение".
- **P0-2:** Убрать `thumbnail` из `GET /maps` (список) — отдельный endpoint `GET /maps/:id/thumbnail` с тем же гейтом видимости. Ленивая подгрузка в списке.
- **P0-3:** Защита от дуотона/халфтона на превью плиток карт — новый CSS-класс `.map-tile-art` без `.cover-halftone/.cover-photo`, только `background-image` как есть.
- **P0-4:** Добавить кнопки зума (`+`, `−`, `Вписать`) в тулбар MapEditor + readout `N пт/кл` + хоткеи `Equal/NumpadAdd`, `Minus/NumpadSubtract`, `Digit0/Numpad0`.
- **P0-5:** `generate()` — `useConfirm` перед генерацией при непустой карте со сводкой сид/море/горы/лес. По пустой — сразу генерирует.

### Этап 2 (дизайн-инвариант: P0-3, P1-1, P1-2, P1-3, P1-4)
- **P0-3 (переведено):** Плитка списка без дуотона/халфтона.
- **P1-1:** Акцент-бюджет в тулбаре: ноль `primary`. Панели Генератор/PNG — аккордеон: одновременно открыт один CTA — один горячий объект.
- **P1-2:** Выделенная кисть → `outline: 1px solid var(--ink)` + иконка выбора, а не `border: 2px solid var(--accent)`.
- **P1-3:** Координаты — стакан Oswald + `letterSpacing 0.08em` под гардом `"letterSpacing" in ctx`. Размер от scale как есть.
- **P1-4:** Разводка палитры: лес `#5F7D72` (уже исправлено), болото оставить. Бежевое трио (пустыня/равнина/холмы) — довести dLum ≥0.15 у всех пар (например, холмы сделать `#907050`).

### Этап 3 (UX-тупики: P1-8, P1-9, P1-10, P2-3)
- **P1-8:** UI редактора: меню карты (настройки: имя/масштаб/подпись/W+H с кропом + fitCamera; дублировать; удалить с useConfirm). Русские ошибки вместо английских.
- **P1-9:** Пипетка берёт оба слоя — Alt+клик по клетке с дорогой включает "Дорогу". С активной дорогой Alt+клик точечно снимает дорогу.
- **P1-10:** Правая кнопка — временный ластик ( eraseOverrideRef, инструмент не переключает, мазок — один undo-шаг).
- **P2-3:** Постоянная легенда редактора — collapsible панель с цветом + названием террейна, 9 типов + дорога. Источник для PNG-легенды.

### Этап 4 (мастер/печать/стол: P0-7, P2-1, P2-2, P2-4)
- **P0-7:** PNG экспорт: легенда дефолт ВКЛ, координаты дефолт ВКЛ (на экране выкл), плотность `16/24/32/64` (добавили 64), название/масштаб в шапке. Легенда включает: 9 террейнов + дорога + виды дверей (с учётом playerView) + `1 клетка = ...` моноширинным.
- **P2-1:** Инструмент "Линейка" (M): клик — начало, живой конец за курсором, клик — фиксация, третий — новый замер, Esc — сброс. В историю не идёт. Метрика — `cellDistance` + `parseCellLore()` → метры. Тач — замер тапами.
- **P2-2:** Подписи — слой blob v2 (`labels: [{x,y,text}]`, ≤200, текст 1–64). Рендер: точка-маркер + текст Oswald с бумажной обводкой. UI: инструмент "Подпись" (T) → модалка (правка/удаление).
- **P2-4:** Привязки карт: UI мастера — кнопка "Привязки · N" в шапке + карточка (список с отвязкой, селекты типа/сущности, локации через выбор сеттинга, уже привязанное скрыто из селекта, ошибки по-русски).

### Этап 5 (перф/надёжность: P1-5, P1-6, P1-7, P2-7, P2-8)
- **P1-5:** `renderMap` — только видимый диапазон (`vx0..vx1`, `vy0..vy1` с запасом клетка под гексы). Миниатюры через `pickThumbnail()`-кэш: те же клетки — готовое, строчка быстрее 2.5с — null. Дроссель через RAF не нужен (ховер бьётся о то же значение).
- **P1-6:** Отправка в `sendSave()` с монотонным `saveSeqRef` — устаревший ответ игнорируется, побеждает поздний мазок. Автосейв и "Повторить" через него.
- **P1-7:** Битый blob — плашка "показана пустая карта, автосохранение остановлено", снятие кнопкой "Понял, разрешаю перезапись".
- **P2-7:** Canvas — `role="img"` + `aria-label`; скрытый живой регион `aria-live="polite"` объявляет инструмент/террейн/статус.
- **P2-8:** Счётчик списка — кнопка "Сбросить" при активных фильтрах; title redo — `Ctrl+Shift+Z / Ctrl+Y`; формула границ гексов в `renderThumbnail` — вызов `worldBounds()`; порог координат 18 объяснён; `parent_map_id`/`thumbnail` через `COALESCE` нельзя сбросить в NULL — принято как есть.

### Этира 6 (мастерские доработки, не в текущий sprint)
- Paquet C (данж-генератор)
- Paquet D (сервисное: readout, миникарта, JSON, воды)
- Мобильный тулбар (P2-6) — ОТЛОЖЕНО в `На_будущее.md`
- Показ на стол (P2-5) — ОТЛОЖЕНО в `На_будущее.md`

---
*Последнее обновление: 2026-09-18. Этот документ — аудит и план. Отчёты о выполнении разделов дописываются вниз по мере закрытия пунктов. Следующая команда после обсуждения определит, какой этап начать первым.*